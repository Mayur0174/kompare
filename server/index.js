import { openDb } from './db.js';
import { seed } from './seed.js';
import { createApp } from './app.js';
import { startPriceEngine } from './priceEngine.js';
import { config } from './config.js';

const db = openDb();
if (seed(db)) console.log('[db] seeded demo catalogue');
const app = createApp(db);
const stopEngine = startPriceEngine(db, config.refreshIntervalMs);
// Recompute the home-page trending / best-seller catalogue on schedule (every 12h by default).
// Only recompute at boot if the persisted snapshot is stale.
fetchFeedIfStale();
const feedTimer = setInterval(() => {
  try { app.locals.refreshHomeFeed(); console.log('[feed] home catalogue refreshed'); } catch (e) { console.error('[feed] refresh failed', e); }
}, config.feedRefreshMs);
feedTimer.unref();

const server = app.listen(config.port, () => {
  console.log(`[kompare] listening on http://localhost:${config.port} (${config.isProd ? 'production' : 'development'})`);
});

function fetchFeedIfStale() {
  const row = db.prepare("SELECT computed_at FROM feed_snapshots WHERE id='home'").get();
  if (!row || Date.now() - row.computed_at >= config.feedRefreshMs) app.locals.refreshHomeFeed();
}

function shutdown(signal) {
  console.log(`[kompare] ${signal} received, shutting down`);
  stopEngine();
  clearInterval(feedTimer);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
