import { StrictMode, Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, ToastProvider, useAuth } from './lib/hooks';
import { ApiError } from './lib/api';
import { Header } from './components/Header';
import { Spinner } from './components/ui';
import { QuickViewProvider } from './components/QuickView';
import { InstallBanner, TabBar } from './components/TabBar';
import Home from './pages/Home';
import './styles.css';

const Search = lazy(() => import('./pages/Search'));
const Product = lazy(() => import('./pages/Product'));
const Deals = lazy(() => import('./pages/Deals'));
const Cart = lazy(() => import('./pages/Cart'));
const Checkout = lazy(() => import('./pages/Checkout'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const Watchlist = lazy(() => import('./pages/Watchlist'));
const Login = lazy(() => import('./pages/Login'));
const NotFound = lazy(() => import('./pages/NotFound'));

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

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
  return null;
}

function App() {
  return (
    <>
      <ScrollTop />
      <Header />
      <main className="container main">
        <Suspense fallback={<div className="center pad"><Spinner /></div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/deals" element={<Deals />} />
            <Route path="/p/:slug" element={<Product />} />
            <Route path="/login" element={<Login />} />
            <Route path="/cart" element={<Protected><Cart /></Protected>} />
            <Route path="/checkout" element={<Protected><Checkout /></Protected>} />
            <Route path="/orders" element={<Protected><Orders /></Protected>} />
            <Route path="/orders/:id" element={<Protected><OrderDetail /></Protected>} />
            <Route path="/watchlist" element={<Protected><Watchlist /></Protected>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <InstallBanner />
      <TabBar />
      <footer className="footer">
        <div className="container">
          <b>Kompare</b> · One app for every store. Prices are refreshed continuously from each platform's provider.
          <span className="muted"> Demo build: offers come from the built-in simulated provider.</span>
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
