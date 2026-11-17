/**
 * Zero-dependency PNG icon generator.
 * Draws a tiny open-book mark on the classroom green, with optional safe-zone
 * scaling for maskable icons. Run: node scripts/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT_DIR = path.resolve('assets');
const SS = 4;

const COLORS = {
  green: [31, 111, 92, 255],
  greenDeep: [24, 88, 73, 255],
  cream: [250, 246, 236, 255],
  creamSoft: [235, 227, 211, 255],
  gold: [214, 168, 92, 255]
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function createCanvas(size) {
  const width = Math.round(size * SS);
  const data = Buffer.alloc(width * width * 4);
  return { size: width, data };
}

function setPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const i = (y * canvas.size + x) * 4;
  canvas.data[i] = color[0];
  canvas.data[i + 1] = color[1];
  canvas.data[i + 2] = color[2];
  canvas.data[i + 3] = color[3];
}

function fillAll(canvas, color) {
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) setPixel(canvas, x, y, color);
  }
}

function fillCircle(canvas, cx, cy, radius, color) {
  const r = radius * canvas.size;
  const x0 = Math.floor(cx * canvas.size - r);
  const x1 = Math.ceil(cx * canvas.size + r);
  const y0 = Math.floor(cy * canvas.size - r);
  const y1 = Math.ceil(cy * canvas.size + r);
  const r2 = r * r;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx * canvas.size;
      const dy = y + 0.5 - cy * canvas.size;
      if (dx * dx + dy * dy <= r2) setPixel(canvas, x, y, color);
    }
  }
}

function fillPolygon(canvas, points, color) {
  const pts = points.map(([x, y]) => [x * canvas.size, y * canvas.size]);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(canvas.size - 1, Math.ceil(maxY)); y += 1) {
    for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(canvas.size - 1, Math.ceil(maxX)); x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (inside) setPixel(canvas, x, y, color);
    }
  }
}

function fillRoundRect(canvas, x, y, w, h, radius, color) {
  fillPolygon(
    canvas,
    [
      [x + radius / w, y],
      [x + (w - radius) / w, y],
      [x + w / w, y + radius / h],
      [x + w / w, y + (h - radius) / h],
      [x + (w - radius) / w, y + h / h],
      [x + radius / w, y + h / h],
      [x / w, y + (h - radius) / h],
      [x / w, y + radius / h]
    ].map(([nx, ny]) => [nx * (w / 1), ny * (h / 1)]),
    color
  );
}

function drawIcon(targetSize, contentScale) {
  const canvas = createCanvas(targetSize);
  fillAll(canvas, COLORS.green);

  // Soft darker ring, kept inside the safe area.
  fillCircle(canvas, 0.5, 0.5, 0.42 * contentScale, COLORS.greenDeep);

  const cx = 0.5;
  const cy = 0.5;
  const scale = contentScale;

  // Book pages.
  const leftPage = [
    [cx - 0.30 * scale, cy - 0.16 * scale],
    [cx - 0.02 * scale, cy - 0.22 * scale],
    [cx - 0.02 * scale, cy + 0.22 * scale],
    [cx - 0.30 * scale, cy + 0.28 * scale]
  ];
  const rightPage = [
    [cx + 0.02 * scale, cy - 0.22 * scale],
    [cx + 0.30 * scale, cy - 0.16 * scale],
    [cx + 0.30 * scale, cy + 0.28 * scale],
    [cx + 0.02 * scale, cy + 0.22 * scale]
  ];

  fillPolygon(canvas, leftPage, COLORS.creamSoft);
  fillPolygon(canvas, rightPage, COLORS.cream);

  // Spine and page lines.
  fillPolygon(
    canvas,
    [
      [cx - 0.025 * scale, cy - 0.24 * scale],
      [cx + 0.025 * scale, cy - 0.24 * scale],
      [cx + 0.025 * scale, cy + 0.23 * scale],
      [cx - 0.025 * scale, cy + 0.23 * scale]
    ],
    COLORS.green
  );

  for (const offset of [0.02, 0.10, 0.18]) {
    fillPolygon(
      canvas,
      [
        [cx - 0.25 * scale, cy + offset * scale],
        [cx - 0.07 * scale, cy + (offset - 0.03) * scale],
        [cx - 0.07 * scale, cy + (offset - 0.005) * scale],
        [cx - 0.25 * scale, cy + (offset + 0.025) * scale]
      ],
      COLORS.greenDeep
    );
    fillPolygon(
      canvas,
      [
        [cx + 0.07 * scale, cy + (offset - 0.03) * scale],
        [cx + 0.25 * scale, cy + offset * scale],
        [cx + 0.25 * scale, cy + (offset + 0.025) * scale],
        [cx + 0.07 * scale, cy + (offset - 0.005) * scale]
      ],
      COLORS.creamSoft
    );
  }

  // Gold spark above the book.
  fillCircle(canvas, cx, cy - 0.37 * scale, 0.065 * scale, COLORS.gold);
  fillPolygon(
    canvas,
    [
      [cx - 0.02 * scale, cy - 0.52 * scale],
      [cx + 0.02 * scale, cy - 0.52 * scale],
      [cx + 0.015 * scale, cy - 0.43 * scale],
      [cx - 0.015 * scale, cy - 0.43 * scale]
    ],
    COLORS.gold
  );

  return downsample(canvas, targetSize);
}

function downsample(canvas, targetSize) {
  const out = Buffer.alloc(targetSize * targetSize * 4);
  const factor = canvas.size / targetSize;
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      const startY = Math.floor(y * factor);
      const endY = Math.floor((y + 1) * factor);
      const startX = Math.floor(x * factor);
      const endX = Math.floor((x + 1) * factor);
      for (let sy = startY; sy < endY; sy += 1) {
        for (let sx = startX; sx < endX; sx += 1) {
          const i = (sy * canvas.size + sx) * 4;
          r += canvas.data[i];
          g += canvas.data[i + 1];
          b += canvas.data[i + 2];
          a += canvas.data[i + 3];
          count += 1;
        }
      }
      const i = (y * targetSize + x) * 4;
      out[i] = Math.round(r / count);
      out[i + 1] = Math.round(g / count);
      out[i + 2] = Math.round(b / count);
      out[i + 3] = Math.round(a / count);
    }
  }
  return out;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [file, size, scale] of [
  ['icon-192.png', 192, 0.94],
  ['icon-512.png', 512, 0.94],
  ['icon-maskable-512.png', 512, 0.72]
]) {
  const rgba = drawIcon(size, scale);
  fs.writeFileSync(path.join(OUT_DIR, file), encodePng(size, size, rgba));
  console.log(`wrote assets/${file}`);
}
