// On-device replacement for server/crypto.js (same exports), in plain synchronous JS.
// SHA-256 / HMAC-SHA256 / PBKDF2-SHA256 (Web Crypto is async-only, the server code is sync).

const primes = [];
for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p)) primes.push(n);
const frac = (x) => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
const K = Uint32Array.from(primes, (p) => frac(Math.cbrt(p)));
const H0 = Uint32Array.from(primes.slice(0, 8), (p) => frac(Math.sqrt(p)));
const W = new Uint32Array(64);
const enc = new TextEncoder();
const dec = new TextDecoder();

export function sha256(bytes) {
  const len = bytes.length;
  const n = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(n);
  m.set(bytes);
  m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(n - 4, (len * 8) >>> 0);
  dv.setUint32(n - 8, Math.floor((len * 8) / 2 ** 32));
  const H = H0.slice();
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

const concat = (a, b) => { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
const toBytes = (x) => (typeof x === 'string' ? enc.encode(x) : x);

export function hmac(key, msg) {
  let k = toBytes(key);
  if (k.length > 64) k = sha256(k);
  const ipad = new Uint8Array(64), opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { ipad[i] = (k[i] || 0) ^ 0x36; opad[i] = (k[i] || 0) ^ 0x5c; }
  return sha256(concat(opad, sha256(concat(ipad, toBytes(msg)))));
}

export function pbkdf2(password, salt, iterations) {
  let u = hmac(password, concat(salt, Uint8Array.of(0, 0, 0, 1)));
  const t = u.slice();
  for (let i = 1; i < iterations; i++) { u = hmac(password, u); for (let j = 0; j < 32; j++) t[j] ^= u[j]; }
  return t;
}

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g) || [], (h) => parseInt(h, 16));
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const ITER = 10000;

export function hashPassword(pw) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${hex(salt)}$${hex(pbkdf2(pw, salt, ITER))}`;
}

export function verifyPassword(pw, stored) {
  const [alg, iter, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'pbkdf2' || !saltHex || !hashHex) return false;
  return safeEqual(hex(pbkdf2(pw, unhex(saltHex), Number(iter))), hashHex);
}

export const b64uEncode = (str) => b64u(enc.encode(str));
export const b64uDecode = (str) => dec.decode(unb64u(str));
export const hmacB64u = (secret, data) => b64u(hmac(secret, data));

export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
