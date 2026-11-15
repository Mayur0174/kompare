import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const isProd = process.env.NODE_ENV === 'production';
const secret = process.env.JWT_SECRET || (isProd ? null : 'dev-only-insecure-secret-change-me');
if (!secret) {
  // In production we refuse to boot without a real secret; generate an ephemeral one and warn loudly.
  console.warn('[config] JWT_SECRET not set – generating an ephemeral secret (sessions reset on restart).');
}

export const config = {
  root,
  isProd,
  port: Number(process.env.PORT) || 8787,
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'kompare.db'),
  jwtSecret: secret || crypto.randomBytes(32).toString('hex'),
  tokenTtlSec: 60 * 60 * 24 * 7,
  // How often the price engine polls platforms (ms). 0 disables.
  refreshIntervalMs: process.env.REFRESH_INTERVAL_MS !== undefined ? Number(process.env.REFRESH_INTERVAL_MS) : 60_000,
  // Home-page trending / best-seller catalogue is recomputed this often (default 12h).
  feedRefreshMs: Number(process.env.FEED_REFRESH_MS) || 12 * 60 * 60 * 1000,
  webDist: path.join(root, 'dist'),
};
