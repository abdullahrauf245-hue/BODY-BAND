/*
 * Chooses which webcam the SmartSpectra SDK reads. A pure function so it is tested on its
 * own (test/camera-pick.test.js).
 *
 * With no name wanted, the SDK's default camera is used. With a name (PRESAGE_CAMERA_NAME,
 * for example "iriun" or "droidcam" for a phone used as a webcam) the first camera whose
 * name contains it is used. If none matches there is no fallback to another camera:
 * silently reading the laptop webcam when the phone was meant would waste SDK minutes.
 */
'use strict';

/**
 * @param {Array<{id: string, name: string|null}>} cameras what the SDK found
 * @param {string} [wanted] part of a camera name, any case
 * @returns {{useDefault: true} | {camera: object} | {error: string}}
 */
function pickCamera(cameras, wanted) {
  const want = (wanted || '').trim().toLowerCase();
  if (!want) return { useDefault: true };
  const list = Array.isArray(cameras) ? cameras : [];
  const camera = list.find((c) => c && typeof c.name === 'string' && c.name.toLowerCase().includes(want));
  if (camera) return { camera };
  const names = list.map((c) => c && c.name).filter((n) => typeof n === 'string' && n);
  return {
    error: `The camera "${wanted.trim()}" is not connected. ` +
      (names.length ? `Cameras found: ${names.join(', ')}.` : 'No cameras were found.') +
      ' Connect it, or remove PRESAGE_CAMERA_NAME from .env to use the default camera.',
  };
}

module.exports = { pickCamera };
