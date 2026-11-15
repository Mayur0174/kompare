import { config } from './config.js';
import { HttpError } from './util.js';
import { b64uDecode, b64uEncode, hmacB64u, safeEqual } from './crypto.js';

export { hashPassword, verifyPassword } from './crypto.js';

export function signToken(userId) {
  const payload = b64uEncode(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + config.tokenTtlSec }));
  return `${payload}.${hmacB64u(config.jwtSecret, payload)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  if (!safeEqual(sig, hmacB64u(config.jwtSecret, payload))) return null;
  try {
    const data = JSON.parse(b64uDecode(payload));
    if (!data.exp || data.exp < Date.now() / 1000) return null;
    return data.sub;
  } catch { return null; }
}

/** Express middleware: attaches req.userId when a valid bearer token is present. */
export function authenticate(req, _res, next) {
  const h = req.headers.authorization;
  req.userId = h?.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.userId) return next(new HttpError(401, 'Please sign in to continue'));
  next();
}
