/**
 * Platform provider registry.
 *
 * Every marketplace is reached through a provider that implements:
 *   fetchOffer(listing)            -> { price, inStock, stockQty, deliveryDays } | null
 *   placeOrder({ items, address }) -> { ref, eta }
 *
 * Production deployments plug in real adapters (affiliate / partner APIs such as
 * Amazon PA-API, Flipkart Affiliate API, or a scraping service) by registering a
 * provider for the platform id. Out of the box every platform uses the
 * SimulatedProvider so the app is fully functional without credentials.
 */
import { retailRound, clamp, DAY } from '../util.js';

export class SimulatedProvider {
  constructor(platformId) { this.platformId = platformId; this.kind = 'simulated'; }

  /** Market-like price movement: mean-reverting noise with occasional flash deals. */
  fetchOffer(l, rnd = Math.random) {
    let next = l.price + (l.base_price - l.price) * 0.25 + l.base_price * (rnd() - 0.5) * 0.03;
    const roll = rnd();
    if (roll < 0.04) next = l.base_price * (0.85 + rnd() * 0.06); // flash deal
    else if (roll < 0.07) next = l.base_price * (1.02 + rnd() * 0.04); // price hike
    const price = clamp(retailRound(next), Math.round(l.mrp * 0.3), l.mrp);
    let inStock = l.in_stock;
    if (rnd() < 0.02) inStock = inStock ? 0 : 1;
    const stockQty = inStock ? Math.max(1, l.stock_qty || Math.floor(10 + rnd() * 150)) : 0;
    return { price, inStock, stockQty, deliveryDays: l.delivery_days };
  }

  placeOrder({ items }) {
    const prefix = this.platformId.slice(0, 3).toUpperCase();
    const ref = `${prefix}-${Date.now().toString(36).toUpperCase()}-${[...globalThis.crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    const maxDays = Math.max(...items.map((i) => i.delivery_days));
    return { ref, eta: Date.now() + maxDays * DAY };
  }
}

const registry = new Map();

export function registerProvider(platformId, provider) { registry.set(platformId, provider); }

export function getProvider(platformId) {
  let p = registry.get(platformId);
  if (!p) { p = new SimulatedProvider(platformId); registry.set(platformId, p); }
  return p;
}
