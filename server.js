const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve mobile control UI statically so phone can open http://<laptop-ip>:3000/
app.use(express.static(path.join(__dirname, 'mobile')));

// Last-write-wins: each change from mobile overwrites the pending values.
let lastValues = null; // { sl, tp, volume, ts } | null
// Semantics per key: string (numeric text, '' = CLEAR the site field) | undefined (leave site field alone)

function isValidValue(v) {
  // Empty string means "clear this field on the site". Undefined = not included = skip.
  return v === undefined || (typeof v === 'string' && (v === '' || /^-?\d*\.?\d*$/.test(v)));
}

function isValidAction(a) {
  return a === undefined || a === 'buy' || a === 'sell';
}

function isValidComment(c) {
  return c === undefined || (typeof c === 'string' && c.length <= 200);
}

// POST /values — mobile sends { sl, tp, volume, action?, comment? } on every change.
// action "buy"/"sell" = user tapped BUY/SELL BY MARKET → site clicks the OPPOSITE market button.
app.post('/values', (req, res) => {
  const { sl, tp, volume, action, comment } = req.body || {};

  if (!isValidValue(sl) || !isValidValue(tp) || !isValidValue(volume) || !isValidAction(action) || !isValidComment(comment)) {
    console.warn(`[WARN] Rejected invalid values: ${JSON.stringify(req.body)}`);
    return res.status(400).json({
      status: 'error',
      message: 'sl/tp/volume must be numeric strings ("" clears, omitted skips); action must be "buy"|"sell"; comment max 200 chars',
    });
  }

  lastValues = { sl, tp, volume, action, comment, ts: Date.now() };

  console.log(`[${new Date().toISOString()}] Received values: sl="${sl}" tp="${tp}" volume="${volume}" action="${action || '-'}" comment="${comment || ''}" (SL<->TP + Buy<->Sell swapped on site)`);

  res.json({ status: 'ok', sl, tp, volume, action });
});

// GET /values — extension polls this; consume-once semantics.
// `has:true` distinguishes a real payload (possibly all-clears) from "nothing pending".
app.get('/values', (req, res) => {
  if (lastValues) {
    const v = lastValues;
    lastValues = null;
    return res.json({ sl: v.sl, tp: v.tp, volume: v.volume, action: v.action, comment: v.comment, has: true });
  }
  res.json({ sl: null, tp: null, volume: null, action: null, comment: null, has: false });
});

// Latest site quote, pushed by the extension (latest-wins, NOT consume-once).
let lastQuote = null; // { bid, ask, balance, equity, ts } | null

function isNumText(v) {
  return typeof v === 'string' && /^-?[\d\s.,]+$/.test(v) && /[0-9]/.test(v);
}

// POST /quote — extension reports live ticket prices (bid/ask) + account (balance/equity)
app.post('/quote', (req, res) => {
  const { bid, ask, balance, equity } = req.body || {};
  if (!isNumText(bid) || !isNumText(ask)) {
    return res.status(400).json({ status: 'error', message: 'bid and ask must be numeric strings' });
  }
  if ((balance !== undefined && !isNumText(balance)) || (equity !== undefined && !isNumText(equity))) {
    return res.status(400).json({ status: 'error', message: 'balance/equity must be numeric strings' });
  }
  lastQuote = { bid, ask, balance: balance ?? null, equity: equity ?? null, ts: Date.now() };
  res.json({ status: 'ok' });
});

// GET /quote — phone UIs poll this to show live site prices
app.get('/quote', (req, res) => {
  res.json(lastQuote || { bid: null, ask: null, balance: null, equity: null, ts: null });
});

// Health check for mobile UI "test connection"
app.get('/health', (req, res) => {
  res.json({ status: 'ok', pending: lastValues, time: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`InverseFill server running on http://0.0.0.0:${PORT}`);
  console.log(`Mobile UI  : http://<your-laptop-ip>:${PORT}/`);
  console.log(`POST /values  { "sl": "1.08500", "tp": "1.09500", "volume": "0.01", "action": "buy"|"sell" }  ("" clears, omitted skips)`);
  console.log(`GET  /values  -> { sl, tp, volume, action, comment, has }`);
  console.log(`POST /quote   { "bid": "93.120", "ask": "93.220", "balance": "4577.16", "equity": "4573.60" }`);
  console.log(`GET  /quote   -> latest site quote (for phone display)`);
});
