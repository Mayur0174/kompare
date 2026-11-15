import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Address } from '../lib/api';
import { useAuth, useCart, useTitle, useToast } from '../lib/hooks';
import { PAYMENT_LABEL, money } from '../lib/format';
import { Spinner } from '../components/ui';
import { Summary } from './Cart';

const EMPTY: Address = { name: '', phone: '', line1: '', city: '', state: '', pincode: '' };
const FIELDS: [keyof Address, string, string?][] = [
  ['name', 'Full name'], ['phone', 'Mobile number', 'tel'], ['line1', 'Address (house no, street, area)'],
  ['city', 'City'], ['state', 'State'], ['pincode', 'PIN code', 'numeric'],
];

function validate(a: Address) {
  const e: Partial<Record<keyof Address, string>> = {};
  if (a.name.trim().length < 2) e.name = 'Enter the recipient name';
  if (!/^[6-9]\d{9}$/.test(a.phone.trim())) e.phone = 'Enter a valid 10-digit mobile number';
  if (a.line1.trim().length < 5) e.line1 = 'Enter the full address';
  if (a.city.trim().length < 2) e.city = 'Enter the city';
  if (a.state.trim().length < 2) e.state = 'Enter the state';
  if (!/^[1-9]\d{5}$/.test(a.pincode.trim())) e.pincode = 'Enter a valid 6-digit PIN code';
  return e;
}

export default function Checkout() {
  useTitle('Checkout');
  const { user } = useAuth();
  const { data: cart, isLoading, refetch } = useCart();
  const [addr, setAddr] = useState<Address>(user?.address || EMPTY);
  const [touched, setTouched] = useState(false);
  const [payment, setPayment] = useState('upi');
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const errors = validate(addr);

  const place = useMutation({
    mutationFn: () => api<{ orderId: number }>('/checkout', { method: 'POST', body: { address: addr, paymentMethod: payment, expectedTotal: cart!.total, idempotencyKey } }),
    onSuccess: (r) => {
      qc.setQueryData(['cart'], { groups: [], subtotal: 0, shipping: 0, total: 0, savings: 0, count: 0 });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['product'] });
      nav(`/orders/${r.orderId}?placed=1`, { replace: true });
    },
    onError: (e: Error) => {
      toast(e.message, 'err');
      if (e instanceof ApiError && e.status === 409) refetch();
    },
  });

  if (isLoading) return <div className="center pad"><Spinner /></div>;
  if (!cart?.count && !place.isSuccess) return <Navigate to="/cart" replace />;
  if (!cart) return null;
  const codBlocked = cart.total > 50_000;

  return (
    <form className="cart-page" noValidate onSubmit={(e) => {
      e.preventDefault(); setTouched(true);
      if (Object.keys(errors).length) return toast('Please fix the highlighted fields', 'err');
      place.mutate();
    }}>
      <div>
        <h1 className="section-title">Checkout</h1>
        <div className="card pad-lg">
          <h3>Delivery address</h3>
          <div className="form-grid">
            {FIELDS.map(([k, label, mode]) => (
              <label key={k} className={k === 'line1' ? 'span2' : ''}>{label}
                <input value={addr[k]} inputMode={mode as 'tel' | 'numeric' | undefined} autoComplete={k === 'line1' ? 'street-address' : k === 'pincode' ? 'postal-code' : k === 'phone' ? 'tel' : k}
                  aria-invalid={touched && !!errors[k]} onChange={(e) => setAddr({ ...addr, [k]: e.target.value })} />
                {touched && errors[k] && <span className="xs err">{errors[k]}</span>}
              </label>
            ))}
          </div>
        </div>
        <div className="card pad-lg">
          <h3>Payment method</h3>
          <div className="pay-options">
            {Object.entries(PAYMENT_LABEL).map(([k, label]) => (
              <label key={k} className={`pay${payment === k ? ' on' : ''}${k === 'cod' && codBlocked ? ' disabled' : ''}`}>
                <input type="radio" name="pay" value={k} checked={payment === k} disabled={k === 'cod' && codBlocked} onChange={() => setPayment(k)} />
                {label}{k === 'cod' && codBlocked && <span className="xs muted"> (up to ₹50,000)</span>}
              </label>
            ))}
          </div>
          <p className="xs muted">Payment is completed securely on each store's payment page. Kompare never stores card details.</p>
        </div>
      </div>
      <Summary cart={cart}>
        <button className="btn primary block" disabled={place.isPending}>{place.isPending ? 'Placing order…' : `Place order · ${money(cart.total)}`}</button>
      </Summary>
    </form>
  );
}
