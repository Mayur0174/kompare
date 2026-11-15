import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  address TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS platforms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  domain TEXT NOT NULL,
  shipping_fee INTEGER NOT NULL,
  free_shipping_above INTEGER NOT NULL,
  return_days INTEGER NOT NULL,
  cod INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  specs TEXT NOT NULL,
  emoji TEXT NOT NULL,
  hue INTEGER NOT NULL,
  rating REAL NOT NULL,
  review_count INTEGER NOT NULL,
  base_sales INTEGER NOT NULL DEFAULT 0,
  search_text TEXT NOT NULL
);

-- Precomputed home-page catalogue (trending / best sellers), refreshed on a schedule.
CREATE TABLE IF NOT EXISTS feed_snapshots (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);

-- Daily view counter, used for the "Trending" ranking.
CREATE TABLE IF NOT EXISTS product_views (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (product_id, day)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  url TEXT NOT NULL UNIQUE,
  seller TEXT NOT NULL,
  base_price INTEGER NOT NULL,
  price INTEGER NOT NULL,
  mrp INTEGER NOT NULL,
  in_stock INTEGER NOT NULL,
  stock_qty INTEGER NOT NULL,
  delivery_days INTEGER NOT NULL,
  rating REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(product_id, platform_id)
);
CREATE INDEX IF NOT EXISTS idx_listings_product ON listings(product_id);

CREATE TABLE IF NOT EXISTS price_history (
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  price INTEGER NOT NULL,
  PRIMARY KEY (listing_id, ts)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS watchlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, product_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  target_price INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  triggered_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(active, product_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cart_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 10),
  added_price INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, listing_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subtotal INTEGER NOT NULL,
  shipping INTEGER NOT NULL,
  total INTEGER NOT NULL,
  savings INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  address TEXT NOT NULL,
  idempotency_key TEXT,
  cancelled_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  product_id INTEGER NOT NULL,
  platform_id TEXT NOT NULL,
  title TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  mrp INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  platform_order_ref TEXT NOT NULL,
  eta INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
`;

export function openDb(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction (sync). Rolls back on throw. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Tiny prepared-statement cache so hot queries are compiled once. */
export function stmtCache(db) {
  const cache = new Map();
  return (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
}

/** Bumped whenever prices/stock change so read caches can invalidate cheaply. */
export const dataVersion = { v: 0 };
