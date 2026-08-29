'use strict';

/**
 * 生成应用图标与托盘图标，纯 JS 手写 PNG（zlib + CRC32），不引任何图形库。
 *   build/icon.ico       —— 应用与安装包图标（内嵌 16/32/48/64/128/256 六张 PNG）
 *   build/tray.png       —— 托盘常态
 *   build/tray-alert.png —— 托盘带红点角标（有逾期未完成待办时）
 *
 * 需要改图标时直接改下面的 draw()，然后 `node scripts/gen-icons.js`。
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.resolve(__dirname, '..', 'build');
const SS = 4; // 4x 超采样做抗锯齿

/* ------------------------------------------------------------------ */
/* 画图                                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {number} size 输出边长
 * @param {{dot?:boolean, flat?:boolean}} opts
 * @returns {Buffer} RGBA 像素
 */
function draw(size, opts = {}) {
  const N = size * SS;
  const acc = new Float64Array(N * N * 4);

  const R = N / 2;
  const radius = N * 0.22; // 圆角
  const inset = N * 0.045;

  // 底：圆角矩形 + 竖向天空渐变
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!inRoundRect(x, y, inset, inset, N - inset * 2, N - inset * 2, radius)) continue;
      const t = y / N;
      const [r, g, b] = opts.flat
        ? [236, 241, 245]
        : [lerp(96, 190, t), lerp(150, 212, t), lerp(184, 222, t)];
      setPx(acc, N, x, y, r, g, b, 255);
    }
  }

  // 表盘圈
  const faceR = N * 0.3;
  const ring = N * 0.052;
  const cx = R;
  const cy = R;
  const white = opts.flat ? [46, 62, 78] : [255, 255, 255];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= faceR + ring / 2 && d >= faceR - ring / 2) {
        setPx(acc, N, x, y, white[0], white[1], white[2], 255);
      }
    }
  }

  // 指针：时针指 10 点，分针指 2 点
  strokeLine(acc, N, cx, cy, cx - faceR * 0.42, cy - faceR * 0.42, N * 0.05, white);
  strokeLine(acc, N, cx, cy, cx + faceR * 0.52, cy - faceR * 0.3, N * 0.042, white);

  // 逾期红点角标
  if (opts.dot) {
    const dr = N * 0.19;
    const dx = N - inset - dr * 0.95;
    const dy = inset + dr * 0.95;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (Math.hypot(x - dx, y - dy) <= dr) setPx(acc, N, x, y, 226, 62, 47, 255);
      }
    }
  }

  return downsample(acc, N, size);
}

function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return Math.hypot(px - cx, py - cy) <= r;
}

function strokeLine(acc, N, x0, y0, x1, y1, width, color) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - width));
  const maxX = Math.min(N - 1, Math.ceil(Math.max(x0, x1) + width));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - width));
  const maxY = Math.min(N - 1, Math.ceil(Math.max(y0, y1) + width));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (distToSegment(x, y, x0, y0, x1, y1) <= width / 2) {
        setPx(acc, N, x, y, color[0], color[1], color[2], 255);
      }
    }
  }
}

function distToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

function setPx(acc, N, x, y, r, g, b, a) {
  const i = (y * N + x) * 4;
  acc[i] = r;
  acc[i + 1] = g;
  acc[i + 2] = b;
  acc[i + 3] = a;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 超采样缓冲 → 目标尺寸 RGBA（直通 alpha 加权平均） */
function downsample(acc, N, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * N + (x * SS + sx)) * 4;
          const al = acc[i + 3] / 255;
          r += acc[i] * al;
          g += acc[i + 1] * al;
          b += acc[i + 2] * al;
          a += al;
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = a > 0 ? Math.round(r / a) : 0;
      out[o + 1] = a > 0 ? Math.round(g / a) : 0;
      out[o + 2] = a > 0 ? Math.round(b / a) : 0;
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* PNG 编码                                                            */
/* ------------------------------------------------------------------ */

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
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 每行加一个 filter 字节（0 = None）
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------------ */
/* ICO 封装（Vista+ 允许直接内嵌 PNG）                                 */
/* ------------------------------------------------------------------ */

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0; // 调色板
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4); // color planes
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/* ------------------------------------------------------------------ */

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const sizes = [16, 32, 48, 64, 128, 256];
  const entries = sizes.map((size) => ({ size, png: encodePng(draw(size), size) }));
  fs.writeFileSync(path.join(OUT, 'icon.ico'), encodeIco(entries));

  // 托盘：Windows 托盘按 16px 显示，给 32px 让高 DPI 也清楚
  fs.writeFileSync(path.join(OUT, 'tray.png'), encodePng(draw(32), 32));
  fs.writeFileSync(path.join(OUT, 'tray-alert.png'), encodePng(draw(32, { dot: true }), 32));

  console.log('图标已生成到', OUT);
}

main();
