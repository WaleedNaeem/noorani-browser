// Pure-Node PNG generator for the Noorani Browser app icon.
//
// Design: cream rounded square with a gold 8-point star in the center.
// No dependencies — builds the PNG byte-for-byte using only zlib + Buffer.
// Re-run whenever the design changes:   node tools/generate-icon.js

const fs   = require('fs');
const path = require('path');
const { deflateSync } = require('zlib');

// ---- CRC32 --------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---- PNG chunk writer ---------------------------------------------------
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Prepend filter byte (0 = None) to each scanline.
  const rowBytes = width * 4;
  const filtered = Buffer.alloc(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + rowBytes)] = 0;
    rgba.copy(filtered, y * (1 + rowBytes) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const idat = deflateSync(filtered, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- Drawing primitives --------------------------------------------------
function Canvas(w, h) {
  return { w, h, buf: Buffer.alloc(w * h * 4) }; // fully transparent
}
function putPixel(c, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  c.buf[i] = r; c.buf[i+1] = g; c.buf[i+2] = b; c.buf[i+3] = a;
}
function fillRect(c, x0, y0, x1, y1, r, g, b, a) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) putPixel(c, x, y, r, g, b, a);
}

// Filled rounded rectangle with AA on the corners (approximate).
function fillRoundedRect(c, x0, y0, x1, y1, radius, r, g, b, a) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let inside = true;
      let cover  = 1.0;
      // Determine if (x, y) lies in a corner zone; if so, distance to corner center.
      let cx = null, cy = null;
      if (x < x0 + radius && y < y0 + radius)       { cx = x0 + radius;     cy = y0 + radius;     }
      else if (x >= x1 - radius && y < y0 + radius) { cx = x1 - radius - 1; cy = y0 + radius;     }
      else if (x < x0 + radius && y >= y1 - radius) { cx = x0 + radius;     cy = y1 - radius - 1; }
      else if (x >= x1 - radius && y >= y1 - radius){ cx = x1 - radius - 1; cy = y1 - radius - 1; }

      if (cx !== null) {
        const dx = x - cx, dy = y - cy;
        const d  = Math.sqrt(dx*dx + dy*dy);
        if (d > radius + 0.5) inside = false;
        else if (d > radius - 0.5) cover = (radius + 0.5 - d);
      }
      if (inside) putPixel(c, x, y, r, g, b, Math.round(a * cover));
    }
  }
}

// Fill polygon using even-odd scanline rule with 4x vertical supersampling
// for smooth edges. `points` = [[x, y], ...] in pixel space.
function fillPolygon(c, points, r, g, b, a) {
  const SS = 4;
  const minY = Math.max(0, Math.floor(Math.min(...points.map(p => p[1]))));
  const maxY = Math.min(c.h - 1, Math.ceil(Math.max(...points.map(p => p[1]))));
  for (let y = minY; y <= maxY; y++) {
    const acc = new Float32Array(c.w);
    for (let s = 0; s < SS; s++) {
      const yy = y + (s + 0.5) / SS;
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        if ((y0 <= yy && y1 > yy) || (y1 <= yy && y0 > yy)) {
          const t = (yy - y0) / (y1 - y0);
          xs.push(x0 + t * (x1 - x0));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a0 = xs[k], a1 = xs[k + 1];
        const ia0 = Math.max(0, Math.floor(a0));
        const ia1 = Math.min(c.w - 1, Math.ceil(a1));
        for (let x = ia0; x <= ia1; x++) {
          const left  = Math.max(a0, x);
          const right = Math.min(a1, x + 1);
          const span  = Math.max(0, right - left);
          acc[x] += span / SS;
        }
      }
    }
    for (let x = 0; x < c.w; x++) {
      if (acc[x] > 0) {
        const alpha = Math.min(1, acc[x]);
        // Alpha-composite over whatever was there (nearly always opaque cream).
        const i = (y * c.w + x) * 4;
        const srcA = alpha * (a / 255);
        const dstA = c.buf[i+3] / 255;
        const outA = srcA + dstA * (1 - srcA);
        if (outA > 0) {
          c.buf[i]   = Math.round((r * srcA + c.buf[i]   * dstA * (1 - srcA)) / outA);
          c.buf[i+1] = Math.round((g * srcA + c.buf[i+1] * dstA * (1 - srcA)) / outA);
          c.buf[i+2] = Math.round((b * srcA + c.buf[i+2] * dstA * (1 - srcA)) / outA);
          c.buf[i+3] = Math.round(outA * 255);
        }
      }
    }
  }
}

// ---- Design --------------------------------------------------------------
// An 8-pointed star — a minimalist motif rooted in Islamic geometric
// patterns but widely used as a neutral geometric mark.
function eightPointStar(cx, cy, outerR, innerR) {
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const theta = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const r = (i % 2 === 0) ? outerR : innerR;
    pts.push([cx + r * Math.cos(theta), cy + r * Math.sin(theta)]);
  }
  return pts;
}

function makeIcon({ size, bg, fg }) {
  const c = Canvas(size, size);
  const corner = Math.round(size * 0.18);
  fillRoundedRect(c, 0, 0, size, size, corner, bg.r, bg.g, bg.b, 255);

  // Star centered, outer radius ~36% of canvas, inner ~16%.
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.36;
  const innerR = size * 0.16;
  fillPolygon(c, eightPointStar(cx, cy, outerR, innerR), fg.r, fg.g, fg.b, 255);

  return encodePNG(size, size, c.buf);
}

// ---- SVG source (design source of truth) --------------------------------
function makeSVG({ size, bg, fg }) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.36;
  const innerR = size * 0.16;
  const pts = eightPointStar(cx, cy, outerR, innerR)
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const corner = Math.round(size * 0.18);
  const bgHex = `#${[bg.r, bg.g, bg.b].map(n => n.toString(16).padStart(2, '0')).join('')}`;
  const fgHex = `#${[fg.r, fg.g, fg.b].map(n => n.toString(16).padStart(2, '0')).join('')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${corner}" ry="${corner}" fill="${bgHex}"/>
  <polygon points="${pts}" fill="${fgHex}"/>
</svg>
`;
}

// ---- ICO encoder (Windows icon container) -------------------------------
// Modern ICO supports embedded PNG entries, so we don't need a BMP encoder
// — just stitch the PNG bytes into the ICO's directory structure.
function makeIco(entries) {
  const n = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type = 1 (ICO)
  header.writeUInt16LE(n, 4);  // image count

  const dir = Buffer.alloc(16 * n);
  const datas = [];
  let offset = 6 + 16 * n;

  for (let i = 0; i < n; i++) {
    const { size, png } = entries[i];
    const d = dir.subarray(i * 16, (i + 1) * 16);
    d[0] = size >= 256 ? 0 : size;   // width  (0 means 256)
    d[1] = size >= 256 ? 0 : size;   // height (0 means 256)
    d[2] = 0;                        // palette count
    d[3] = 0;                        // reserved
    d.writeUInt16LE(1,  4);          // colour planes
    d.writeUInt16LE(32, 6);          // bits per pixel
    d.writeUInt32LE(png.length, 8);  // image data size
    d.writeUInt32LE(offset,    12);  // image data offset
    datas.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, dir, ...datas]);
}

// ---- Generate + write ----------------------------------------------------
const OUT = path.join(__dirname, '..', 'assets', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const LIGHT = { bg: { r: 0xFA, g: 0xF7, b: 0xF2 }, fg: { r: 0xC9, g: 0xA9, b: 0x61 } };
const DARK  = { bg: { r: 0x1A, g: 0x1A, b: 0x1A }, fg: { r: 0xD4, g: 0xAF, b: 0x37 } };

// Light-variant sizes needed for: the Windows .ico (16..256), Linux 512+,
// macOS high-res auto-conversion (1024).
const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const EXTRA_SIZES = [512, 1024];
const ALL_LIGHT_SIZES = [...new Set([...ICO_SIZES, ...EXTRA_SIZES])].sort((a, b) => a - b);

const lightPngs = {};
for (const size of ALL_LIGHT_SIZES) {
  const png = makeIcon({ size, ...LIGHT });
  lightPngs[size] = png;
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), png);
}

// Dark variant at the 512/256/64 sizes we've historically shipped.
for (const size of [512, 256, 64]) {
  fs.writeFileSync(path.join(OUT, `icon-dark-${size}.png`), makeIcon({ size, ...DARK  }));
}

// SVG sources of truth.
fs.writeFileSync(path.join(OUT, 'icon.svg'),      makeSVG({ size: 512, ...LIGHT }));
fs.writeFileSync(path.join(OUT, 'icon-dark.svg'), makeSVG({ size: 512, ...DARK  }));

// Canonical names the electron-builder config points to.
fs.writeFileSync(path.join(OUT, 'icon.png'), lightPngs[1024]);   // 1024×1024 — mac + linux
fs.writeFileSync(
  path.join(OUT, 'icon.ico'),
  makeIco(ICO_SIZES.map((s) => ({ size: s, png: lightPngs[s] })))
);

console.log('Wrote icons to', OUT);
console.log(' · sizes:      ', ALL_LIGHT_SIZES.join(', '));
console.log(' · icon.ico:   ', ICO_SIZES.join('+'), 'px');
console.log(' · icon.png:   1024px (mac/linux source)');
