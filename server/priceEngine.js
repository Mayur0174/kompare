import { tx, dataVersion } from './db.js';
import { getProvider } from './providers/index.js';
import { HOUR } from './util.js';

const fmt = (n) => `₹${n.toLocaleString('en-IN')}`;

/**
 * Refresh a slice of listings from their providers, record history (one point
 * per listing per hour, so storage stays bounded) and fire price alerts.
 */
export function refreshPrices(db, { fraction = 0.2, now = Date.now(), rnd = Math.random } = {}) {
  const all = db.prepare('SELECT * FROM listings').all();
  const picked = all.filter(() => rnd() < fraction);
  const changedProducts = new Set();

  tx(db, () => {
    const upd = db.prepare('UPDATE listings SET price=?, in_stock=?, stock_qty=?, delivery_days=?, updated_at=? WHERE id=?');
    const hist = db.prepare('INSERT INTO price_history (listing_id, ts, price) VALUES (?,?,?) ON CONFLICT(listing_id, ts) DO UPDATE SET price=excluded.price');
    const bucket = Math.floor(now / HOUR) * HOUR;
    for (const l of picked) {
      const offer = getProvider(l.platform_id).fetchOffer(l, rnd);
      if (!offer) continue;
      upd.run(offer.price, offer.inStock, offer.stockQty, offer.deliveryDays, now, l.id);
      if (offer.price !== l.price) {
        hist.run(l.id, bucket, offer.price);
        changedProducts.add(l.product_id);
      }
      if (offer.inStock !== l.in_stock) changedProducts.add(l.product_id);
    }
    if (changedProducts.size) { dataVersion.v++; checkAlerts(db, [...changedProducts], now); }
  });
  return { checked: picked.length, changedProducts: changedProducts.size };
}

export function checkAlerts(db, productIds, now = Date.now()) {
  const placeholders = productIds.map(() => '?').join(',');
  const hits = db.prepare(`
    SELECT a.id, a.user_id, a.target_price, p.title, p.slug, best.price, best.platform_id, pl.name AS platform_name
    FROM alerts a
    JOIN products p ON p.id = a.product_id
    JOIN (SELECT product_id, platform_id, MIN(price) AS price FROM listings WHERE in_stock=1 GROUP BY product_id) best ON best.product_id = a.product_id
    JOIN platforms pl ON pl.id = best.platform_id
    WHERE a.active = 1 AND a.product_id IN (${placeholders}) AND best.price <= a.target_price
  `).all(...productIds);
  const notify = db.prepare('INSERT INTO notifications (user_id,title,body,link,created_at) VALUES (?,?,?,?,?)');
  const done = db.prepare('UPDATE alerts SET active=0, triggered_at=? WHERE id=?');
  for (const h of hits) {
    notify.run(h.user_id, `Price drop: ${h.title}`, `Now ${fmt(h.price)} on ${h.platform_name} (your target ${fmt(h.target_price)}).`, `/p/${h.slug}`, now);
    done.run(now, h.id);
  }
  return hits.length;
}

/**
 * Keep storage bounded: hourly points for the last 7 days, one point per day (the day's last)
 * before that, and nothing older than a year.
 */
export function compactHistory(db, now = Date.now()) {
  const weekAgo = now - 7 * 86_400_000;
  const r1 = db.prepare(`DELETE FROM price_history WHERE ts < ? AND (listing_id, ts) NOT IN (
      SELECT listing_id, MAX(ts) FROM price_history WHERE ts < ? GROUP BY listing_id, ts / 86400000)`).run(weekAgo, weekAgo);
  const r2 = db.prepare('DELETE FROM price_history WHERE ts < ?').run(now - 366 * 86_400_000);
  return r1.changes + r2.changes;
}

export function startPriceEngine(db, intervalMs, log = console) {
  if (!intervalMs) return () => {};
  let lastCompaction = 0;
  const timer = setInterval(() => {
    try {
      if (Date.now() - lastCompaction > 86_400_000) {
        lastCompaction = Date.now();
        const removed = compactHistory(db);
        if (removed) { dataVersion.v++; log.info?.(`[prices] compacted ${removed} history points`); }
      }
      const r = refreshPrices(db);
      if (r.changedProducts) log.info?.(`[prices] refreshed ${r.checked} listings, ${r.changedProducts} products changed`);
    } catch (e) { log.error?.('[prices] refresh failed', e); }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
