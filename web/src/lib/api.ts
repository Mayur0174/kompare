export type Platform = {
  id: string; name: string; color: string; domain: string; shipping_fee: number; free_shipping_above: number;
  return_days: number; cod: boolean; provider: string;
};
export type Category = { id: string; name: string; emoji: string; count: number };
export type Summary = {
  id: number; slug: string; title: string; brand: string; category: string; emoji: string; hue: number; rating: number;
  reviewCount: number; mrp: number; bestPrice: number; maxPrice: number; bestPlatform: string | null; offers: number;
  inStock: boolean; discount: number; avg30: number; dropPct: number; spread: number; platforms: string[];
  sold30: number; views7: number; trendScore: number;
};
export type Listing = {
  id: number; platformId: string; url: string; seller: string; price: number; mrp: number; discount: number; inStock: boolean;
  stockQty: number; deliveryDays: number; rating: number; shipping: number; effectivePrice: number; returnDays: number; cod: boolean; updatedAt: number;
};
export type ProductDetail = {
  product: { id: number; slug: string; title: string; brand: string; category: string; description: string; specs: Record<string, string>; emoji: string; hue: number; rating: number; reviewCount: number };
  listings: Listing[];
  stats: Record<string, { low: number; high: number; avg: number }>;
  overall: { low: number; high: number; avg: number; lowAt: number };
  verdict: { level: 'great' | 'good' | 'wait'; text: string } | null;
  similar: Summary[]; watching: boolean; alert: { id: number; targetPrice: number; active: boolean } | null;
};
export type History = { days: number; series: Record<string, [number, number][]> };
export type Address = { name: string; phone: string; line1: string; city: string; state: string; pincode: string };
export type User = { id: number; email: string; name: string; address: Address | null };
export type CartItem = {
  listingId: number; productId: number; slug: string; title: string; emoji: string; hue: number; qty: number; price: number; mrp: number;
  addedPrice: number; inStock: boolean; deliveryDays: number; cheaperAt: { platformId: string; price: number } | null;
};
export type Cart = {
  groups: { platformId: string; items: CartItem[]; subtotal: number; mrpTotal: number; shipping: number; freeShippingGap: number }[];
  subtotal: number; shipping: number; total: number; savings: number; count: number;
};
export type OrderStatus = 'placed' | 'confirmed' | 'shipped' | 'out_for_delivery' | 'delivered' | 'cancelled';
export type Order = {
  id: number; status: OrderStatus; createdAt: number; cancelledAt: number | null; subtotal: number; shipping: number; total: number; savings: number;
  paymentMethod: string; address: Address; cancellable: boolean;
  shipments: { platformId: string; ref: string; eta: number; items: { title: string; qty: number; unitPrice: number; mrp: number; slug?: string; emoji?: string; hue?: number }[] }[];
};
export type Alert = { id: number; targetPrice: number; active: boolean; triggeredAt: number | null; createdAt: number; product: Summary };
export type Notification = { id: number; title: string; body: string; link: string | null; read: boolean; createdAt: number };

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, unknown>) { super(message); }
}

const TOKEN_KEY = 'kompare.token';
export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
export const LOCAL = import.meta.env.VITE_LOCAL_API === '1';

export async function api<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const token = tokenStore.get();
  if (LOCAL) {
    // Mobile app: the backend runs on the device, no network round-trip.
    const { localApi } = await import('../local/backend.js');
    const r = await localApi(path, { method: opts.method, body: opts.body, token });
    if (r.status >= 400) {
      if (r.status === 401 && token) onUnauthorized();
      throw new ApiError(r.status, r.body.error || `Request failed (${r.status})`, r.body.details);
    }
    return r.body as T;
  }
  const res = await fetch(`${API_BASE}/api${path}`, {
    method: opts.method || 'GET',
    signal: opts.signal,
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.details);
  }
  return data as T;
}

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
