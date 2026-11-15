import express from 'express';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { tx, stmtCache, dataVersion } from './db.js';
import { authenticate, requireAuth, hashPassword, verifyPassword, signToken } from './auth.js';
import { fetchLiveOffers, ingestOffers, normQuery } from './live.js';
import { HttpError, DAY, HOUR } from './util.js';
import { CATEGORIES, SEARCH_URLS } from './catalog.js';
import { config } from './config.js';
import { verifyFirebaseIdToken } from './firebaseVerify.js';
import { checkAlerts } from './priceEngine.js';

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => { try { const out = fn(req, res); if (out !== undefined) res.json(out); } catch (e) { next(e); } };
const parse = (schema, data) => {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message || 'Invalid input', r.error.flatten().fieldErrors);
  return r.data;
};

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref?.();
  return (req, _res, next) => {
    const key = req.ip;
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > max) return next(new HttpError(429, 'Too many requests, please slow down'));
    next();
  };
}

const AddressSchema = z.object({
  name: z.string().trim().min(2, 'Enter the recipient name').max(80),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
  line1: z.string().trim().min(5, 'Enter the full address').max(200),
  city: z.string().trim().min(2, 'Enter the city').max(60),
  state: z.string().trim().min(2, 'Enter the state').max(60),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
});

export function createApp(db, { log = console } = {}) {
  const q = stmtCache(db);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(compression());
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  // CORS for the native (Capacitor) apps, whose UI is served from a local origin.
  const allowed = new Set(['capacitor://localhost', 'https://localhost', 'http://localhost', ...(process.env.CORS_ORIGINS || '').split(',').filter(Boolean)]);
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '50kb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, max: 600 }));
  app.use(authenticate);

  // ---------- cached product summaries (invalidated when prices change) ----------
  let summaryCache = { key: '', rows: [] };
  function summaries() {
    const key = `${dataVersion.v}:${Math.floor(Date.now() / 60_000)}`;
    if (summaryCache.key === key) return summaryCache.rows;
    const since = Date.now() - 30 * DAY;
    const rows = q(`
      SELECT p.id, p.slug, p.title, p.brand, p.category, p.emoji, p.hue, p.image, p.rating, p.review_count, p.base_sales, p.search_text,
             MAX(l.mrp) AS mrp,
             MIN(CASE WHEN l.in_stock=1 THEN l.price END) AS best_price,
             MAX(l.price) AS max_price,
             COUNT(l.id) AS offers,
             SUM(l.in_stock) AS in_stock_offers
      FROM products p JOIN listings l ON l.product_id = p.id
      GROUP BY p.id`).all();
    const best = q(`SELECT l.product_id, l.platform_id FROM listings l
      WHERE l.in_stock=1 AND l.price = (SELECT MIN(price) FROM listings x WHERE x.product_id=l.product_id AND x.in_stock=1)`).all();
    const bestMap = new Map(best.map((b) => [b.product_id, b.platform_id]));
    // Average of each day's lowest price across stores (a real "over time" baseline, not a cross-store mix).
    const avg = q(`SELECT product_id, AVG(daymin) avg30, MIN(daymin) low30, COUNT(*) days FROM (
        SELECT l.product_id, h.ts / 86400000 AS d, MIN(h.price) daymin
        FROM price_history h JOIN listings l ON l.id = h.listing_id WHERE h.ts >= ? GROUP BY l.product_id, d
      ) GROUP BY product_id`).all(since);
    const avgMap = new Map(avg.map((a) => [a.product_id, a]));
    const dayNo = Math.floor(Date.now() / DAY);
    const views = new Map(q('SELECT product_id, SUM(n) n FROM product_views WHERE day > ? GROUP BY product_id').all(dayNo - 7).map((r) => [r.product_id, r.n]));
    const watches = new Map(q('SELECT product_id, COUNT(*) n FROM watchlist WHERE created_at >= ? GROUP BY product_id').all(Date.now() - 7 * DAY).map((r) => [r.product_id, r.n]));
    const sold = new Map(q(`SELECT i.product_id, SUM(i.qty) n FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE o.created_at >= ? AND o.cancelled_at IS NULL GROUP BY i.product_id`).all(Date.now() - 30 * DAY).map((r) => [r.product_id, r.n]));
    const platRows = q('SELECT product_id, platform_id FROM listings').all();
    const platMap = new Map();
    for (const r of platRows) (platMap.get(r.product_id) || platMap.set(r.product_id, []).get(r.product_id)).push(r.platform_id);
    summaryCache = {
      key,
      rows: rows.map((r) => {
        const a = avgMap.get(r.id);
        const price = r.best_price ?? r.max_price;
        // Only meaningful once there are a few days of real price checks.
        const dropPct = a && a.days >= 3 ? Math.round((1 - price / a.avg30) * 1000) / 10 : 0;
        const views7 = views.get(r.id) || 0;
        return {
          sold30: r.base_sales + (sold.get(r.id) || 0),
          views7,
          trendScore: views7 + 25 * (watches.get(r.id) || 0) + 40 * (sold.get(r.id) || 0) + Math.max(0, dropPct) * 15,
          id: r.id, slug: r.slug, title: r.title, brand: r.brand, category: r.category, emoji: r.emoji, hue: r.hue, image: r.image || null,
          rating: r.rating, reviewCount: r.review_count, mrp: r.mrp, bestPrice: price, maxPrice: r.max_price,
          bestPlatform: bestMap.get(r.id) || null, offers: r.offers, inStock: r.in_stock_offers > 0,
          discount: Math.round((1 - price / r.mrp) * 100),
          avg30: a ? Math.round(a.avg30) : price,
          dropPct,
          spread: r.max_price - price,
          platforms: platMap.get(r.id) || [],
          _search: r.search_text,
        };
      }),
    };
    return summaryCache.rows;
  }
  const publicSummary = ({ _search, ...rest }) => rest;

  // ---------- meta ----------
  app.get('/api/health', wrap(() => ({ ok: true, time: Date.now() })));
  app.get('/api/meta', wrap((_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    const platforms = q('SELECT * FROM platforms').all().map((p) => ({ ...p, cod: !!p.cod, searchUrl: SEARCH_URLS[p.id] || null }));
    const counts = new Map(q('SELECT category, COUNT(*) c FROM products GROUP BY category').all().map((r) => [r.category, r.c]));
    return { platforms, categories: CATEGORIES.map(({ platforms: _p, ...c }) => ({ ...c, count: counts.get(c.id) || 0 })) };
  }));

  // ---------- search ----------
  const SearchSchema = z.object({
    q: z.string().trim().max(100).optional().default(''),
    category: z.string().max(40).optional(),
    platform: z.string().max(40).optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    inStock: z.enum(['1', '0']).optional(),
    sort: z.enum(['relevance', 'price_asc', 'price_desc', 'discount', 'rating', 'drop', 'spread', 'popular', 'trending']).optional().default('relevance'),
    page: z.coerce.number().int().min(1).max(1000).optional().default(1),
    limit: z.coerce.number().int().min(1).max(60).optional().default(24),
    slugs: z.string().max(2000).optional(), // comma-separated; returns exactly these, in this order
  });

  function score(s, tokens) {
    if (!tokens.length) return 1;
    let sc = 0;
    for (const t of tokens) {
      if (s._search.includes(t)) sc += s.title.toLowerCase().includes(t) ? 3 : 1;
      else if (t.length > 3 && s._search.includes(t.slice(0, -1))) sc += 1; // tolerate plural / typo-at-end
      else return 0;
    }
    return sc;
  }

  app.get('/api/products', wrap((req) => {
    const f = parse(SearchSchema, req.query);
    if (f.slugs) {
      const want = f.slugs.split(',').slice(0, 30);
      const bySlug = new Map(summaries().map((s) => [s.slug, s]));
      const items = want.map((s) => bySlug.get(s)).filter(Boolean).map(publicSummary);
      return { total: items.length, page: 1, pages: 1, items };
    }
    const tokens = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    let rows = summaries()
      .map((s) => ({ s, sc: score(s, tokens) }))
      .filter(({ s, sc }) => sc > 0
        && (!f.category || s.category === f.category)
        && (!f.platform || s.platforms.includes(f.platform))
        && (f.minPrice === undefined || s.bestPrice >= f.minPrice)
        && (f.maxPrice === undefined || s.bestPrice <= f.maxPrice)
        && (f.inStock !== '1' || s.inStock));
    const sorters = {
      relevance: (a, b) => b.sc - a.sc || b.s.sold30 - a.s.sold30,
      price_asc: (a, b) => a.s.bestPrice - b.s.bestPrice,
      price_desc: (a, b) => b.s.bestPrice - a.s.bestPrice,
      discount: (a, b) => b.s.discount - a.s.discount,
      rating: (a, b) => b.s.rating - a.s.rating,
      popular: (a, b) => b.s.sold30 - a.s.sold30,
      trending: (a, b) => b.s.trendScore - a.s.trendScore,
      drop: (a, b) => b.s.dropPct - a.s.dropPct,
      spread: (a, b) => b.s.spread - a.s.spread,
    };
    rows.sort(sorters[f.sort]);
    const total = rows.length;
    rows = rows.slice((f.page - 1) * f.limit, f.page * f.limit);
    return { total, page: f.page, pages: Math.ceil(total / f.limit), items: rows.map((r) => publicSummary(r.s)) };
  }));

  app.get('/api/suggest', wrap((req) => {
    const text = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
    if (!text) return { items: [] };
    const tokens = text.split(/\s+/);
    const items = summaries().map((s) => ({ s, sc: score(s, tokens) })).filter((r) => r.sc > 0)
      .sort((a, b) => b.sc - a.sc || b.s.reviewCount - a.s.reviewCount).slice(0, 6)
      .map(({ s }) => ({ slug: s.slug, title: s.title, emoji: s.emoji, bestPrice: s.bestPrice, category: s.category }));
    return { items };
  }));

  // Paste a product URL from any supported store and jump to its comparison page.
  app.get('/api/resolve', wrap((req) => {
    const raw = String(req.query.url || '').trim();
    let u;
    try { u = new URL(raw); } catch { throw new HttpError(400, 'That does not look like a valid URL'); }
    const host = u.hostname.replace(/^www\./, '');
    const plat = q('SELECT id, name FROM platforms WHERE domain = ?').get(host);
    if (!plat) throw new HttpError(404, `We don't support ${host} yet`);
    const clean = `https://www.${host}${u.pathname}`.replace(/\/$/, '');
    const hit = q('SELECT p.slug FROM listings l JOIN products p ON p.id=l.product_id WHERE l.url = ?').get(clean);
    if (hit) return { slug: hit.slug };
    // Fall back to matching the URL slug words against our catalogue.
    const words = u.pathname.split(/[/\-_]+/).filter((w) => w.length > 2 && !/^\d+$/.test(w)).map((w) => w.toLowerCase());
    const best = summaries().map((s) => ({ s, n: words.filter((w) => s._search.includes(w)).length })).sort((a, b) => b.n - a.n)[0];
    if (best && best.n >= 2) return { slug: best.s.slug };
    throw new HttpError(404, `Couldn't find that ${plat.name} product in our catalogue`);
  }));

  // ---------- product detail ----------
  function productBySlug(slug) {
    const p = q('SELECT * FROM products WHERE slug = ?').get(slug);
    if (!p) throw new HttpError(404, 'Product not found');
    return p;
  }

  function listingView(l, plat) {
    const shipping = l.price >= plat.free_shipping_above ? 0 : plat.shipping_fee;
    return {
      id: l.id, platformId: l.platform_id, url: l.url, seller: l.seller, price: l.price, mrp: l.mrp,
      discount: Math.round((1 - l.price / l.mrp) * 100), inStock: !!l.in_stock, stockQty: l.stock_qty,
      deliveryDays: l.delivery_days, rating: l.rating, shipping, effectivePrice: l.price + shipping,
      returnDays: plat.return_days, cod: !!plat.cod, updatedAt: l.updated_at,
    };
  }

  app.get('/api/products/:slug', wrap((req) => {
    const p = productBySlug(req.params.slug);
    q('INSERT INTO product_views (product_id, day, n) VALUES (?,?,1) ON CONFLICT(product_id, day) DO UPDATE SET n = n + 1').run(p.id, Math.floor(Date.now() / DAY));
    const plats = new Map(q('SELECT * FROM platforms').all().map((x) => [x.id, x]));
    const listings = q('SELECT * FROM listings WHERE product_id = ?').all(p.id).map((l) => listingView(l, plats.get(l.platform_id)));
    listings.sort((a, b) => (b.inStock - a.inStock) || a.effectivePrice - b.effectivePrice);
    const stats = q(`SELECT l.platform_id, MIN(h.price) low, MAX(h.price) high, ROUND(AVG(h.price)) avg
      FROM price_history h JOIN listings l ON l.id = h.listing_id WHERE l.product_id = ? GROUP BY l.platform_id`).all(p.id);
    const overall = q(`SELECT MIN(h.price) low, MAX(h.price) high, ROUND(AVG(h.price)) avg,
        (SELECT h2.ts FROM price_history h2 JOIN listings l2 ON l2.id=h2.listing_id WHERE l2.product_id=? ORDER BY h2.price ASC, h2.ts DESC LIMIT 1) low_ts
      FROM price_history h JOIN listings l ON l.id = h.listing_id WHERE l.product_id = ?`).get(p.id, p.id);
    const best = listings.find((l) => l.inStock) || null;
    // Buy-timing verdict: where does today's best price sit between the all-time low and average?
    let verdict = null;
    const points = q('SELECT COUNT(DISTINCT h.ts / 86400000) d FROM price_history h JOIN listings l ON l.id=h.listing_id WHERE l.product_id=?').get(p.id).d;
    if (best && points >= 3) {
      const pos = overall.avg === overall.low ? 0 : (best.price - overall.low) / (overall.avg - overall.low);
      verdict = pos <= 0.35 ? { level: 'great', text: 'Great time to buy – close to the lowest price we have seen.' }
        : pos <= 1 ? { level: 'good', text: 'Fair price – below the 6-month average.' }
          : { level: 'wait', text: 'Consider waiting – the price is above its usual level.' };
    }
    const similar = summaries().filter((s) => s.category === p.category && s.id !== p.id)
      .sort((a, b) => Math.abs(a.bestPrice - (best?.price ?? 0)) - Math.abs(b.bestPrice - (best?.price ?? 0))).slice(0, 6).map(publicSummary);
    const watching = req.userId ? !!q('SELECT 1 FROM watchlist WHERE user_id=? AND product_id=?').get(req.userId, p.id) : false;
    const alert = req.userId ? q('SELECT id, target_price targetPrice, active FROM alerts WHERE user_id=? AND product_id=?').get(req.userId, p.id) || null : null;
    return {
      product: {
        id: p.id, slug: p.slug, title: p.title, brand: p.brand, category: p.category, description: p.description,
        specs: JSON.parse(p.specs), emoji: p.emoji, hue: p.hue, rating: p.rating, reviewCount: p.review_count, image: p.image || null,
      },
      listings,
      stats: Object.fromEntries(stats.map((s) => [s.platform_id, { low: s.low, high: s.high, avg: s.avg }])),
      overall: { low: overall.low, high: overall.high, avg: overall.avg, lowAt: overall.low_ts },
      verdict, similar, watching, alert: alert && { ...alert, active: !!alert.active },
      trackedSince: q('SELECT MIN(h.ts) t FROM price_history h JOIN listings l ON l.id=h.listing_id WHERE l.product_id=?').get(p.id).t,
      image: p.image || null,
    };
  }));

  app.get('/api/products/:slug/history', wrap((req, res) => {
    const days = parse(z.coerce.number().int().min(1).max(365).default(90), req.query.days ?? 90);
    const p = productBySlug(req.params.slug);
    const since = Date.now() - days * DAY;
    const rows = q(`SELECT l.platform_id, h.ts, h.price FROM price_history h JOIN listings l ON l.id = h.listing_id
      WHERE l.product_id = ? AND h.ts >= ? ORDER BY h.ts`).all(p.id, since);
    // Carry the last known price before the window so each line starts at the left edge.
    const before = q(`SELECT l.platform_id, (SELECT h.price FROM price_history h WHERE h.listing_id=l.id AND h.ts < ? ORDER BY h.ts DESC LIMIT 1) price
      FROM listings l WHERE l.product_id = ?`).all(since, p.id);
    const series = {};
    for (const b of before) if (b.price != null) series[b.platform_id] = [[since, b.price]];
    for (const r of rows) (series[r.platform_id] ||= []).push([r.ts, r.price]);
    const current = q('SELECT platform_id, price FROM listings WHERE product_id=?').all(p.id);
    const now = Date.now();
    for (const c of current) (series[c.platform_id] ||= []).push([now, c.price]);
    res.set('Cache-Control', 'private, max-age=30');
    return { days, series };
  }));

  // ---------- auth ----------
  const authLimiter = rateLimit({ windowMs: 60_000, max: 20 });
  const userView = (u) => ({ id: u.id, email: u.email, name: u.name, address: u.address ? JSON.parse(u.address) : null });

  app.post('/api/auth/signup', authLimiter, wrap((req) => {
    const b = parse(z.object({
      name: z.string().trim().min(2, 'Name is too short').max(60),
      email: z.string().trim().toLowerCase().email('Enter a valid email'),
      password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    }), req.body);
    if (q('SELECT 1 FROM users WHERE email=?').get(b.email)) throw new HttpError(409, 'An account with this email already exists');
    const { lastInsertRowid: id } = q('INSERT INTO users (email,name,password_hash,created_at) VALUES (?,?,?,?)').run(b.email, b.name, hashPassword(b.password), Date.now());
    const u = q('SELECT * FROM users WHERE id=?').get(id);
    return { token: signToken(Number(id)), user: userView(u) };
  }));

  app.post('/api/auth/login', authLimiter, wrap((req) => {
    const b = parse(z.object({ email: z.string().trim().toLowerCase().min(1, 'Enter your email'), password: z.string().min(1, 'Enter your password') }), req.body);
    const u = q('SELECT * FROM users WHERE email=?').get(b.email);
    if (!u || !verifyPassword(b.password, u.password_hash)) throw new HttpError(401, 'Incorrect email or password');
    return { token: signToken(u.id), user: userView(u) };
  }));

  app.get('/api/auth/me', requireAuth, wrap((req) => {
    const u = q('SELECT * FROM users WHERE id=?').get(req.userId);
    if (!u) throw new HttpError(401, 'Session expired');
    return { user: userView(u) };
  }));

  // ---------- Google sign-in (Firebase Auth) ----------
  // Links the Google identity to a local account (matched by Google uid, then by email) and returns our token.
  function googleLogin(identity) {
    let u = q('SELECT * FROM users WHERE google_uid = ?').get(identity.uid) || q('SELECT * FROM users WHERE email = ?').get(identity.email.toLowerCase());
    if (u && !u.google_uid) q('UPDATE users SET google_uid = ? WHERE id = ?').run(identity.uid, u.id);
    if (!u) {
      const { lastInsertRowid } = q('INSERT INTO users (email,name,password_hash,google_uid,created_at) VALUES (?,?,?,?,?)')
        .run(identity.email.toLowerCase(), identity.name.slice(0, 60), 'google', identity.uid, Date.now());
      u = { id: Number(lastInsertRowid) };
    }
    u = q('SELECT * FROM users WHERE id = ?').get(u.id);
    return { token: signToken(u.id), user: userView(u) };
  }
  const GoogleSchema = z.object({
    idToken: z.string().min(10),
    uid: z.string().min(1).max(128).optional(),
    email: z.string().email().optional(),
    name: z.string().max(120).nullish(),
  });
  app.post('/api/auth/google', authLimiter, (req, res, next) => {
    try {
      const b = parse(GoogleSchema, req.body);
      if (config.trustDeviceIdentity) {
        // On-device build: the phone's Google sign-in already authenticated this user locally.
        if (!b.uid || !b.email) throw new HttpError(400, 'Missing Google account details');
        return res.json(googleLogin({ uid: b.uid, email: b.email, name: b.name || b.email.split('@')[0] }));
      }
      if (!config.firebaseProjectId) throw new HttpError(501, 'Google sign-in is not configured on this server');
      verifyFirebaseIdToken(b.idToken, config.firebaseProjectId).then((id) => res.json(googleLogin(id))).catch(next);
    } catch (e) { next(e); }
  });

  // ---------- cloud backup: export / import a user's data ----------
  // Live products may not exist on another device yet, so backups carry enough to re-create them.
  function withProduct({ id, ...row }) {
    const p = q('SELECT title, image FROM products WHERE id=?').get(id);
    const offers = q('SELECT l.url, l.price, l.mrp, l.rating, pl.name source FROM listings l JOIN platforms pl ON pl.id=l.platform_id WHERE l.product_id=?').all(id)
      .map((l) => ({ title: p.title, source: l.source, price: l.price, oldPrice: l.mrp > l.price ? l.mrp : null, link: l.url, image: p.image, rating: l.rating || null }));
    return { ...row, product: { title: p.title, offers } };
  }

  app.get('/api/sync/export', requireAuth, wrap((req) => {
    const uid = req.userId;
    const u = q('SELECT name, address FROM users WHERE id=?').get(uid);
    const orders = q('SELECT * FROM orders WHERE user_id=? ORDER BY created_at').all(uid).map((o) => ({
      subtotal: o.subtotal, shipping: o.shipping, total: o.total, savings: o.savings, payment_method: o.payment_method, address: o.address,
      idempotency_key: o.idempotency_key, cancelled_at: o.cancelled_at, created_at: o.created_at,
      items: q(`SELECT i.*, l.url FROM order_items i JOIN listings l ON l.id=i.listing_id WHERE i.order_id=?`).all(o.id).map((i) => ({
        url: i.url, platform_id: i.platform_id, title: i.title, unit_price: i.unit_price, mrp: i.mrp, qty: i.qty, platform_order_ref: i.platform_order_ref, eta: i.eta,
      })),
    }));
    return {
      version: 1,
      exportedAt: Date.now(),
      profile: { name: u.name, address: u.address },
      watchlist: q('SELECT p.id, p.slug, w.created_at FROM watchlist w JOIN products p ON p.id=w.product_id WHERE w.user_id=?').all(uid).map(withProduct),
      alerts: q('SELECT p.id, p.slug, a.target_price, a.active, a.triggered_at, a.created_at FROM alerts a JOIN products p ON p.id=a.product_id WHERE a.user_id=?').all(uid).map(withProduct),
      cart: q('SELECT l.url, c.qty, c.added_price, c.created_at FROM cart_items c JOIN listings l ON l.id=c.listing_id WHERE c.user_id=?').all(uid),
      notifications: q('SELECT title, body, link, read, created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(uid),
      orders,
    };
  }));

  const SnapshotSchema = z.object({
    version: z.literal(1),
    profile: z.object({ name: z.string().max(120), address: z.string().max(2000).nullable() }),
    watchlist: z.array(z.object({ slug: z.string(), created_at: z.number(), product: z.any().optional() })).max(2000),
    alerts: z.array(z.object({ slug: z.string(), target_price: z.number().int(), active: z.number(), triggered_at: z.number().nullable(), created_at: z.number(), product: z.any().optional() })).max(2000),
    cart: z.array(z.object({ url: z.string(), qty: z.number().int().min(1).max(10), added_price: z.number().int(), created_at: z.number() })).max(200),
    notifications: z.array(z.object({ title: z.string(), body: z.string(), link: z.string().nullable(), read: z.number(), created_at: z.number() })).max(500),
    orders: z.array(z.object({
      subtotal: z.number().int(), shipping: z.number().int(), total: z.number().int(), savings: z.number().int(), payment_method: z.string(), address: z.string(),
      idempotency_key: z.string().nullable(), cancelled_at: z.number().nullable(), created_at: z.number(),
      items: z.array(z.object({ url: z.string(), platform_id: z.string(), title: z.string(), unit_price: z.number().int(), mrp: z.number().int(), qty: z.number().int(), platform_order_ref: z.string(), eta: z.number() })),
    })).max(1000),
  }).passthrough();

  // Replaces this user's data with a backup (the cloud copy is the source of truth on sign-in).
  app.post('/api/sync/import', requireAuth, wrap((req) => {
    const s = parse(SnapshotSchema, req.body?.snapshot);
    const uid = req.userId;
    // Re-create products this device hasn't seen yet from the offers stored in the backup.
    const restored = new Map();
    for (const e of [...s.watchlist, ...s.alerts]) {
      if (restored.has(e.slug) || q('SELECT 1 FROM products WHERE slug=?').get(e.slug)) continue;
      const offers = (e.product?.offers || []).map((o) => OfferSchema.safeParse(o)).filter((r) => r.success).map((r) => r.data);
      if (offers.length) { const [id] = ingestOffers(db, e.product.title, offers); if (id) restored.set(e.slug, id); }
    }
    const productId = new Map(q('SELECT id, slug FROM products').all().map((p) => [p.slug, p.id]));
    for (const [slug, id] of restored) productId.set(slug, id);
    const listing = new Map(q('SELECT id, url, product_id FROM listings').all().map((l) => [l.url, l]));
    tx(db, () => {
      for (const t of ['watchlist', 'alerts', 'cart_items', 'notifications', 'orders']) q(`DELETE FROM ${t} WHERE user_id=?`).run(uid);
      q('UPDATE users SET name=?, address=? WHERE id=?').run(s.profile.name, s.profile.address, uid);
      for (const w of s.watchlist) if (productId.has(w.slug)) q('INSERT OR IGNORE INTO watchlist (user_id,product_id,created_at) VALUES (?,?,?)').run(uid, productId.get(w.slug), w.created_at);
      for (const a of s.alerts) if (productId.has(a.slug)) {
        q('INSERT OR REPLACE INTO alerts (user_id,product_id,target_price,active,triggered_at,created_at) VALUES (?,?,?,?,?,?)').run(uid, productId.get(a.slug), a.target_price, a.active ? 1 : 0, a.triggered_at, a.created_at);
      }
      for (const c of s.cart) if (listing.has(c.url)) q('INSERT OR REPLACE INTO cart_items (user_id,listing_id,qty,added_price,created_at) VALUES (?,?,?,?,?)').run(uid, listing.get(c.url).id, c.qty, c.added_price, c.created_at);
      for (const n of s.notifications) q('INSERT INTO notifications (user_id,title,body,link,read,created_at) VALUES (?,?,?,?,?,?)').run(uid, n.title, n.body, n.link, n.read ? 1 : 0, n.created_at);
      for (const o of s.orders) {
        const items = o.items.filter((i) => listing.has(i.url));
        if (!items.length) continue;
        const { lastInsertRowid } = q(`INSERT INTO orders (user_id,subtotal,shipping,total,savings,payment_method,address,idempotency_key,cancelled_at,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(uid, o.subtotal, o.shipping, o.total, o.savings, o.payment_method, o.address, o.idempotency_key, o.cancelled_at, o.created_at);
        for (const i of items) {
          const l = listing.get(i.url);
          q(`INSERT INTO order_items (order_id,listing_id,product_id,platform_id,title,unit_price,mrp,qty,platform_order_ref,eta) VALUES (?,?,?,?,?,?,?,?,?,?)`)
            .run(Number(lastInsertRowid), l.id, l.product_id, i.platform_id, i.title, i.unit_price, i.mrp, i.qty, i.platform_order_ref, i.eta);
        }
      }
    });
    dataVersion.v++;
    return { ok: true };
  }));

  // ---------- profile ----------
  app.patch('/api/auth/me', requireAuth, wrap((req) => {
    const b = parse(z.object({ name: z.string().trim().min(2, 'Name is too short').max(60).optional(), address: AddressSchema.nullable().optional() }), req.body);
    if (b.name !== undefined) q('UPDATE users SET name=? WHERE id=?').run(b.name, req.userId);
    if (b.address !== undefined) q('UPDATE users SET address=? WHERE id=?').run(b.address ? JSON.stringify(b.address) : null, req.userId);
    return { user: userView(q('SELECT * FROM users WHERE id=?').get(req.userId)) };
  }));
  // Permanently deletes the account and all of its data (orders, cart, alerts, watchlist, notifications).
  app.delete('/api/auth/me', requireAuth, wrap((req) => {
    tx(db, () => {
      const orderIds = q('SELECT id FROM orders WHERE user_id=?').all(req.userId).map((o) => o.id);
      for (const id of orderIds) q('DELETE FROM order_items WHERE order_id=?').run(id);
      q('DELETE FROM users WHERE id=?').run(req.userId);
    });
    dataVersion.v++;
    return { ok: true };
  }));

  // ---------- watchlist ----------
  app.get('/api/watchlist', requireAuth, wrap((req) => {
    const ids = new Set(q('SELECT product_id FROM watchlist WHERE user_id=? ORDER BY created_at DESC').all(req.userId).map((r) => r.product_id));
    return { items: summaries().filter((s) => ids.has(s.id)).map(publicSummary) };
  }));
  app.post('/api/watchlist/:productId', requireAuth, wrap((req) => {
    const pid = parse(z.coerce.number().int().positive(), req.params.productId);
    if (!q('SELECT 1 FROM products WHERE id=?').get(pid)) throw new HttpError(404, 'Product not found');
    q('INSERT OR IGNORE INTO watchlist (user_id,product_id,created_at) VALUES (?,?,?)').run(req.userId, pid, Date.now());
    return { ok: true };
  }));
  app.delete('/api/watchlist/:productId', requireAuth, wrap((req) => {
    q('DELETE FROM watchlist WHERE user_id=? AND product_id=?').run(req.userId, Number(req.params.productId));
    return { ok: true };
  }));

  // ---------- alerts ----------
  app.get('/api/alerts', requireAuth, wrap((req) => {
    const rows = q('SELECT id, product_id, target_price, active, triggered_at, created_at FROM alerts WHERE user_id=? ORDER BY created_at DESC').all(req.userId);
    const map = new Map(summaries().map((s) => [s.id, s]));
    return { items: rows.filter((r) => map.has(r.product_id)).map((r) => ({
      id: r.id, targetPrice: r.target_price, active: !!r.active, triggeredAt: r.triggered_at, createdAt: r.created_at, product: publicSummary(map.get(r.product_id)),
    })) };
  }));
  app.post('/api/alerts', requireAuth, wrap((req) => {
    const b = parse(z.object({ productId: z.number().int().positive(), targetPrice: z.number().int().min(1, 'Enter a target price').max(10_000_000) }), req.body);
    if (!q('SELECT 1 FROM products WHERE id=?').get(b.productId)) throw new HttpError(404, 'Product not found');
    q(`INSERT INTO alerts (user_id,product_id,target_price,active,created_at) VALUES (?,?,?,1,?)
       ON CONFLICT(user_id,product_id) DO UPDATE SET target_price=excluded.target_price, active=1, triggered_at=NULL`).run(req.userId, b.productId, b.targetPrice, Date.now());
    q('INSERT OR IGNORE INTO watchlist (user_id,product_id,created_at) VALUES (?,?,?)').run(req.userId, b.productId, Date.now());
    // If the target is already met, notify right away instead of waiting for the next price refresh.
    const triggered = checkAlerts(db, [b.productId]) > 0;
    return { ok: true, triggered };
  }));
  app.delete('/api/alerts/:id', requireAuth, wrap((req) => {
    q('DELETE FROM alerts WHERE id=? AND user_id=?').run(Number(req.params.id), req.userId);
    return { ok: true };
  }));

  // ---------- notifications ----------
  app.get('/api/notifications', requireAuth, wrap((req) => {
    const items = q('SELECT id, title, body, link, read, created_at createdAt FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(req.userId)
      .map((n) => ({ ...n, read: !!n.read }));
    return { items, unread: items.filter((n) => !n.read).length };
  }));
  app.post('/api/notifications/read', requireAuth, wrap((req) => {
    q('UPDATE notifications SET read=1 WHERE user_id=?').run(req.userId);
    return { ok: true };
  }));

  // ---------- live, real product data ----------
  // The app (or this server) fetches Google Shopping results and posts them here to be stored:
  // products are grouped across stores, every price check is recorded as history, alerts are checked.
  app.get('/api/live/cached', wrap((req) => {
    const q0 = normQuery(String(req.query.q || ''));
    const maxAge = Math.min(Number(req.query.maxAge) || 6 * HOUR, 7 * 24 * HOUR);
    const row = q0 && q('SELECT product_ids, fetched_at FROM live_queries WHERE q=?').get(q0);
    if (!row || Date.now() - row.fetched_at > maxAge) return { fresh: false, items: [] };
    return { fresh: true, fetchedAt: row.fetched_at, items: itemsFor(JSON.parse(row.product_ids)) };
  }));
  const OfferSchema = z.object({
    title: z.string().min(1).max(200), source: z.string().min(1).max(60), price: z.number().int().positive(),
    oldPrice: z.number().int().positive().nullable().optional(), link: z.string().url().max(2000), googleLink: z.string().url().max(2000).nullable().optional(),
    image: z.string().url().max(2000).nullable().optional(), rating: z.number().min(0).max(5).nullable().optional(),
    reviews: z.number().int().nonnegative().nullable().optional(), delivery: z.string().max(80).nullable().optional(), productId: z.string().max(100).nullable().optional(),
  });
  app.post('/api/live/ingest', wrap((req) => {
    const b = parse(z.object({ query: z.string().trim().min(1).max(120), offers: z.array(OfferSchema).max(120) }), req.body);
    const ids = ingestOffers(db, b.query, b.offers);
    return { fetchedAt: Date.now(), items: itemsFor(ids) };
  }));
  // Server mode: fetch live results here so the API key stays on the server.
  app.get('/api/live/search', (req, res, next) => {
    const query = String(req.query.q || '').trim().slice(0, 120);
    if (!query) return next(new HttpError(400, 'Enter something to search'));
    if (!config.serpApiKey) return next(new HttpError(501, 'Live prices are not configured on this server'));
    fetchLiveOffers(query, config.serpApiKey)
      .then((offers) => res.json({ fetchedAt: Date.now(), items: itemsFor(ingestOffers(db, query, offers)) }))
      .catch(next);
  });
  function itemsFor(ids) {
    const byId = new Map(summaries().map((s) => [s.id, s]));
    return ids.map((id) => byId.get(id)).filter(Boolean).map(publicSummary);
  }

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // ---------- static web app ----------
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use('/assets', express.static(path.join(config.webDist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.get('/sw.js', (_req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(config.webDist, 'sw.js')); });
    app.use(express.static(config.webDist, { maxAge: '1h', index: false }));
    app.get('*', (_req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(config.webDist, 'index.html')); });
  }

  // ---------- errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) log.error?.(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message, details: err.details });
  });

  return app;
}
