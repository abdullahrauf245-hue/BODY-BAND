# Body Band — Product Requirements (PRD)

Status: draft v1 · 15 Nov 2026 · Deadline: **22 Nov 2026** (Presage SmartSpectra SDK Challenge)

## 1. What it is

Body Band turns your body into a musical instrument. A camera reads your pulse and
breathing through the Presage SmartSpectra SDK, and the app plays music and visuals
that follow them live: your heartbeat sets the rhythm, your breath shapes the sound.

There is nothing to hold, wear or press. You sit, breathe, and the music is yours.

## 2. Why (the contest brief)

The challenge asks for an experience that responds to real-time human signals captured
through a camera (pulse, breathing rate, HRV, expressions). Body Band is built so the
SmartSpectra signals are the whole experience, not an add-on: without them there is no music.

## 3. Who it is for

| Person | What they get |
| --- | --- |
| Anyone curious | A one-minute "hear your own heartbeat as music" moment |
| People who want to calm down | Slow breathing audibly and visibly changes the music, which rewards calm |
| People with limited movement | An instrument that needs no hands: breathing alone plays it |
| Contest judges | A demo that is understood in ten seconds and clearly driven by the SDK |

## 4. Goals

1. Real pulse and breathing from the camera drive the sound and visuals, with a delay small enough to feel connected.
2. A first-time user understands what is happening within ten seconds, with no instructions.
3. It always sounds pleasant, whatever the body does.
4. It works as a demo even with no camera (simulated mode), so it can be shown anywhere.
5. Free SDK minutes are protected: a camera session can never be left running by accident.

## 5. Not in scope

- Medical use, diagnosis, or health advice of any kind.
- Accounts, saved history, or sending vitals anywhere outside the user's PC.
- Hand or gesture tracking (the SDK does not do it).
- Mobile apps. Desktop browser on Windows first.

## 6. The experience

1. **Intro screen:** name, one line of explanation, choice of signal source, Begin.
2. **Getting ready (camera mode):** plain hints if the camera can't read you ("face not centered", "too dark").
3. **Playing:** a glowing orb grows and shrinks with the breath, each heartbeat sends a ripple
   and plays a note, and a small panel shows pulse, breaths per minute and time left.
4. **End:** Stop, or automatic stop after 2 minutes. The screen says why it ended.

## 7. Requirements

### Must have (for submission)

| # | Requirement |
| --- | --- |
| M1 | Camera mode: live pulse and breathing from SmartSpectra drive the music and visuals |
| M2 | Heartbeat → rhythm (a beat and a note per heartbeat) |
| M3 | Breath → sound and visuals (orb size, brightness and openness of the sound) |
| M4 | Simulated mode that needs no camera |
| M5 | Manual mode: hold Space or press the screen to breathe in |
| M6 | Camera hints shown in plain words |
| M7 | Camera session auto-stops after 2 minutes, on Stop, and when the tab closes |
| M8 | API key stays on the user's PC and is never uploaded |
| M9 | Demo video and write-up for the submission |

### Should have

| # | Requirement |
| --- | --- |
| S1 | Polished visual design (the user's UI/UX ideas, applied with the design toolkit) |
| S2 | HRV changes the mood of the music (calmer body → warmer, slower harmony) |
| S3 | A short guided "calm down" session with a before/after pulse comparison |
| S4 | Respects reduced-motion settings; fully usable by keyboard |

### Could have

| # | Requirement |
| --- | --- |
| C1 | Choice of musical styles |
| C2 | Record and download the piece you just made |
| C3 | Facial expression (smile) adds sparkle to the music |

## 8. How we will know it works

- Camera mode shows a pulse within a few beats of a fingertip pulse check.
- The orb visibly follows a deliberate slow breath in and out.
- Someone who has never seen it can explain what it does after ten seconds of watching.
- A full 2-minute camera session ends by itself, and the Presage dashboard shows only that usage.

## 9. Risks

| Risk | Plan |
| --- | --- |
| Only about 50 free SDK minutes | Build with simulated/manual modes; short camera tests; auto-stop |
| SDK does not load on this PC yet (missing Microsoft runtime file) | Install the Visual C++ runtime update; fall back to the SDK's other input paths if needed |
| Breathing signal may arrive slowly or in bursts | Smooth it in the app; tune after the first real test |
| Seven days left | Must-haves first; design polish only after camera mode works |

## 10. Open questions

- Exact judging criteria and submission format (video length, write-up, repo rules).
- Whether SDK minutes are counted per session or per second of camera time.
- Final name and visual direction (waiting on the user's UI/UX ideas).
