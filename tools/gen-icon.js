'use strict';
/**
 * 纯 Node 生成应用图标（无任何图形库依赖）
 * 输出 assets/icon.png (256) 与 assets/tray.png (32/64)
 * 用法：node tools/gen-icon.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 绘制 ---------- */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const mixRGB = (c1, c2, t) => [
  Math.round(mix(c1[0], c2[0], t)),
  Math.round(mix(c1[1], c2[1], t)),
  Math.round(mix(c1[2], c2[2], t))
];

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy || 1;
  let t = (wx * vx + wy * vy) / len2;
  t = clamp01(t);
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  return Math.sqrt(dx * dx + dy * dy);
}

function render(size) {
  const S = 4;                    // 4x4 超采样抗锯齿
  const buf = Buffer.alloc(size * size * 4);
  const U = (v) => v * size;      // 以 1 为单位的坐标 -> 像素

  const cx = size / 2;
  const cy = size / 2;
  const hw = size * 0.44;
  const hh = size * 0.44;
  const radius = size * 0.245;

  // 表盘
  const ringR = size * 0.205;
  const ringW = size * 0.048;
  // 指针
  const handW = size * 0.036;
  const hourLen = size * 0.105;
  const minLen = size * 0.145;

  const cA = [124, 92, 255];      // #7C5CFF
  const cB = [59, 130, 246];      // #3B82F6

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let accA = 0;
      let accR = 0;
      let accG = 0;
      let accB = 0;

      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;

          const dCard = sdRoundRect(px, py, cx, cy, hw, hh, radius);
          if (dCard > 0.7) continue;

          // 背景渐变（左上 -> 右下）
          const t = clamp01((px / size * 0.65 + py / size * 0.35));
          const bg = mixRGB(cA, cB, t);
          let r = bg[0];
          let g = bg[1];
          let b = bg[2];
          let a = 1;

          // 顶部高光
          const gloss = clamp01(1 - (py / size) * 1.9) * 0.35;
          if (gloss > 0) {
            r = mix(r, 255, gloss * 0.35);
            g = mix(g, 255, gloss * 0.35);
            b = mix(b, 255, gloss * 0.35);
          }

          // 表盘白环
          const dRing = Math.abs(Math.sqrt((px - cx) ** 2 + (py - cy * 1.0) ** 2) - ringR) - ringW / 2;
          if (dRing < 0) {
            const w = clamp01(-dRing + 0.5);
            r = mix(r, 255, w);
            g = mix(g, 255, w);
            b = mix(b, 255, w);
          }

          // 指针（10:10 造型）
          const hubY = cy;
          const dMin = sdSegment(px, py, cx, hubY, cx, hubY - minLen) - handW / 2;
          const ang = (-60 * Math.PI) / 180; // 指向右上方
          const hx = cx + Math.cos(ang) * hourLen;
          const hy = hubY + Math.sin(ang) * hourLen;
          const dHour = sdSegment(px, py, cx, hubY, hx, hy) - handW * 0.62;
          const dDot = Math.sqrt((px - cx) ** 2 + (py - hubY) ** 2) - handW * 0.95;

          const wHand = clamp01(-Math.min(dMin, dHour, dDot) + 0.5);
          if (wHand > 0) {
            r = mix(r, 255, wHand);
            g = mix(g, 255, wHand);
            b = mix(b, 255, wHand);
          }

          // 卡片边缘透明度
          const edge = clamp01(0.5 - dCard);
          a *= edge;

          accA += a;
          accR += r * a;
          accG += g * a;
          accB += b * a;
        }
      }

      const n = S * S;
      const alpha = accA / n;
      const i = (y * size + x) * 4;
      if (alpha > 0.0005) {
        buf[i] = Math.round(accR / accA);
        buf[i + 1] = Math.round(accG / accA);
        buf[i + 2] = Math.round(accB / accA);
        buf[i + 3] = Math.round(alpha * 255);
      }
    }
  }
  return encodePNG(size, size, buf);
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon.png', 256],
  ['icon@2x.png', 512],
  ['tray.png', 32],
  ['tray@2x.png', 64]
];

for (const [name, size] of targets) {
  const png = render(size);
  fs.writeFileSync(path.join(outDir, name), png);
  const file = path.join(outDir, name);
  console.log('✓', name, size + 'x' + size, (png.length / 1024).toFixed(1) + 'KB', file);
}
