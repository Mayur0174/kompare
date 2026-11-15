// Real product data: Google Shopping results (via SerpApi) → products grouped across stores.
// Every listing keeps the real store link, real price, real image. Each fetch records a price point,
// so price history is genuine and grows from the first time a product is checked.
import { tx, dataVersion } from './db.js';
import { checkAlerts } from './priceEngine.js';
import { slugify, hashStr, HOUR } from './util.js';

export { serpApiUrl, fetchLiveOffers, normalizeResults, platformIdFor } from './liveFetch.js';
import { platformIdFor } from './liveFetch.js';

// ---------- grouping the same product across stores ----------
const STOP = new Set(['the', 'and', 'with', 'for', 'of', 'in', 'by', 'new', 'latest', 'buy', 'online', 'india', 'pack', 'combo']);
export function tokens(title) {
  return [...new Set(title.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, (m) => ` ${m.slice(1, -1)} `).split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t)))];
}
function similarity(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size || 1);
}
/** Same Google product id, or ≥80% of the shorter title's words in common (and same leading brand word). */
export function groupOffers(offers) {
  const groups = [];
  for (const o of offers) {
    const tk = new Set(tokens(o.title));
    const g = groups.find((x) => (o.productId && x.productIds.has(o.productId))
      || (x.brand === [...tk][0] && similarity(tk, x.tokens) >= 0.8));
    if (g) { g.offers.push(o); if (o.productId) g.productIds.add(o.productId); }
    else groups.push({ tokens: tk, brand: [...tk][0], productIds: new Set(o.productId ? [o.productId] : []), offers: [o] });
  }
  return groups;
}

const EMOJI = [[/headphone|earbud|earphone|airpods|buds|tws|neckband/, '🎧'], [/laptop|macbook|notebook|chromebook/, '💻'], [/watch|band/, '⌚'], [/phone|mobile|iphone|galaxy|pixel|redmi|oneplus/, '📱'],
  [/tv|television/, '📺'], [/shoe|sneaker|footwear|slipper|sandal|crocs/, '👟'], [/shirt|t-shirt|tshirt|polo|kurta|dress|top|jeans|trouser|jacket|hoodie/, '👕'],
  [/serum|cream|lipstick|foundation|sunscreen|shampoo|perfume|makeup/, '💄'], [/fridge|refrigerator|washing|air conditioner|\bac\b|microwave|fryer|mixer|vacuum/, '🏠'],
  [/speaker|soundbar/, '🔊'], [/camera/, '📷'], [/tablet|ipad/, '📱'], [/bag|backpack/, '🎒'], [/book/, '📚']];
const emojiFor = (t) => (EMOJI.find(([re]) => re.test(t.toLowerCase())) || [null, '🛍️'])[1];

function ensurePlatform(db, id, source) {
  if (db.prepare('SELECT 1 FROM platforms WHERE id=?').get(id)) return;
  const hue = hashStr(id) % 360;
  db.prepare('INSERT INTO platforms (id,name,color,domain,shipping_fee,free_shipping_above,return_days,cod) VALUES (?,?,?,?,0,0,0,0)')
    .run(id, source, `hsl(${hue} 55% 45%)`, '');
}

/**
 * Upsert live offers. Returns the product ids (in result order) for this query.
 * Prices are recorded as hourly history points; alerts are checked against the new prices.
 */
export function ingestOffers(db, query, offers, now = Date.now()) {
  const groups = groupOffers(offers);
  const ids = [];
  tx(db, () => {
    const bucket = Math.floor(now / HOUR) * HOUR;
    for (const g of groups) {
      // Prefer an existing product that already has one of these links.
      let pid = null;
      for (const o of g.offers) {
        const hit = db.prepare('SELECT product_id FROM listings WHERE url=?').get(o.link);
        if (hit) { pid = hit.product_id; break; }
      }
      const first = g.offers.reduce((a, b) => (b.image && !a.image ? b : a), g.offers[0]);
      const title = g.offers.map((o) => o.title).sort((a, b) => a.length - b.length)[Math.floor((g.offers.length - 1) / 2)];
      if (!pid) {
        let slug = slugify(title) || `product-${hashStr(first.link)}`;
        if (db.prepare('SELECT 1 FROM products WHERE slug=?').get(slug)) slug = `${slug.slice(0, 70)}-${(hashStr(first.link) % 1e6).toString(36)}`;
        const rated = g.offers.filter((o) => o.rating);
        const rating = rated.length ? Math.round((rated.reduce((s, o) => s + o.rating, 0) / rated.length) * 10) / 10 : 0;
        const reviews = g.offers.reduce((s, o) => s + (o.reviews || 0), 0);
        const brand = title.split(/\s+/)[0].replace(/[^\w&'.-]/g, '') || 'Brand';
        const { lastInsertRowid } = db.prepare(`INSERT INTO products (slug,title,brand,category,description,specs,emoji,hue,rating,review_count,search_text,image,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(slug, title, brand, slugify(query).slice(0, 40) || 'search', '', '{}', emojiFor(title), hashStr(brand) % 360,
          rating, reviews, `${g.offers.map((o) => o.title).join(' ')} ${query}`.toLowerCase().slice(0, 2000), first.image, now);
        pid = Number(lastInsertRowid);
      } else if (first.image) {
        db.prepare('UPDATE products SET image=COALESCE(image, ?) WHERE id=?').run(first.image, pid);
      }
      // One listing per store: keep the cheapest offer from each store.
      const perStore = new Map();
      for (const o of g.offers) {
        const pl = platformIdFor(o.source);
        if (!perStore.has(pl) || o.price < perStore.get(pl).price) perStore.set(pl, o);
      }
      for (const [pl, o] of perStore) {
        ensurePlatform(db, pl, o.source);
        const mrp = Math.max(o.oldPrice || o.price, o.price);
        const existing = db.prepare('SELECT id FROM listings WHERE product_id=? AND platform_id=?').get(pid, pl);
        let lid;
        if (existing) {
          lid = existing.id;
          db.prepare('UPDATE listings SET url=?, price=?, mrp=MAX(mrp, ?), in_stock=1, rating=?, seller=?, updated_at=? WHERE id=?')
            .run(o.link, o.price, mrp, o.rating || 0, o.delivery || o.source, now, lid);
        } else {
          // A link can only belong to one listing; drop a stale owner if the store moved it.
          db.prepare('DELETE FROM listings WHERE url=? AND product_id<>?').run(o.link, pid);
          const r = db.prepare(`INSERT INTO listings (product_id,platform_id,url,seller,base_price,price,mrp,in_stock,stock_qty,delivery_days,rating,updated_at)
            VALUES (?,?,?,?,?,?,?,1,1,0,?,?)`).run(pid, pl, o.link, o.delivery || o.source, o.price, o.price, mrp, o.rating || 0, now);
          lid = Number(r.lastInsertRowid);
        }
        db.prepare('INSERT INTO price_history (listing_id,ts,price) VALUES (?,?,?) ON CONFLICT(listing_id,ts) DO UPDATE SET price=excluded.price').run(lid, bucket, o.price);
      }
      if (!ids.includes(pid)) ids.push(pid);
    }
    db.prepare(`INSERT INTO live_queries (q, product_ids, fetched_at) VALUES (?,?,?)
      ON CONFLICT(q) DO UPDATE SET product_ids=excluded.product_ids, fetched_at=excluded.fetched_at`).run(normQuery(query), JSON.stringify(ids), now);
    if (ids.length) checkAlerts(db, ids, now);
  });
  dataVersion.v++;
  return ids;
}

export const normQuery = (q) => String(q).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
