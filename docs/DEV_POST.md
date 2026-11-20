---
title: Body Band: your heartbeat sets the rhythm, your breath shapes the sound
published: false
tags: devchallenge, presagechallenge, webdev, javascript
---

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04).*

## What I Built

Body Band plays music from your pulse and breathing. A webcam reads both through the Presage
SmartSpectra SDK, and the music follows them live. Each heartbeat plays a soft kick and a
note. Breathing in opens a warm pad sound, and breathing out closes it again. You don't wear,
hold or press anything: you sit in front of the camera and breathe.

The screen looks like a piece of studio hardware. A strip across the top shows pulse and
breathing rate, a dial's blue arc fills as you breathe in, and two panels show what each
sound is doing. Three breathing guides (4-7-8, box breathing and coherence breathing) put a
needle on the dial where your breath should be, and a SYNC score shows how closely your real
breathing follows it.

Every note comes from one scale (A minor pentatonic), so the music sounds pleasant whatever
your body does.

## Demo

A live camera session with my narration. The SDK reads my pulse and breathing from the webcam,
and the breathing arc and the music follow them.

{% embed https://youtu.be/9LxZwy8pMdg %}

You can try the interface without a camera at https://bodyband.vercel.app (Simulated and
Manual modes). Camera mode runs on your own computer, because the SDK reads the webcam there.

## Code

https://github.com/abdullahrauf245-hue/BODY-BAND

The README has setup instructions, including a double-click start for Windows
(`BodyBand.bat`) and steps for macOS (Apple Silicon) and Linux.

## How It Responds to Human Signals

Body Band uses three SmartSpectra metrics: pulse rate, breathing rate and the chest-breathing
trace (`MetricType.PULSE_RATE`, `BREATHING_RATE`, `CHEST_BREATHING`).

| Signal | Sound | Screen |
| --- | --- | --- |
| Chest-breathing trace (where you are in a breath) | Opens and closes a filtered pad, louder and brighter as you breathe in | Blue arc on the dial, breath-depth meter, live breath trace |
| Pulse rate | One soft kick and one note per heartbeat; a faster pulse plays higher, brighter notes | Pulse in BPM, beat light, beat-to-beat times |
| Breathing rate | None | Breaths per minute and seconds per cycle |

### How the SDK is integrated

- The SDK is the Node.js package `@smartspectra/node-sdk`. A small local server (`server.js`)
  creates a `SmartSpectraSDK` with only the three metrics above, opens the webcam with
  `useCamera()` at 640x480 and 30 fps, and listens for `metrics`, `validationStatus`,
  `videoOutput` and `error` events.
- The server decodes each metrics packet with `decodeMetrics` and streams the newest pulse
  rate, breathing rate and chest-trace samples to the page over Server-Sent Events.
- The page scales the chest trace to 0..1 over the last few breaths, and a Web Audio engine
  with no libraries turns it into sound. A cough or a shift in the chair moves the trace far
  more than a breath does, so the scale uses the 4th to 96th percentile. Impossible pulse
  readings are ignored, and the tempo glides to a new pulse instead of jumping.
- If the SDK stops (API key refused, minutes used up, no internet, frame rate too low), the
  page says what happened in plain words.
- The SDK's hints, such as "place more of the chest in view", appear in the camera panel, and
  its `videoOutput` frames are shown there, mirrored, as a live preview.
- The rest of the app doesn't know where the numbers come from. A simulated body and a
  one-button manual mode send the same events, which is how the hosted demo works without a
  camera.

### What the real readings looked like

In the first live camera session the SDK sent one or two chest-trace samples per packet while
the camera held 29 to 30 frames a second. The raw readings had some noise, so I tuned for it.
Pulse readings outside 35 to 200 are ignored, and each pulse shown is the median of the last
five. The breath scale ignores outliers. The SYNC score allows about a second of sensor delay
when it compares your breath with the guide. These parts have unit tests (`npm test`, 27
passing).

## Prize Categories

Most Creative or Delightful Use. You hear your heartbeat and breathing as music, and you
change the music by changing how you breathe. Slow, deep breaths make long, open swells, and
a faster heart makes the melody climb. With a guide on, breathing becomes a small game of
keeping the arc on the needle.

## Consent and Data Handling

- Consent: choosing the camera opens a camera check that explains what will happen, what it
  costs and where data goes. The SDK opens the camera only after the person presses START
  MEASURING. The session stops by itself after 2 minutes, when they press Stop, or when they
  close the tab. The camera panel shows a live picture the whole time, so it is always clear
  that the camera is on.
- Storage, retention and deletion: Body Band stores no video and no readings. The live picture
  and the latest numbers are held in memory during a session and dropped when it ends, so
  there is nothing to keep or delete. The only file it writes is `.env`, which holds the
  user's own API key on their own computer.
- Sharing: Body Band sends nothing anywhere itself. The server listens only on the user's own
  computer, and only the Body Band page can start the camera or read its picture.
- SDK: the SmartSpectra SDK contacts Presage to check the API key and download its models, and
  usage counts against the key. SDK telemetry is turned off (`enableTelemetry: false`).
- AI services: none.
- Not medical: Body Band is an art and wellbeing project. It makes no diagnosis, gives no
  health advice, and its readings should not be used for any health decision.
