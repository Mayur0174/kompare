import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Cart as CartT } from '../lib/api';
import { useCart, useMeta, useTitle, useToast } from '../lib/hooks';
import { money } from '../lib/format';
import { Empty, ErrorBox, PlatformBadge, Spinner, Thumb } from '../components/ui';

export default function Cart() {
  useTitle('Cart');
  const { data: cart, isLoading, isError, error, refetch } = useCart();
  const { platforms } = useMeta();
  const qc = useQueryClient();
  const toast = useToast();
  const update = useMutation({
    mutationFn: ({ listingId, qty }: { listingId: number; qty: number }) =>
      qty > 0 ? api<CartT>(`/cart/${listingId}`, { method: 'PATCH', body: { qty } }) : api<CartT>(`/cart/${listingId}`, { method: 'DELETE' }),
    onSuccess: (c) => qc.setQueryData(['cart'], c),
    onError: (e: Error) => toast(e.message, 'err'),
  });

  if (isLoading) return <div className="center pad"><Spinner /></div>;
  if (isError) return <ErrorBox error={error} retry={refetch} />;
  if (!cart?.count) return <Empty title="Your cart is empty" icon="🛒"><p className="muted">Add offers from any store — we'll split the order for you.</p><Link className="btn primary" to="/">Start comparing</Link></Empty>;

  const blocked = cart.groups.some((g) => g.items.some((i) => !i.inStock));
  return (
    <div className="cart-page">
      <div>
        <h1 className="section-title">Cart · {cart.count} item{cart.count > 1 ? 's' : ''} from {cart.groups.length} store{cart.groups.length > 1 ? 's' : ''}</h1>
        {cart.groups.map((g) => (
          <div key={g.platformId} className="card cart-group">
            <div className="cart-group-head">
              <PlatformBadge id={g.platformId} />
              <span className="xs muted">{g.shipping ? `${money(g.shipping)} delivery · add ${money(g.freeShippingGap)} more for free delivery` : 'Free delivery'}</span>
            </div>
            {g.items.map((i) => (
              <div key={i.listingId} className="cart-item">
                <Thumb emoji={i.emoji} hue={i.hue} size="sm" />
                <div className="grow">
                  <Link to={`/p/${i.slug}`} className="cart-title">{i.title}</Link>
                  <div className="xs muted">Delivery in {i.deliveryDays} days</div>
                  {!i.inStock && <div className="xs err">Out of stock — remove to continue</div>}
                  {i.price !== i.addedPrice && <div className={`xs ${i.price < i.addedPrice ? 'ok' : 'err'}`}>Price {i.price < i.addedPrice ? 'dropped' : 'rose'} from {money(i.addedPrice)} since you added it</div>}
                  {i.cheaperAt && <div className="xs warn">💡 {money(i.cheaperAt.price)} on {platforms.get(i.cheaperAt.platformId)?.name} — <Link to={`/p/${i.slug}`} className="link">compare</Link></div>}
                </div>
                <div className="qty">
                  <button aria-label="Decrease quantity" disabled={update.isPending} onClick={() => update.mutate({ listingId: i.listingId, qty: i.qty - 1 })}>−</button>
                  <span>{i.qty}</span>
                  <button aria-label="Increase quantity" disabled={update.isPending || i.qty >= 10} onClick={() => update.mutate({ listingId: i.listingId, qty: i.qty + 1 })}>+</button>
                </div>
                <div className="right">
                  <b>{money(i.price * i.qty)}</b>
                  {i.mrp > i.price && <div className="xs muted"><s>{money(i.mrp * i.qty)}</s></div>}
                  <button className="link xs" onClick={() => update.mutate({ listingId: i.listingId, qty: 0 })}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <Summary cart={cart}>
        <Link to="/checkout" className={`btn primary block${blocked ? ' disabled' : ''}`} aria-disabled={blocked} onClick={(e) => blocked && e.preventDefault()}>Proceed to checkout</Link>
      </Summary>
    </div>
  );
}

export function Summary({ cart, children }: { cart: CartT; children?: React.ReactNode }) {
  return (
    <aside className="card summary">
      <h3>Order summary</h3>
      <div className="sum-row"><span>Items ({cart.count})</span><span>{money(cart.subtotal)}</span></div>
      <div className="sum-row"><span>Delivery</span><span>{cart.shipping ? money(cart.shipping) : 'Free'}</span></div>
      <div className="sum-row total"><span>Total</span><span>{money(cart.total)}</span></div>
      {cart.savings > 0 && <div className="save-banner">You save {money(cart.savings)} vs MRP</div>}
      {children}
      <p className="xs muted">Your order is split into {cart.groups.length} sub-order{cart.groups.length > 1 ? 's' : ''} and placed with each store directly.</p>
    </aside>
  );
}
