import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs, type Summary } from '../lib/api';
import { useAuth, useMeta, useTitle } from '../lib/hooks';
import { recentlyViewed } from '../lib/recent';
import { SearchBox } from '../components/Header';
import { PlatformBadge, ProductCard } from '../components/ui';

export default function Home() {
  useTitle('');
  const { user } = useAuth();
  const { categories, list } = useMeta();
  const known = list.filter((p) => p.searchUrl);
  const viewed = recentlyViewed.list();
  const recent = useQuery({
    queryKey: ['products', { slugs: viewed.join(',') }],
    queryFn: () => api<{ items: Summary[] }>(`/products${qs({ slugs: viewed.join(',') })}`),
    enabled: viewed.length > 0,
  });
  const watch = useQuery({ queryKey: ['watchlist'], queryFn: () => api<{ items: Summary[] }>('/watchlist'), enabled: !!user });

  return (
    <>
      <section className="hero">
        <h1>Every store. One price check.</h1>
        <p className="muted">Search any product to compare live prices on {known.length || 9} stores, track its price and get alerts when it drops.</p>
        <SearchBox big />
        <div className="platform-strip">{known.map((p) => <PlatformBadge key={p.id} id={p.id} />)}</div>
      </section>

      <section>
        <h2 className="section-title">Shop by category</h2>
        <div className="cats">
          {categories.map((c) => (
            <Link key={c.id} to={`/search${qs({ q: c.query })}`} className="cat card">
              <span className="cat-emoji">{c.emoji}</span><span>{c.name}</span><span className="xs muted">Live prices</span>
            </Link>
          ))}
        </div>
      </section>

      {!!watch.data?.items.length && <Row title="🔔 Your price watch" to="/watchlist" items={watch.data.items} />}
      {!!recent.data?.items.length && <Row title="👀 Recently viewed" items={recent.data.items} />}

      <section className="card pad-lg">
        <h2 className="section-title sm">How Kompare works</h2>
        <ol className="how">
          <li><b>Search anything.</b> We fetch live listings from Amazon, Flipkart, Myntra, Croma, Reliance Digital, Tata CLiQ and more.</li>
          <li><b>Compare.</b> The same product is grouped across stores, cheapest first, with real prices and links.</li>
          <li><b>Track.</b> Save a product or set a target price. Every check is recorded, so you build a real price history.</li>
          <li><b>Buy on the store.</b> “Buy” opens the store's own product page to complete your order.</li>
        </ol>
      </section>
    </>
  );
}

function Row({ title, items, to }: { title: string; items: Summary[]; to?: string }) {
  return (
    <section>
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {to && <Link to={to} className="link">See all →</Link>}
      </div>
      <div className="hscroll">{items.map((p) => <div key={p.id} className="hscroll-item"><ProductCard p={p} /></div>)}</div>
    </section>
  );
}
