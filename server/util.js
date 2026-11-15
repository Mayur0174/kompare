// Deterministic PRNG so seeded data is reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Indian retail style price: ends with 9 (or 99 for bigger prices). */
export function retailRound(p) {
  if (p < 100) return Math.max(9, Math.round(p));
  if (p < 2000) return Math.round(p / 10) * 10 - 1;
  return Math.round(p / 100) * 100 - 1;
}

export function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80);
}

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
