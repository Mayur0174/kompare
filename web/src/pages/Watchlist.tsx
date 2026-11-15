import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Alert, type Summary } from '../lib/api';
import { useTitle, useToast, useWatchToggle } from '../lib/hooks';
import { date, money } from '../lib/format';
import { Empty, Grid, Spinner, Thumb } from '../components/ui';

export default function Watchlist() {
  useTitle('Watchlist');
  const qc = useQueryClient();
  const toast = useToast();
  const watch = useQuery({ queryKey: ['watchlist'], queryFn: () => api<{ items: Summary[] }>('/watchlist'), refetchInterval: 60_000 });
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api<{ items: Alert[] }>('/alerts'), refetchInterval: 60_000 });
  const unwatch = useWatchToggle();
  const del = useMutation({
    mutationFn: (id: number) => api(`/alerts/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alerts'] }); qc.invalidateQueries({ queryKey: ['product'] }); toast('Alert removed'); },
  });

  return (
    <>
      <h1 className="section-title">Price alerts</h1>
      {alerts.isLoading ? <Spinner /> : !alerts.data?.items.length ? (
        <p className="muted">No alerts yet. Open any product and tap “Set price alert” — we check prices continuously and notify you on a drop.</p>
      ) : (
        <div className="stack">
          {alerts.data.items.map((a) => {
            const hit = a.product.bestPrice <= a.targetPrice;
            return (
              <div key={a.id} className="card order-row">
                <div className="row gap">
                  <Thumb emoji={a.product.emoji} hue={a.product.hue} size="sm" />
                  <div>
                    <Link to={`/p/${a.product.slug}`} className="cart-title">{a.product.title}</Link>
                    <div className="xs muted">Target {money(a.targetPrice)} · now {money(a.product.bestPrice)}{a.triggeredAt ? ` · triggered ${date(a.triggeredAt)}` : ''}</div>
                  </div>
                </div>
                <div className="row gap">
                  <span className={`status ${a.active ? (hit ? 'delivered' : 'placed') : 'delivered'}`}>{a.active ? (hit ? 'Target reached' : 'Watching') : 'Triggered'}</span>
                  <button className="btn ghost sm" onClick={() => del.mutate(a.id)}>Remove</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <section>
        <h2 className="section-title">Watchlist</h2>
        {watch.isLoading ? <Grid loading /> : (
          <>
            <Grid items={watch.data?.items} empty={<Empty title="Nothing on your watchlist" icon="👀"><Link to="/" className="btn primary">Browse products</Link></Empty>} />
            {!!watch.data?.items.length && (
              <div className="row gap wrap" style={{ marginTop: 12 }}>
                {watch.data.items.map((p) => <button key={p.id} className="btn ghost sm" onClick={() => unwatch.mutate({ productId: p.id, on: false })}>✕ {p.brand} {p.title.split(' ').slice(1, 4).join(' ')}</button>)}
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
