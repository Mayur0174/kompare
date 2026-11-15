import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setUnauthorizedHandler, tokenStore, type Cart, type Category, type Platform, type User } from './api';

// ---------- toasts ----------
type Toast = { id: number; text: string; kind: 'ok' | 'err' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- auth ----------
type AuthCtxT = { user: User | null; ready: boolean; login: (token: string, user: User) => void; logout: () => void };
const AuthCtx = createContext<AuthCtxT>({ user: null, ready: false, login: () => {}, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!tokenStore.get());

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    qc.removeQueries({ predicate: (q) => ['cart', 'watchlist', 'alerts', 'orders', 'order', 'notifications'].includes(String(q.queryKey[0])) });
    qc.invalidateQueries({ queryKey: ['product'] });
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return;
    api<{ user: User }>('/auth/me').then((r) => setUser(r.user)).catch(() => tokenStore.set(null)).finally(() => setReady(true));
  }, [logout]);

  const login = useCallback((token: string, u: User) => {
    tokenStore.set(token);
    setUser(u);
    qc.invalidateQueries();
  }, [qc]);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);

// ---------- shared data ----------
export function useMeta() {
  const q = useQuery({
    queryKey: ['meta'],
    queryFn: () => api<{ platforms: Platform[]; categories: Category[] }>('/meta'),
    staleTime: Infinity,
  });
  const platforms = useMemo(() => new Map((q.data?.platforms || []).map((p) => [p.id, p])), [q.data]);
  return { platforms, categories: q.data?.categories || [], list: q.data?.platforms || [] };
}

export function useCart() {
  const { user } = useAuth();
  return useQuery({ queryKey: ['cart'], queryFn: () => api<Cart>('/cart'), enabled: !!user, refetchInterval: 60_000 });
}

export function useAddToCart() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (v: { listingId: number; qty?: number }) => api<Cart>('/cart', { method: 'POST', body: { listingId: v.listingId, qty: v.qty ?? 1 } }),
    onSuccess: (cart) => { qc.setQueryData(['cart'], cart); toast('Added to cart'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
}

export function useWatchToggle() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ productId, on }: { productId: number; on: boolean }) => api(`/watchlist/${productId}`, { method: on ? 'POST' : 'DELETE' }),
    onSuccess: (_d, v) => {
      toast(v.on ? 'Added to watchlist' : 'Removed from watchlist');
      qc.invalidateQueries({ queryKey: ['watchlist'] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });
}

export function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useTitle(title: string) {
  useEffect(() => { document.title = title ? `${title} · Kompare` : 'Kompare – One app for every store'; }, [title]);
}
