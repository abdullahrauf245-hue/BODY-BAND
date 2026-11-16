'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickCamera } = require('../camera-pick');

const cams = [{ id: 'a', name: 'Integrated Webcam' }, { id: 'b', name: 'Iriun Webcam' }, { id: 'c', name: null }];

test('no camera wanted means the SDK default', () => {
  for (const w of [undefined, null, '', '   ']) assert.deepEqual(pickCamera(cams, w), { useDefault: true });
});

test('a wanted name matches any part of a camera name, in any case', () => {
  assert.equal(pickCamera(cams, 'iriun').camera.id, 'b');
  assert.equal(pickCamera(cams, '  WEBCAM ').camera.id, 'a', 'the first match wins');
});

test('a camera that is not connected is an error, never a fallback to another camera', () => {
  const r = pickCamera(cams, 'droidcam');
  assert.equal(r.camera, undefined);
  assert.match(r.error, /"droidcam" is not connected/);
  assert.match(r.error, /Integrated Webcam, Iriun Webcam/);
  assert.match(pickCamera([], 'x').error, /No cameras were found/);
});

test('odd input from the SDK does not crash it', () => {
  assert.match(pickCamera(undefined, 'x').error, /No cameras were found/);
  assert.match(pickCamera([null, {}, { name: 5 }], 'x').error, /No cameras were found/);
});
