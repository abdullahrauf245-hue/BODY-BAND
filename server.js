/*
 * Body Band local server.
 *   - serves the website on http://localhost:3000
 *   - GET /vitals : starts SmartSpectra on the webcam and streams pulse and
 *     breathing to the page (Server-Sent Events). The session ends when the
 *     page disconnects or after MAX_SECONDS, whichever comes first, so the
 *     camera can never be left running by accident.
 *
 * The API key is read from .env (PRESAGE_API_KEY) and never leaves this process.
 */
require('dotenv').config({ quiet: true });
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const MAX_SECONDS = Number(process.env.PRESAGE_MAX_SECONDS) || 120;

// Only these files are ever served (so .env and node_modules stay private).
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/audio.js': ['audio.js', 'text/javascript; charset=utf-8'],
  '/signals.js': ['signals.js', 'text/javascript; charset=utf-8'],
};

let session = null;            // the one active camera session, if any
let teardown = Promise.resolve();

const last = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function endSession(reason) {
  if (!session) return teardown;
  const s = session;
  session = null;
  clearTimeout(s.timer);
  clearInterval(s.ticker);
  const used = Math.round((Date.now() - s.startedAt) / 1000);
  console.log(`[vitals] session ended after ${used}s: ${reason}`);
  if (!s.res.writableEnded) {
    send(s.res, 'ended', { reason, seconds: used });
    s.res.end();
  }
  teardown = (async () => {
    try { await s.sdk.stopAsync(); } catch (e) { /* already stopped */ }
    try { await s.sdk.destroy(); } catch (e) { /* already destroyed */ }
  })();
  return teardown;
}

async function startSession(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const fail = (reason) => { send(res, 'ended', { reason, seconds: 0 }); res.end(); };

  const apiKey = process.env.PRESAGE_API_KEY;
  if (!apiKey) return fail('No PRESAGE_API_KEY found in .env');
  if (session) return fail('A camera session is already running');
  await teardown; // let the previous session finish closing first

  let sdkLib, decodeMetrics;
  try {
    sdkLib = require('@smartspectra/node-sdk');
    ({ decodeMetrics } = require('@smartspectra/node-sdk/messages'));
  } catch (e) {
    return fail('SmartSpectra SDK failed to load: ' + e.message);
  }
  const { SmartSpectraSDK, CameraSelection, MetricType } = sdkLib;

  let sdk;
  try {
    sdk = new SmartSpectraSDK({
      apiKey,
      // Only what the music uses. Asking for more makes the SDK fetch extra models when
      // the session starts (the arterial pressure trace needs one), and that is one more
      // thing that can fail.
      requestedMetrics: [MetricType.CHEST_BREATHING, MetricType.BREATHING_RATE, MetricType.PULSE_RATE],
    });
  } catch (e) {
    return fail('Could not create SmartSpectra session: ' + e.message);
  }

  const s = (session = { sdk, res, startedAt: Date.now(), packets: 0, lastCode: -1 });

  sdk.on('validationStatus', (code, ts, hint) => {
    if (session !== s || code === s.lastCode) return;
    s.lastCode = code;
    send(res, 'status', { code, text: code === 0 ? '' : hint || 'Adjusting…' });
  });

  sdk.on('metrics', (buf) => {
    if (session !== s) return;
    let m;
    try { m = decodeMetrics(buf); } catch (e) { return; }
    const pulse = last(m.cardio && m.cardio.pulseRate);
    const rate = last(m.breathing && m.breathing.rate);
    const trace = ((m.breathing && m.breathing.upperTrace) || []).map((p) => p.value);
    if (s.packets < 5) {
      console.log(`[vitals] packet ${s.packets + 1}: pulse=${pulse ? pulse.value.toFixed(1) : '-'} ` +
        `breathRate=${rate ? rate.value.toFixed(1) : '-'} traceSamples=${trace.length}`);
    }
    s.packets++;
    if (!pulse && !rate && !trace.length) return;
    send(res, 'vitals', {
      pulse: pulse ? pulse.value : null,
      breathRate: rate ? rate.value : null,
      trace,
    });
  });

  sdk.on('error', (code, message, retryable) => {
    console.error(`[vitals] SmartSpectra error ${code}: ${message}`);
    if (session === s) endSession(`SmartSpectra error ${code}: ${message}`);
  });

  try {
    sdk.useCamera(CameraSelection.default);
    sdk.start();
  } catch (e) {
    return endSession('Could not start the camera: ' + e.message);
  }
  console.log(`[vitals] session started (auto-stops after ${MAX_SECONDS}s)`);

  s.timer = setTimeout(() => endSession(`Auto-stopped after ${MAX_SECONDS} seconds`), MAX_SECONDS * 1000);
  s.ticker = setInterval(() => {
    const left = Math.max(0, MAX_SECONDS - Math.round((Date.now() - s.startedAt) / 1000));
    send(res, 'tick', { left });
  }, 1000);
  send(res, 'tick', { left: MAX_SECONDS });
  req.on('close', () => { if (session === s) endSession('Page disconnected'); });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/vitals') return void startSession(req, res);
  const entry = req.method === 'GET' && STATIC[url];
  if (!entry) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(__dirname, entry[0]), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Error'); }
    res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Body Band running at http://localhost:${PORT}`);
  console.log(process.env.PRESAGE_API_KEY ? 'API key loaded from .env' : 'WARNING: no PRESAGE_API_KEY in .env');
});

async function shutdown() {
  await endSession('Server shutting down');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
