import type { Listing } from '../lib/api';
import { useMeta } from '../lib/hooks';
import { money, ago } from '../lib/format';
import { PlatformBadge } from './ui';

/** One product's real offers across stores, cheapest first. "Buy" opens the store's own product page. */
export function OffersTable({ listings, compact, stats }: { listings: Listing[]; compact?: boolean; stats?: Record<string, { low: number; high: number }> }) {
  const { platforms } = useMeta();
  const live = listings.filter((l) => l.inStock);
  const best = live[0];
  const worst = Math.max(...live.map((l) => l.price));

  return (
    <div className="offers">
      {best && live.length > 1 && worst > best.price && (
        <div className="save-banner">You save <b>{money(worst - best.price)}</b> by buying on {platforms.get(best.platformId)?.name} instead of the costliest store.</div>
      )}
      {listings.map((l) => {
        const name = platforms.get(l.platformId)?.name || l.platformId;
        const note = l.seller && l.seller !== name ? l.seller : null; // e.g. delivery info from the listing
        return (
          <div key={l.id} className={`offer${l === best ? ' best' : ''}${l.inStock ? '' : ' oos'}`}>
            <div className="offer-store">
              <PlatformBadge id={l.platformId} />
              {l === best && live.length > 1 && <span className="tag green">Lowest price</span>}
            </div>
            <div className="offer-price">
              <strong>{money(l.price)}</strong>
              {l.mrp > l.price && <span className="xs"><s className="muted">{money(l.mrp)}</s> <span className="off">{l.discount}% off</span></span>}
              {stats?.[l.platformId] && stats[l.platformId].high > stats[l.platformId].low && l.price <= stats[l.platformId].low && <span className="tag green xs">Lowest we've seen</span>}
            </div>
            <div className="offer-meta xs">
              {note && <div>{note}</div>}
              {!compact && l.rating > 0 && <div className="muted">★ {l.rating}</div>}
              <div className="muted">Checked {ago(l.updatedAt)}</div>
            </div>
            <div className="offer-actions">
              <a className="btn primary sm" href={l.url} target="_blank" rel="noopener noreferrer">Buy on {name} ↗</a>
            </div>
          </div>
        );
      })}
      <p className="xs muted">Prices are from each store's live listing when last checked. Final price and delivery are confirmed on the store.</p>
    </div>
  );
}
