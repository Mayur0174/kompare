const clean = (parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
const path = { join: (...p) => clean(p), resolve: (...p) => clean(p), dirname: (p) => String(p).split('/').slice(0, -1).join('/') || '/' };
export default path;
