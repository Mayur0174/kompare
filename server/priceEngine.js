const fmt = (n) => `₹${n.toLocaleString('en-IN')}`;

/** Notify users whose target price is met by the cheapest in-stock offer of these products. */
export function checkAlerts(db, productIds, now = Date.now()) {
  if (!productIds.length) return 0;
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
 * Keep storage bounded: every price check for the last 7 days, one point per day (the day's last)
 * before that, and nothing older than a year.
 */
export function compactHistory(db, now = Date.now()) {
  const weekAgo = now - 7 * 86_400_000;
  const r1 = db.prepare(`DELETE FROM price_history WHERE ts < ? AND (listing_id, ts) NOT IN (
      SELECT listing_id, MAX(ts) FROM price_history WHERE ts < ? GROUP BY listing_id, ts / 86400000)`).run(weekAgo, weekAgo);
  const r2 = db.prepare('DELETE FROM price_history WHERE ts < ?').run(now - 366 * 86_400_000);
  return r1.changes + r2.changes;
}
