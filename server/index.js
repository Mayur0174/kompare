import { openDb } from './db.js';
import { seed } from './seed.js';
import { createApp } from './app.js';
import { compactHistory } from './priceEngine.js';
import { config } from './config.js';

const db = openDb();
if (seed(db)) console.log('[db] initialised stores');
const app = createApp(db);
if (!config.serpApiKey) console.warn('[kompare] SERPAPI_KEY not set: live prices are disabled (store search links still work).');

// Keep price history compact (daily).
compactHistory(db);
const compactTimer = setInterval(() => compactHistory(db), 24 * 3600 * 1000);
compactTimer.unref();

const server = app.listen(config.port, () => {
  console.log(`[kompare] listening on http://localhost:${config.port} (${config.isProd ? 'production' : 'development'})`);
});

function shutdown(signal) {
  console.log(`[kompare] ${signal} received, shutting down`);
  clearInterval(compactTimer);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
