import express from 'express';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { tx, stmtCache, dataVersion } from './db.js';
import { authenticate, requireAuth, hashPassword, verifyPassword, signToken } from './auth.js';
import { getProvider } from './providers/index.js';
import { HttpError, DAY, HOUR } from './util.js';
import { CATEGORIES } from './catalog.js';
import { config } from './config.js';

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

export function orderStatus(o, items, now = Date.now()) {
  if (o.cancelled_at) return 'cancelled';
  const eta = Math.max(...items.map((i) => i.eta));
  const t = now - o.created_at;
  const span = eta - o.created_at;
  if (now >= eta) return 'delivered';
  if (now >= eta - 12 * HOUR) return 'out_for_delivery';
  if (t >= span * 0.3) return 'shipped';
  if (t >= 2 * 60_000) return 'confirmed';
  return 'placed';
}

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
      SELECT p.id, p.slug, p.title, p.brand, p.category, p.emoji, p.hue, p.rating, p.review_count, p.base_sales, p.search_text,
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
    const avg = q(`SELECT l.product_id, AVG(h.price) avg30, MIN(h.price) low30
      FROM price_history h JOIN listings l ON l.id = h.listing_id WHERE h.ts >= ? GROUP BY l.product_id`).all(since);
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
        const dropPct = a ? Math.round((1 - price / a.avg30) * 1000) / 10 : 0;
        const views7 = views.get(r.id) || 0;
        return {
          sold30: r.base_sales + (sold.get(r.id) || 0),
          views7,
          trendScore: views7 + 25 * (watches.get(r.id) || 0) + 40 * (sold.get(r.id) || 0) + Math.max(0, dropPct) * 15,
          id: r.id, slug: r.slug, title: r.title, brand: r.brand, category: r.category, emoji: r.emoji, hue: r.hue,
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
    const platforms = q('SELECT * FROM platforms').all().map((p) => ({ ...p, cod: !!p.cod, provider: getProvider(p.id).kind }));
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

  /** Pick the top-N by a score while capping items per category, so the catalogue is varied. */
  function diversified(arr, score, n = 12, perCat = 3) {
    const out = [], perCount = new Map();
    for (const s of [...arr].sort((a, b) => score(b) - score(a))) {
      const c = perCount.get(s.category) || 0;
      if (c >= perCat) continue;
      perCount.set(s.category, c + 1);
      out.push(s);
      if (out.length >= n) break;
    }
    return out;
  }

  // Trending / best-seller catalogue: a snapshot recomputed every config.feedRefreshMs (12h by default)
  // and persisted, so the home page is stable between refreshes and survives restarts.
  function homeFeed(force = false) {
    const row = q("SELECT data, computed_at FROM feed_snapshots WHERE id='home'").get();
    const now = Date.now();
    if (row && !force && now - row.computed_at < config.feedRefreshMs) {
      return { ...JSON.parse(row.data), updatedAt: row.computed_at, nextUpdateAt: row.computed_at + config.feedRefreshMs };
    }
    const all = summaries().filter((s) => s.inStock);
    const data = {
      trending: diversified(all, (s) => s.trendScore).map((s) => s.id),
      bestsellers: diversified(all, (s) => s.sold30).map((s) => s.id),
    };
    q("INSERT INTO feed_snapshots (id, data, computed_at) VALUES ('home', ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, computed_at=excluded.computed_at")
      .run(JSON.stringify(data), now);
    return { ...data, updatedAt: now, nextUpdateAt: now + config.feedRefreshMs };
  }
  app.locals.refreshHomeFeed = () => homeFeed(true);

  app.get('/api/deals', wrap(() => {
    const all = summaries().filter((s) => s.inStock);
    const byId = new Map(summaries().map((s) => [s.id, s]));
    const pick = (arr, n = 8) => arr.slice(0, n).map(publicSummary);
    const feed = homeFeed();
    // Membership is frozen by the snapshot; prices on the cards stay live.
    const hydrate = (ids) => ids.map((id) => byId.get(id)).filter(Boolean).map(publicSummary);
    return {
      trending: hydrate(feed.trending),
      bestsellers: hydrate(feed.bestsellers),
      feedUpdatedAt: feed.updatedAt,
      feedNextUpdateAt: feed.nextUpdateAt,
      drops: pick([...all].sort((a, b) => b.dropPct - a.dropPct)),
      discounts: pick([...all].sort((a, b) => b.discount - a.discount)),
      spreads: pick([...all].sort((a, b) => b.spread / b.bestPrice - a.spread / a.bestPrice)),
    };
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
    if (best) {
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
        specs: JSON.parse(p.specs), emoji: p.emoji, hue: p.hue, rating: p.rating, reviewCount: p.review_count,
      },
      listings,
      stats: Object.fromEntries(stats.map((s) => [s.platform_id, { low: s.low, high: s.high, avg: s.avg }])),
      overall: { low: overall.low, high: overall.high, avg: overall.avg, lowAt: overall.low_ts },
      verdict, similar, watching, alert: alert && { ...alert, active: !!alert.active },
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
    return { ok: true };
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

  // ---------- cart ----------
  function cartView(userId) {
    const plats = new Map(q('SELECT * FROM platforms').all().map((x) => [x.id, x]));
    const rows = q(`SELECT c.qty, c.added_price, l.*, p.title, p.slug, p.emoji, p.hue FROM cart_items c
      JOIN listings l ON l.id=c.listing_id JOIN products p ON p.id=l.product_id WHERE c.user_id=? ORDER BY c.created_at`).all(userId);
    // Cheapest in-stock alternative per product, to nudge users to the better deal.
    const alt = new Map(q(`SELECT product_id, platform_id, MIN(price) price FROM listings WHERE in_stock=1 GROUP BY product_id`).all().map((r) => [r.product_id, r]));
    const groups = new Map();
    for (const r of rows) {
      const plat = plats.get(r.platform_id);
      const g = groups.get(r.platform_id) || { platformId: r.platform_id, items: [], subtotal: 0, mrpTotal: 0, shipping: 0 };
      const a = alt.get(r.product_id);
      g.items.push({
        listingId: r.id, productId: r.product_id, slug: r.slug, title: r.title, emoji: r.emoji, hue: r.hue, qty: r.qty,
        price: r.price, mrp: r.mrp, addedPrice: r.added_price, inStock: !!r.in_stock && r.stock_qty >= r.qty, deliveryDays: r.delivery_days,
        cheaperAt: a && a.platform_id !== r.platform_id && a.price < r.price ? { platformId: a.platform_id, price: a.price } : null,
      });
      g.subtotal += r.price * r.qty;
      g.mrpTotal += r.mrp * r.qty;
      groups.set(r.platform_id, g);
    }
    let subtotal = 0, shipping = 0, mrpTotal = 0, count = 0;
    for (const g of groups.values()) {
      const plat = plats.get(g.platformId);
      g.shipping = g.subtotal >= plat.free_shipping_above ? 0 : plat.shipping_fee;
      g.freeShippingGap = g.shipping ? plat.free_shipping_above - g.subtotal : 0;
      subtotal += g.subtotal; shipping += g.shipping; mrpTotal += g.mrpTotal;
      count += g.items.reduce((n, i) => n + i.qty, 0);
    }
    return { groups: [...groups.values()], subtotal, shipping, total: subtotal + shipping, savings: mrpTotal - subtotal, count };
  }

  app.get('/api/cart', requireAuth, wrap((req) => cartView(req.userId)));
  app.post('/api/cart', requireAuth, wrap((req) => {
    const b = parse(z.object({ listingId: z.number().int().positive(), qty: z.number().int().min(1).max(10).default(1) }), req.body);
    const l = q('SELECT * FROM listings WHERE id=?').get(b.listingId);
    if (!l) throw new HttpError(404, 'Offer not found');
    if (!l.in_stock) throw new HttpError(409, 'This offer is out of stock');
    q(`INSERT INTO cart_items (user_id,listing_id,qty,added_price,created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(user_id,listing_id) DO UPDATE SET qty=MIN(10, cart_items.qty + excluded.qty)`).run(req.userId, l.id, b.qty, l.price, Date.now());
    return cartView(req.userId);
  }));
  app.patch('/api/cart/:listingId', requireAuth, wrap((req) => {
    const qty = parse(z.number().int().min(1).max(10), req.body?.qty);
    q('UPDATE cart_items SET qty=? WHERE user_id=? AND listing_id=?').run(qty, req.userId, Number(req.params.listingId));
    return cartView(req.userId);
  }));
  app.delete('/api/cart/:listingId', requireAuth, wrap((req) => {
    q('DELETE FROM cart_items WHERE user_id=? AND listing_id=?').run(req.userId, Number(req.params.listingId));
    return cartView(req.userId);
  }));

  // ---------- checkout & orders ----------
  app.post('/api/checkout', requireAuth, wrap((req) => {
    const b = parse(z.object({
      address: AddressSchema,
      paymentMethod: z.enum(['upi', 'card', 'netbanking', 'cod']),
      expectedTotal: z.number().int().nonnegative(),
      idempotencyKey: z.string().min(8).max(64),
      saveAddress: z.boolean().optional(),
    }), req.body);

    const existing = q('SELECT id FROM orders WHERE user_id=? AND idempotency_key=?').get(req.userId, b.idempotencyKey);
    if (existing) return { orderId: existing.id, duplicate: true };

    return tx(db, () => {
      const cart = cartView(req.userId);
      if (!cart.count) throw new HttpError(400, 'Your cart is empty');
      const oos = cart.groups.flatMap((g) => g.items).filter((i) => !i.inStock);
      if (oos.length) throw new HttpError(409, `Out of stock: ${oos.map((i) => i.title).join(', ')}`, { code: 'OUT_OF_STOCK' });
      if (cart.total !== b.expectedTotal) {
        throw new HttpError(409, 'Prices changed since you last looked. Please review your cart.', { code: 'PRICE_CHANGED', total: cart.total });
      }
      if (b.paymentMethod === 'cod' && cart.total > 50_000) throw new HttpError(400, 'Cash on delivery is available for orders up to ₹50,000');

      const now = Date.now();
      const { lastInsertRowid } = q(`INSERT INTO orders (user_id,subtotal,shipping,total,savings,payment_method,address,idempotency_key,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(req.userId, cart.subtotal, cart.shipping, cart.total, cart.savings, b.paymentMethod, JSON.stringify(b.address), b.idempotencyKey, now);
      const orderId = Number(lastInsertRowid);
      const insItem = q(`INSERT INTO order_items (order_id,listing_id,product_id,platform_id,title,unit_price,mrp,qty,platform_order_ref,eta)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      const decStock = q('UPDATE listings SET stock_qty = stock_qty - ?, in_stock = CASE WHEN stock_qty - ? > 0 THEN 1 ELSE 0 END WHERE id=?');
      for (const g of cart.groups) {
        // One sub-order per marketplace, placed through that platform's provider.
        const placed = getProvider(g.platformId).placeOrder({ items: g.items.map((i) => ({ ...i, delivery_days: i.deliveryDays })), address: b.address });
        for (const i of g.items) {
          insItem.run(orderId, i.listingId, i.productId, g.platformId, i.title, i.price, i.mrp, i.qty, placed.ref, placed.eta);
          decStock.run(i.qty, i.qty, i.listingId);
        }
      }
      q('DELETE FROM cart_items WHERE user_id=?').run(req.userId);
      if (b.saveAddress !== false) q('UPDATE users SET address=? WHERE id=?').run(JSON.stringify(b.address), req.userId);
      q('INSERT INTO notifications (user_id,title,body,link,created_at) VALUES (?,?,?,?,?)').run(
        req.userId, `Order #${orderId} placed`, `${cart.count} item(s) across ${cart.groups.length} store(s). You saved ₹${cart.savings.toLocaleString('en-IN')}.`, `/orders/${orderId}`, now);
      dataVersion.v++;
      return { orderId };
    });
  }));

  function orderView(o) {
    const items = q('SELECT * FROM order_items WHERE order_id=?').all(o.id);
    const slugs = new Map(q(`SELECT id, slug, emoji, hue FROM products WHERE id IN (${items.map(() => '?').join(',') || 'NULL'})`).all(...items.map((i) => i.product_id)).map((p) => [p.id, p]));
    const status = orderStatus(o, items);
    const byPlatform = {};
    for (const i of items) {
      const sp = slugs.get(i.product_id);
      (byPlatform[i.platform_id] ||= { platformId: i.platform_id, ref: i.platform_order_ref, eta: i.eta, items: [] }).items.push({
        title: i.title, qty: i.qty, unitPrice: i.unit_price, mrp: i.mrp, slug: sp?.slug, emoji: sp?.emoji, hue: sp?.hue,
      });
    }
    return {
      id: o.id, status, createdAt: o.created_at, cancelledAt: o.cancelled_at, subtotal: o.subtotal, shipping: o.shipping, total: o.total,
      savings: o.savings, paymentMethod: o.payment_method, address: JSON.parse(o.address), shipments: Object.values(byPlatform),
      cancellable: ['placed', 'confirmed'].includes(status),
    };
  }

  app.get('/api/orders', requireAuth, wrap((req) => ({
    items: q('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.userId).map(orderView),
  })));
  app.get('/api/orders/:id', requireAuth, wrap((req) => {
    const o = q('SELECT * FROM orders WHERE id=? AND user_id=?').get(Number(req.params.id), req.userId);
    if (!o) throw new HttpError(404, 'Order not found');
    return orderView(o);
  }));
  app.post('/api/orders/:id/cancel', requireAuth, wrap((req) => tx(db, () => {
    const o = q('SELECT * FROM orders WHERE id=? AND user_id=?').get(Number(req.params.id), req.userId);
    if (!o) throw new HttpError(404, 'Order not found');
    const view = orderView(o);
    if (!view.cancellable) throw new HttpError(409, `Order can't be cancelled once ${view.status.replace(/_/g, ' ')}`);
    q('UPDATE orders SET cancelled_at=? WHERE id=?').run(Date.now(), o.id);
    for (const i of q('SELECT listing_id, qty FROM order_items WHERE order_id=?').all(o.id)) {
      q('UPDATE listings SET stock_qty = stock_qty + ?, in_stock = 1 WHERE id=?').run(i.qty, i.listing_id);
    }
    dataVersion.v++;
    return orderView(q('SELECT * FROM orders WHERE id=?').get(o.id));
  })));

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
