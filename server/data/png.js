'use strict';
// Minimal PNG decoder (Node built-ins only): non-interlaced, 8-bit
// greyscale / RGB / RGBA / greyscale+alpha / palette. Output is always the
// native channel count except palette, which is expanded to RGB(A).

const zlib = require('zlib');

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePNG(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIG[i]) throw new Error('Not a PNG file');
  }
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      trns = body;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!width || !height) throw new Error('PNG: missing IHDR');
  if (bitDepth !== 8) throw new Error('PNG: only 8-bit depth supported (got ' + bitDepth + ')');
  if (interlace) throw new Error('PNG: interlaced images not supported');
  const ch = CHANNELS[colorType];
  if (!ch) throw new Error('PNG: unsupported colour type ' + colorType);
  if (colorType === 3 && !palette) throw new Error('PNG: palette image without PLTE');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  if (raw.length < height * (stride + 1)) throw new Error('PNG: truncated image data');
  const px = new Uint8Array(height * stride);
  const bpp = ch; // bytes per pixel at 8-bit depth
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= bpp ? px[dst + x - bpp] : 0;
      const b = y > 0 ? px[prev + x] : 0;
      const c = x >= bpp && y > 0 ? px[prev + x - bpp] : 0;
      let out;
      switch (ft) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: out = v + paeth(a, b, c); break;
        default: throw new Error('PNG: bad filter type ' + ft);
      }
      px[dst + x] = out & 255;
    }
  }

  if (colorType !== 3) return { width, height, channels: ch, data: px };

  // Expand palette indices
  const outCh = trns ? 4 : 3;
  const data = new Uint8Array(width * height * outCh);
  for (let i = 0, n = width * height; i < n; i++) {
    const k = px[i];
    data[i * outCh] = palette[k * 3];
    data[i * outCh + 1] = palette[k * 3 + 1];
    data[i * outCh + 2] = palette[k * 3 + 2];
    if (outCh === 4) data[i * 4 + 3] = k < trns.length ? trns[k] : 255;
  }
  return { width, height, channels: outCh, data };
}

module.exports = { decodePNG };
