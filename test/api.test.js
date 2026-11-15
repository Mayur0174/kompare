import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { seed } from '../server/seed.js';
import { createApp } from '../server/app.js';
import { refreshPrices } from '../server/priceEngine.js';

let server, base, db, token;
const call = async (path, { method = 'GET', body, auth = true } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  db = openDb(':memory:');
  seed(db);
  server = createApp(db, { log: { error() {} } }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

test('search finds products across platforms and filters work', async () => {
  const r = await call('/products?q=jackets');
  assert.equal(r.status, 200);
  assert.ok(r.body.total >= 5);
  assert.ok(r.body.items.every((i) => /jacket|windcheater/i.test(i.title)));
  const multi = r.body.items.find((i) => i.platforms.length > 1);
  const single = r.body.items.find((i) => i.platforms.length === 1);
  assert.ok(multi && single, 'has both multi-store and exclusive products');
  const f = await call('/products?category=mobiles&sort=price_asc');
  const prices = f.body.items.map((i) => i.bestPrice);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  assert.equal((await call('/products?sort=bogus')).status, 400);
});

test('product detail returns sorted offers, history and verdict', async () => {
  const { body } = await call('/products?q=iphone');
  const slug = body.items[0].slug;
  const d = await call(`/products/${slug}`);
  assert.equal(d.status, 200);
  const inStock = d.body.listings.filter((l) => l.inStock).map((l) => l.effectivePrice);
  assert.deepEqual(inStock, [...inStock].sort((a, b) => a - b));
  const h = await call(`/products/${slug}/history?days=30`);
  for (const pts of Object.values(h.body.series)) assert.ok(pts.length >= 30);
  assert.equal((await call('/products/nope')).status, 404);
});

test('home feed returns diversified trending and best sellers with a 12h schedule', async () => {
  const r = await call('/deals');
  assert.equal(r.body.trending.length, 12);
  assert.equal(r.body.bestsellers.length, 12);
  const perCat = {};
  for (const p of r.body.trending) perCat[p.category] = (perCat[p.category] || 0) + 1;
  assert.ok(Math.max(...Object.values(perCat)) <= 3);
  assert.equal(r.body.feedNextUpdateAt - r.body.feedUpdatedAt, 12 * 3600 * 1000);
  const again = await call('/deals');
  assert.equal(again.body.feedUpdatedAt, r.body.feedUpdatedAt, 'snapshot is stable between refreshes');
});

test('auth: signup, login, bad password, protected routes', async () => {
  assert.equal((await call('/cart', { auth: false })).status, 401);
  const s = await call('/auth/signup', { method: 'POST', body: { name: 'Test', email: 'T@x.com', password: 'password123' } });
  assert.equal(s.status, 200);
  assert.equal((await call('/auth/signup', { method: 'POST', body: { name: 'Test', email: 't@x.com', password: 'password123' } })).status, 409);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: 't@x.com', password: 'wrong' } })).status, 401);
  const l = await call('/auth/login', { method: 'POST', body: { email: 't@x.com', password: 'password123' } });
  token = l.body.token;
  assert.equal((await call('/auth/me')).body.user.email, 't@x.com');
});

test('cart → checkout splits per platform, is idempotent and guards price changes', async () => {
  const items = (await call('/products?category=audio')).body.items;
  const a = (await call(`/products/${items[0].slug}`)).body.listings.find((l) => l.inStock);
  const b = (await call(`/products/${items[1].slug}`)).body.listings.find((l) => l.inStock && l.platformId !== a.platformId);
  await call('/cart', { method: 'POST', body: { listingId: a.id } });
  const cart = (await call('/cart', { method: 'POST', body: { listingId: b.id, qty: 2 } })).body;
  assert.equal(cart.count, 3);
  assert.equal(cart.groups.length, 2);
  const address = { name: 'Test User', phone: '9876543210', line1: '1 Test Street', city: 'Pune', state: 'MH', pincode: '411001' };

  const stale = await call('/checkout', { method: 'POST', body: { address, paymentMethod: 'upi', expectedTotal: cart.total + 1, idempotencyKey: 'key-stale-1' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.details.code, 'PRICE_CHANGED');

  const bad = await call('/checkout', { method: 'POST', body: { address: { ...address, pincode: '12' }, paymentMethod: 'upi', expectedTotal: cart.total, idempotencyKey: 'key-bad-1' } });
  assert.equal(bad.status, 400);

  const ok = await call('/checkout', { method: 'POST', body: { address, paymentMethod: 'upi', expectedTotal: cart.total, idempotencyKey: 'key-good-1' } });
  assert.equal(ok.status, 200);
  const dup = await call('/checkout', { method: 'POST', body: { address, paymentMethod: 'upi', expectedTotal: cart.total, idempotencyKey: 'key-good-1' } });
  assert.equal(dup.body.orderId, ok.body.orderId);
  assert.equal((await call('/cart')).body.count, 0);

  const order = (await call(`/orders/${ok.body.orderId}`)).body;
  assert.equal(order.shipments.length, 2);
  assert.equal(order.total, cart.total);
  assert.equal(order.status, 'placed');
  const c = await call(`/orders/${ok.body.orderId}/cancel`, { method: 'POST' });
  assert.equal(c.body.status, 'cancelled');
  assert.equal((await call(`/orders/${ok.body.orderId}/cancel`, { method: 'POST' })).status, 409);
});

test('price alerts fire a notification when the price drops below target', async () => {
  const p = (await call('/products?q=sony')).body.items[0];
  await call('/alerts', { method: 'POST', body: { productId: p.id, targetPrice: p.bestPrice - 1 } });
  assert.equal((await call('/alerts')).body.items[0].active, true);
  // Force a price drop through the provider path.
  db.prepare('UPDATE listings SET base_price = ?, price = ? WHERE product_id = ? AND in_stock = 1').run(Math.round(p.bestPrice * 0.5), Math.round(p.bestPrice * 0.5), p.id);
  refreshPrices(db, { fraction: 1, rnd: () => 0.5 });
  const n = (await call('/notifications')).body;
  assert.ok(n.items.some((x) => x.title.includes('Price drop')));
  assert.equal((await call('/alerts')).body.items[0].active, false);
});

test('resolve pasted store URLs', async () => {
  const url = db.prepare("SELECT url FROM listings WHERE platform_id='flipkart' LIMIT 1").get().url;
  assert.equal((await call(`/resolve?url=${encodeURIComponent(url)}`)).status, 200);
  assert.equal((await call(`/resolve?url=${encodeURIComponent('https://example.com/x')}`)).status, 404);
  assert.equal((await call('/resolve?url=notaurl')).status, 400);
});

test('cloud backup: export → wipe → import restores the same data', async () => {
  const before = (await call('/sync/export')).body;
  assert.ok(before.orders.length >= 1 && before.alerts.length >= 1);
  const p = (await call('/products?q=boat')).body.items[0];
  await call(`/watchlist/${p.id}`, { method: 'POST' });
  const snap = (await call('/sync/export')).body;
  // Simulate a fresh device: wipe this user's data, then restore from the snapshot.
  const uid = db.prepare("SELECT id FROM users WHERE email='t@x.com'").get().id;
  for (const t of ['watchlist', 'alerts', 'notifications', 'orders']) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(uid);
  assert.equal((await call('/watchlist')).body.items.length, 0);
  assert.equal((await call('/sync/import', { method: 'POST', body: { snapshot: snap } })).status, 200);
  const after = (await call('/sync/export')).body;
  for (const k of ['watchlist', 'alerts', 'cart', 'notifications']) assert.equal(after[k].length, snap[k].length, k);
  assert.deepEqual(after.orders.map((o) => [o.total, o.items.length, o.cancelled_at]), snap.orders.map((o) => [o.total, o.items.length, o.cancelled_at]));
  assert.equal((await call('/sync/import', { method: 'POST', body: { snapshot: { version: 2 } } })).status, 400);
});

test('google sign-in requires server configuration and rejects forged tokens', async () => {
  const r = await call('/auth/google', { method: 'POST', body: { idToken: 'x'.repeat(40) }, auth: false });
  assert.equal(r.status, 501);
});
