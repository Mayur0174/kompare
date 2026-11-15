import { useNavigate } from 'react-router-dom';
import type { Listing } from '../lib/api';
import { useAddToCart, useAuth, useMeta } from '../lib/hooks';
import { money, ago } from '../lib/format';
import { PlatformBadge } from './ui';

/** Side-by-side price list of one product across every platform, cheapest (incl. shipping) first. */
export function OffersTable({ listings, compact, stats }: { listings: Listing[]; compact?: boolean; stats?: Record<string, { low: number }> }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const add = useAddToCart();
  const { platforms } = useMeta();
  const best = listings.find((l) => l.inStock);
  const worst = Math.max(...listings.filter((l) => l.inStock).map((l) => l.effectivePrice));

  const addToCart = (l: Listing) => {
    if (!user) return nav(`/login?next=${encodeURIComponent(location.pathname)}`);
    add.mutate({ listingId: l.id });
  };

  return (
    <div className="offers">
      {best && listings.filter((l) => l.inStock).length > 1 && worst > best.effectivePrice && (
        <div className="save-banner">You save <b>{money(worst - best.effectivePrice)}</b> by buying on {platforms.get(best.platformId)?.name} instead of the costliest store.</div>
      )}
      {listings.map((l) => (
        <div key={l.id} className={`offer${l === best ? ' best' : ''}${l.inStock ? '' : ' oos'}`}>
          <div className="offer-store">
            <PlatformBadge id={l.platformId} />
            {l === best && <span className="tag green">Lowest price</span>}
            {!compact && <div className="xs muted">Sold by {l.seller} · ★ {l.rating}</div>}
          </div>
          <div className="offer-price">
            <strong>{money(l.price)}</strong>
            {l.mrp > l.price && <span className="xs"><s className="muted">{money(l.mrp)}</s> <span className="off">{l.discount}% off</span></span>}
            {stats?.[l.platformId] && l.price <= stats[l.platformId].low && <span className="tag green xs">Lowest ever here</span>}
          </div>
          <div className="offer-meta xs">
            <div>{l.shipping ? `+ ${money(l.shipping)} delivery` : 'Free delivery'}</div>
            <div className="muted">{l.inStock ? `In ${l.deliveryDays} day${l.deliveryDays > 1 ? 's' : ''}` : 'Out of stock'}{!compact && ` · ${l.returnDays}-day returns`}</div>
            {!compact && <div className="muted">Updated {ago(l.updatedAt)}</div>}
          </div>
          <div className="offer-actions">
            <button className="btn primary sm" disabled={!l.inStock || add.isPending} onClick={() => addToCart(l)}>{l.inStock ? 'Add to cart' : 'Sold out'}</button>
            <a className="btn ghost sm" href={l.url} target="_blank" rel="noopener noreferrer nofollow">Visit ↗</a>
          </div>
        </div>
      ))}
    </div>
  );
}
