import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMeta, useTitle } from '../lib/hooks';
import { CACHE_HOURS, LiveNotConfigured, liveSearch, storeSearchLinks } from '../lib/live';
import { recentSearches } from '../lib/recent';
import { ago } from '../lib/format';
import { Empty, Grid } from '../components/ui';
import { SearchBox } from '../components/Header';
import type { Summary } from '../lib/api';

const SORTS = [['relevance', 'Best match'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['stores', 'Most stores']] as const;
type Sort = (typeof SORTS)[number][0];

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') || '').trim();
  const sort = (params.get('sort') as Sort) || 'relevance';
  const store = params.get('store') || '';
  const { list } = useMeta();
  const qc = useQueryClient();
  useTitle(q ? `“${q}”` : 'Search');

  const live = useQuery({
    queryKey: ['live', q.toLowerCase()],
    queryFn: () => liveSearch(q),
    enabled: !!q,
    staleTime: CACHE_HOURS * 3600_000,
    retry: (n, e) => !(e instanceof LiveNotConfigured) && n < 1,
  });
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try { qc.setQueryData(['live', q.toLowerCase()], await liveSearch(q, { force: true })); } catch { /* keep current results */ } finally { setRefreshing(false); }
  };

  const items = useMemo(() => {
    let r: Summary[] = live.data?.items || [];
    if (store) r = r.filter((p) => p.platforms.includes(store));
    const s = [...r];
    if (sort === 'price_asc') s.sort((a, b) => a.bestPrice - b.bestPrice);
    if (sort === 'price_desc') s.sort((a, b) => b.bestPrice - a.bestPrice);
    if (sort === 'stores') s.sort((a, b) => b.offers - a.offers);
    return s;
  }, [live.data, sort, store]);
  const storesInResults = useMemo(() => list.filter((p) => live.data?.items.some((i) => i.platforms.includes(p.id))), [list, live.data]);

  const set = (k: string, v?: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    setParams(n, { replace: true });
  };
  const links = storeSearchLinks(q, list);
  const notConfigured = live.error instanceof LiveNotConfigured;

  return (
    <section>
      <div className="tab-search"><SearchBox autoFocus={!q} /></div>
      {!q && <EmptyState onPick={(v) => { recentSearches.add(v); setParams({ q: v }); }} />}

      {q && (
        <>
          <div className="section-head">
            <div>
              <h1 className="section-title">Results for “{q}”</h1>
              <div className="muted sm">
                {live.isLoading ? 'Checking live prices across stores…' : live.data ? `${items.length} products · prices checked ${ago(live.data.fetchedAt)}` : ' '}
              </div>
            </div>
            {live.data && (
              <div className="row gap">
                <select aria-label="Sort by" value={sort} onChange={(e) => set('sort', e.target.value === 'relevance' ? undefined : e.target.value)}>
                  {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button className="btn sm" disabled={refreshing} onClick={refresh}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
              </div>
            )}
          </div>

          {storesInResults.length > 1 && (
            <div className="recent-searches">
              <button className={`chip${!store ? ' on' : ''}`} onClick={() => set('store')}>All stores</button>
              {storesInResults.map((p) => <button key={p.id} className={`chip${store === p.id ? ' on' : ''}`} onClick={() => set('store', p.id)}>{p.name}</button>)}
            </div>
          )}

          {notConfigured ? (
            <div className="notice"><b>Live price comparison is not switched on in this build.</b>Use the store links below to see real results for “{q}” on each store. (Setup: README → Live prices.)</div>
          ) : live.isError ? (
            <div className="notice"><b>Couldn't load live prices</b>{(live.error as Error).message}. Check your internet connection, or use the store links below.</div>
          ) : (
            <Grid items={items} loading={live.isLoading} empty={<Empty title="No live results" icon="🔍"><p className="muted">Try a more specific name, e.g. a model number, or search the stores directly below.</p></Empty>} />
          )}

          <div className="card pad-lg" style={{ marginTop: 20 }}>
            <h3 className="section-title sm">Search “{q}” directly on each store</h3>
            <div className="store-links">
              {links.map(({ platform, url }) => (
                <a key={platform.id} className="store-link" style={{ ['--pc' as string]: platform.color }} href={url} target="_blank" rel="noopener noreferrer"><i />{platform.name} ↗</a>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  const { categories } = useMeta();
  const [recent, setRecent] = useState(recentSearches.list);
  return (
    <div className="stack">
      {recent.length > 0 && (
        <div className="recent-searches">
          <span className="xs muted">Recent</span>
          {recent.map((v) => <button key={v} className="chip" onClick={() => onPick(v)}>🕘 {v}</button>)}
          <button className="link xs" onClick={() => { recentSearches.clear(); setRecent([]); }}>Clear</button>
        </div>
      )}
      <div>
        <h2 className="section-title sm">Popular searches</h2>
        <div className="recent-searches">{categories.map((c) => <button key={c.id} className="chip" onClick={() => onPick(c.query)}>{c.emoji} {c.query}</button>)}</div>
      </div>
      <p className="muted sm">Search any product: we check live prices on Amazon, Flipkart, Myntra, Croma and more, and link you to the real listing.</p>
    </div>
  );
}
