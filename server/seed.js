import { openDb, tx } from './db.js';
import { PLATFORMS } from './catalog.js';
import { config } from './config.js';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

/** Inserts the known stores. Products are never preloaded: they come from live searches. */
export function seed(db) {
  if (db.prepare('SELECT COUNT(*) c FROM platforms').get().c > 0) return false;
  tx(db, () => {
    const ins = db.prepare('INSERT INTO platforms (id,name,color,domain,shipping_fee,free_shipping_above,return_days,cod) VALUES (?,?,?,?,?,?,?,?)');
    for (const p of PLATFORMS) ins.run(p.id, p.name, p.color, p.domain, p.shipping_fee, p.free_shipping_above, p.return_days, p.cod);
  });
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--reset')) {
    for (const f of [config.dbFile, `${config.dbFile}-wal`, `${config.dbFile}-shm`]) fs.rmSync(f, { force: true });
  }
  const db = openDb();
  console.log(seed(db) ? `Initialised stores -> ${config.dbFile}` : 'Database already initialised.');
}
