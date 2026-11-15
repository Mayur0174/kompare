// Node implementation of the crypto primitives the app needs.
// The mobile build swaps this file for web/src/local/shims/crypto.js (same exports).
import crypto from 'node:crypto';

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

export const b64uEncode = (str) => Buffer.from(str).toString('base64url');
export const b64uDecode = (str) => Buffer.from(str, 'base64url').toString();
export const hmacB64u = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
