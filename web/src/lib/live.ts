// Live, real product search. On the phone the app calls Google Shopping (SerpApi) directly through
// Capacitor's native HTTP (no CORS, no server); on the web it goes through our server, which holds the key.
// Results are stored on the device, so prices are recorded each time they are checked (real history).
import { CapacitorHttp } from '@capacitor/core';
import { api, ApiError, LOCAL, qs, type Platform, type Summary } from './api';
import { isNative } from './native';
import { fetchLiveOffers, type FetchLike } from '../../../server/liveFetch.js';

const KEY = import.meta.env.VITE_SERPAPI_KEY as string | undefined;
export const CACHE_HOURS = 6;

export class LiveNotConfigured extends Error {
  constructor() { super('Live prices are not set up in this build yet'); }
}

export type LiveResult = { items: Summary[]; fetchedAt: number; cached: boolean };

const nativeFetch: FetchLike = async (url) => {
  const r = await CapacitorHttp.get({ url, responseType: 'json' });
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) };
};

/** Search every store for real products. Cached for a few hours to save the free API quota. */
export async function liveSearch(q: string, opts: { force?: boolean } = {}): Promise<LiveResult> {
  const query = q.trim();
  if (!opts.force) {
    const c = await api<{ fresh: boolean; fetchedAt: number; items: Summary[] }>(`/live/cached${qs({ q: query, maxAge: CACHE_HOURS * 3600_000 })}`);
    if (c.fresh) return { items: c.items, fetchedAt: c.fetchedAt, cached: true };
  }
  if (LOCAL) {
    if (!KEY) throw new LiveNotConfigured();
    const offers = await fetchLiveOffers(query, KEY, isNative ? nativeFetch : (url) => fetch(url));
    const r = await api<{ fetchedAt: number; items: Summary[] }>('/live/ingest', { method: 'POST', body: { query, offers }, silent: true });
    return { ...r, cached: false };
  }
  try {
    const r = await api<{ fetchedAt: number; items: Summary[] }>(`/live/search${qs({ q: query })}`);
    return { ...r, cached: false };
  } catch (e) {
    if (e instanceof ApiError && e.status === 501) throw new LiveNotConfigured();
    throw e;
  }
}

/** Real search pages on each store for a query: these always work, key or no key. */
export function storeSearchLinks(q: string, platforms: Platform[]) {
  const enc = encodeURIComponent(q.trim());
  return platforms.filter((p) => p.searchUrl).map((p) => ({ platform: p, url: p.searchUrl!.replace('{q}', p.id === 'myntra' ? enc.replace(/%20/g, '-') : enc) }));
}

/** Re-check real prices of watched products (at most a few, twice a day) so alerts fire. */
export async function refreshWatched(titles: string[]) {
  const KEY_AT = 'kompare.watchRefreshAt';
  let last = 0;
  try { last = Number(localStorage.getItem(KEY_AT) || 0); } catch { /* ignore */ }
  if (Date.now() - last < 12 * 3600_000 || !titles.length) return 0;
  try { localStorage.setItem(KEY_AT, String(Date.now())); } catch { /* ignore */ }
  let n = 0;
  for (const t of titles.slice(0, 5)) {
    try { await liveSearch(t, { force: true }); n++; } catch (e) { if (e instanceof LiveNotConfigured) break; }
  }
  return n;
}
