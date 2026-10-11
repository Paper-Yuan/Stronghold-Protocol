#!/usr/bin/env node
// tools/crop-board-atlas.mjs — tile crops of the real 卫戍协议 board atlas (local-client art, DESIGN §13).
//
// The local client's autochess map textures (extracted by tools/local-extract into public/assets/local/map/autochess):
//   TX_autochessi_D.png       2048² diffuse atlas: 256 px floor cells (concrete slabs, hazard / chevron variants),
//                              gold-framed high-ground plates (a left / middle / right strip + a single plate),
//                              REINFORCEMENTS / EQUIPMENTS bench pads (512²), side panels, hatches, crates …
//   TX_autochessi_common_D.png 1024² device plates (hazard X, heal, shield, target, blade, blast, ▶▶, arrows)
//   TX_autochessi_BG.png       1024² dark concrete backdrop (the ground around the board)
//
// This script is the source of truth for WHICH pixels of those textures make each battlefield material of the
// renderer (public/js/render/textures.js MATERIALS). It validates every rect against the real images (bounds,
// coverage, contrast) and writes public/assets/local/map/autochess/tiles.json:
//
//   { version, cell, source: { D|common|BG: { path, w, h } },
//     materials: { <material>: [ layer… ] },          layers drawn in order into one square atlas cell
//     backdrop: { src: 'BG', tilesPerRepeat, crop? } }   the ground plane texture (crop avoids the lane stripes)
//   layer = { proc: 'rim' } (procedural bevel) | { src, rect: [x, y, w, h], rot?: 0|90|180|270 (clockwise), flipX?, flipY?, scale?: 0..1 (centred
//             decal, fraction of the cell), alpha?, tint?: '#rrggbb' (multiply), bright?: number (× brightness) }
//
// Side-face crops have the aspect of the face they cover (1 : block height), so the stretched cell maps back to
// undistorted proportions on the 3D face. Materials missing from tiles.json keep the procedural look, and the
// renderer falls back entirely when the atlas or this file is absent (the art is optional at runtime).
//
// The official 3D board (DESIGN §15, public/js/render/board3d) samples the same textures directly: its surface table
// (board3d/atlas.js SURFACES — rects of TX_autochessi_D / _common_D mapped onto tile tops, block sides, pads, devices)
// is validated here too and written into tiles.json → `board3d` (the renderer prefers it over its built-in copy, so
// a re-crop needs no code change).
//
// Usage: node tools/crop-board-atlas.mjs [--dir public/assets/local/map/autochess] [--preview out.png] [--check]
//   --check     validate only (exit 1 on problems), write nothing
//   --preview   also write a contact sheet PNG of every material (for eyeballing the crops)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { SURFACES as BOARD3D } from '../public/js/render/board3d/atlas.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith('--')) continue;
  const k = args[i].slice(2);
  opt[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
}
const DIR = path.resolve(ROOT, typeof opt.dir === 'string' ? opt.dir : 'public/assets/local/map/autochess');
const URL_BASE = '/' + path.relative(path.join(ROOT, 'public'), DIR).split(path.sep).join('/');

export const SOURCES = Object.freeze({
  D: { file: 'TX_autochessi_D.png', w: 2048, h: 2048 },
  common: { file: 'TX_autochessi_common_D.png', w: 1024, h: 1024 },
  BG: { file: 'TX_autochessi_BG.png', w: 1024, h: 1024 },
});

// ---- rects (atlas pixels; picked by eye from the 2048² atlas, 256 px per floor cell) --------------------------
const R = {
  concrete: [256, 512, 256, 256],        // plain 2×2-slab concrete
  concreteFrame: [256, 256, 256, 256],   // concrete with a steel edge rail on top + a red ✕ marker
  concreteStripe: [512, 256, 256, 256],  // concrete, diagonal hazard stripe band on the right, red tag
  concreteArrow: [768, 256, 256, 256],   // concrete, yellow ‹ chevrons + red stripes (path marker)
  concreteRed: [768, 512, 256, 256],     // concrete, broad red diagonal no-deploy stripes
  plateL: [0, 0, 256, 256],              // gold-framed high-ground plate: left end of a horizontal strip
  plateM: [256, 0, 256, 256],            //   middle (gold rails top & bottom only)
  plateR: [512, 0, 256, 256],            //   right end
  plateS: [768, 0, 256, 256],            //   single plate (framed on all four sides, corner bolts)
  goldSide: [0, 1664, 272, 114],         // gold ribbed panel (high-ground faces, 1 : 0.42)
  graySide: [272, 1664, 272, 82],        // grey ribbed panel (forbidden-block faces, 1 : 0.3)
  sepSide: [196, 768, 300, 160],         // dark blue-grey wall panel with a REST AREA tag (separator faces, 1 : 0.55)
  mech: [1088, 705, 304, 304],           // dark machinery hatch (grey-scale; tinted)
  slats: [1032, 477, 226, 226],          // horizontal grille slats (grey-scale)
  hatch: [556, 1788, 236, 236],          // hazard-framed glass hatch (fence line: deployable, not walkable)
  lift: [804, 1790, 234, 234],           // lift plate with ▲▼ arrows (teleport in / out)
  ringHatch: [1290, 1400, 210, 210],     // round hatch with a gold ring (protection objective)
  padReinf: [0, 1024, 512, 512],         // REINFORCEMENTS bench pad (hand slots)
  padEquip: [512, 1024, 512, 512],       // EQUIPMENTS bench pad (temp slots)
  benchRail: [0, 1538, 512, 82],         // bench edge rails (1 : 0.16)
  crateFace: [1087, 1938, 134, 108],     // orange wooden crate side with an ✕ brace
  crateFace2: [1222, 1938, 134, 108],    // the neighbouring crate panel (lid)
};
const C = {
  hazardX: [2, 2, 250, 248],             // hazard-striped plate with a steel ✕ (sealed floor)
  heal: [264, 2, 256, 250],
  shield: [538, 2, 256, 250],
  target: [2, 262, 250, 250],            // crosshair + wings (turret)
  blast: [538, 262, 250, 250],
  enemyMark: [792, 258, 232, 262],       // red shield / clock roundel (enemy gate marker)
  fast: [2, 520, 250, 250],              // ▶▶ plate (blower airflow)
};

const L = (src, rect, o = {}) => ({ src, rect, ...o });

/** material → layers (names match public/js/render/textures.js MATERIALS). */
export const MATERIALS = {
  road: [L('D', R.concrete)],
  road2: [L('D', R.concrete, { rot: 90 })],
  road3: [L('D', R.concrete, { rot: 180, bright: 0.97 })],
  roadN: [L('D', R.concrete, { rot: 270, bright: 0.93 })],
  roadN2: [L('D', R.concrete, { flipX: true, bright: 0.93 })],
  floor: [L('D', R.concreteRed)],
  floor2: [L('D', R.concreteRed, { flipX: true })],
  preview: [L('D', R.concreteStripe, { bright: 0.9 })],
  wall: [L('D', R.plateS)],
  wallL: [L('D', R.plateL)],
  wallM: [L('D', R.plateM)],
  wallR: [L('D', R.plateR)],
  // vertical strips: the horizontal pieces turned (texture top = far edge of the tile)
  wallB: [L('D', R.plateL, { rot: 270 })],
  wallVM: [L('D', R.plateM, { rot: 90 })],
  wallT: [L('D', R.plateL, { rot: 90 })],
  wallSide: [L('D', R.goldSide, { bright: 0.92 })],
  forbid: [L('D', R.concrete, { tint: '#6a7075' }), { proc: 'rim' }],
  forbid2: [L('D', R.concrete, { rot: 90, tint: '#646a6f' }), { proc: 'rim' }],
  forbidSide: [L('D', R.graySide, { tint: '#6d767b' })],
  sep: [L('D', R.slats, { tint: '#5a6266' }), { proc: 'rim' }],
  sepSide: [L('D', R.sepSide, { bright: 0.8 })],
  fence: [L('D', R.hatch)],
  start: [L('D', R.concreteArrow), L('common', C.enemyMark, { scale: 0.5, alpha: 0.85 })],
  end: [L('D', R.ringHatch), L('common', C.shield, { scale: 0.46, alpha: 0.9, tint: '#6fc3ff' })],
  telin: [L('D', R.lift)],
  telout: [L('D', R.lift, { rot: 180 })],
  hand: [L('D', R.padReinf)],
  temp: [L('D', R.padEquip)],
  benchSide: [L('D', R.benchRail)],
  benchSideTemp: [L('D', R.benchRail, { flipX: true })],
  smog: [L('D', R.slats, { tint: '#7c8589' })],
  crateSide: [L('D', R.crateFace)],
  crateTop: [L('D', R.crateFace2, { rot: 90, bright: 1.08 })],
  blowerTop: [L('D', R.mech, { tint: '#6b7478' }), L('common', C.fast, { scale: 0.92 })],
  sealed: [L('common', C.hazardX)],
  turretTop: [L('D', R.mech, { rot: 180, tint: '#737c80' }), L('common', C.target, { scale: 0.9 })],
  platformTop: [L('D', R.plateS, { bright: 1.06 })],
};

export const BACKDROP = { src: 'BG', tilesPerRepeat: 9, crop: [0, 0, 1024, 440] };

// ---- minimal PNG codec (8-bit RGB/RGBA/grey, non-interlaced — what the extractor writes) ------------------------

export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

export function decodePng(buf) {
  const { w, h } = pngSize(buf);
  let off = 8, depth = 0, ctype = 0, inter = 0, plte = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { depth = data[8]; ctype = data[9]; inter = data[12]; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || inter !== 0) throw new Error(`unsupported PNG (depth ${depth}, interlace ${inter})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error(`unsupported colour type ${ctype}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = cur[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      if (ctype === 6) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = cur[s + 3]; }
      else if (ctype === 2) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255; }
      else if (ctype === 3) { const p = cur[s] * 3; out[o] = plte[p]; out[o + 1] = plte[p + 1]; out[o + 2] = plte[p + 2]; out[o + 3] = 255; }
      else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = cur[s + 1]; }
      else { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = 255; }
    }
    cur.copy(prev);
  }
  return { w, h, rgba: out };
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Coverage / contrast of a rect: { opaque (0..1), mean (0..255), std }. */
export function rectStats(img, [x, y, w, h]) {
  let n = 0, op = 0, sum = 0, sq = 0;
  for (let yy = y; yy < y + h; yy += 2) for (let xx = x; xx < x + w; xx += 2) {
    const o = (yy * img.w + xx) * 4;
    const l = 0.299 * img.rgba[o] + 0.587 * img.rgba[o + 1] + 0.114 * img.rgba[o + 2];
    n++; if (img.rgba[o + 3] > 200) op++; sum += l; sq += l * l;
  }
  const mean = sum / n;
  return { opaque: op / n, mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

// ---- main ----------------------------------------------------------------------------------------------------

function main() {
  const problems = [];
  const source = {};
  const images = {};
  for (const [key, s] of Object.entries(SOURCES)) {
    const file = path.join(DIR, s.file);
    if (!fs.existsSync(file)) { problems.push(`missing ${path.relative(ROOT, file)}`); continue; }
    const buf = fs.readFileSync(file);
    const { w, h } = pngSize(buf);
    if (w !== s.w || h !== s.h) problems.push(`${s.file}: ${w}×${h}, expected ${s.w}×${s.h}`);
    source[key] = { path: `${URL_BASE}/${s.file}`, w, h };
    try { images[key] = decodePng(buf); } catch (err) { problems.push(`${s.file}: ${err.message}`); }
  }
  if (!source.D) {
    console.error(`[crop-board-atlas] ${problems.join('; ')} — run tools/local-extract first (the art is optional).`);
    process.exit(opt.check ? 1 : 0);
  }
  const report = [];
  for (const [name, layers] of Object.entries(MATERIALS)) {
    for (const ly of layers) {
      if (ly.proc) continue;
      const img = images[ly.src];
      const [x, y, w, h] = ly.rect;
      const S = SOURCES[ly.src];
      if (!(x >= 0 && y >= 0 && w > 8 && h > 8 && x + w <= S.w && y + h <= S.h)) { problems.push(`${name}: rect ${ly.rect} outside ${ly.src}`); continue; }
      if (!img) continue;
      const st = rectStats(img, ly.rect);
      report.push(`${name.padEnd(14)} ${ly.src.padEnd(6)} [${ly.rect.join(',')}]  opaque ${(st.opaque * 100).toFixed(0)}%  mean ${st.mean.toFixed(0)}  std ${st.std.toFixed(1)}`);
      const decal = ly !== layers[0] || ly.scale != null;
      if (!decal && st.opaque < 0.9) problems.push(`${name}: rect ${ly.rect} of ${ly.src} is ${(100 - st.opaque * 100).toFixed(0)}% transparent`);
      if (decal && st.opaque < 0.05) problems.push(`${name}: decal rect ${ly.rect} of ${ly.src} is empty`);
      if (st.std < 2) problems.push(`${name}: rect ${ly.rect} of ${ly.src} is flat (std ${st.std.toFixed(1)})`);
    }
  }
  // the 3D board's surfaces: inside their source, opaque (D) / non-empty (common decals), not flat
  for (const [name, sf] of Object.entries(BOARD3D)) {
    const S = SOURCES[sf.src];
    const [x, y, w, h] = sf.rect;
    if (!S || !(x >= 0 && y >= 0 && w > 8 && h > 8 && x + w <= S.w && y + h <= S.h)) { problems.push(`board3d ${name}: rect ${sf.rect} outside ${sf.src}`); continue; }
    const img = images[sf.src];
    if (!img) continue;
    const st = rectStats(img, sf.rect);
    report.push(`3d ${name.padEnd(12)} ${sf.src.padEnd(6)} [${sf.rect.join(',')}]  opaque ${(st.opaque * 100).toFixed(0)}%  mean ${st.mean.toFixed(0)}  std ${st.std.toFixed(1)}`);
    if (sf.src === 'D' && st.opaque < 0.9) problems.push(`board3d ${name}: rect ${sf.rect} is ${(100 - st.opaque * 100).toFixed(0)}% transparent`);
    if (sf.src === 'common' && st.opaque < 0.05) problems.push(`board3d ${name}: decal rect ${sf.rect} is empty`);
    if (st.std < 2) problems.push(`board3d ${name}: rect ${sf.rect} is flat (std ${st.std.toFixed(1)})`);
  }
  console.log(report.join('\n'));
  if (problems.length) console.warn('[crop-board-atlas] problems:\n  ' + problems.join('\n  '));
  if (opt.check) process.exit(problems.length ? 1 : 0);

  const board3d = Object.fromEntries(Object.entries(BOARD3D).map(([k, v]) => [k, { ...v, rect: [...v.rect] }]));
  const out = { version: 2, generatedBy: 'tools/crop-board-atlas.mjs', cell: 256, source, materials: MATERIALS, backdrop: source.BG ? BACKDROP : null, board3d };
  const file = path.join(DIR, 'tiles.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  console.log(`wrote ${path.relative(ROOT, file)} (${Object.keys(MATERIALS).length} materials, ${Object.keys(board3d).length} 3D surfaces)`);

  if (typeof opt.preview === 'string') {
    // contact sheet: every material's first layer, nearest-neighbour scaled into 128 px cells (no rotation)
    const names = Object.keys(MATERIALS), cols = 8, S = 128;
    const W = cols * S, H = Math.ceil(names.length / cols) * S;
    const sheet = Buffer.alloc(W * H * 4, 0);
    names.forEach((n, i) => {
      const ly = MATERIALS[n][0], img = images[ly.src];
      if (!img || !ly.rect) return;
      const [x, y, w, h] = ly.rect, ox = (i % cols) * S, oy = Math.floor(i / cols) * S;
      for (let yy = 2; yy < S - 2; yy++) for (let xx = 2; xx < S - 2; xx++) {
        const sx = x + Math.floor(((xx - 2) / (S - 4)) * w), sy = y + Math.floor(((yy - 2) / (S - 4)) * h);
        const so = (sy * img.w + sx) * 4, dO = ((oy + yy) * W + ox + xx) * 4;
        img.rgba.copy(sheet, dO, so, so + 4);
      }
    });
    fs.writeFileSync(path.resolve(opt.preview), encodePng(W, H, sheet));
    console.log(`preview → ${opt.preview}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('crop-board-atlas.mjs')) main();
