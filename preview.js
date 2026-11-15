/*
 * Turns a raw camera frame from the SmartSpectra SDK into a small RGBA picture the page
 * can paint straight onto a canvas. A pure function, so it is tested without the SDK
 * or a camera (test/preview.test.js).
 */
'use strict';

// The SDK's PixelFormat values: bytes per pixel, and where red, green and blue sit.
// Formats that store brightness and colour separately are shown in grey, using the
// brightness byte only.
const LAYOUTS = {
  0: { bpp: 3, r: 0, g: 1, b: 2 }, // RGB
  1: { bpp: 3, r: 2, g: 1, b: 0 }, // BGR
  2: { bpp: 4, r: 0, g: 1, b: 2 }, // RGBA
  3: { bpp: 4, r: 2, g: 1, b: 0 }, // BGRA
  4: { bpp: 1, grey: true },       // NV12: the brightness plane comes first
  5: { bpp: 1, grey: true },       // NV21: same
  6: { bpp: 2, grey: true },       // YUYV: brightness is every other byte
};

/**
 * @param {{buf: Uint8Array, width: number, height: number, stride: number, format: number}} frame
 *        stride is the number of bytes in one row of the source (rows may be padded)
 * @param {number} [maxWidth] the picture is shrunk by a whole factor until it fits this width
 * @returns {{width: number, height: number, data: Buffer} | null} null when the frame can't be read
 */
function toRgba(frame, maxWidth = 320) {
  const layout = frame && LAYOUTS[frame.format];
  if (!layout || !frame.buf || !(frame.width > 0) || !(frame.height > 0)) return null;
  const { buf, width, height } = frame;
  const { bpp } = layout;
  const stride = frame.stride > 0 ? frame.stride : width * bpp;

  const step = Math.max(1, Math.ceil(width / maxWidth)); // keep every step-th pixel and row
  const w = Math.floor(width / step), h = Math.floor(height / step);
  if (!w || !h) return null;
  const lastByte = (h - 1) * step * stride + (w - 1) * step * bpp + bpp - 1;
  if (lastByte >= buf.length) return null; // shorter than its own size says: don't read past it

  const out = Buffer.allocUnsafe(w * h * 4);
  let o = 0;
  for (let y = 0; y < h; y++) {
    let i = y * step * stride;
    for (let x = 0; x < w; x++, i += step * bpp, o += 4) {
      if (layout.grey) {
        out[o] = out[o + 1] = out[o + 2] = buf[i];
      } else {
        out[o] = buf[i + layout.r];
        out[o + 1] = buf[i + layout.g];
        out[o + 2] = buf[i + layout.b];
      }
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

module.exports = { toRgba };
