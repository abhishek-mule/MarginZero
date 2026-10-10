// InverseFill — background service worker (Manifest V3)
// Polls http://localhost:3000/values every 500ms, forwards SL/TP/volume to tab.
// The content script fills automatically on arrival — no clicks needed on laptop.

const SERVER_URLS = ['http://localhost:3000/values', 'http://127.0.0.1:3000/values'];
const QUOTE_URLS = ['http://localhost:3000/quote', 'http://127.0.0.1:3000/quote'];
const POLL_MS = 500;

async function pollOnce() {
  for (const url of SERVER_URLS) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data || data.has !== true) return; // nothing pending (has:false = idle poll)
      console.log('[InverseFill] got values:', data);
      await forwardToTabs(data);
      return;
    } catch (e) {
      continue; // try next URL
    }
  }
}

async function forwardToTabs(data) {
  const msg = { type: 'INVERSE_VALUES', sl: data.sl, tp: data.tp, volume: data.volume, action: data.action, comment: data.comment };
  try {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active && active.id != null) {
      try {
        await chrome.tabs.sendMessage(active.id, msg);
        return;
      } catch (e) {
        // active tab has no content script (e.g. chrome://) — broadcast instead
      }
    }
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    await Promise.allSettled(tabs.map((t) => chrome.tabs.sendMessage(t.id, msg)));
  } catch (e) {
    console.warn('[InverseFill] forward failed:', e);
  }
}

setInterval(pollOnce, POLL_MS);
chrome.alarms?.create?.('inversefill-poll', { periodInMinutes: 0.1 });
chrome.alarms?.onAlarm?.addListener?.(() => pollOnce());
pollOnce();

// Live quote uplink: content script reads ticket prices → we POST to the server
// (from the worker, so no page mixed-content issues). Phone UIs poll GET /quote.
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'QUOTE') return;
  const body = JSON.stringify({ bid: msg.bid, ask: msg.ask, balance: msg.balance, equity: msg.equity });
  (async () => {
    for (const url of QUOTE_URLS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (res.ok) return;
      } catch { /* try next URL */ }
    }
  })();
});
