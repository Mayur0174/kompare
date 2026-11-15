import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Order } from '../lib/api';
import { useTitle, useToast } from '../lib/hooks';
import { PAYMENT_LABEL, STATUS_LABEL, date, dateTime, money } from '../lib/format';
import { ErrorBox, PlatformBadge, Spinner, Thumb } from '../components/ui';

const STEPS = ['placed', 'confirmed', 'shipped', 'out_for_delivery', 'delivered'] as const;

export default function OrderDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  useTitle(`Order #${id}`);
  const { data: o, isLoading, isError, error, refetch } = useQuery({ queryKey: ['order', id], queryFn: () => api<Order>(`/orders/${id}`), refetchInterval: 30_000 });
  const cancel = useMutation({
    mutationFn: () => api<Order>(`/orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: (d) => { qc.setQueryData(['order', id], d); qc.invalidateQueries({ queryKey: ['orders'] }); toast('Order cancelled'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });

  if (isLoading) return <div className="center pad"><Spinner /></div>;
  if (isError || !o) return <ErrorBox error={error} retry={refetch} />;
  const step = STEPS.indexOf(o.status as (typeof STEPS)[number]);

  return (
    <>
      {params.get('placed') && <div className="success-banner">🎉 Order placed! We've sent it to {o.shipments.length} store{o.shipments.length > 1 ? 's' : ''}.</div>}
      <div className="section-head">
        <div>
          <h1 className="section-title">Order #{o.id} <span className={`status ${o.status}`}>{STATUS_LABEL[o.status]}</span></h1>
          <div className="muted sm">Placed {dateTime(o.createdAt)} · {PAYMENT_LABEL[o.paymentMethod]}</div>
        </div>
        {o.cancellable && <button className="btn danger" disabled={cancel.isPending} onClick={() => confirm('Cancel this order?') && cancel.mutate()}>Cancel order</button>}
      </div>

      {o.status !== 'cancelled' && (
        <div className="card pad-lg">
          <ol className="tracker">
            {STEPS.map((s, i) => <li key={s} className={i <= step ? 'done' : ''}><span />{STATUS_LABEL[s]}</li>)}
          </ol>
        </div>
      )}

      <div className="cart-page">
        <div>
          {o.shipments.map((s) => (
            <div key={s.platformId} className="card cart-group">
              <div className="cart-group-head">
                <PlatformBadge id={s.platformId} />
                <span className="xs muted">Store order {s.ref} · {o.status === 'cancelled' ? 'Cancelled' : `Arrives by ${date(s.eta)}`}</span>
              </div>
              {s.items.map((i, k) => (
                <div key={k} className="cart-item">
                  {i.emoji && <Thumb emoji={i.emoji} hue={i.hue || 0} size="sm" />}
                  <div className="grow">{i.slug ? <Link to={`/p/${i.slug}`} className="cart-title">{i.title}</Link> : i.title}<div className="xs muted">Qty {i.qty}</div></div>
                  <b>{money(i.unitPrice * i.qty)}</b>
                </div>
              ))}
            </div>
          ))}
        </div>
        <aside className="card summary">
          <h3>Summary</h3>
          <div className="sum-row"><span>Items</span><span>{money(o.subtotal)}</span></div>
          <div className="sum-row"><span>Delivery</span><span>{o.shipping ? money(o.shipping) : 'Free'}</span></div>
          <div className="sum-row total"><span>Total</span><span>{money(o.total)}</span></div>
          {o.savings > 0 && <div className="save-banner">You saved {money(o.savings)}</div>}
          <h3>Deliver to</h3>
          <p className="sm">{o.address.name}<br />{o.address.line1}<br />{o.address.city}, {o.address.state} {o.address.pincode}<br />📞 {o.address.phone}</p>
        </aside>
      </div>
    </>
  );
}
