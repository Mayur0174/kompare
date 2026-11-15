# Kompare

One app to compare a product's **live price, price history and delivery terms across Amazon, Flipkart, Myntra, AJIO, Croma, Reliance Digital, Tata CLiQ, Nykaa and Meesho**, and to **order from any of them in one checkout**.

Kompare is an **Android app** (an `.apk` you install on the phone). The whole backend (catalogue, price engine, alerts, cart, orders) runs **on the phone** with an on-device SQLite database, so it needs no server and works offline. Signing in with Google backs your data up to your own free Firebase project, so it comes back after a reinstall or on a new phone. The same code also runs as a website with a Node server. Everything used is free and open source.

## Get the Android app

1. Open the repository on GitHub → **Actions** → **Android app** → the latest green run.
2. Under **Artifacts**, download **Kompare-android-apk** (a zip containing `Kompare.apk`).
3. On the phone, open `Kompare.apk` and allow "Install unknown apps" when Android asks.

Every push builds a new APK automatically (`.github/workflows/android.yml`). To build one on your own computer you need Android Studio, then run `npm run android:apk` (or `npm run android:open` to open the project in Android Studio).

## Google sign-in + cloud backup (free)

Signing out and back in on the same phone already keeps all your data: it stays in the on-device database. Google sign-in adds a **cloud backup**: the watchlist, alerts, cart, orders and address are saved to Firestore under `users/{your uid}`. Signing in again, on this phone or a new one, restores everything. Changes are backed up automatically about 1.5 s after each edit.

One-time setup, about 10 minutes, on Firebase's free Spark plan:

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**.
2. **Authentication** → Sign-in method → enable **Google**. Copy the **Web client ID** shown under "Web SDK configuration".
3. **Firestore Database** → Create database. Then **Rules** → paste the contents of `firestore.rules` → Publish.
4. **Project settings** → Your apps → add a **Web app** and copy its config (`apiKey`, `authDomain`, `projectId`, `appId`).
5. Still in Project settings, add an **Android app** with package name `app.kompare.mobile`. Add the **SHA-1** of your signing key: run `scripts/make-keystore.sh`, which creates the key and prints its SHA-1.
6. GitHub → Settings → Secrets and variables → Actions. Add these repository secrets:
   `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, `GOOGLE_WEB_CLIENT_ID`,
   and the 4 signing secrets printed by the script (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`).
7. Push any commit, or click **Run workflow**. The new APK has a working **Continue with Google** button.

For local builds, copy `web/.env.example` to `web/.env` and fill in the same values. **All `.env` files, keystores and `google-services.json` are git-ignored.** Note that the Firebase web config is compiled into the app, which is normal for Firebase. The data stays protected because the Firestore rules only let each user read and write their own document. For the website/server mode, also set `FIREBASE_PROJECT_ID` so the server can verify Google ID tokens.

iOS: the same project builds for iPhone with `npm run ios:open`. This needs a Mac with Xcode, and distributing through the App Store needs a paid Apple developer account.

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

## Running the website / server version

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev          # API on :8787 + Vite on :5173 (hot reload)
# or production:
npm run build && JWT_SECRET=change-me npm start   # http://localhost:8787
npm test             # API test suite
npm run seed         # reset the demo database
```

`npm run preview:app` serves the Android app's build in a browser, with the on-device backend and no server, which is handy for quick testing.

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
| `FIREBASE_PROJECT_ID` | – | Enables Google sign-in on the server (verifies Firebase ID tokens) |
| `VITE_FIREBASE_*`, `VITE_GOOGLE_WEB_CLIENT_ID` | – | Google sign-in + cloud backup in the app (`web/.env`, or GitHub Secrets) |
| `VITE_API_BASE` | – | Optional: make the app talk to a remote server instead of its on-device backend |

## Architecture

```
server/
  app.js            Express REST API (validation with zod, cached summaries, security headers, gzip)
  db.js             SQLite schema via node:sqlite (WAL), nothing to install
  priceEngine.js    Polls providers, records hourly price history, fires alerts
  providers/        One adapter per store: fetchOffer() + placeOrder()
  seed.js           Demo catalogue: 56 products, 6 months of history
  firebaseVerify.js Verifies Google/Firebase ID tokens (Web Crypto)
web/src/            React + TanStack Query, routes split into lazy chunks, SVG chart with no chart library
web/src/local/      On-device backend: runs server/* on SQLite-in-WebAssembly with small shims for Node-only modules
web/src/lib/cloud.ts  Google sign-in + Firestore backup/restore
android/            Native Android project (Capacitor)
test/               node:test API suite
```

### Real store data

Each store is reached through a **provider** (`server/providers/index.js`). Out of the box every store uses the built-in `SimulatedProvider`, which produces realistic price movements, sales and stock changes, so the whole app works with no credentials. **The prices in the demo are simulated, not real Amazon / Flipkart prices.** To go live, register a provider per store that calls that store's affiliate or partner API (for example Amazon PA-API or the Flipkart Affiliate API) for `fetchOffer`. For `placeOrder`, call a partner order API where the store offers one, or fall back to an affiliate deep-link checkout. Nothing else in the app has to change.
