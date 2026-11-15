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
  globalThis.__kompareEnv = { NODE_ENV: 'production', JWT_SECRET: deviceSecret(), DB_FILE: ':memory:' };

  // Imported after the environment is prepared (config.js reads it at import time).
  const [{ openDb }, { seed }, { createApp }, { startPriceEngine }, { config }] = await Promise.all([
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
  return app;
}

let ready;
export async function localApi(path, { method = 'GET', body, token } = {}) {
  ready ||= boot();
  const app = await ready;
  const res = app.handle({
    method,
    url: `/api${path}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)),
  });
  return { status: res.status, body: res.body ?? {} };
}
