// Per-device history: recently viewed products and recent searches (localStorage, best effort).
function list(key: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
function save(key: string, v: string[]) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } }
function store(key: string, max: number) {
  return {
    list: () => list(key),
    add(item: string) { const v = item.trim(); if (!v) return; save(key, [v, ...list(key).filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, max)); },
    remove(item: string) { save(key, list(key).filter((x) => x !== item)); },
    clear() { save(key, []); },
  };
}
export const recentlyViewed = store('kompare.recentlyViewed', 12);
export const recentSearches = store('kompare.recentSearches', 8);
