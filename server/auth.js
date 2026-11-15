import crypto from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './util.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, actual);
}

export function signToken(userId) {
  const payload = b64u(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + config.tokenTtlSec }));
  const sig = b64u(crypto.createHmac('sha256', config.jwtSecret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', config.jwtSecret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
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
