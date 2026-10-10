// InverseFill — content script for FundingPips MT5 terminal (Svelte app)
// Swap rule: mobile SL -> site's TP field, mobile TP -> site's SL field, volume -> volume.
// Market order: app SELL BY MARKET -> clicks site BUY; app BUY BY MARKET -> clicks site SELL.
// Empty string CLEARS the site field; missing key leaves it alone.
// Fills automatically on arrival — every app control (+/−/✕/typing/volume/buttons) propagates.
//
// Selectors verified from real ticket DOM (Oct 2026):
//   div.sl > div.trade-input.orange > div.label "Stop Loss" + label > input[type=text]
//   div.tp > div.trade-input.green  > div.label "Take Profit" + label > input[type=text]
//   div.volume (volume input container)
// Buy/Sell market buttons: explicit selectors below, else text fallback ("buy"/"sell").
// (svelte-xxxx hashes are intentionally NEVER matched — they change on rebuild.)

const SELECTORS = {
  sl: ['.sl input', '.trade-input.orange input'],
  tp: ['.tp input', '.trade-input.green input'],
  volume: ['.volume input'],
  // Verified from full ticket DOM (Oct 2026): div.comment > ... > input[type=text]
  comment: ['.comment input[type="text"]', '.comment input'],
  // Verified from real ticket DOM (Oct 2026):
  //   <div class="footer-row"> <button class="trade-button red">Sell by Market</button>
  //                            <button class="trade-button">Buy by Market</button> </div>
  buy: ['.footer-row .trade-button:not(.red)', 'button.trade-button:not(.red)'],
  sell: ['.footer-row .trade-button.red', 'button.trade-button.red'],
};

const RETRY_MS = 300;
const RETRY_ATTEMPTS = 10; // ~3s wait for ticket dialog to appear

function norm(s) {
  return (s || '').toLowerCase();
}

function isVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/** Primary: explicit selectors. Fallback: label-anchored search. Last resort: container input. */
function findField(kind) {
  // 1. Explicit selectors
  for (const sel of SELECTORS[kind]) {
    try {
      const el = document.querySelector(sel);
      if (el && el.tagName === 'INPUT' && isVisible(el)) return el;
    } catch { /* bad selector — ignore */ }
  }
  // 2. Label-anchored: div.label text -> closest .trade-input (or parent) -> input
  const needles = kind === 'sl'
    ? ['stop loss', 'stoploss']
    : kind === 'tp'
      ? ['take profit', 'takeprofit']
      : kind === 'volume'
        ? ['volume', 'lots', 'quantity']
        : ['comment', 'note'];
  const labels = document.querySelectorAll('.trade-input .label, .label, label');
  for (const lb of labels) {
    const t = norm(lb.textContent?.slice(0, 60));
    if (needles.some((n) => t.includes(n))) {
      const box = lb.closest('.trade-input') || lb.parentElement;
      const inp = box?.querySelector?.('input[type="text"], input:not([type])');
      if (inp && isVisible(inp)) return inp;
    }
  }
  // 3. Generic: any input inside the semantic container
  const container = document.querySelector(
    kind === 'sl' ? '.sl' : kind === 'tp' ? '.tp' : kind === 'volume' ? '.volume' : '.comment'
  );
  const inp = container?.querySelector?.('input');
  return inp && isVisible(inp) ? inp : null;
}

/** Svelte-safe fill: native setter + input/change events + verify + fallback. '' clears. */
function fillField(input, value) {
  input.scrollIntoView({ block: 'center', behavior: 'instant' });
  input.focus();
  try {
    input.select?.();
  } catch { /* ignore */ }

  // Native setter bypasses Svelte/React binding guards (plain .value= is ignored)
  const proto = input.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // Verify — Svelte sometimes reverts; fallback to execCommand insertText
  if (input.value !== value) {
    try {
      input.focus();
      input.select?.();
      if (value === '') input.value = '';
      else document.execCommand('insertText', false, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch { /* ignore */ }
  }

  flash(input);
  input.blur?.();
}

function flash(el) {
  try {
    const prev = el.style.outline;
    el.style.outline = '3px solid #f1c40f';
    setTimeout(() => { el.style.outline = prev; }, 700);
  } catch { /* ignore */ }
}

/** Find the site's BUY or SELL market button: explicit selectors, else button-text fallback. */
function findOrderButton(kind) {
  // 1. Explicit selectors (most reliable — add site-specific ones to SELECTORS above)
  for (const sel of SELECTORS[kind]) {
    try {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    } catch { /* bad selector — ignore */ }
  }
  // 2. Text fallback: clickable whose own text is exactly/starts with buy/sell
  const needles = kind === 'buy' ? ['buy', 'long'] : ['sell', 'short'];
  const els = document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]');
  let best = null, bestScore = 0;
  for (const el of els) {
    if (!isVisible(el)) continue;
    const t = norm((el.value ?? el.textContent ?? '').trim().split('\n')[0]);
    for (const n of needles) {
      if (t === n || t.startsWith(n + ' ')) {
        const score = t === n ? 4 : 2;
        if (score > bestScore) { bestScore = score; best = el; }
      }
    }
  }
  return best;
}

function robustClick(el) {
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  el.focus?.();
  flash(el);
  // Full mouse sequence for Svelte/React listeners, then native click
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  el.click();
}

function handleValues(msg, attempt = 0) {
  // Collect requested fills: key present as string ('' included = clear). Missing = skip.
  const jobs = [];
  if (typeof msg.tp === 'string') jobs.push({ kind: 'sl', value: msg.tp, tag: `SL<-${msg.tp === '' ? 'cleared' : msg.tp}` });
  if (typeof msg.sl === 'string') jobs.push({ kind: 'tp', value: msg.sl, tag: `TP<-${msg.sl === '' ? 'cleared' : msg.sl}` });
  if (typeof msg.volume === 'string') jobs.push({ kind: 'volume', value: msg.volume, tag: `VOL<-${msg.volume === '' ? 'cleared' : msg.volume}` });
  // Comment is direct (never swapped); empty = skip (no noise when unused).
  if (typeof msg.comment === 'string' && msg.comment !== '') jobs.push({ kind: 'comment', value: msg.comment, tag: `CMT<-${msg.comment}` });
  const hasAction = msg.action === 'buy' || msg.action === 'sell';
  if (!jobs.length && !hasAction) return;

  const missing = jobs.filter((j) => !findField(j.kind));
  if (missing.length && attempt < RETRY_ATTEMPTS) {
    // Ticket dialog may still be opening — retry shortly (SPA-safe)
    setTimeout(() => handleValues(msg, attempt + 1), RETRY_MS);
    if (attempt === 0) console.log('[InverseFill] ticket not found, waiting for dialog…');
    return;
  }

  const done = [];
  for (const j of jobs) {
    const field = findField(j.kind);
    if (field) {
      fillField(field, j.value);
      done.push(j.tag);
    } else {
      console.warn(`[InverseFill] no ${j.kind} field found. Check SELECTORS in content.js.`);
    }
  }
  if (done.length) console.log(`[InverseFill] auto-fill: ${done.join(', ')}`);

  // Market order: fill first, then click the OPPOSITE button (app sell -> site BUY, app buy -> site SELL)
  if (hasAction) {
    const target = msg.action === 'buy' ? 'sell' : 'buy';
    setTimeout(() => clickWhenReady(target, msg.action, 0), 350); // let the SPA register filled values first
  }
}

// The snapshot showed Buy rendered with `disabled` — a click on a disabled button is
// silently ignored, so wait briefly for it to enable before giving up.
function clickWhenReady(target, appAction, attempt) {
  const btn = findOrderButton(target);
  if (!btn) {
    console.warn(`[InverseFill] app ${appAction} received but no site ${target} button found. Check SELECTORS.buy/sell.`);
    return;
  }
  if (btn.disabled && attempt < 6) {
    setTimeout(() => clickWhenReady(target, appAction, attempt + 1), 350);
    if (attempt === 0) console.log(`[InverseFill] site ${target} button disabled, waiting for it to enable…`);
    return;
  }
  if (btn.disabled) {
    console.warn(`[InverseFill] site ${target} button still disabled after ~2s — order NOT placed. (Ticket may block it: check price/volume validity on the site.)`);
    return;
  }
  robustClick(btn);
  console.log(`[InverseFill] app ${appAction.toUpperCase()} BY MARKET → clicked site ${target.toUpperCase()}:`, btn);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'INVERSE_VALUES') {
    handleValues(msg);
  }
});

// ---- Live quote reporter: reads ticket bid/ask + account equity, pushes to server ----
// Verified from full page DOM (Oct 2026):
//   div.price > div.price-column (x2: bid then ask, e.g. 93.120 / 93.220)
//   positions footer row divs: "Balance: 4 577.16", "Equity: 4 573.60", ...
let lastQuoteSent = '';
function readQuote() {
  try {
    const cols = document.querySelectorAll('.price .price-column');
    if (cols.length < 2) return;
    const bid = norm(cols[0].textContent).replace(/[^0-9.\-]/g, '');
    const ask = norm(cols[1].textContent).replace(/[^0-9.\-]/g, '');
    if (!bid || !ask) return;

    let balance = null, equity = null;
    const divs = document.querySelectorAll('div');
    for (const d of divs) {
      const t = d.textContent;
      if (t.length > 60) continue; // leaf-ish nodes only
      let m = t.match(/Balance:\s*([\d\s.,]+)/);
      if (m) balance = m[1].replace(/[\s,]/g, '');
      m = t.match(/Equity:\s*([\d\s.,]+)/);
      if (m) equity = m[1].replace(/[\s,]/g, '');
      if (balance && equity) break;
    }

    const key = `${bid}|${ask}|${balance}|${equity}`;
    if (key === lastQuoteSent) return; // changed-only reporting
    lastQuoteSent = key;
    chrome.runtime.sendMessage({ type: 'QUOTE', bid, ask, balance, equity });
  } catch { /* DOM not ready — ignore */ }
}
setInterval(readQuote, 2000);
readQuote();
