'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toRgba } = require('../preview');

const RGB = 0, BGR = 1, RGBA = 2, BGRA = 3, NV12 = 4, YUYV = 6;
const bytes = (img) => Array.from(img.data);

test('RGB frame becomes RGBA with full opacity', () => {
  const img = toRgba({ buf: Buffer.from([10, 20, 30, 40, 50, 60]), width: 2, height: 1, stride: 6, format: RGB });
  assert.deepEqual([img.width, img.height], [2, 1]);
  assert.deepEqual(bytes(img), [10, 20, 30, 255, 40, 50, 60, 255]);
});

test('BGR and BGRA have red and blue swapped back', () => {
  const bgr = toRgba({ buf: Buffer.from([30, 20, 10]), width: 1, height: 1, stride: 3, format: BGR });
  assert.deepEqual(bytes(bgr), [10, 20, 30, 255]);
  const bgra = toRgba({ buf: Buffer.from([30, 20, 10, 0]), width: 1, height: 1, stride: 4, format: BGRA });
  assert.deepEqual(bytes(bgra), [10, 20, 30, 255]);
});

test('row padding (stride wider than the pixels) is skipped', () => {
  // 1 pixel per row, 2 rows, each row padded to 8 bytes
  const buf = Buffer.from([1, 2, 3, 4, 99, 99, 99, 99, 5, 6, 7, 8, 99, 99, 99, 99]);
  const img = toRgba({ buf, width: 1, height: 2, stride: 8, format: RGBA });
  assert.deepEqual(bytes(img), [1, 2, 3, 255, 5, 6, 7, 255]);
});

test('a wide frame is shrunk by keeping every n-th pixel and row', () => {
  // 4x2 RGB, pixel value = its index; maxWidth 2 keeps columns 0 and 2 of row 0
  const buf = Buffer.alloc(4 * 2 * 3);
  for (let p = 0; p < 8; p++) buf.fill(p, p * 3, p * 3 + 3);
  const img = toRgba({ buf, width: 4, height: 2, stride: 12, format: RGB }, 2);
  assert.deepEqual([img.width, img.height], [2, 1]);
  assert.deepEqual(bytes(img), [0, 0, 0, 255, 2, 2, 2, 255]);
});

test('brightness-plus-colour formats are shown in grey', () => {
  // NV12 2x2: four brightness bytes, then colour bytes that must be ignored
  const nv12 = toRgba({ buf: Buffer.from([10, 20, 30, 40, 128, 128]), width: 2, height: 2, stride: 2, format: NV12 });
  assert.deepEqual(bytes(nv12), [10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255, 40, 40, 40, 255]);
  // YUYV 2x1: brightness, colour, brightness, colour
  const yuyv = toRgba({ buf: Buffer.from([10, 128, 20, 128]), width: 2, height: 1, stride: 4, format: YUYV });
  assert.deepEqual(bytes(yuyv), [10, 10, 10, 255, 20, 20, 20, 255]);
});

test('missing stride falls back to width times bytes per pixel', () => {
  const img = toRgba({ buf: Buffer.from([1, 2, 3, 4, 5, 6]), width: 1, height: 2, stride: 0, format: RGB });
  assert.deepEqual(bytes(img), [1, 2, 3, 255, 4, 5, 6, 255]);
});

test('frames that cannot be read give null instead of garbage', () => {
  assert.equal(toRgba(null), null);
  assert.equal(toRgba({ buf: Buffer.alloc(3), width: 1, height: 1, stride: 3, format: 42 }), null, 'unknown format');
  assert.equal(toRgba({ buf: Buffer.alloc(5), width: 2, height: 1, stride: 6, format: RGB }), null, 'buffer too short');
  assert.equal(toRgba({ buf: Buffer.alloc(0), width: 0, height: 0, stride: 0, format: RGB }), null, 'empty frame');
});
