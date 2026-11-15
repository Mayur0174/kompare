import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { seed } from '../server/seed.js';
import { createApp } from '../server/app.js';
import { normalizeResults, groupOffers, platformIdFor } from '../server/live.js';

// Shape of a SerpApi google_shopping response (abridged).
const serp = (price = 64999) => ({
  shopping_results: [
    { position: 1, title: 'Apple iPhone 15 (128 GB) - Black', source: 'Amazon.in', extracted_price: price, extracted_old_price: 69900, link: 'https://www.amazon.in/dp/B0CHX1W1XY', thumbnail: 'https://example-cdn.test/iphone.jpg', rating: 4.5, reviews: 1200, delivery: 'Free delivery', product_id: '111' },
    { position: 2, title: 'Apple iPhone 15 128GB Black', source: 'Flipkart', extracted_price: price + 1000, link: 'https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4', product_id: '111' },
    { position: 3, title: 'Apple iPhone 15 (128GB) Black', source: 'Croma', price: `₹${(price + 500).toLocaleString('en-IN')}.00`, product_link: 'https://www.google.com/shopping/product/111' },
    { position: 4, title: 'Samsung Galaxy S24 5G (8GB, 256GB) Onyx Black', source: 'Reliance Digital', extracted_price: 74999, link: 'https://www.reliancedigital.in/samsung-galaxy-s24/p/494351234', product_id: '222' },
    { position: 5, title: 'Broken result without price', source: 'Amazon.in', link: 'https://www.amazon.in/x' },
  ],
});

let server, base, db, token;
const call = async (path, { method = 'GET', body, auth = true } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
const ingest = (q, price) => call('/live/ingest', { method: 'POST', body: { query: q, offers: normalizeResults(serp(price)) } });

before(async () => {
  db = openDb(':memory:');
  seed(db);
  server = createApp(db, { log: { error() {} } }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

test('no preloaded products: the catalogue starts empty', async () => {
  assert.equal(db.prepare('SELECT COUNT(*) c FROM products').get().c, 0);
  assert.equal((await call('/products')).body.total, 0);
  const meta = (await call('/meta')).body;
  assert.ok(meta.platforms.find((p) => p.id === 'amazon').searchUrl.startsWith('https://www.amazon.in/s?k='));
});

test('normalises live results and maps stores', () => {
  const offers = normalizeResults(serp());
  assert.equal(offers.length, 4, 'drops results without a price');
  assert.equal(offers[2].price, 65499, 'parses "₹65,499.00"');
  assert.equal(offers[2].link, 'https://www.google.com/shopping/product/111', 'falls back to the Google Shopping page');
  assert.equal(platformIdFor('Amazon.in'), 'amazon');
  assert.equal(platformIdFor('Reliance Digital'), 'reliance');
  assert.equal(platformIdFor('Vijay Sales'), 'vijay-sales');
  const groups = groupOffers(offers);
  assert.equal(groups.length, 2, 'same iPhone across 3 stores is one product');
  assert.equal(groups[0].offers.length, 3);
});

test('ingest stores real links, groups stores and caches the query', async () => {
  const r = await ingest('iphone 15', 64999);
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 2);
  const iphone = r.body.items[0];
  assert.deepEqual([...iphone.platforms].sort(), ['amazon', 'croma', 'flipkart']);
  assert.equal(iphone.bestPrice, 64999);
  assert.equal(iphone.image, 'https://example-cdn.test/iphone.jpg');
  const d = (await call(`/products/${iphone.slug}`)).body;
  assert.equal(d.listings[0].url, 'https://www.amazon.in/dp/B0CHX1W1XY');
  assert.equal(d.verdict, null, 'no buy verdict without real history');
  assert.ok(d.trackedSince);
  const c = (await call('/live/cached?q=IPHONE%2015')).body;
  assert.equal(c.fresh, true);
  assert.equal(c.items.length, 2);
  assert.equal((await call('/live/cached?q=unknown')).body.fresh, false);
  // Local search finds ingested products.
  assert.equal((await call('/products?q=galaxy')).body.total, 1);
});

test('re-checking updates the same product and records real history', async () => {
  const before = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  await ingest('iphone 15', 62999);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM products').get().c, before, 'no duplicates');
  const slug = (await call('/products?q=iphone')).body.items[0].slug;
  const d = (await call(`/products/${slug}`)).body;
  assert.equal(d.listings[0].price, 62999);
  const h = (await call(`/products/${slug}/history?days=7`)).body;
  assert.ok(h.series.amazon.some(([, p]) => p === 62999));
});

test('auth, watchlist and alerts on real products', async () => {
  assert.equal((await call('/watchlist', { auth: false })).status, 401);
  const s = await call('/auth/signup', { method: 'POST', body: { name: 'Test', email: 't@x.com', password: 'password123' } });
  token = s.body.token;
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: 't@x.com', password: 'wrong' } })).status, 401);
  const p = (await call('/products?q=iphone')).body.items[0];
  await call(`/watchlist/${p.id}`, { method: 'POST' });
  assert.equal((await call('/watchlist')).body.items.length, 1);
  const a = await call('/alerts', { method: 'POST', body: { productId: p.id, targetPrice: 60000 } });
  assert.equal(a.body.triggered, false);
  await ingest('iphone 15', 59999); // a real price drop arrives
  const n = (await call('/notifications')).body;
  assert.ok(n.items.some((x) => x.title.startsWith('Price drop') && x.body.includes('59,999')));
  assert.equal((await call('/alerts')).body.items[0].active, false);
  // Target already met → fires immediately.
  const g = (await call('/products?q=galaxy')).body.items[0];
  assert.equal((await call('/alerts', { method: 'POST', body: { productId: g.id, targetPrice: 80000 } })).body.triggered, true);
});

test('cloud backup restores watchlist and alerts on a fresh device', async () => {
  const snap = (await call('/sync/export')).body;
  assert.ok(snap.watchlist[0].product.offers.length >= 3);
  // Fresh device: empty database, new local account.
  const db2 = openDb(':memory:');
  seed(db2);
  const s2 = createApp(db2, { log: { error() {} } }).listen(0);
  await new Promise((r) => s2.once('listening', r));
  const b2 = `http://localhost:${s2.address().port}/api`;
  const post = (path, body, tok) => fetch(b2 + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const tok = (await post('/auth/signup', { name: 'Test', email: 't@x.com', password: 'password123' })).body.token;
    assert.equal((await post('/sync/import', { snapshot: snap }, tok)).status, 200);
    const w = await fetch(`${b2}/watchlist`, { headers: { authorization: `Bearer ${tok}` } }).then((r) => r.json());
    assert.equal(w.items.length, snap.watchlist.length);
    assert.ok(w.items.some((p) => p.offers === 3 && p.platforms.includes('amazon')));
    const al = await fetch(`${b2}/alerts`, { headers: { authorization: `Bearer ${tok}` } }).then((r) => r.json());
    assert.equal(al.items.length, snap.alerts.length);
  } finally { s2.close(); }
  assert.equal((await call('/sync/import', { method: 'POST', body: { snapshot: { version: 2 } } })).status, 400);
});

test('live search without a key, Google sign-in config guard, validation', async () => {
  assert.equal((await call('/live/search?q=phone')).status, 501);
  assert.equal((await call('/auth/google', { method: 'POST', body: { idToken: 'x'.repeat(40) }, auth: false })).status, 501);
  assert.equal((await call('/live/ingest', { method: 'POST', body: { query: 'x', offers: [{ title: 'a', source: 'b', price: -1, link: 'nope' }] } })).status, 400);
});

test('pasted store links resolve to tracked products', async () => {
  assert.equal((await call(`/resolve?url=${encodeURIComponent('https://www.amazon.in/dp/B0CHX1W1XY')}`)).status, 200);
  assert.equal((await call('/resolve?url=notaurl')).status, 400);
});

test('account deletion removes the user and their data', async () => {
  assert.equal((await call('/auth/me', { method: 'DELETE' })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE email='t@x.com'").get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM watchlist').get().c, 0);
});
