import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth, useCart } from '../lib/hooks';

/** Native-style bottom navigation shown on phones / in the installed app. */
export function TabBar() {
  const { user } = useAuth();
  const { data: cart } = useCart();
  const tabs = [
    { to: '/', label: 'Home', icon: '🏠', end: true },
    { to: '/search', label: 'Search', icon: '🔍' },
    { to: '/deals', label: 'Deals', icon: '🔥' },
    { to: '/cart', label: 'Cart', icon: '🛒', badge: cart?.count },
    { to: user ? '/account' : '/login', label: 'Account', icon: '👤' },
  ];
  return (
    <nav className="tabbar" aria-label="Primary">
      {tabs.map((t) => (
        <NavLink key={t.label} to={t.to} end={t.end} className="tab">
          <span className="tab-icon">{t.icon}{!!t.badge && <span className="dot">{t.badge}</span>}</span>
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** "Install app" banner using the browser's native install prompt (Android / desktop Chrome). */
export function InstallBanner() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem('kompare.installDismissed') === '1'; } catch { return false; } });
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  if (!evt || dismissed) return null;
  const close = () => { setDismissed(true); try { localStorage.setItem('kompare.installDismissed', '1'); } catch { /* ignore */ } };
  return (
    <div className="install-banner">
      <img src="/icons/icon-192.png" alt="" width={36} height={36} />
      <div className="grow"><b>Install Kompare</b><div className="xs muted">Faster access, price-drop alerts, works offline.</div></div>
      <button className="btn primary sm" onClick={async () => { await evt.prompt(); await evt.userChoice; setEvt(null); }}>Install</button>
      <button className="icon-btn" aria-label="Dismiss" onClick={close}>✕</button>
    </div>
  );
}
