import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, type Notification } from '../lib/api';
import { useAuth, useCart, useDebounced, useToast } from '../lib/hooks';
import { money, ago } from '../lib/format';

type Suggest = { items: { slug: string; title: string; emoji: string; bestPrice: number; category: string }[] };

export function SearchBox({ autoFocus, big }: { autoFocus?: boolean; big?: boolean }) {
  const [params] = useSearchParams();
  const [text, setText] = useState(params.get('q') || '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const nav = useNavigate();
  const toast = useToast();
  const debounced = useDebounced(text.trim(), 150);
  const isUrl = /^https?:\/\//i.test(debounced);
  const { data } = useQuery({
    queryKey: ['suggest', debounced],
    queryFn: ({ signal }) => api<Suggest>(`/suggest${qs({ q: debounced })}`, { signal }),
    enabled: debounced.length > 1 && !isUrl,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const items = debounced.length > 1 && !isUrl ? data?.items || [] : [];

  useEffect(() => { setText(params.get('q') || ''); }, [params]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setOpen(false);
    const t = text.trim();
    if (active >= 0 && items[active]) return nav(`/p/${items[active].slug}`);
    if (/^https?:\/\//i.test(t)) {
      try {
        const r = await api<{ slug: string }>(`/resolve${qs({ url: t })}`);
        nav(`/p/${r.slug}`);
      } catch (err) { toast((err as Error).message, 'err'); }
      return;
    }
    nav(`/search${qs({ q: t })}`);
  }

  return (
    <form className={`search${big ? ' big' : ''}`} onSubmit={submit} role="search">
      <input
        value={text} autoFocus={autoFocus} aria-label="Search products or paste a product link"
        placeholder="Search products, brands… or paste an Amazon / Flipkart link"
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <button className="btn primary" type="submit" aria-label="Search">Search</button>
      {open && items.length > 0 && (
        <ul className="suggest" role="listbox">
          {items.map((s, i) => (
            <li key={s.slug} role="option" aria-selected={i === active}>
              <Link to={`/p/${s.slug}`} className={i === active ? 'active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(false)}>
                <span className="sug-emoji">{s.emoji}</span><span className="grow">{s.title}</span><b>{money(s.bestPrice)}</b>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: Notification[]; unread: number }>('/notifications'),
    refetchInterval: 30_000,
  });
  const markRead = useMutation({
    mutationFn: () => api('/notifications/read', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="dropdown" ref={ref}>
      <button className="icon-btn" aria-label={`Notifications (${data?.unread || 0} unread)`} onClick={() => { setOpen(!open); if (!open && data?.unread) markRead.mutate(); }}>
        🔔{!!data?.unread && <span className="dot">{data.unread}</span>}
      </button>
      {open && (
        <div className="menu notif-menu">
          <div className="menu-head">Notifications</div>
          {!data?.items.length && <div className="muted pad">No notifications yet. Set a price alert to get notified on drops.</div>}
          {data?.items.map((n) => (
            <Link key={n.id} to={n.link || '#'} className={`notif${n.read ? '' : ' unread'}`} onClick={() => setOpen(false)}>
              <b>{n.title}</b><span>{n.body}</span><span className="xs muted">{ago(n.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { user, logout } = useAuth();
  const { data: cart } = useCart();
  const [menu, setMenu] = useState(false);
  return (
    <header className="header">
      <div className="container header-row">
        <Link to="/" className="logo" aria-label="Kompare home"><span className="logo-mark">K</span><span className="logo-text">Kompare</span></Link>
        <div className="header-search"><SearchBox /></div>
        <nav className="header-nav">
          <NavLink to="/deals" className="nav-link hide-sm">Deals</NavLink>
          {user && <NavLink to="/watchlist" className="nav-link hide-sm">Watchlist</NavLink>}
          {user && <Notifications />}
          <NavLink to="/cart" className="icon-btn" aria-label={`Cart (${cart?.count || 0} items)`}>🛒{!!cart?.count && <span className="dot">{cart.count}</span>}</NavLink>
          {user ? (
            <div className="dropdown">
              <button className="avatar" onClick={() => setMenu(!menu)} onBlur={() => setTimeout(() => setMenu(false), 150)} aria-label="Account menu">{user.name[0]?.toUpperCase()}</button>
              {menu && (
                <div className="menu">
                  <div className="menu-head">{user.name}<div className="xs muted">{user.email}</div></div>
                  <Link to="/orders" className="menu-item">📦 Orders</Link>
                  <Link to="/watchlist" className="menu-item">👀 Watchlist & alerts</Link>
                  <button className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { setMenu(false); logout(); }}>↩ Sign out</button>
                </div>
              )}
            </div>
          ) : <Link to="/login" className="btn primary sm">Sign in</Link>}
        </nav>
      </div>
      <div className="container mobile-search"><SearchBox /></div>
    </header>
  );
}
