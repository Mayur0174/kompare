import { openDb, tx } from './db.js';
import { PLATFORMS, CATEGORIES, PRODUCTS } from './catalog.js';
import { mulberry32, hashStr, retailRound, slugify, DAY, clamp } from './util.js';
import { hashPassword } from './auth.js';
import { config } from './config.js';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const HISTORY_DAYS = 180;
// Sale events: days ago, duration, depth, platforms.
const SALES = [
  { ago: 35, len: 6, depth: 0.14, platforms: ['amazon', 'flipkart', 'myntra', 'ajio', 'tatacliq'] },
  { ago: 110, len: 4, depth: 0.10, platforms: ['amazon'] },
  { ago: 112, len: 5, depth: 0.10, platforms: ['flipkart'] },
  { ago: 75, len: 7, depth: 0.12, platforms: ['myntra', 'ajio', 'nykaa'] },
  { ago: 150, len: 3, depth: 0.07, platforms: ['croma', 'reliance'] },
];

export function seed(db, { now = Date.now() } = {}) {
  const count = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  if (count > 0) return false;

  tx(db, () => {
    const insPlat = db.prepare('INSERT INTO platforms (id,name,color,domain,shipping_fee,free_shipping_above,return_days,cod) VALUES (?,?,?,?,?,?,?,?)');
    for (const p of PLATFORMS) insPlat.run(p.id, p.name, p.color, p.domain, p.shipping_fee, p.free_shipping_above, p.return_days, p.cod);

    const insProd = db.prepare(`INSERT INTO products (slug,title,brand,category,description,specs,emoji,hue,rating,review_count,base_sales,search_text)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insView = db.prepare('INSERT INTO product_views (product_id, day, n) VALUES (?,?,?)');
    const insList = db.prepare(`INSERT INTO listings (product_id,platform_id,url,seller,base_price,price,mrp,in_stock,stock_qty,delivery_days,rating,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insHist = db.prepare('INSERT INTO price_history (listing_id,ts,price) VALUES (?,?,?)');
    const dayStart = Math.floor(now / DAY) * DAY;

    for (const [title, brand, category, mrp, typical, emoji, specs, onlyOn] of PRODUCTS) {
      const rnd = mulberry32(hashStr(title));
      const cat = CATEGORIES.find((c) => c.id === category);
      const slug = slugify(title);
      const rating = Math.round((3.9 + rnd() * 0.9) * 10) / 10;
      const reviews = Math.floor(500 + rnd() * 60000);
      const desc = `${title} by ${brand}. Compare live prices across stores, see the full price history and buy from the store offering the best deal.`;
      const { lastInsertRowid: pid } = insProd.run(slug, title, brand, category, desc, JSON.stringify(specs), emoji,
        hashStr(brand) % 360, rating, reviews, Math.floor(reviews / 40 + rnd() * 300), `${title} ${brand} ${cat.name} ${category} ${/jacket|windcheater|puffer|bomber/i.test(title) ? 'jacket jackets outerwear winter' : ''}`.toLowerCase());

      // Seed a week of organic views so Trending is meaningful on day one.
      const dayNo = Math.floor(now / DAY);
      const buzz = rnd() ** 2;
      for (let d = 0; d < 7; d++) insView.run(pid, dayNo - d, Math.floor(5 + buzz * 400 * (1 - d * 0.1) + rnd() * 30));

      // Amazon/Flipkart (first two) always present; others with high probability.
      const plats = onlyOn || cat.platforms.filter((_, i) => i < 2 || rnd() < 0.72);
      for (const platformId of plats) {
        const r = mulberry32(hashStr(title + platformId));
        const offset = (r() - 0.45) * 0.09; // platform-specific premium/discount
        const base = Math.min(mrp, retailRound(typical * (1 + offset)));
        const sku = (hashStr(slug + platformId).toString(36) + 'X').toUpperCase().slice(0, 10);
        const plat = PLATFORMS.find((p) => p.id === platformId);
        const url = `https://www.${plat.domain}/${slug}/p/${sku}`;
        const seller = platformId === 'amazon' ? 'Appario Retail' : platformId === 'flipkart' ? 'RetailNet' : `${plat.name} Retail`;

        // 180-day random walk with mean reversion + sale dips.
        let p = base * (1 + (r() - 0.3) * 0.08);
        const points = [];
        for (let d = HISTORY_DAYS; d >= 0; d--) {
          p += (base - p) * 0.12 + base * (r() - 0.5) * 0.025;
          if (r() < 0.03) p = base * (1 + (r() - 0.6) * 0.1);
          let price = p;
          for (const s of SALES) {
            if (s.platforms.includes(platformId) && d <= s.ago && d > s.ago - s.len) price = p * (1 - s.depth * (0.7 + r() * 0.5));
          }
          points.push([dayStart - d * DAY, clamp(retailRound(price), Math.round(mrp * 0.3), mrp)]);
        }
        const current = points[points.length - 1][1];
        const inStock = r() > 0.07 ? 1 : 0;
        const { lastInsertRowid: lid } = insList.run(pid, platformId, url, seller, base, current, mrp, inStock,
          inStock ? Math.floor(5 + r() * 200) : 0, 1 + Math.floor(r() * 6),
          Math.round(clamp(rating + (r() - 0.5) * 0.4, 3.5, 5) * 10) / 10, now);
        for (const [ts, price] of points) insHist.run(lid, ts, price);
      }
    }

    db.prepare('INSERT INTO users (email,name,password_hash,address,created_at) VALUES (?,?,?,?,?)').run(
      'demo@kompare.app', 'Demo Shopper', hashPassword('demo1234'),
      JSON.stringify({ name: 'Demo Shopper', phone: '9876543210', line1: '42, MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' }), now,
    );
  });
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--reset')) {
    for (const f of [config.dbFile, `${config.dbFile}-wal`, `${config.dbFile}-shm`]) fs.rmSync(f, { force: true });
  }
  const db = openDb();
  const t = Date.now();
  console.log(seed(db) ? `Seeded in ${Date.now() - t}ms -> ${config.dbFile}` : 'Database already seeded.');
}
