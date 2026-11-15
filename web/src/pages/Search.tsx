import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs, type Summary } from '../lib/api';
import { useMeta, useTitle } from '../lib/hooks';
import { Empty, ErrorBox, Grid } from '../components/ui';
import { SearchBox } from '../components/Header';

const SORTS = [
  ['relevance', 'Relevance'], ['trending', 'Trending'], ['popular', 'Best selling'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'],
  ['discount', 'Biggest discount'], ['drop', 'Biggest price drop'], ['spread', 'Most saved by comparing'], ['rating', 'Top rated'],
] as const;

export default function Search() {
  const [params, setParams] = useSearchParams();
  const { categories, list } = useMeta();
  const f = Object.fromEntries(params.entries());
  const page = Number(f.page || 1);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['products', f],
    queryFn: ({ signal }) => api<{ total: number; pages: number; items: Summary[] }>(`/products${qs({ ...f, limit: 24 })}`, { signal }),
    placeholderData: keepPreviousData,
  });
  const cat = categories.find((c) => c.id === f.category);
  useTitle(f.q ? `“${f.q}”` : cat?.name || 'All products');

  const set = (k: string, v?: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    if (k !== 'page') n.delete('page');
    setParams(n, { replace: k !== 'page' });
  };

  return (
    <div className="search-page">
      <aside className="filters card">
        <h3>Filters</h3>
        <label>Category
          <select value={f.category || ''} onChange={(e) => set('category', e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Store
          <select value={f.platform || ''} onChange={(e) => set('platform', e.target.value)}>
            <option value="">All stores</option>
            {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div className="row gap">
          <label>Min ₹<input type="number" min={0} inputMode="numeric" defaultValue={f.minPrice} key={`min${f.minPrice}`} onBlur={(e) => set('minPrice', e.target.value)} /></label>
          <label>Max ₹<input type="number" min={0} inputMode="numeric" defaultValue={f.maxPrice} key={`max${f.maxPrice}`} onBlur={(e) => set('maxPrice', e.target.value)} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.inStock === '1'} onChange={(e) => set('inStock', e.target.checked ? '1' : undefined)} /> In stock only</label>
        {params.toString() && <button className="btn ghost sm" onClick={() => setParams(new URLSearchParams(f.q ? { q: f.q } : {}))}>Clear filters</button>}
      </aside>
      <section>
        <div className="tab-search"><SearchBox autoFocus={!f.q && !f.category && !f.sort} /></div>
        <div className="section-head">
          <div>
            <h1 className="section-title">{f.q ? <>Results for “{f.q}”</> : cat?.name || 'All products'}</h1>
            <div className="muted sm">{data ? `${data.total} products` : ' '}{isFetching && !isLoading ? ' · updating…' : ''}</div>
          </div>
          <select aria-label="Sort by" value={f.sort || 'relevance'} onChange={(e) => set('sort', e.target.value)}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {isError ? <ErrorBox error={error} retry={refetch} /> : (
          <Grid items={data?.items} loading={isLoading} empty={<Empty title="No products match" icon="🔍"><p className="muted">Try a different search or remove some filters.</p></Empty>} />
        )}
        {data && data.pages > 1 && (
          <div className="pager">
            <button className="btn" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>← Prev</button>
            <span className="muted">Page {page} of {data.pages}</span>
            <button className="btn" disabled={page >= data.pages} onClick={() => set('page', String(page + 1))}>Next →</button>
          </div>
        )}
      </section>
    </div>
  );
}
