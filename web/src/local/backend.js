// On-device backend: boots the same server code (server/app.js) inside the app,
// backed by SQLite (sql.js / WebAssembly) persisted in IndexedDB. No network or server needed.
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

const DB_NAME = 'kompare-device';

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function deviceSecret() {
  try {
    let s = localStorage.getItem('kompare.deviceSecret');
    if (!s) {
      s = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('kompare.deviceSecret', s);
    }
    return s;
  } catch { return 'kompare-device-fallback-secret'; }
}

async function boot() {
  const [SQL, bytes] = await Promise.all([initSqlJs({ locateFile: () => wasmUrl }), idbGet('db').catch(() => undefined)]);
  globalThis.__kompareSQL = SQL;
  globalThis.__kompareDbBytes = bytes;
  globalThis.__kompareSave = (data) => idbSet('db', data).catch((e) => console.error('[device-db] save failed', e));
  globalThis.__kompareEnv = { NODE_ENV: 'production', JWT_SECRET: deviceSecret(), DB_FILE: ':memory:', TRUST_DEVICE_IDENTITY: '1', REFRESH_INTERVAL_MS: '120000' };

  // Imported after the environment is prepared (config.js reads it at import time).
  const [{ openDb }, { seed }, { createApp }, { startPriceEngine, refreshPrices }, { config }] = await Promise.all([
    import('../../../server/db.js'), import('../../../server/seed.js'), import('../../../server/app.js'),
    import('../../../server/priceEngine.js'), import('../../../server/config.js'),
  ]);
  const db = openDb(':memory:');
  if (seed(db)) db.flush();
  const app = createApp(db, { log: console });
  startPriceEngine(db, config.refreshIntervalMs);

  // Trending / best-seller catalogue: recompute when the 12h snapshot is stale (checked at launch and hourly).
  const refreshFeedIfStale = () => {
    const row = db.prepare("SELECT computed_at FROM feed_snapshots WHERE id='home'").get();
    if (!row || Date.now() - row.computed_at >= config.feedRefreshMs) app.locals.refreshHomeFeed();
  };
  refreshFeedIfStale();
  setInterval(refreshFeedIfStale, 60 * 60 * 1000);

  // Persist immediately when the app is backgrounded.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') db.flush(); });
  window.addEventListener('pagehide', () => db.flush());
  // Catch up on prices after the app was in the background (timers are paused there).
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    if (away > config.refreshIntervalMs) refreshPrices(db, { fraction: Math.min(1, 0.2 * (away / config.refreshIntervalMs)) });
  });
  return app;
}

let ready;
export async function localApi(path, { method = 'GET', body, token } = {}) {
  ready ||= boot();
  const app = await ready;
  const t0 = performance.now();
  const res = app.handle({
    method,
    url: `/api${path}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)),
  });
  const ms = performance.now() - t0;
  if (ms > 50) console.debug(`[device-api] ${method} ${path} ${ms.toFixed(0)}ms`);
  (globalThis.__kompareTimings ||= []).push([`${method} ${path.split('?')[0]}`, Math.round(ms)]);
  return { status: res.status, body: res.body ?? {} };
}
