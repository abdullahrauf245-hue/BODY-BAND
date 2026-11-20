---
title: Body Band: your heartbeat sets the rhythm, your breath shapes the sound
published: false
tags: devchallenge, presagechallenge, webdev, javascript
---

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04).*

## What I Built

**Body Band** turns your body into a musical instrument. A webcam reads your pulse and
breathing through the Presage SmartSpectra SDK, and the app plays music that follows them
live. Each heartbeat plays a soft kick and a note; breathing in opens a warm pad sound and
breathing out closes it again. There is nothing to wear, hold or press: you sit, breathe,
and the music is yours.

It looks like a piece of studio hardware: a telemetry strip with pulse and breathing rate, a
dial whose blue arc fills as you breathe in, and two "voices" showing what the music is doing.
Three breathing guides (4-7-8, box breathing, coherence breathing) put a needle on the dial
showing where your breath should be, and a SYNC score shows how closely your real breathing
follows it.

The notes always come from one scale (A minor pentatonic), so it sounds pleasant whatever
your body does.

## Demo

A 20-second live camera session, with sound: the SDK reads my pulse and breathing from the
webcam, and the breathing arc and the music follow them.

{% embed https://youtu.be/9h75S_-VV5w %}

Try the interface without a camera: https://bodyband.vercel.app (Simulated and Manual modes).
Camera mode runs on your own computer, because the SDK reads the webcam there.

## Code

https://github.com/abdullahrauf245-hue/BODY-BAND

The README has setup instructions, including a one-double-click start for Windows
(`BodyBand.bat`) and steps for macOS (Apple Silicon) and Linux.

## How It Responds to Human Signals

**Signals used:** pulse rate, breathing rate, and the chest-breathing trace from the
SmartSpectra SDK (`MetricType.PULSE_RATE`, `BREATHING_RATE`, `CHEST_BREATHING`).

| Signal | Sound | Screen |
| --- | --- | --- |
| Chest-breathing trace (where you are in a breath) | Opens and closes a filtered pad; louder and brighter as you breathe in | Blue arc on the dial, breath-depth meter, live breath trace |
| Pulse rate | One soft kick plus one note per heartbeat; a faster pulse plays higher, brighter notes | Pulse in BPM, beat light, beat-to-beat times |
| Breathing rate | — | Breaths per minute and seconds per cycle |

**How the SDK is integrated:**

- The SDK is the Node.js package `@smartspectra/node-sdk`. A small local server (`server.js`)
  creates a `SmartSpectraSDK` with only the three metrics above, opens the webcam with
  `useCamera()` at 640x480, 30 fps, and listens for `metrics`, `validationStatus`,
  `videoOutput` and `error` events.
- Each metrics packet is decoded with `decodeMetrics`, and the newest pulse rate, breathing
  rate and new chest-trace samples are streamed to the page over Server-Sent Events.
- The page scales the chest trace to 0..1 over the last few breaths, then a Web Audio engine
  (no libraries) turns it into sound. A cough or a shift in the chair is far bigger than a
  breath, so the scale uses the 4th to 96th percentile rather than the extremes, impossible
  pulse readings are ignored, and the tempo glides instead of jumping.
- If the SDK stops (API key refused, minutes used up, no internet, frame rate too low), the
  page says so in plain words.
- The SDK's readiness hints ("place more of the chest in view", frame rate too low) appear in
  the camera panel, and its `videoOutput` frames are shown, mirrored, as a live preview.
- The rest of the app never knows where the numbers come from: a simulated body and a
  one-button manual mode emit the same events, which is how the hosted demo works without a
  camera.

**What the real readings looked like.** In the first live camera session the SDK delivered one
to two chest-trace samples per packet while the camera held 29 to 30 frames a second. Raw
readings are not perfectly clean, so I tuned for that: pulse readings outside 35 to 200 are
ignored, each pulse shown is the median of the last five, the breath scale ignores outliers,
and the SYNC score allows about a second of sensor delay when comparing your breath with the
guide. These parts have unit tests (`npm test`, 27 passing).

## Prize Categories

**Most Creative or Delightful Use.** I wanted the measurement to disappear: instead of a
dashboard of numbers, you *hear* your own heartbeat and breathing as music, and you change
the music by changing how you breathe. Slow, deep breaths make long, open swells; a racing
heart makes the melody climb. Breathing along with a guide becomes a small game of keeping
the arc on the needle.

## Consent and Data Handling

- **Consent before every session.** Choosing the camera opens a camera check that explains
  what will happen, what it costs and where data goes. The SDK opens the camera only after
  the person presses START MEASURING, and the session stops by itself after 2 minutes, when
  they press Stop, or when they close the tab. The camera panel shows a live picture the whole
  time, so it is always obvious the camera is on.
- **Storage, retention, deletion.** Body Band stores no video and no readings. The live
  picture and the latest numbers exist only in memory during a session and are dropped when it
  ends, so there is nothing to retain or delete. The only file it keeps is `.env` with the
  user's own API key, on their own computer.
- **Sharing.** Body Band sends nothing anywhere itself. The server listens only on the user's
  own computer, and only the Body Band page can start the camera or read its picture.
- **SDK.** The SmartSpectra SDK contacts Presage to check the API key and download its models,
  and usage counts against the key. SDK telemetry is turned off (`enableTelemetry: false`).
- **AI services.** None.
- **Not medical.** Body Band is an art and wellbeing project. It makes no diagnosis, gives no
  health advice, and its readings should not be used for any health decision.
