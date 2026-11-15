// Verifies Firebase Auth ID tokens (RS256) with Google's published JWKs.
// Uses Web Crypto only, so it runs on Node 22+ and in browsers alike.
import { HttpError } from './util.js';

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let cache = { keys: null, expires: 0 };

async function keys() {
  if (cache.keys && Date.now() < cache.expires) return cache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new HttpError(503, 'Could not reach Google to verify sign-in');
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
  const { keys: list } = await res.json();
  cache = { keys: new Map(list.map((k) => [k.kid, k])), expires: Date.now() + maxAge * 1000 };
  return cache.keys;
}

const b64uBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const b64uJson = (s) => JSON.parse(new TextDecoder().decode(b64uBytes(s)));

/** Returns { uid, email, name } for a valid token, otherwise throws 401. */
export async function verifyFirebaseIdToken(token, projectId) {
  const fail = (why) => { throw new HttpError(401, `Google sign-in failed: ${why}`); };
  const parts = String(token || '').split('.');
  if (parts.length !== 3) fail('malformed token');
  const [h, p, s] = parts;
  const header = b64uJson(h);
  const claims = b64uJson(p);
  if (header.alg !== 'RS256') fail('unexpected algorithm');
  const jwk = (await keys()).get(header.kid);
  if (!jwk) fail('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) fail('bad signature');
  const now = Date.now() / 1000;
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) fail('token is for a different project');
  if (!(claims.exp > now) || !(claims.iat <= now + 300) || !claims.sub) fail('token expired');
  if (!claims.email || claims.email_verified === false) fail('email not verified');
  return { uid: claims.sub, email: claims.email, name: claims.name || claims.email.split('@')[0] };
}
