// node:sqlite (DatabaseSync) API implemented on top of sql.js (SQLite compiled to WebAssembly),
// with the database persisted to IndexedDB on the device.
// Boot code must set globalThis.__kompareSQL (initialised sql.js) and optionally
// globalThis.__kompareDbBytes / globalThis.__kompareSave before constructing a DatabaseSync.

export class DatabaseSync {
  constructor() {
    const SQL = globalThis.__kompareSQL;
    if (!SQL) throw new Error('sql.js is not initialised');
    this.db = new SQL.Database(globalThis.__kompareDbBytes || undefined);
    this.gen = 0; // bumps whenever sql.js invalidates prepared statements (export)
    this.saveTimer = null;
    this.lastId = null;
  }

  exec(sql) {
    this.db.exec(sql);
    this.dirty();
  }

  prepare(sql) {
    const self = this;
    let st = null, gen = -1;
    const stmt = () => { if (gen !== self.gen) { st = self.db.prepare(sql); gen = self.gen; } return st; };
    return {
      get(...p) { const s = stmt(); s.bind(p); const row = s.step() ? s.getAsObject() : undefined; s.reset(); return row; },
      all(...p) { const s = stmt(); s.bind(p); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.reset(); return rows; },
      run(...p) {
        const s = stmt(); s.bind(p); s.step(); s.reset();
        const changes = self.db.getRowsModified();
        const lastInsertRowid = self.rowid();
        self.dirty();
        return { changes, lastInsertRowid };
      },
    };
  }

  rowid() {
    if (!this.lastId || this.lastIdGen !== this.gen) { this.lastId = this.db.prepare('SELECT last_insert_rowid()'); this.lastIdGen = this.gen; }
    this.lastId.step();
    const v = this.lastId.get()[0];
    this.lastId.reset();
    return v;
  }

  /** Debounced persistence: snapshot the whole DB to device storage shortly after writes. */
  dirty() {
    if (!globalThis.__kompareSave || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!globalThis.__kompareSave) return;
    const bytes = this.db.export(); // frees prepared statements & resets pragmas
    this.gen++;
    this.db.exec('PRAGMA foreign_keys = ON');
    globalThis.__kompareSave(bytes);
  }

  close() { this.flush(); this.db.close(); }
}
