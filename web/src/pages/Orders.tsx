import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Order } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { STATUS_LABEL, dateTime, money } from '../lib/format';
import { Empty, ErrorBox, PlatformBadge, Spinner } from '../components/ui';

export default function Orders() {
  useTitle('Orders');
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['orders'], queryFn: () => api<{ items: Order[] }>('/orders'), refetchInterval: 60_000 });
  if (isLoading) return <div className="center pad"><Spinner /></div>;
  if (isError) return <ErrorBox error={error} retry={refetch} />;
  if (!data?.items.length) return <Empty title="No orders yet" icon="📦"><Link to="/" className="btn primary">Find a deal</Link></Empty>;
  return (
    <>
      <h1 className="section-title">Your orders</h1>
      <div className="stack">
        {data.items.map((o) => (
          <Link key={o.id} to={`/orders/${o.id}`} className="card order-row">
            <div>
              <b>Order #{o.id}</b> <span className={`status ${o.status}`}>{STATUS_LABEL[o.status]}</span>
              <div className="xs muted">{dateTime(o.createdAt)} · {o.shipments.reduce((n, s) => n + s.items.length, 0)} items</div>
              <div className="row gap wrap" style={{ marginTop: 6 }}>{o.shipments.map((s) => <PlatformBadge key={s.platformId} id={s.platformId} small />)}</div>
            </div>
            <div className="right"><b>{money(o.total)}</b>{o.savings > 0 && <div className="xs ok">Saved {money(o.savings)}</div>}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
