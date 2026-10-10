# InverseFill — SL/TP Swap Fill System

Type **Stop Loss / Take Profit** on your phone → fills the New Order ticket on the FundingPips MT5 terminal (`mt5-sim1.fundingpips.com/terminal`) open on your laptop, **swapped**: your SL lands in the site's TP field and vice-versa. Pure local-network solution, no API access to the target site.

## Architecture

```
Mobile (SL/TP inputs, auto-send) --POST /values--> Node server :3000 --GET /values (poll 500ms)--> Chrome extension --> content.js fills ticket SWAPPED
```

## Project structure

```
.
├── server.js              # Express server + serves mobile UI
├── package.json
├── mobile/
│   ├── index.html         # Simple SL/TP swap controller (minimal)
│   └── terminal.html      # TradeX demo trading terminal (chart-first mobile UI)
├── extension/
│   ├── manifest.json      # Manifest V3, host_permissions <all_urls>
│   ├── background.js      # Polls localhost:3000/values every 500ms
│   └── content.js         # Swapped fill of .sl/.tp ticket inputs
└── prd.md                 # Original Red/Green PRD (superseded by SL/TP swap)
```

## Setup (< 15 min)

### 1. Laptop — start the server
```bash
npm install
node server.js
# → InverseFill server running on http://0.0.0.0:3000
```
Find your laptop's LAN IP: `hostname -I | awk '{print $1}'` (e.g. `192.168.1.5`). Allow port 3000 if the firewall blocks it (`sudo ufw allow 3000`).

### 2. Laptop — install / reload the Chrome extension
1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `extension/` folder (or hit Reload if already loaded).
3. Open the FundingPips terminal and open the **New Order ticket** (with the SL/TP fields visible). Keep that tab active.

### 2b. Firefox instead of Chrome (laptop)
Use the `extension-firefox/` folder (identical code, Firefox-compatible manifest with `background.scripts`):
1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → select `extension-firefox/manifest.json`.
3. Note: temporary add-ons unload when Firefox fully quits — repeat after restart. Then proceed with Step 3 below.

### 3. Phone — open the controller (same Wi-Fi!)
Open `http://<laptop-ip>:3000/` (e.g. `http://192.168.1.5:3000/`).
- Tap **Test** to verify connectivity.
- Type SL = `1.08500`, TP = `1.09500` → within ~1s the ticket shows SL = `1.09500`, TP = `1.08500` (swapped), with a gold flash on each filled field.

## API

| Method | Endpoint | Body / Response | Notes |
|--------|----------|-----------------|-------|
| POST | `/values` | `{ "sl": "1.08500", "tp": "1.09500", "volume": "0.02", "action": "sell", "comment": "scalp-01" }` → `{ status: "ok" }` | `""` clears the site field; omitted key = leave it alone; `action` buy/sell = market-button tap (optional); 400 on invalid |
| GET | `/values` | `{ sl, tp, volume, has }` | Consume-once. `has:true` = real payload (even all-clears), `has:false` = idle |
| GET | `/health` | `{ status: "ok", pending, time }` | Connection test |
| POST | `/quote` | `{ "bid": "93.120", "ask": "93.220", "balance": "4577.16", "equity": "4573.60" }` | Extension pushes live ticket prices (latest-wins) |
| GET | `/quote` | `{ bid, ask, balance, equity, ts }` | Phone UIs poll every 3s to show live site prices |
| GET | `/` | Mobile SL/TP UI | Static from `mobile/` |

Latency budget: ~300ms debounce + ≤500ms poll + ~50ms fill ≈ **≤850ms** end-to-end. Steppers, ✕-clear and volume send instantly (no debounce).

Every app control propagates automatically — no clicks needed on the laptop:
- **− / + steppers** (volume/SL/TP, both UIs) → site fields update to the new value.
- **✕ clear or deleting text** → the corresponding site field is cleared too.
- **Typing / comment** (debounced) → site fields follow.
- **SELL BY MARKET (red) / BUY BY MARKET (sky blue)** → fills the ticket first, then clicks the **opposite** button on the site (app SELL → site BUYS, app BUY → site SELLS).
- **Comment** → filled directly into the ticket's comment field (never swapped).
- **Live prices on phone** — the extension reads the ticket's bid/ask (`.price-column`) + balance/equity every 2s (changed-only) and POSTs to `/quote`; both phone UIs display them. Note: your DOM snapshot showed "Market closed", which is why Buy rendered `disabled` — the extension waits ~2s for a disabled button to enable, then warns instead of failing silently.
- The extension fills on arrival (SL↔TP swapped, volume direct) with a gold flash; if the ticket isn't open yet it retries ~3s.

## How the content script finds the fields

Verified against the real ticket DOM (Svelte app). Stable selectors in `extension/content.js` → `SELECTORS`:

```js
SELECTORS = {
  sl: ['.sl input', '.trade-input.orange input'],
  tp: ['.tp input', '.trade-input.green input'],
  volume: ['.volume input'],
  buy: [],   // site BUY market button — text fallback ("buy") works if not added
  sell: [],  // site SELL market button — text fallback ("sell") works if not added
  // + label-anchored fallback: div.label "Stop Loss"/"Take Profit"/"Volume"
  //   → closest('.trade-input').querySelector('input')
};
```

Never matches `svelte-xxxx` hashes (unstable). Fill uses the native input value setter + `input`/`change` events so Svelte bindings pick it up, with an `execCommand` fallback and a ~3s retry loop while the ticket dialog opens.

## TradeX demo terminal (chart-first mobile UI)

`mobile/terminal.html` → open `http://<laptop-ip>:3000/terminal.html`. A TradingView-style dark terminal (USOIL demo):

- **Market header** — logo, asset selector, price, day change, bid/ask, SIMULATED badge.
- **Real candlestick chart** (Lightweight Charts v4, pinned CDN) — price + time scales, gridlines, current-price line, crosshair + OHLC legend, pan/zoom/touch, volume overlay, fullscreen.
- **Timeframes** 1m–1M, horizontally scrollable; seeded demo OHLCV regenerates per TF.
- **Indicators tab** — MA20, EMA50, Volume (overlays); RSI14, MACD (separate panes). All implemented, no fakes.
- **Drawing tab** — horizontal levels, auto S/R (swing H/L), clear. Freehand trendlines marked "soon".
- **Events tab** — sample economic events + on-chart markers.
- **Order execution** — sticky Buy/Sell bar → bottom sheet (volume stepper, SL/TP with Buy/Sell-side validation, comment, summary) → demo confirmation modal. SL/TP also draw dashed lines on the chart and **mirror swapped to the laptop ticket via same-origin POST /values** (toggleable).
- **Desktop** — three-region layout: chart left, persistent order panel right.

Layout verified by construction at 360–430px (max-w, scrollable toolbars, no page-level horizontal overflow; chart resizes via ResizeObserver). Chart/timeframe/sheet behavior needs a live browser check (no headless browser in this env).

## Verified

- `POST /values` → `GET` returns `{sl, tp}` → `GET` again returns nulls ✓
- Invalid body → `400`; empty string accepted ✓
- `GET /health` ✓, `GET /` serves new InverseFill UI ✓
- Manifest parses, all JS passes `node --check` ✓
- Extension fill: manual check — type on phone, watch ticket fields fill swapped with gold flash
