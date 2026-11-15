// Fetching + parsing live Google Shopping results (SerpApi). No database code here, so the
// mobile app can import it directly.
import { slugify } from './util.js';

export const SERPAPI_URL = 'https://serpapi.com/search.json';

/** Build the Google Shopping request for India. */
export function serpApiUrl(query, apiKey) {
  const p = new URLSearchParams({ engine: 'google_shopping', q: query, gl: 'in', hl: 'en', google_domain: 'google.co.in', location: 'India', num: '40', api_key: apiKey });
  return `${SERPAPI_URL}?${p}`;
}

/** Fetch live offers (works on Node and in the app; the native app's fetch has no CORS limits). */
export async function fetchLiveOffers(query, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(serpApiUrl(query, apiKey));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = String(data.error || `HTTP ${res.status}`);
    const err = new Error(/run out|limit/i.test(msg) ? 'Monthly live-search limit reached on your SerpApi plan' : /invalid api key/i.test(msg) ? 'The SerpApi key is invalid' : `Live search failed: ${msg}`);
    err.status = res.status === 401 ? 401 : 502;
    throw err;
  }
  return normalizeResults(data);
}

const KNOWN = [
  [/amazon/i, 'amazon'], [/flipkart/i, 'flipkart'], [/myntra/i, 'myntra'], [/ajio/i, 'ajio'], [/croma/i, 'croma'],
  [/reliance\s*digital|reliancedigital/i, 'reliance'], [/tata\s*cliq/i, 'tatacliq'], [/nykaa/i, 'nykaa'], [/meesho/i, 'meesho'],
];
export function platformIdFor(source) {
  for (const [re, id] of KNOWN) if (re.test(source)) return id;
  return slugify(source).slice(0, 40) || 'other';
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : typeof v === 'string' ? Math.round(Number(v.replace(/[^\d.]/g, ''))) || null : null);
const isHttp = (u) => typeof u === 'string' && /^https?:\/\//.test(u);

/** SerpApi google_shopping response → flat list of offers. */
export function normalizeResults(data) {
  const raw = [
    ...(data.shopping_results || []),
    ...(data.inline_shopping_results || []),
    ...((data.categorized_shopping_results || []).flatMap((c) => c.shopping_results || [])),
  ];
  const seen = new Set();
  const offers = [];
  for (const r of raw) {
    const price = num(r.extracted_price ?? r.price);
    const link = isHttp(r.link) ? r.link : isHttp(r.product_link) ? r.product_link : null;
    if (!r.title || !price || !link || !r.source) continue;
    const key = `${r.source}|${r.title}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    offers.push({
      title: String(r.title).slice(0, 200),
      source: String(r.source).slice(0, 60),
      price,
      oldPrice: num(r.extracted_old_price ?? r.old_price),
      link,
      googleLink: isHttp(r.product_link) ? r.product_link : null,
      image: isHttp(r.thumbnail) ? r.thumbnail : null,
      rating: typeof r.rating === 'number' ? r.rating : null,
      reviews: typeof r.reviews === 'number' ? r.reviews : null,
      delivery: typeof r.delivery === 'string' ? r.delivery.slice(0, 80) : null,
      productId: r.product_id ? String(r.product_id) : null,
    });
  }
  return offers;
}

