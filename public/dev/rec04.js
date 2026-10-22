import { REC04, REC01, REC02, REC03 } from './puzzle-data.js';

/* ══ REC 04 · 密钥浮现 · 200 ID 分批 · 聚成点阵罗德岛 · 重聚成字 ══ */

const cv = document.getElementById('stars');
const ctx = cv.getContext('2d');
const l1 = document.getElementById('l1');
const l2 = document.getElementById('l2');
const endmsg = document.getElementById('endmsg');
const endfoot = document.getElementById('endfoot');
const skipBtn = document.getElementById('skip');

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
resize();

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function sample(arr, n) { return shuffle(arr).slice(0, n); }

/* ── 图标 → 点阵（精确到像素） ── */
let logoImg = null;
async function loadLogo() {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => { logoImg = im; res(im); };
    im.onerror = () => res(null);
    im.src = '/assets/ui/campLogo/logo_rhodes.png';
  });
}

/**
 * 把图标采样成点阵（步长 2px）。
 * 每个点：{x, y} 屏幕坐标。数量约 2000-5000。
 */
function logoDotGrid(w, h, stepX = 2, stepY = 2) {
  if (!logoImg) return [];
  const oc = document.createElement('canvas');
  oc.width = w; oc.height = h;
  const o = oc.getContext('2d');
  const ih = h * 0.56;
  const iw = ih * (logoImg.width / logoImg.height);
  o.drawImage(logoImg, w / 2 - iw / 2, h / 2 - ih / 2, iw, ih);

  const img = o.getImageData(0, 0, w, h).data;
  const pts = [];
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const i4 = (y * w + x) * 4;
      const a = img[i4 + 3];
      if (a < 100) continue;              // 透明跳过
      // logo_rhodes.png 是黑底白图：只取「亮色」像素（塔身/文字/边框）
      const lum = (img[i4] * 0.299 + img[i4 + 1] * 0.587 + img[i4 + 2] * 0.114);
      if (lum < 128) continue;            // 暗色背景跳过
      pts.push([x, y]);
    }
  }
  return pts;
}

/* ── 文字 → 点阵 ── */
function textDotGrid(w, h, stepX = 3, stepY = 3) {
  const oc = document.createElement('canvas');
  oc.width = w; oc.height = h;
  const o = oc.getContext('2d');
  o.fillStyle = '#fff';
  o.textAlign = 'center';
  o.textBaseline = 'middle';
  const s1 = Math.min(w * 0.062, h * 0.075);
  const s2 = s1 * 0.62;
  const cx = w / 2, cy = h / 2;
  o.font = '400 ' + Math.round(s1) + "px 'AcuminReg','Noto Sans SC',sans-serif";
  o.fillText(REC04.lines[0], cx, cy - s1 * 0.78);
  o.font = '400 ' + Math.round(s2) + "px 'AcuminReg','Noto Sans SC',sans-serif";
  o.fillText(REC04.lines[1], cx, cy + s1 * 0.72);

  const img = o.getImageData(0, 0, w, h).data;
  const pts = [];
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      if (img[(y * w + x) * 4 + 3] > 128) pts.push([x, y]);
    }
  }
  return pts;
}

/* ── 网格布点（不重叠，用于 ID 起始位置） ── */
function spreadStarts(count, w, h) {
  const cols = Math.ceil(Math.sqrt(count * (w / h)));
  const rows = Math.ceil(count / cols);
  const cw = w / cols, ch = h / rows;
  const out = [];
  let k = 0;
  for (let r = 0; r < rows && k < count; r++) {
    for (let c = 0; c < cols && k < count; c++) {
      out.push([
        (c + 0.5) * cw + (Math.random() - 0.5) * cw * 0.6,
        (r + 0.5) * ch + (Math.random() - 0.5) * ch * 0.6,
      ]);
      k++;
    }
  }
  return shuffle(out);
}

/* ── 密钥列表 ── */
function keysOf() {
  const out = ['ALL DOCTOR', 'PAPERYUAN'];
  for (const f of (REC01?.frags || [])) out.push(f.answer);
  for (const f of (REC02?.frags || [])) out.push(f.answer);
  for (const g of (REC03?.ids || [])) out.push(g.answer);
  return out;
}

let particles = [];      // 200 个 ID
let logoDots = [];       // 罗德岛点阵
let textDots = [];       // 文字点阵
let ready = false;

async function load() {
  try { await document.fonts.ready; } catch {}
  await loadLogo();

  let all = [];
  try {
    const r = await fetch('/dev/qq-names.json', { cache: 'no-store' });
    all = await r.json();
  } catch { all = []; }
  if (!Array.isArray(all) || all.length === 0) all = ['博士'];

  const N = REC04.count;
  const picked = sample(all, N);
  const starts = spreadStarts(N, W, H);

  // 点阵：图标 + 文字
  logoDots = logoDotGrid(Math.round(W), Math.round(H), 2, 2);
  textDots = textDotGrid(Math.round(W), Math.round(H), 3, 3);

  // 把徽记点阵按顺序切给 200 个 ID（连续切片，保证空间聚拢）
  const per = Math.ceil(logoDots.length / N);
  particles = picked.map((name, i) => {
    const [sx, sy] = starts[i];
    // 该 ID 负责的徽记点（连续一段 → 空间上靠在一起）
    const mine = logoDots.slice(i * per, (i + 1) * per);
    return {
      name,
      sx, sy, x: sx, y: sy,
      dots: mine,                                  // 它要变成的点
      // 它飞向的目标 = 自己那片点的质心
      gx: mine.length ? mine.reduce((a, d) => a + d[0], 0) / mine.length : sx,
      gy: mine.length ? mine.reduce((a, d) => a + d[1], 0) / mine.length : sy,
      size: 11 + Math.random() * 4,
      depth: 0.55 + Math.random() * 0.85,
      batch: Math.floor(i / Math.ceil(N / 4)),
      drift: Math.random() * Math.PI * 2,
      driftSpeed: 0.0004 + Math.random() * 0.0009,
      wobble: 0.5 + Math.random() * 1.2,
    };
  });
  ready = true;
}

/* ── 时间轴 ── */
const T = {
  KEYS_END: 2400,
  BATCH_START: 2400,
  BATCH_SPAN: 3600,
  GATHER: 6400,       // ID → 点阵罗德岛
  LOGO_FULL: 9400,    // 点阵完全成形
  HOLD: 11200,        // 保持
  REFORM: 11800,      // 点阵 → 文字
  TEXT_FULL: 14600,
  TEXT_IN: 13600,
  FOOT: 16000,
};

const keys = keysOf();
let start = 0;
let skipped = false;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

function buildKeys() {
  const box = document.createElement('div');
  box.className = 'keylayer';
  box.id = 'keylayer';
  keys.slice(0, 26).forEach((k, i) => {
    const el = document.createElement('span');
    el.className = 'keyline';
    el.textContent = k;
    el.style.setProperty('--i', i);
    box.appendChild(el);
  });
  document.body.appendChild(box);
}

/* 背景三角网格（参考图的暗色分割线） */
function drawGrid() {
  const sz = Math.max(W, H) / 3.2;
  ctx.strokeStyle = 'rgba(255,255,255,0.028)';
  ctx.lineWidth = 1;
  const rows = Math.ceil(H / sz) + 2;
  const cols = Math.ceil(W / sz) + 2;
  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      const x = c * sz, y = r * sz;
      // 正方形
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + sz, y);
      ctx.lineTo(x + sz, y + sz); ctx.lineTo(x, y + sz);
      ctx.closePath();
      ctx.stroke();
      // 对角线
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + sz, y + sz);
      ctx.moveTo(x + sz, y); ctx.lineTo(x, y + sz);
      ctx.stroke();
    }
  }
}

function frame(now) {
  const t = skipped ? 1e9 : now - start;
  ctx.clearRect(0, 0, W, H);
  drawGrid();

  if (ready) {
    /* ── 阶段一 + 二：ID 飞向自己那片徽记点，途中逐渐化作点 ── */
    const gL = ease(clamp01((t - T.GATHER) / (T.LOGO_FULL - T.GATHER)));
    const gT = ease(clamp01((t - T.REFORM) / (T.TEXT_FULL - T.REFORM)));
    const tNow = t;

    for (const pt of particles) {
      const batchStart = T.BATCH_START + pt.batch * (T.BATCH_SPAN / 4);
      const appear = clamp01((t - batchStart) / 400);
      if (appear <= 0) continue;

      pt.drift += pt.driftSpeed;

      // 位置：起点 → 自己那片点的质心
      const wob = 7 * pt.wobble * (1 - gL);
      const cx = pt.sx + (pt.gx - pt.sx) * gL + Math.sin(pt.drift) * wob;
      const cy = pt.sy + (pt.gy - pt.sy) * gL + Math.cos(pt.drift * 0.8) * wob;

      // 字号：随 gL 收缩到 0（「化作点」）
      const size = pt.size * pt.depth * Math.max(0, 1 - gL * 1.35);
      const idAlpha = clamp01(1 - gL * 1.6);

      if (idAlpha > 0.02 && size > 0.7) {
        ctx.globalAlpha = Math.min(1, appear * idAlpha * (0.4 + 0.6 * (pt.depth - 0.55) / 0.85));
        ctx.font = '400 ' + size.toFixed(1) + "px 'AcuminReg','Noto Sans SC',sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(pt.name, cx, cy);
      }

      // 该 ID 负责的点：从 ID 位置「炸开」到自己位置
      // 分解进度：gL 0.35 → 1
      const spread = clamp01((gL - 0.30) / 0.55);
      if (spread > 0 && pt.dots.length) {
        ctx.fillStyle = '#ffffff';
        for (let k = 0; k < pt.dots.length; k++) {
          const [dx, dy] = pt.dots[k];
          // 起点：ID 当前位置 + 微小随机偏移
          const ox = cx + (Math.random() - 0.5) * 6;
          const oy = cy + (Math.random() - 0.5) * 6;
          // 用 k 做确定性偏移（避免每帧跳动）
          const ang = (k * 2.399963) % (Math.PI * 2);
          const rad = 4 + (k % 5) * 1.6;
          const sx0 = cx + Math.cos(ang) * rad;
          const sy0 = cy + Math.sin(ang) * rad;

          // 重聚到文字
          const td = textDots[k % textDots.length] || [dx, dy];
          const finalX = dx + (td[0] - dx) * gT;
          const finalY = dy + (td[1] - dy) * gT;

          const px = sx0 + (finalX - sx0) * spread;
          const py = sy0 + (finalY - sy0) * spread;

          const seed = (dx * 7919 + dy * 104729) % 1000;
          const bright = 0.32 + ((seed * 9301 + 49297) % 233280) / 233280 * 0.68;
          const twinkle = 0.85 + 0.15 * Math.sin(tNow / 900 + seed);
          const s = 0.85 + (seed % 7) * 0.075;

          ctx.globalAlpha = spread * bright * twinkle * (1 - clamp01(gT * 0.9));
          ctx.beginPath();
          ctx.arc(px, py, s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;

    // 文字出现
    if (gT > 0.75) {
      const ta = clamp01((gT - 0.75) / 0.25);
      ctx.globalAlpha = ta;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const s1 = Math.min(W * 0.062, H * 0.075);
      const s2 = s1 * 0.62;
      ctx.font = '400 ' + Math.round(s1) + "px 'AcuminReg','Noto Sans SC',sans-serif";
      ctx.fillText(REC04.lines[0], W / 2, H / 2 - s1 * 0.78);
      ctx.font = '400 ' + Math.round(s2) + "px 'AcuminReg','Noto Sans SC',sans-serif";
      ctx.fillText(REC04.lines[1], W / 2, H / 2 + s1 * 0.72);
      ctx.globalAlpha = 1;
    }
  }

  if (t > T.KEYS_END - 400) {
    const box = document.getElementById('keylayer');
    if (box) box.style.opacity = '0';
  }
  if (t >= T.TEXT_IN) endfoot.classList.add('is-on') === false;
  if (t >= T.FOOT) {
    endfoot.classList.add('is-on');
    skipBtn.classList.add('is-gone');
  }
  requestAnimationFrame(frame);
}

skipBtn.addEventListener('click', () => {
  skipped = true;
  document.getElementById('keylayer')?.remove();
  endfoot.classList.add('is-on');
  skipBtn.classList.add('is-gone');
  ctx.clearRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const s1 = Math.min(W * 0.062, H * 0.075);
  const s2 = s1 * 0.62;
  ctx.font = '400 ' + Math.round(s1) + "px 'AcuminReg','Noto Sans SC',sans-serif";
  ctx.fillText(REC04.lines[0], W / 2, H / 2 - s1 * 0.78);
  ctx.font = '400 ' + Math.round(s2) + "px 'AcuminReg','Noto Sans SC',sans-serif";
  ctx.fillText(REC04.lines[1], W / 2, H / 2 + s1 * 0.72);
});

/* BGM */
const bgm = document.getElementById('bgm');
if (bgm) {
  bgm.volume = 0.55;
  const tryPlay = () => bgm.play().catch(() => {});
  tryPlay();
  const kick = () => { tryPlay(); removeEventListener('pointerdown', kick); removeEventListener('keydown', kick); };
  addEventListener('pointerdown', kick);
  addEventListener('keydown', kick);
}

buildKeys();
load().then(() => {
  start = performance.now();
  requestAnimationFrame(frame);
});
