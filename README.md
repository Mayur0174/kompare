# Kompare

Kompare is an **Android app** that compares a product's **live price across Amazon, Flipkart, Myntra, AJIO, Croma, Reliance Digital, Tata CLiQ, Nykaa, Meesho** and other Indian stores. It shows each store's real listing with a working link, records the product's price every time it's checked, and alerts you when it drops.

There are **no preloaded or made-up products**. Every product comes from a live search, and every "Buy" button opens the store's own product page, where the purchase is completed. Everything used is free and open source.

## Get the Android app

On your Android phone, open
**https://github.com/Mayur0174/kompare/releases/download/android-latest/Kompare.apk**,
tap the downloaded file and allow "Install unknown apps". Every push to the repository builds a new APK and updates that link. If an older Kompare build is installed, uninstall it first; updates after this one install over the top.

## Live prices (free API key, 2 minutes)

Amazon and Flipkart have no open price API, and scraping their sites breaks their terms and gets blocked. Kompare uses **Google Shopping results through SerpApi** instead: one search returns real products, prices, photos and store links from all the major Indian stores.

1. Sign up at **https://serpapi.com** (free plan, about 100–250 searches a month) and copy your **API key**.
2. GitHub → this repository → **Settings → Secrets and variables → Actions → New repository secret**: name `SERPAPI_KEY`, value = your key.
3. Push any commit, or open **Actions → Android app → Run workflow**. The new APK has live prices.

How the free quota is used:
- Each search result is cached for 6 hours, so repeat searches cost nothing.
- **↻ Refresh** fetches fresh prices.
- Watched products are re-checked about twice a day when you open the app (at most 5), so price alerts can fire.

Without a key, the app still works as a launcher: every search shows real search links for that product on each store.

Note: the key is compiled into the APK, so anyone who unpacks the app could read it. That's acceptable for a personal free key. For a public release, run the server version below, which keeps the key on the server (`SERPAPI_KEY` in `.env`).

## What the app does

- **Search any product** across stores. The same product is grouped across stores, cheapest first, with real photos, ratings and links. Filter by store and sort by price.
- **Quick-compare pop-up**: tap a product to see every store's price and a **Buy on <store>** button.
- **Real price history**: every check is stored. The chart, the lowest-tracked price and the drop badges come from real checks, starting the first time you look at a product.
- **Watchlist and price alerts**, with Android notifications. Tapping a notification opens the product.
- **Paste a store link** (Amazon, Flipkart, …) into the search box to find that product.
- **Accounts** on the phone, plus optional **Google sign-in with cloud backup** (below). Includes delete account.
- Recently viewed, recent searches, native share sheet, dark mode, works offline for what you've already viewed.

The app has no cart and no in-app checkout. Real orders can only be placed on the stores themselves.

## Google sign-in + cloud backup (free)

Signing out and back in on the same phone already keeps your data: it stays in the on-device database. Google sign-in adds a **cloud backup**: your watchlist and price alerts (with the products' store offers) are saved to Firestore under `users/{your uid}`. Signing in again, on this phone or a new one, restores everything. Changes are backed up automatically about 1.5 s after each edit.

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

iOS: the same project builds for iPhone with `npm run ios:open`. This needs a Mac with Xcode, and the App Store needs a paid Apple developer account.

## Website / server version

Requires Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env    # set JWT_SECRET, SERPAPI_KEY (and FIREBASE_PROJECT_ID for Google sign-in)
npm run build && npm start          # http://localhost:8787
npm run dev                         # API :8787 + Vite :5173 with hot reload
npm test                            # API tests
npm run preview:app                 # the Android app's build in a browser (on-device backend)
```

Docker: `docker build -t kompare . && docker run -p 8787:8787 --env-file .env -v kompare-data:/app/data kompare`

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `SERPAPI_KEY` | GitHub secret (app) / `.env` (server) | Live prices from Google Shopping |
| `FIREBASE_*`, `GOOGLE_WEB_CLIENT_ID` | GitHub secrets / `web/.env` | Google sign-in + cloud backup |
| `ANDROID_KEYSTORE_*`, `ANDROID_KEY_*` | GitHub secrets | Release signing (`scripts/make-keystore.sh`) |
| `JWT_SECRET` | `.env` | Session signing on the server (**set in production**) |
| `PORT`, `DB_FILE` | `.env` | Server port and SQLite file |

All `.env` files, keystores (except the debug-only one) and `google-services.json` are git-ignored.

## Architecture

```
server/
  liveFetch.js     Google Shopping (SerpApi) request + parsing into store offers
  live.js          Groups offers into products across stores, stores prices as history, fires alerts
  app.js           REST API (zod validation, cached summaries, security headers, gzip)
  db.js            SQLite schema + migrations (node:sqlite)
  firebaseVerify.js  Verifies Google sign-in tokens (Web Crypto)
web/src/
  local/           On-device backend: server/* runs inside the app on SQLite-in-WebAssembly
  lib/live.ts      Live search (native HTTP on the phone, server proxy on the web), store links, caching
  lib/cloud.ts     Google sign-in + Firestore backup/restore
android/           Native Android project (Capacitor)
test/              API tests (node:test)
```
