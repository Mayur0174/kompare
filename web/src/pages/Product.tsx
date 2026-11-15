import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type History } from '../lib/api';
import { useAuth, useMeta, useTitle, useToast, useWatchToggle } from '../lib/hooks';
import { money, date } from '../lib/format';
import { productQuery } from '../components/QuickView';
import { recentlyViewed } from '../lib/recent';
import { enableNotifications, shareLink } from '../lib/native';
import { OffersTable } from '../components/Offers';
import { PriceChart } from '../components/PriceChart';
import { Empty, ErrorBox, Grid, Spinner, Stars, Thumb } from '../components/ui';

const RANGES = [7, 30, 90, 180];

export default function Product() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const { platforms } = useMeta();
  const [days, setDays] = useState(90);
  const q = useQuery({ ...productQuery(slug), refetchInterval: 60_000 });
  const hist = useQuery({
    queryKey: ['history', slug, days],
    queryFn: () => api<History>(`/products/${slug}/history?days=${days}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const watch = useWatchToggle();
  useTitle(q.data?.product.title || '');
  const toast = useToast();
  useEffect(() => { if (q.data) recentlyViewed.add(q.data.product.slug); }, [q.data]);

  if (q.isLoading) return <div className="center pad"><Spinner /></div>;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <Empty title="Product not found" icon="🔍"><Link to="/" className="btn">Go home</Link></Empty>;
    return <ErrorBox error={q.error} retry={q.refetch} />;
  }
  const { product: p, listings, overall, stats, verdict, similar, watching, alert, trackedSince } = q.data!;
  const best = listings.find((l) => l.inStock);
  const requireUser = () => { if (!user) { nav(`/login?next=/p/${slug}`); return false; } return true; };

  return (
    <>
      <nav className="crumbs xs"><Link to="/">Home</Link> / <Link to={`/search?category=${p.category}`}>{p.category}</Link> / <span className="muted">{p.brand}</span></nav>
      <div className="product-top">
        <Thumb emoji={p.emoji} hue={p.hue} image={p.image} size="lg" />
        <div className="product-info">
          <div className="muted">{p.brand}</div>
          <h1>{p.title}</h1>
          <Stars value={p.rating} count={p.reviewCount} />
          <div className="big-price">
            {best ? <>{money(best.price)} <span className="sm muted">on {platforms.get(best.platformId)?.name}</span></> : <span className="err">Out of stock everywhere</span>}
          </div>
          {verdict && <div className={`verdict ${verdict.level}`}>{verdict.text}</div>}
          <div className="stat-row">
            <div className="stat"><span className="xs muted">Lowest tracked</span><b>{money(overall.low)}</b><span className="xs muted">{overall.lowAt ? date(overall.lowAt) : ''}</span></div>
            <div className="stat"><span className="xs muted">Average</span><b>{money(overall.avg)}</b></div>
            <div className="stat"><span className="xs muted">Highest</span><b>{money(overall.high)}</b></div>
          </div>
          <div className="row gap wrap">
            <button className="btn" onClick={async () => {
              const r = await shareLink({
                title: p.title,
                text: best ? `${p.title} is ${money(best.price)} on ${platforms.get(best.platformId)?.name} — compared on Kompare` : p.title,
                url: best?.url || listings[0]?.url || '',
              });
              if (r === 'copied') toast('Link copied');
            }}>↗ Share</button>
            <button className={`btn${watching ? ' active' : ''}`} disabled={watch.isPending} onClick={() => requireUser() && watch.mutate({ productId: p.id, on: !watching })}>
              {watching ? '✓ Watching' : '👀 Watch'}
            </button>
            <AlertForm productId={p.id} current={alert} suggested={best ? Math.round(Math.min(best.price * 0.95, overall.avg)) : overall.low} requireUser={requireUser} />
          </div>
        </div>
      </div>

      <section className="card pad-lg">
        <h2 className="section-title sm">Compare prices across {listings.length} {listings.length === 1 ? 'store' : 'stores'}</h2>
        <OffersTable listings={listings} stats={stats} />
      </section>

      <section className="card pad-lg">
        <div className="section-head">
          <h2 className="section-title sm">Price history</h2>
          <div className="seg" role="group" aria-label="Range">
            {RANGES.map((r) => <button key={r} className={r === days ? 'on' : ''} onClick={() => setDays(r)}>{r === 180 ? '6M' : `${r}D`}</button>)}
          </div>
        </div>
        {trackedSince && <p className="xs muted">Real prices recorded each time this product is checked, since {date(trackedSince)}. Watch it or set an alert to keep tracking.</p>}
        {hist.data ? <div style={{ opacity: hist.isFetching && hist.isPlaceholderData ? 0.5 : 1 }}><PriceChart data={hist.data} platforms={platforms} /></div> : <div className="skeleton" style={{ height: 280 }} />}
      </section>

      <section>
        <div className="card pad-lg">
          <h2 className="section-title sm">Store-wise price range</h2>
          <table className="specs">
            <thead><tr><th>Store</th><th>Low</th><th>Avg</th><th>High</th></tr></thead>
            <tbody>{Object.entries(stats).map(([id, s]) => <tr key={id}><th>{platforms.get(id)?.name}</th><td>{money(s.low)}</td><td>{money(s.avg)}</td><td>{money(s.high)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      {similar.length > 0 && <section><h2 className="section-title">Similar products</h2><Grid items={similar} /></section>}
    </>
  );
}

function AlertForm({ productId, current, suggested, requireUser }: {
  productId: number; current: { id: number; targetPrice: number; active: boolean } | null; suggested: number; requireUser: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(current?.targetPrice || suggested));
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: async () => {
      enableNotifications().catch(() => false); // ask once for system notifications (Android 13+)
      return api<{ ok: boolean; triggered?: boolean }>('/alerts', { method: 'POST', body: { productId, targetPrice: Math.round(Number(value)) } });
    },
    onSuccess: (r) => {
      toast(r.triggered ? 'Already at or below your target. Check your notifications!' : `We'll notify you when it drops to ${money(Number(value))}`);
      setOpen(false);
      for (const key of ['product', 'alerts', 'watchlist', 'notifications']) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  if (!open) {
    return <button className="btn" onClick={() => requireUser() && setOpen(true)}>{current?.active ? `🔔 Alert at ${money(current.targetPrice)}` : '🔔 Set price alert'}</button>;
  }
  return (
    <form className="row gap" onSubmit={(e) => { e.preventDefault(); if (Number(value) > 0) save.mutate(); }}>
      <label className="sr-only" htmlFor="target">Target price</label>
      <input id="target" type="number" min={1} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 130 }} autoFocus />
      <button className="btn primary" disabled={save.isPending || !(Number(value) > 0)}>Notify me</button>
      <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}
