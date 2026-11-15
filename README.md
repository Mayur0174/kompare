# Kompare

One app to compare a product's **live price, price history and delivery terms across Amazon, Flipkart, Myntra, AJIO, Croma, Reliance Digital, Tata CLiQ, Nykaa and Meesho**, and to **order from any of them in one checkout**.

It ships as an installable mobile app (PWA, with offline support), can be wrapped as native Android / iOS apps with Capacitor, and also works as a website. Everything is free and open source. There are no paid services or API keys, and no database server to run.

## Features

- **Universal search** with autocomplete, typo/plural tolerance, filters (category, store, price, stock) and 9 sort orders. Paste an Amazon / Flipkart / Myntra… product link to jump straight to its comparison.
- **Quick-compare pop-up**: tap any product to see its price on every store that sells it, cheapest first, with delivery cost, ETA, stock, "lowest ever" badges and how much you save.
- **Product page** with an interactive multi-store price-history chart (7D / 30D / 90D / 6M), the 6-month low / average / high, a store-wise price range, a "good time to buy?" verdict, specs and similar products.
- **Home catalogue**: *Trending now* (views, watchlist adds, orders and price drops this week) and *Best sellers* (units sold in 30 days), mixed across categories. The list is a snapshot **recomputed every 12 hours** (`FEED_REFRESH_MS`) and stored in the database; prices on the cards stay live. Below that: price drops, the biggest gaps between stores, and a category browser.
- **Price alerts and watchlist**: set a target price and get an in-app notification when any store drops to it.
- **One cart, many stores**: free-delivery thresholds per store, "cheaper elsewhere" hints, and warnings when a price changed after you added the item.
- **Checkout** splits the order into one sub-order per store. It is idempotent (a double tap cannot order twice), rejects a stale price or out-of-stock item, validates address and PIN code, and offers UPI / card / netbanking / COD (COD up to ₹50k).
- **Orders**: per-store tracking numbers and ETAs, a status tracker, and cancellation (stock goes back).
- **Accounts**: scrypt password hashing, HMAC-signed tokens, rate-limited login. Demo account: `demo@kompare.app` / `demo1234`.
- **Mobile app shell**: bottom tab bar, safe-area insets, bottom-sheet pop-ups, install banner, service worker (app shell plus offline catalogue), manifest with maskable icons, dark mode, reduced-motion support.

## Running it

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev          # API on :8787 + Vite on :5173 (hot reload)
# or production:
npm run build && JWT_SECRET=change-me npm start   # http://localhost:8787
npm test             # API test suite
npm run seed         # reset the demo database
```

On a phone, open the site and choose **Install / Add to Home Screen**.

### Native Android / iOS (Capacitor)

```bash
VITE_API_BASE=https://your-api.example.com npm run android   # opens Android Studio → Run / Build APK
VITE_API_BASE=https://your-api.example.com npm run ios       # macOS + Xcode
```

The native app bundles the UI locally and talks to your deployed API. CORS already allows the Capacitor origins; add more with `CORS_ORIGINS`.

### Docker

```bash
docker build -t kompare . && docker run -p 8787:8787 -e JWT_SECRET=change-me -v kompare-data:/app/data kompare
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `JWT_SECRET` | dev value / random | Token signing secret (**set it in production**) |
| `DB_FILE` | `data/kompare.db` | SQLite file |
| `REFRESH_INTERVAL_MS` | `60000` | How often store prices are polled (`0` disables) |
| `FEED_REFRESH_MS` | `43200000` (12h) | How often the trending / best-seller catalogue is recomputed |
| `CORS_ORIGINS` | – | Extra allowed origins (comma-separated) |
| `VITE_API_BASE` | – | API URL baked into native builds |

## Architecture

```
server/
  app.js            Express REST API (validation with zod, cached summaries, security headers, gzip)
  db.js             SQLite schema via node:sqlite (WAL), nothing to install
  priceEngine.js    Polls providers, records hourly price history, fires alerts
  providers/        One adapter per store: fetchOffer() + placeOrder()
  seed.js           Demo catalogue: 56 products, 6 months of history
web/src/            React + TanStack Query, routes split into lazy chunks, SVG chart with no chart library
test/               node:test API suite
```

### Real store data

Each store is reached through a **provider** (`server/providers/index.js`). Out of the box every store uses the built-in `SimulatedProvider`, which produces realistic price movements, sales and stock changes, so the whole app works with no credentials. **The prices in the demo are simulated, not real Amazon / Flipkart prices.** To go live, register a provider per store that calls that store's affiliate or partner API (for example Amazon PA-API or the Flipkart Affiliate API) for `fetchOffer`. For `placeOrder`, call a partner order API where the store offers one, or fall back to an affiliate deep-link checkout. Nothing else in the app has to change.
