/**
 * Generates the PWA icon set — no image tooling, no binary blobs in git.
 *
 * These are placeholders: a stylised fretboard in the app's accent colours.
 * They are real, valid PNGs at the right sizes so the manifest passes install
 * checks today. Replace public/icons/* with proper artwork when you have it,
 * keeping the same filenames and sizes, or edit the drawing below and re-run
 * `npm run icons`.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');

/** Rendering happens at 3x and is averaged down, which stands in for anti-aliasing. */
const SUPERSAMPLE = 3;

const COLOURS = {
  background: [18, 16, 31],
  neck: [138, 90, 59],
  neckEdge: [92, 58, 36],
  fret: [216, 216, 224],
  string: [245, 234, 214],
  inlay: [124, 92, 255],
};

// PNG encoding ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typeBytes = Buffer.from(type, 'ascii');

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));

  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlacing

  // Each scanline is prefixed with filter type 0 (none).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Drawing --------------------------------------------------------------------

function createCanvas(size) {
  return { size, data: Buffer.alloc(size * size * 4) };
}

function setPixel(canvas, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const offset = (y * canvas.size + x) * 4;
  canvas.data[offset] = r;
  canvas.data[offset + 1] = g;
  canvas.data[offset + 2] = b;
  canvas.data[offset + 3] = 255;
}

function fillRect(canvas, x, y, width, height, colour) {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const x1 = Math.round(x + width);
  const y1 = Math.round(y + height);

  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      setPixel(canvas, px, py, colour);
    }
  }
}

function fillCircle(canvas, cx, cy, radius, colour) {
  const r2 = radius * radius;
  for (let py = Math.floor(cy - radius); py <= Math.ceil(cy + radius); py += 1) {
    for (let px = Math.floor(cx - radius); px <= Math.ceil(cx + radius); px += 1) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) {
        setPixel(canvas, px, py, colour);
      }
    }
  }
}

/**
 * A guitar neck seen head-on: wooden fretboard, four frets, six strings, one
 * inlay dot.
 *
 * `contentScale` is the fraction of the canvas the neck occupies. Maskable
 * icons pass a smaller value so the drawing survives an aggressive circular
 * crop.
 */
function drawIcon(size, contentScale) {
  const canvas = createCanvas(size);
  fillRect(canvas, 0, 0, size, size, COLOURS.background);

  const neckWidth = size * contentScale * 0.62;
  const neckHeight = size * contentScale;
  const neckX = (size - neckWidth) / 2;
  const neckY = (size - neckHeight) / 2;

  const edge = Math.max(1, size * 0.012);
  fillRect(canvas, neckX - edge, neckY, neckWidth + edge * 2, neckHeight, COLOURS.neckEdge);
  fillRect(canvas, neckX, neckY, neckWidth, neckHeight, COLOURS.neck);

  // Frets: evenly spaced here rather than logarithmic — it reads better small.
  const fretCount = 4;
  const fretThickness = Math.max(1, size * 0.022);
  const fretGap = neckHeight / (fretCount + 1);
  for (let i = 1; i <= fretCount; i += 1) {
    fillRect(
      canvas,
      neckX - edge,
      neckY + fretGap * i - fretThickness / 2,
      neckWidth + edge * 2,
      fretThickness,
      COLOURS.fret,
    );
  }

  // Inlay dot between the second and third fret.
  fillCircle(canvas, size / 2, neckY + fretGap * 2.5, size * 0.062, COLOURS.inlay);

  // Six strings, thinnest to thickest across the neck.
  const stringCount = 6;
  const stringGap = neckWidth / (stringCount + 1);
  for (let i = 1; i <= stringCount; i += 1) {
    const thickness = Math.max(1, size * (0.008 + i * 0.0016));
    fillRect(
      canvas,
      neckX + stringGap * i - thickness / 2,
      neckY,
      thickness,
      neckHeight,
      COLOURS.string,
    );
  }

  return canvas;
}

function downsample(canvas, targetSize) {
  const factor = canvas.size / targetSize;
  const out = createCanvas(targetSize);

  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;

      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const offset = ((y * factor + sy) * canvas.size + (x * factor + sx)) * 4;
          r += canvas.data[offset];
          g += canvas.data[offset + 1];
          b += canvas.data[offset + 2];
        }
      }

      const samples = factor * factor;
      setPixel(out, x, y, [
        Math.round(r / samples),
        Math.round(g / samples),
        Math.round(b / samples),
      ]);
    }
  }

  return out;
}

function writeIcon(filename, size, contentScale) {
  const rendered = drawIcon(size * SUPERSAMPLE, contentScale);
  const final = downsample(rendered, size);
  const path = resolve(OUT_DIR, filename);

  writeFileSync(path, encodePng(size, final.data));
  console.log(`  ${filename}  (${size}x${size})`);
}

mkdirSync(OUT_DIR, { recursive: true });

console.log('Generating placeholder icons in public/icons:');
writeIcon('icon-192.png', 192, 0.78);
writeIcon('icon-512.png', 512, 0.78);
// Maskable icons get cropped to a circle inscribed in the middle 80%, so the
// drawing is pulled well inside that.
writeIcon('maskable-512.png', 512, 0.52);
writeIcon('apple-touch-icon.png', 180, 0.78);
console.log('Done. Replace these with real artwork when you have it.');
