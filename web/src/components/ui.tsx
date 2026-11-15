import { memo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Summary } from '../lib/api';
import { useMeta } from '../lib/hooks';
import { productQuery, useQuickView } from './QuickView';
import { useQueryClient } from '@tanstack/react-query';
import { money, compact } from '../lib/format';

/** Real product photo when we have one (from the store listing), otherwise a neutral emoji tile. */
export const Thumb = memo(function Thumb({ emoji, hue, image, size = 'md' }: { emoji: string; hue: number; image?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  if (image && !failed) {
    return (
      <div className={`thumb thumb-${size} thumb-img`} aria-hidden>
        <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </div>
    );
  }
  return (
    <div className={`thumb thumb-${size}`} style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 92%), hsl(${(hue + 40) % 360} 70% 84%))` }} aria-hidden>
      <span>{emoji}</span>
    </div>
  );
});

export function PlatformBadge({ id, small }: { id: string; small?: boolean }) {
  const { platforms } = useMeta();
  const p = platforms.get(id);
  return (
    <span className={`pbadge${small ? ' sm' : ''}`} style={{ ['--pc' as string]: p?.color || '#888' }}>
      <i />{p?.name || id}
    </span>
  );
}

export function Stars({ value, count }: { value: number; count?: number }) {
  return (
    <span className="stars" aria-label={`Rated ${value} out of 5`}>
      <b>{value.toFixed(1)} ★</b>{count !== undefined && <span className="muted"> ({compact(count)})</span>}
    </span>
  );
}

export const ProductCard = memo(function ProductCard({ p }: { p: Summary }) {
  const quickView = useQuickView();
  const { platforms } = useMeta();
  const qc = useQueryClient();
  // Start loading offers the moment a finger touches the card, so the pop-up opens with data ready.
  const prefetch = () => { qc.prefetchQuery({ ...productQuery(p.slug), staleTime: 20_000 }); };
  return (
    <Link to={`/p/${p.slug}`} className="card pcard" onPointerDown={prefetch} onMouseEnter={prefetch} onClick={(e) => {
      // Plain click opens the quick-compare pop-up; ctrl/cmd/middle-click still opens the full page.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      quickView(p);
    }}>
      <Thumb emoji={p.emoji} hue={p.hue} image={p.image} />
      <div className="pcard-body">
        <div className="muted xs">{p.brand}</div>
        <div className="pcard-title">{p.title}</div>
        {p.rating > 0 && <Stars value={p.rating} count={p.reviewCount} />}
        <div className="pcard-price">
          <strong>{money(p.bestPrice)}</strong>
          {p.mrp > p.bestPrice && <s className="muted">{money(p.mrp)}</s>}
          {p.discount > 0 && <span className="off">{p.discount}% off</span>}
        </div>
        <div className="pcard-foot">
          {p.bestPlatform ? <span className="xs">Best on <PlatformBadge id={p.bestPlatform} small /></span> : <span className="xs err">Out of stock</span>}
          <span className="xs muted">{p.offers} {p.offers === 1 ? 'store' : 'stores'}</span>
        </div>
        <div className="pdots" aria-label={`Sold on ${p.platforms.map((id) => platforms.get(id)?.name).join(', ')}`}>
          {p.platforms.map((id) => <i key={id} title={platforms.get(id)?.name} style={{ background: platforms.get(id)?.color }} />)}
          <span className="xs link">Compare prices →</span>
        </div>
        {p.dropPct >= 3 && <span className="ribbon">↓ {p.dropPct}% vs 30d avg</span>}
      </div>
    </Link>
  );
});

export function Grid({ items, loading, empty }: { items?: Summary[]; loading?: boolean; empty?: ReactNode }) {
  if (loading) return <div className="grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="card skeleton" style={{ height: 300 }} />)}</div>;
  if (!items?.length) return <>{empty ?? <Empty title="Nothing here yet" />}</>;
  return <div className="grid">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div>;
}

export function Empty({ title, children, icon = '🛍️' }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <Empty title="Something went wrong" icon="⚠️">
      <p className="muted">{error instanceof Error ? error.message : 'Please try again.'}</p>
      {retry && <button className="btn" onClick={retry}>Retry</button>}
    </Empty>
  );
}

export function Spinner() { return <div className="spinner" role="progressbar" aria-label="Loading" />; }
