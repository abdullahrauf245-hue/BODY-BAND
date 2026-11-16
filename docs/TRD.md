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
| `preview.js` | Shrinks a raw camera frame into a small picture for the live view (tested in `test/`) |
| `camview.js` | Paints the live camera picture in the camera panel |
| `signals.js` | Signal sources: Simulated, Manual, Presage (camera). All emit the same events |
| `vitals.js` | Signal logic with no page, audio or SDK in it, so it is unit tested: breath scaling, pulse filtering, breath counting, guides, sync score |
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
| `tick` | `left` (seconds), `fps`, `width`, `height` (what the camera is delivering) |
| `ended` | `reason`, `seconds` |

- `GET /preview` returns the newest camera picture, shrunk to 320 pixels wide, as raw RGBA
  (size in the `X-Frame-Width` / `X-Frame-Height` headers), or 204 when there is none. The SDK
  owns the webcam, so the browser cannot open it as well; the SDK's `videoOutput` event hands
  each frame to the server, which keeps only the newest one in memory.
- `/vitals` and `/preview` answer only requests from the Body Band page itself (checked by
  the `Host` and `Origin` headers), so another website cannot start a camera session.

- One session at a time. A session ends on: page disconnect, the time limit
  (`PRESAGE_MAX_SECONDS`, default 120), an SDK error, or server shutdown.
- The page closes the stream on any error and never reconnects by itself, so a session
  cannot restart silently.

## 6. SDK usage

- Metrics requested: chest breathing, breathing rate and pulse rate, which is everything the
  app reads. Other metrics make the SDK download extra models at session start (the arterial
  pressure trace needs one), so they are left out until something uses them.
- Input: `useCamera(CameraSelection.default, { width: 640, height: 480, fps: 30 })`. The SDK
  refuses to measure below 25 frames a second. Change the mode with `PRESAGE_CAMERA` in `.env`
  (for example `1280x720@30`). On Windows, front/back selection is not supported.
- Data arrives as protobuf and is decoded with `decodeMetrics` from `@smartspectra/node-sdk/messages`.
- Fields used now: latest `cardio.pulseRate`, latest `breathing.rate`, `breathing.upperTrace`.

## 7. Mapping signals to music and visuals

| Signal | Sound | Visual |
| --- | --- | --- |
| Breath position (0..1) | Opens the pad's filter and raises its volume | Orb size and brightness; dust drifts up or down |
| Each heartbeat | Soft kick plus one note from a minor pentatonic scale | Pink ripple and a flash |
| Pulse level | Octave and brightness of the notes | — |
| HRV (planned) | Harmony and mood | Colour temperature |

Making the camera readings dependable (`vitals.js`, 16 unit tests):

| Problem | What the code does |
| --- | --- |
| A cough or a shift in the chair is far bigger than a breath | The chest trace is scaled to 0..1 between the 4th and 96th percentile of the last 600 samples, not the minimum and maximum, so one spike does not flatten every breath for 20 seconds |
| An impossible or odd pulse reading | Readings outside 35 to 200 are ignored, each reading is the median of the last five, and the tempo glides over about a second |
| A wobble halfway through a breath | A breath is counted only when an inhale starts after the breath has fallen at least 0.2 from its peak |
| The SDK needs time before its first pulse | The page says "finding your pulse" until one arrives, and plays no beats before then |
| The SDK stops with an error | Its error code is shown in plain words (API key refused, minutes used up, no internet, camera busy, frame rate too low) |

The first successful camera session (16 Nov) showed 1 to 2 chest samples per packet and the
camera holding 29 to 30 frames a second. Heartbeats are generated from the pulse rate; the
SDK's beat-by-beat pulse waveform needs a model download that failed on 15 Nov, so exact
beat timing is not used. `BODYBAND_DEBUG=1` prints a summary of the raw readings every 10
seconds for tuning; nothing is written to disk.

The SYNC score compares the breath with the guide over about the last 8 seconds. A camera
reading always arrives a little late, so the breath is compared with where the guide was 0,
0.5, 1 and 1.5 seconds ago and the best match counts.

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

1. **No real readings yet.** The first camera run (15 Nov, 43 seconds) started the SDK but
   produced no pulse or breathing. The SDK reported "use a camera mode that provides at least
   25 frames per second" at its default 1280x720, and a model download for the arterial
   pressure trace failed (503). Both are addressed above (640x480 at 30, fewer metrics) but
   not yet re-tested. If the frame rate is still low, the likely cause is dim light.
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
