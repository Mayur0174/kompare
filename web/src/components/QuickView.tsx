import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type ProductDetail, type Summary } from '../lib/api';
import { money } from '../lib/format';
import { OffersTable } from './Offers';
import { Spinner, Stars, Thumb } from './ui';

const Ctx = createContext<(p: Summary) => void>(() => {});
export const useQuickView = () => useContext(Ctx);

export const productQuery = (slug: string) => ({
  queryKey: ['product', slug],
  queryFn: () => api<ProductDetail>(`/products/${slug}`),
});

/** Pop-up showing a product's price on every platform, opened from any product card. */
export function QuickViewProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<Summary | null>(null);
  const open = useCallback((p: Summary) => setItem(p), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {item && <QuickView item={item} onClose={() => setItem(null)} />}
    </Ctx.Provider>
  );
}

function QuickView({ item, onClose }: { item: Summary; onClose: () => void }) {
  const { data, isLoading, isError, error } = useQuery(productQuery(item.slug));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus(); };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="qv-title" tabIndex={-1} ref={ref}>
        <button className="modal-close icon-btn" onClick={onClose} aria-label="Close">✕</button>
        <div className="qv-head">
          <Thumb emoji={item.emoji} hue={item.hue} size="sm" />
          <div>
            <div className="xs muted">{item.brand}</div>
            <h2 id="qv-title" className="qv-title">{item.title}</h2>
            <Stars value={item.rating} count={item.reviewCount} />
            <div className="sm">
              Available on <b>{item.offers} {item.offers === 1 ? 'store' : 'stores'}</b> · from <b>{money(item.bestPrice)}</b>
              {item.offers === 1 && <span className="muted"> (exclusive to this store)</span>}
            </div>
          </div>
        </div>
        {isLoading && <div className="center pad"><Spinner /></div>}
        {isError && <div className="err pad">{(error as Error).message}</div>}
        {data && (
          <>
            {data.verdict && <div className={`verdict ${data.verdict.level}`}>{data.verdict.text}</div>}
            <OffersTable listings={data.listings} compact stats={data.stats} />
            <div className="qv-foot">
              <span className="xs muted">6-month low {money(data.overall.low)} · avg {money(data.overall.avg)}</span>
              <Link to={`/p/${item.slug}`} className="btn" onClick={onClose}>Price history & details →</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
