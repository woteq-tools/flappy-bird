#!/usr/bin/env node
/**
 * make-icons.mjs — generates the PWA icons with zero dependencies.
 *
 * Everything is rasterised by hand into an RGBA buffer and encoded as PNG with
 * Node's built-in zlib. Run with:  node tools/make-icons.mjs
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'icons');

/* ------------------------------------------------------------ PNG encoder */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- rasteriser */

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

class Raster {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Float64Array(w * h * 4);
  }

  blend(x, y, c, alpha) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const p = this.px;
    const a = Math.min(1, alpha);
    const ia = 1 - a;
    const ca = c[3] === undefined ? 1 : c[3];
    p[i] = c[0] * a + p[i] * ia;
    p[i + 1] = c[1] * a + p[i + 1] * ia;
    p[i + 2] = c[2] * a + p[i + 2] * ia;
    p[i + 3] = ca * a + p[i + 3] * ia;
  }

  /** Rounded-rectangle coverage test in device pixels. */
  static inRoundRect(px, py, x, y, w, h, r) {
    if (px < x || py < y || px > x + w || py > y + h) return false;
    const cx = Math.min(Math.max(px, x + r), x + w - r);
    const cy = Math.min(Math.max(py, y + r), y + h - r);
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= r * r;
  }

  static inEllipse(px, py, cx, cy, rx, ry) {
    const dx = (px - cx) / rx;
    const dy = (py - cy) / ry;
    return dx * dx + dy * dy <= 1;
  }

  static inPoly(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  fillRect(x, y, w, h, color, alpha = 1) {
    const c = typeof color === 'string' ? hex(color) : color;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.ceil(x + w);
    const y1 = Math.ceil(y + h);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) this.blend(px, py, c, alpha);
    }
  }

  fillGradient(x, y, w, h, top, bottom) {
    const ct = typeof top === 'string' ? hex(top) : top;
    const cb = typeof bottom === 'string' ? hex(bottom) : bottom;
    const y0 = Math.floor(y);
    const y1 = Math.ceil(y + h);
    for (let py = y0; py < y1; py++) {
      const t = h <= 1 ? 0 : (py - y) / h;
      const c = [
        ct[0] + (cb[0] - ct[0]) * t,
        ct[1] + (cb[1] - ct[1]) * t,
        ct[2] + (cb[2] - ct[2]) * t,
      ];
      for (let px = Math.floor(x); px < Math.ceil(x + w); px++) this.blend(px, py, c, 1);
    }
  }

  fillRoundRect(x, y, w, h, r, color, alpha = 1) {
    const c = typeof color === 'string' ? hex(color) : color;
    for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
      for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
        if (Raster.inRoundRect(px + 0.5, py + 0.5, x, y, w, h, r)) this.blend(px, py, c, alpha);
      }
    }
  }

  fillCircle(cx, cy, r, color, alpha = 1) {
    const c = typeof color === 'string' ? hex(color) : color;
    const r2 = r * r;
    for (let py = Math.floor(cy - r); py <= Math.ceil(cy + r); py++) {
      for (let px = Math.floor(cx - r); px <= Math.ceil(cx + r); px++) {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.blend(px, py, c, alpha);
      }
    }
  }

  fillEllipse(cx, cy, rx, ry, color, alpha = 1) {
    const c = typeof color === 'string' ? hex(color) : color;
    for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py++) {
      for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px++) {
        if (Raster.inEllipse(px + 0.5, py + 0.5, cx, cy, rx, ry)) this.blend(px, py, c, alpha);
      }
    }
  }

  fillPoly(points, color, alpha = 1) {
    const c = typeof color === 'string' ? hex(color) : color;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, py] of points) {
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    for (let py = Math.floor(minY); py <= Math.ceil(maxY); py++) {
      for (let px = Math.floor(Math.min(...points.map((p) => p[0]))); px <= Math.ceil(Math.max(...points.map((p) => p[0]))); px++) {
        if (Raster.inPoly(px + 0.5, py + 0.5, points)) this.blend(px, py, c, alpha);
      }
    }
  }
}

/** Box-downsample a supersampled raster to the target size. */
function downsample(raster, factor) {
  const w = raster.w / factor;
  const h = raster.h / factor;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const i = ((y * factor + sy) * raster.w + (x * factor + sx)) * 4;
          r += raster.px[i];
          g += raster.px[i + 1];
          b += raster.px[i + 2];
          a += raster.px[i + 3];
        }
      }
      const n = factor * factor;
      const o = (y * w + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return { width: w, height: h, data: out };
}

/* ------------------------------------------------------------ icon design */

const SKY_TOP = '#38BDF8';
const SKY_BOTTOM = '#9BE7FF';
const GRASS = '#5FC44B';
const GRASS_DARK = '#3E9C33';
const SOIL = '#E2C98E';
const PIPE = '#63D15E';
const PIPE_DARK = '#2F8F37';
const BIRD = '#FFD34D';
const BIRD_DARK = '#E8A317';
const BIRD_LIGHT = '#FFEDB0';
const BEAK = '#FF8A1F';
const BEAK_DARK = '#E06B0A';

/**
 * Draws the icon into `r` (already at the supersampled resolution).
 * `safe` is 0..1 — the fraction of the canvas the artwork may occupy.
 */
function drawIcon(r, size, maskable) {
  const S = size;
  const safe = maskable ? 0.6 : 0.9;
  const inset = (S * (1 - safe)) / 2;

  /* --- background ------------------------------------------------------ */
  if (maskable) {
    r.fillGradient(0, 0, S, S, SKY_TOP, SKY_BOTTOM);
  } else {
    r.fillGradient(0, 0, S, S, SKY_TOP, SKY_BOTTOM);
    // Re-draw as a rounded gradient by masking: simpler to just paint the
    // gradient then knock out the corners.
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        if (!Raster.inRoundRect(px + 0.5, py + 0.5, 0, 0, S, S, S * 0.22)) {
          const i = (py * S + px) * 4;
          r.px[i] = r.px[i + 1] = r.px[i + 2] = r.px[i + 3] = 0;
        }
      }
    }
  }

  /* --- sun ------------------------------------------------------------- */
  const sunX = S * 0.76;
  const sunY = S * 0.2;
  for (let i = 6; i >= 1; i--) {
    r.fillCircle(sunX, sunY, S * 0.075 * i, '#FFF6C9', 0.018 * i);
  }
  r.fillCircle(sunX, sunY, S * 0.085, '#FFF3B0');

  /* --- clouds ---------------------------------------------------------- */
  const cloud = (cx, cy, sc) => {
    r.fillEllipse(cx, cy, S * 0.085 * sc, S * 0.055 * sc, '#FFFFFF', 0.92);
    r.fillEllipse(cx - S * 0.06 * sc, cy + S * 0.012 * sc, S * 0.055 * sc, S * 0.04 * sc, '#FFFFFF', 0.92);
    r.fillEllipse(cx + S * 0.065 * sc, cy + S * 0.015 * sc, S * 0.05 * sc, S * 0.036 * sc, '#FFFFFF', 0.92);
  };
  cloud(S * 0.2, S * 0.22, 1);
  cloud(S * 0.55, S * 0.12, 0.7);

  /* --- ground ---------------------------------------------------------- */
  const gy = S * 0.84;
  r.fillRect(0, gy, S, S - gy, SOIL);
  r.fillRect(0, gy, S, S * 0.05, GRASS);
  r.fillRect(0, gy + S * 0.05, S, S * 0.018, GRASS_DARK);

  /* --- pipe ------------------------------------------------------------ */
  const pw = S * 0.115;
  const px = S * 0.03;
  const py = S * 0.34;
  r.fillRect(px, py, pw, gy - py + S * 0.06, PIPE);
  r.fillRect(px, py, pw * 0.18, gy - py + S * 0.06, PIPE_DARK, 0.55);
  r.fillRect(px + pw * 0.82, py, pw * 0.18, gy - py + S * 0.06, PIPE_DARK, 0.4);
  r.fillRoundRect(px - pw * 0.14, py, pw * 1.28, S * 0.06, S * 0.012, PIPE);
  r.fillRoundRect(px - pw * 0.14, py + S * 0.042, pw * 1.28, S * 0.018, S * 0.008, PIPE_DARK, 0.6);

  /* --- bird ------------------------------------------------------------ */
  const bx = S * 0.62;
  const by = S * 0.58;
  const br = S * 0.13;

  r.fillEllipse(bx, by + br * 0.18, br * 1.02, br * 0.94, BIRD_DARK);
  r.fillEllipse(bx, by + br * 0.08, br, br * 0.92, BIRD);
  r.fillEllipse(bx - br * 0.12, by + br * 0.45, br * 0.62, br * 0.42, BIRD_LIGHT);
  // wing
  r.fillEllipse(bx - br * 0.42, by + br * 0.34, br * 0.4, br * 0.24, '#F2B324');
  r.fillEllipse(bx - br * 0.42, by + br * 0.3, br * 0.36, br * 0.19, BIRD_LIGHT, 0.5);
  // eye
  r.fillCircle(bx + br * 0.42, by - br * 0.3, br * 0.34, '#FFFFFF');
  r.fillCircle(bx + br * 0.5, by - br * 0.28, br * 0.17, '#1F2937');
  r.fillCircle(bx + br * 0.56, by - br * 0.38, br * 0.07, '#FFFFFF');
  // beak
  r.fillPoly(
    [
      [bx + br * 0.78, by - br * 0.12],
      [bx + br * 1.55, by + br * 0.16],
      [bx + br * 0.78, by + br * 0.42],
    ],
    BEAK_DARK,
  );
  r.fillPoly(
    [
      [bx + br * 0.78, by - br * 0.12],
      [bx + br * 1.5, by + br * 0.1],
      [bx + br * 0.78, by + br * 0.2],
    ],
    BEAK,
  );

  /* --- maskable safe zone: shrink the artwork back to the centre ------ */
  if (maskable) {
    const shrunk = new Raster(S, S);
    const k = safe / 0.9;
    const off = (S * (1 - k)) / 2;
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const sx = Math.round((px - off) / k);
        const sy = Math.round((py - off) / k);
        if (sx < 0 || sy < 0 || sx >= S || sy >= S) continue;
        const si = (sy * S + sx) * 4;
        const di = (py * S + px) * 4;
        shrunk.px[di] = r.px[si];
        shrunk.px[di + 1] = r.px[si + 1];
        shrunk.px[di + 2] = r.px[si + 2];
        shrunk.px[di + 3] = r.px[si + 3];
      }
    }
    r.px.set(shrunk.px);
    void inset;
  }
}

/* ----------------------------------------------------------------- build */

const SS = 3; // supersampling factor

function build(size, maskable) {
  const r = new Raster(size * SS, size * SS);
  drawIcon(r, size * SS, maskable);
  const small = downsample(r, SS);
  return encodePNG(small.width, small.height, small.data);
}

fs.mkdirSync(OUT, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-192.png', size: 192, maskable: true },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  { file: 'favicon.png', size: 64, maskable: false },
];

for (const t of targets) {
  const png = build(t.size, t.maskable);
  fs.writeFileSync(path.join(OUT, t.file), png);
  console.log(`icons/${t.file}  ${t.size}x${t.size}  ${(png.length / 1024).toFixed(1)} kB`);
}
