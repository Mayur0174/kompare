import { Component, StrictMode, Suspense, lazy, useEffect, useLayoutEffect, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, ToastProvider, useAuth } from './lib/hooks';
import { ApiError } from './lib/api';
import { Header } from './components/Header';
import { Spinner } from './components/ui';
import { QuickViewProvider } from './components/QuickView';
import { InstallBanner, TabBar } from './components/TabBar';
import { onNotificationTap } from './lib/native';
import Home from './pages/Home';
import './styles.css';

const pages = {
  Search: () => import('./pages/Search'),
  Product: () => import('./pages/Product'),
  Watchlist: () => import('./pages/Watchlist'),
  Account: () => import('./pages/Account'),
  Login: () => import('./pages/Login'),
};
const Search = lazy(pages.Search);
const Product = lazy(pages.Product);
const Watchlist = lazy(pages.Watchlist);
const Account = lazy(pages.Account);
const Login = lazy(pages.Login);
const NotFound = lazy(() => import('./pages/NotFound'));

// Warm every screen once the app is idle, so the first tap on any tab renders instantly.
const idle = (fn: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 1500));
idle(() => { for (const load of Object.values(pages)) load().catch(() => {}); });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: true,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});

function Protected({ children }: { children: JSX.Element }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <div className="center pad"><Spinner /></div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return children;
}

/** New screens start at the top; going Back returns to where you were. */
const scrollPositions = new Map<string, number>();
function ScrollManager() {
  const loc = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  }, []);
  useLayoutEffect(() => {
    const key = loc.key;
    const onScroll = () => scrollPositions.set(key, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    const target = type === 'POP' ? scrollPositions.get(key) ?? 0 : 0;
    // Content may still be rendering (lazy screens): retry briefly until the page is tall enough.
    let tries = 0;
    const restore = () => {
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) > 2 && tries++ < 20) requestAnimationFrame(restore);
    };
    restore();
    return () => window.removeEventListener('scroll', onScroll);
  }, [loc.key, type]);
  return null;
}

/** Tapping a price-drop notification opens that product. */
function NotificationRouter() {
  const nav = useNavigate();
  useEffect(() => { onNotificationTap((link) => nav(link)); }, [nav]);
  return null;
}

class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[ui] crashed', error, info.componentStack); }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty">
        <div className="empty-icon">😵</div>
        <h3>Something went wrong</h3>
        <p className="muted">This screen hit an unexpected error. Your data is safe.</p>
        <button className="btn primary" onClick={() => window.location.reload()}>Reload app</button>
      </div>
    );
  }
}

function Routed({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <>
      <ScrollManager />
      <NotificationRouter />
      <Header />
      <main className="container main">
        <Routed>
        <Suspense fallback={<div className="center pad"><Spinner /></div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/p/:slug" element={<Product />} />
            <Route path="/login" element={<Login />} />
            <Route path="/watchlist" element={<Protected><Watchlist /></Protected>} />
            <Route path="/account" element={<Protected><Account /></Protected>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        </Routed>
      </main>
      <InstallBanner />
      <TabBar />
      <footer className="footer">
        <div className="container">
          <b>Kompare</b> · Live prices from each store's own listings. Purchases are completed on the store.
          
        </div>
      </footer>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <QuickViewProvider>
              <App />
            </QuickViewProvider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

// Offline support + installability (skipped inside native shells, which bundle the app).
if ('serviceWorker' in navigator && import.meta.env.PROD && !import.meta.env.VITE_API_BASE && import.meta.env.VITE_LOCAL_API !== '1') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
