const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = (n: number | null | undefined) => (n == null ? '—' : inr.format(n));
export const compact = (n: number) => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(n);
export const date = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const shortDate = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const dateTime = (ts: number) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export function ago(ts: number) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export const STATUS_LABEL: Record<string, string> = {
  placed: 'Placed', confirmed: 'Confirmed', shipped: 'Shipped', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled',
};
export const PAYMENT_LABEL: Record<string, string> = { upi: 'UPI', card: 'Credit / Debit card', netbanking: 'Net banking', cod: 'Cash on delivery' };
