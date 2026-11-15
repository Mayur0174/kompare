// Tiny in-process stand-in for Express, so server/app.js runs unchanged inside the mobile app.
// Requests never touch the network: the UI calls app.handle() directly.

function compile(path, prefix) {
  if (path === '*') return () => ({});
  const keys = [];
  const src = path.replace(/\/$/, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; });
  const re = new RegExp(`^${src}${prefix ? '(?:/.*)?' : '/?'}$`);
  return (url) => {
    const m = re.exec(url);
    if (!m) return null;
    const params = {};
    keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return params;
  };
}

export default function express() {
  const layers = [];
  const add = (method, path, handlers, prefix) => {
    const match = compile(path, prefix);
    for (const fn of handlers.flat()) layers.push({ method, match, fn });
  };
  const app = {
    locals: {},
    disable() {}, set() {},
    use(...args) { const path = typeof args[0] === 'string' ? args.shift() : '/'; add(null, path === '/' ? '' : path, args, true); },
    get(path, ...h) { add('GET', path, h, false); },
    post(path, ...h) { add('POST', path, h, false); },
    patch(path, ...h) { add('PATCH', path, h, false); },
    put(path, ...h) { add('PUT', path, h, false); },
    delete(path, ...h) { add('DELETE', path, h, false); },

    /** Dispatch a request synchronously. Returns { status, body }. */
    handle({ method = 'GET', url, headers = {}, body }) {
      const u = new URL(url, 'http://local');
      const req = { method, url: u.pathname + u.search, path: u.pathname, query: Object.fromEntries(u.searchParams), params: {}, headers, body, ip: 'device' };
      const res = {
        statusCode: 200, headers: {}, body: undefined, finished: false,
        status(c) { this.statusCode = c; return this; },
        set(k, v) { this.headers[k] = v; return this; },
        setHeader(k, v) { this.headers[k] = v; },
        json(b) { this.body = b; this.finished = true; return this; },
        sendStatus(c) { this.statusCode = c; this.finished = true; return this; },
        sendFile() { this.statusCode = 404; this.finished = true; },
      };
      let i = 0;
      const next = (err) => {
        while (i < layers.length && !res.finished) {
          const l = layers[i++];
          if (l.method && l.method !== method) continue;
          const params = l.match(req.path);
          if (!params) continue;
          const isErrorHandler = l.fn.length === 4;
          if (!!err !== isErrorHandler) continue;
          req.params = params;
          try { return isErrorHandler ? l.fn(err, req, res, next) : l.fn(req, res, next); } catch (e) { err = e; }
        }
        if (!res.finished) { res.statusCode = err ? err.status || 500 : 404; res.body = { error: err ? err.message : 'Not found' }; res.finished = true; }
      };
      next();
      return { status: res.statusCode, body: res.body };
    },
  };
  return app;
}
express.json = () => (_req, _res, next) => next();
express.static = () => (_req, _res, next) => next();
