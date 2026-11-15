import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Summary } from '../lib/api';
import { useMeta, useTitle } from '../lib/hooks';
import { SearchBox } from '../components/Header';
import { ErrorBox, Grid, PlatformBadge } from '../components/ui';
import { ago } from '../lib/format';

const until = (ts: number) => { const h = Math.max(0, (ts - Date.now()) / 3_600_000); return h >= 1 ? `${Math.round(h)}h` : `${Math.max(1, Math.round(h * 60))}m`; };

type Deals = { drops: Summary[]; discounts: Summary[]; spreads: Summary[]; trending: Summary[]; bestsellers: Summary[]; feedUpdatedAt: number; feedNextUpdateAt: number };
export const useDeals = () => useQuery({ queryKey: ['deals'], queryFn: () => api<Deals>('/deals'), refetchInterval: 60_000 });

export default function Home() {
  useTitle('');
  const { categories, list } = useMeta();
  const deals = useDeals();
  return (
    <>
      <section className="hero">
        <h1>Every store. One price check.</h1>
        <p className="muted">Compare live prices, see 6-month price history and order from {list.length || 9} stores — without opening {list.length || 9} apps.</p>
        <SearchBox big />
        <div className="platform-strip">{list.map((p) => <PlatformBadge key={p.id} id={p.id} />)}</div>
      </section>

      <section>
        <h2 className="section-title">Shop by category</h2>
        <div className="cats">
          {categories.map((c) => (
            <Link key={c.id} to={`/search?category=${c.id}`} className="cat card">
              <span className="cat-emoji">{c.emoji}</span><span>{c.name}</span><span className="xs muted">{c.count} products</span>
            </Link>
          ))}
        </div>
      </section>

      {deals.isError ? <ErrorBox error={deals.error} retry={deals.refetch} /> : (
        <>
          {deals.data && <div className="feed-note xs muted">🕒 Trending & best-seller catalogue updated {ago(deals.data.feedUpdatedAt)} · next refresh in {until(deals.data.feedNextUpdateAt)} · prices are live</div>}
          <Section title="📈 Trending now" sub="Most viewed, watched and bought across stores this week" to="/search?sort=trending" items={deals.data?.trending} loading={deals.isLoading} />
          <Section title="🏆 Best sellers" sub="Most units sold in the last 30 days" to="/search?sort=popular" items={deals.data?.bestsellers} loading={deals.isLoading} />
          <Section title="🔥 Biggest price drops" sub="Compared with each product's 30-day average" to="/search?sort=drop" items={deals.data?.drops} loading={deals.isLoading} />
          <Section title="💸 Save the most by comparing" sub="Largest gap between the cheapest and costliest store" to="/search?sort=spread" items={deals.data?.spreads} loading={deals.isLoading} />
        </>
      )}
    </>
  );
}

function Section({ title, sub, to, items, loading }: { title: string; sub?: string; to: string; items?: Summary[]; loading: boolean }) {
  return (
    <section>
      <div className="section-head">
        <div><h2 className="section-title">{title}</h2>{sub && <div className="muted sm">{sub}</div>}</div>
        <Link to={to} className="link">See all →</Link>
      </div>
      <Grid items={items} loading={loading} />
    </section>
  );
}
