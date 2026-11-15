# Body Band — Technical Requirements (TRD)

Status: draft v1 · 15 Nov 2026 · Companion to [PRD.md](PRD.md)

## 1. Overview

```
 webcam ──► SmartSpectra SDK ──► server.js ──(live stream)──► browser page
            (native, in Node)    localhost:3000               signals.js ─► audio.js  (music)
                                                                         └► app.js    (visuals + panel)
```

The SDK only runs in Node.js, not in a browser, so a small local server runs it and
streams the numbers to the page. Everything stays on the user's PC except the SDK's own
calls to Presage.

## 2. Stack

| Part | Choice | Why |
| --- | --- | --- |
| Vitals | `@smartspectra/node-sdk` 3.5.0 | Official SDK; supports Windows x64 |
| Server | Node.js built-in `http` | No framework needed for six files and one stream |
| Live stream | Server-Sent Events (`/vitals`) | One-way, built into browsers, no library |
| Music | Web Audio API | Built into browsers, no library |
| Visuals | Canvas 2D | Enough for the orb, ripples and dust |
| Config | `dotenv` + `.env` | Keeps the API key out of the code |

Requirements: Windows 10/11 x64, Node.js 20 or newer, a webcam, the Microsoft Visual C++
runtime (a recent version that includes `VCRUNTIME140_THREADS.dll`).

## 3. Files

| File | Job |
| --- | --- |
| `server.js` | Serves the page; runs one SmartSpectra camera session and streams it |
| `signals.js` | Signal sources: Simulated, Manual, Presage (camera). All emit the same events |
| `audio.js` | The music engine |
| `app.js` | Visuals, panel, start/stop logic |
| `index.html`, `styles.css` | Page and look |
| `.env` | `PRESAGE_API_KEY` (never committed) |

## 4. Signal contract

Every source emits the same events, so music and visuals never care where data comes from.

| Event | Fields | Meaning |
| --- | --- | --- |
| `frame` | `pulse` (bpm), `breathRate` (per min), `breath` (0..1) | About 60 times a second |
| `beat` | — | Once per heartbeat |
| `status` | `text` | Camera hint, empty when all is well |
| `time` | `left` (seconds) | Camera session time remaining |
| `ended` | `reason` | Session is over |

## 5. Server

- Listens on `127.0.0.1:3000` only (not reachable from other devices).
- Serves a fixed list of six files. `.env`, `server.js` and `node_modules` are never served.
- `GET /vitals` starts a camera session and streams:

| Stream event | Data |
| --- | --- |
| `vitals` | `pulse`, `breathRate`, `trace` (new chest-movement samples) |
| `status` | `code`, `text` (SDK validation hint) |
| `tick` | `left` (seconds) |
| `ended` | `reason`, `seconds` |

- One session at a time. A session ends on: page disconnect, the time limit
  (`PRESAGE_MAX_SECONDS`, default 120), an SDK error, or server shutdown.
- The page closes the stream on any error and never reconnects by itself, so a session
  cannot restart silently.

## 6. SDK usage

- Metrics requested: breathing (chest and abdomen movement, breathing rate) and cardio
  (pulse rate, pulse trace, HRV).
- Input: `useCamera(CameraSelection.default)` — on Windows, front/back selection is not supported.
- Data arrives as protobuf and is decoded with `decodeMetrics` from `@smartspectra/node-sdk/messages`.
- Fields used now: latest `cardio.pulseRate`, latest `breathing.rate`, `breathing.upperTrace`.

## 7. Mapping signals to music and visuals

| Signal | Sound | Visual |
| --- | --- | --- |
| Breath position (0..1) | Opens the pad's filter and raises its volume | Orb size and brightness; dust drifts up or down |
| Each heartbeat | Soft kick plus one note from a minor pentatonic scale | Pink ripple and a flash |
| Pulse level | Octave and brightness of the notes | — |
| HRV (planned) | Harmony and mood | Colour temperature |

Breath position from the camera: the raw chest trace is scaled to 0..1 using the lowest and
highest values of the last 600 samples, then smoothed. Heartbeats are currently generated
from the pulse rate; using the real pulse trace for exact beat timing is a planned upgrade.

### Console UI (redesign, 15 Nov)

The interface follows the user's "OP-BIO.1" console design (light, hardware-style). Every
readout shows a real value; nothing on screen is placeholder data.

| Part | Shows |
| --- | --- |
| Telemetry strip | Pulse and beat-to-beat times, breath depth meter, breathing rate and cycle length |
| Centre dial | Blue arc = how full the breath is; plate = current phase and a live breath trace |
| MOD-L / MOD-R | The two voices: breath pad (filter opening) and pulse voice (last note played) |
| MOD-CAM | Camera state, SDK hints and time left |
| Footer | Start/stop, mute, timer, breathing guide selector |

Breathing guides (4-7-8, box, coherence): the needle on the dial shows where the guide wants
the breath to be, and the arc shows where it is. The user tries to keep the arc tip on the needle.

### Performance pass (15 Nov)

The signal side and the drawing side run on separate loops:

| Loop | Runs | Does |
| --- | --- | --- |
| Signal | A steady timer inside the source, about 60 times a second | Updates the numbers, the breath trace and the music |
| Draw | Only when the browser paints | Draws the latest numbers, skipping every readout whose value has not changed |

Why: beats used to be produced by the drawing loop, so the rhythm slowed whenever drawing did.
In a throttled browser tab drawing 1 to 2 frames a second, the signal loop was measured at
58 to 61 ticks a second.

Measured in Chrome with both versions driven at the same draw rate (about 40 to 45 draws a second):

| | Before | After |
| --- | --- | --- |
| Page updates per second, simulated breathing (dial moving) | 908 | 313 |
| Page updates per second, at rest (manual mode, no input) | 849 | 53 |
| Script time per second, simulated breathing | 10.6 ms | 9.6 ms |
| Script time per second, at rest | 9.5 ms | 6.7 ms |

Script time was already about 1% of one processor core, so the gain is in the browser's own
layout and drawing work, which was not timed directly.

## 8. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Delay | Breath-to-sound delay should feel immediate; target under about half a second on top of the SDK's own delay |
| Smoothness | 60 frames a second on a normal laptop |
| Privacy | No video or vitals stored or sent anywhere by our code; API key only in `.env` |
| Safety of minutes | Hard cap per session; visible countdown |
| Accessibility | Keyboard usable; reduced-motion respected; one-input manual mode |

## 9. Testing

| Check | How | Uses minutes |
| --- | --- | --- |
| Code loads | `node --check` on each file | No |
| Server and privacy | Request each page file (expect 200) and `.env` (expect 404) | No |
| SDK loads | `require` the SDK and list cameras | No |
| Music and visuals | Simulated and Manual modes in the browser | No |
| Real vitals | Short camera sessions, about 1 minute each | Yes |

## 10. Known issues and unknowns

1. **SDK does not load on the dev PC yet:** `smartspectra.dll` needs `VCRUNTIME140_THREADS.dll`,
   which is missing. Fix: update the Microsoft Visual C++ runtime.
2. **Untested with real data:** how often metrics arrive, how many trace samples per packet,
   and whether the chest trace rises or falls on a breath in. The server logs the first five
   packets so this can be tuned after the first camera test.
3. **Node version:** the PC runs Node 26; the SDK recommends Node 24 LTS. No problem seen so far.

## 11. Build order

1. Get the SDK loading, then one short camera test that prints real numbers.
2. Tune breath mapping and delay with real data.
3. Real heartbeat timing from the pulse trace; HRV → mood.
4. Visual design pass with the user's UI/UX ideas.
5. Guided calm-down session (if time allows).
6. Demo video, README and submission.
