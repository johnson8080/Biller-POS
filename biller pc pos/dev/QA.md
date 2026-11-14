# QA - checking the whole app

Two scripts, both run from the project folder. They catch the mistakes that
are easy to make and hard to spot on a small phone screen.

## 1. The static audit (no phone, no browser)

```bash
node dev/qa-audit.js
```

It reads the source and checks that:

- every icon the app draws exists in the sprite (`index.html`)
- every `data-act` on a button has a handler, and every handler has a button
  (buttons whose action is swapped at runtime are counted too)
- every link (`data-nav`) points at a route the router knows
- the service worker caches every script the app loads
- `index.html` loads every script, all on one asset version
- only shipped scripts sit in `js/` (development files live in `dev/`)
- no `console.log` is left in the shipped code
- the notification ids do not clash

It prints `=== FINDINGS ===` with `none` when everything is clean.

## 2. The screen sweep (browser)

Needs `puppeteer-core` and the app served on `http://127.0.0.1:4173`:

```bash
python -m http.server 4173 --bind 127.0.0.1   # from the project folder
node dev/qa-sweep.js
```

It walks every screen (Sell, Orders, Debt, Stock, Suppliers, Reports,
Settings, Store, Account, Subscriptions) and checks that each one renders,
has no duplicated element ids and throws no errors. Then it walks all five
palettes in both light and dark and measures the contrast of every piece of
visible text against the background it really sits on, including translucent
layers. Finally it exercises the stock stepper, the reminder row and the
payment lock.

Anything under `badCount: 0`, `overflowing: 0` and `duplicateIds: []` is a
pass.

## 3. On the phone

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Then check the console over the WebView debug port (see the notes in the
project history): every route, the plan lock, the payment sheet, the
developer panel, and the notifications - `adb shell cmd notification list`
shows what the phone has received.

## Before you release

- `node dev/qa-audit.js` - no findings
- `node dev/qa-sweep.js` - no contrast failures, no overflow, no duplicate ids
- `node test-debt.js` - the debt ledger still balances
- bump `ASSET_VERSION` in `index.html` and `VERSION` in `sw.js`, then
  `node <sync script>` → `npx cap sync android` → gradle build → install
