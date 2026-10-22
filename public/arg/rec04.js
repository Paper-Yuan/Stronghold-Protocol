import { REC04, REC01, REC02, REC03 } from './puzzle-data.js';

/* ══ REC 04 · 景深 · 密钥浮现 · 罗德岛图腾 · 汇聚成字 ══ */

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
addEventListener('resize', () => { resize(); });

function sample(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/* ── 采样任意离屏绘制 → 点集 ── */
function samplePixels(drawFn, count, w, h, stepX = 3, stepY = 3) {
  const oc = document.createElement('canvas');
  oc.width = w; oc.height = h;
  const o = oc.getContext('2d');
  drawFn(o, w, h);
  const img = o.getImageData(0, 0, w, h).data;
  const pts = [];
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      if (img[(y * w + x) * 4 + 3] > 128) pts.push([x, y]);
    }
  }
  if (!pts.length) return null;
  const pool = sample(pts, pts.length);
  const out = [];
  for (let i = 0; i < count; i++) out.push(pool[i % pool.length]);
  return out;
}

/* 文字目标 */
function textPoints(count, w, h) {
  return samplePixels((o, cw, ch) => {
    o.fillStyle = '#fff';
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    const s1 = Math.min(cw * 0.062, ch * 0.075);
    const s2 = s1 * 0.62;
    const cx = cw / 2, cy = ch / 2;
    o.font = '400 ' + Math.round(s1) + "px 'AcuminReg','Noto Sans SC',sans-serif";
    o.fillText(REC04.lines[0], cx, cy - s1 * 0.78);
    o.font = '400 ' + Math.round(s2) + "px 'AcuminReg','Noto Sans SC',sans-serif";
    o.fillText(REC04.lines[1], cx, cy + s1 * 0.72);
  }, count, w, h, 3, 3);
}

/* 罗德岛图标目标（用图片） */
let logoImg = null;
async function loadLogo() {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => { logoImg = im; res(im); };
    im.onerror = () => res(null);
    im.src = '/assets/ui/campLogo/logo_rhodes.png';
  });
}
function logoPoints(count, w, h) {
  if (!logoImg) return null;
  // 采样步长 2px，保证点足够多，粒子能均匀覆盖整个徽记
  return samplePixels((o, cw, ch) => {
    const ih = ch * 0.52;
    const iw = ih * (logoImg.width / logoImg.height);
    o.drawImage(logoImg, cw / 2 - iw / 2, ch / 2 - ih / 2, iw, ih);
  }, count, w, h, 2, 2);
}

/* 网格布点（不重叠） */
function spreadStarts(count, w, h) {
  const cols = Math.ceil(Math.sqrt(count * (w / h)));
  const rows = Math.ceil(count / cols);
  const cw = w / cols, ch = h / rows;
  const out = [];
  let k = 0;
  for (let r = 0; r < rows && k < count; r++) {
    for (let c = 0; c < cols && k < count; c++) {
      out.push([
        (c + 0.5) * cw + (Math.random() - 0.5) * cw * 0.62,
        (r + 0.5) * ch + (Math.random() - 0.5) * ch * 0.62,
      ]);
      k++;
    }
  }
  return sample(out, out.length);
}

/* ── 密钥序列：00 / 01 / 02 / 03 的所有答案 ── */
function keysOf() {
  const out = ['ALL DOCTOR', 'PAPERYUAN'];
  for (const f of (REC01?.frags || [])) out.push(f.answer);
  for (const f of (REC02?.frags || [])) out.push(f.answer);
  for (const g of (REC03?.ids || [])) out.push(g.answer);
  return out;
}

let particles = [];
let ready = false;

async function load() {
  try { await document.fonts.ready; } catch {}
  await loadLogo();

  let all = [];
  try {
    const r = await fetch('/arg/qq-names.json', { cache: 'no-store' });
    all = await r.json();
  } catch { all = []; }
  if (!Array.isArray(all) || all.length === 0) all = ['博士'];

  const N = REC04.count;
  const picked = sample(all, N);
  const starts = spreadStarts(N, W, H);
  const textT = textPoints(N, Math.round(W), Math.round(H)) || starts;
  const logoT = logoPoints(N, Math.round(W), Math.round(H)) || starts;

  // 分批：4 批
  const BATCH = 4;
  particles = picked.map((name, i) => {
    const [sx, sy] = starts[i];
    return {
      name,
      sx, sy, x: sx, y: sy,
      lx: logoT[i][0], ly: logoT[i][1],      // 罗德岛图标目标
      tx: textT[i][0], ty: textT[i][1],      // 文字目标
      size: 11 + Math.random() * 4,
      depth: 0.55 + Math.random() * 0.9,     // 景深系数（影响大小/透明度/速度）
      batch: Math.floor(i / Math.ceil(N / BATCH)),  // 第几批
      drift: Math.random() * Math.PI * 2,
      driftSpeed: 0.0004 + Math.random() * 0.0008,
      wobble: 0.5 + Math.random() * 1.3,
      turn: Math.random() * 0.35,
    };
  });
  ready = true;
}

/* ── 时间轴 ── */
const T = {
  KEYS: 0,          // 00010203 密钥依次浮现
  KEYS_END: 2600,
  BATCH_START: 2600,   // 200 ID 分批浮现
  BATCH_SPAN: 4200,    // 四批铺开
  GATHER: 7600,        // 汇聚到罗德岛
  LOGO_END: 10600,
  REFORM: 11200,       // 重聚到文字
  TEXT_END: 14200,
  TEXT_IN: 13300,
  FOOT: 15600,
};

const keys = keysOf();
const keyEls = [];

function buildKeys() {
  const box = document.createElement('div');
  box.className = 'keylayer';
  box.id = 'keylayer';
  // 只取前 24 条，避免太多
  keys.slice(0, 24).forEach((k, i) => {
    const el = document.createElement('span');
    el.className = 'keyline';
    el.textContent = k;
    el.style.setProperty('--i', i);
    box.appendChild(el);
    keyEls.push(el);
  });
  document.body.appendChild(box);
}

let start = 0;
let skipped = false;

function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function frame(now) {
  const t = skipped ? 1e9 : now - start;
  ctx.clearRect(0, 0, W, H);

  if (ready) {
    // 汇聚阶段 1：→ 罗德岛
    const gL = ease(clamp01((t - T.GATHER) / (T.LOGO_END - T.GATHER)));
    // 重聚阶段 2：→ 文字
    const gT = ease(clamp01((t - T.REFORM) / (T.TEXT_END - T.REFORM)));

    for (const pt of particles) {
      // 分批浮现
      const batchStart = T.BATCH_START + pt.batch * (T.BATCH_SPAN / 4);
      const appear = clamp01((t - batchStart) / 420);
      if (appear <= 0) continue;

      // 漂移
      pt.drift += pt.driftSpeed;
      const wob = 8 * pt.wobble * (1 - Math.max(gL, gT));

      // 位置：起点 → 罗德岛 → 文字
      const px = pt.sx + (pt.lx - pt.sx) * gL + (pt.tx - pt.lx) * gT;
      const py = pt.sy + (pt.ly - pt.sy) * gL + (pt.ty - pt.ly) * gT;
      pt.x = px + Math.sin(pt.drift) * wob;
      pt.y = py + Math.cos(pt.drift * 0.8) * wob;

      // 景深：远的更淡；图标成形时粒子淡出（让真实图标接管）
      const iconFade = clamp01((gL - 0.55) / 0.4);     // 0.55→0.95 之间粒子消失
      const a = appear * (0.35 + 0.65 * (pt.depth - 0.55) / 0.9) * (1 - iconFade);
      ctx.globalAlpha = Math.min(1, a);

      // 图标成形度：0 → 昵称，1 → 光点
      // gL > 0.35 后开始收成点；gT（重聚到文字）阶段保持点，最后融进字
      const dotness = clamp01((gL - 0.32) / 0.55);

      if (dotness > 0.5) {
        // 光点模式：每个粒子一个精确的点（不撒开，保证轮廓锐利）
        const r = (1.5 + pt.depth * 1.2) * (1 - gT * 0.7);
        if (r < 0.3) continue;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      } else {
        // 昵称模式
        const size = pt.size * pt.depth * (1 - dotness * 0.5);
        if (size < 0.6) continue;
        ctx.font = '400 ' + size.toFixed(1) + "px 'AcuminReg','Noto Sans SC',sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(pt.name, pt.x, pt.y);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ── 真实图标：粒子聚拢后由图片精确接管，做到「完全和图一样」 ── */
  if (logoImg && ready) {
    const t2 = skipped ? 1e9 : now - start;
    const gL2 = clamp01((t2 - T.GATHER) / (T.LOGO_END - T.GATHER));
    const gT2 = clamp01((t2 - T.REFORM) / (T.TEXT_END - T.REFORM));
    // 图标透明度：0.45→0.8 渐显；重聚开始后渐隐
    const ia = clamp01((gL2 - 0.45) / 0.35) * (1 - clamp01(gT2 / 0.5));
    if (ia > 0.005) {
      const ih = H * 0.52;
      const iw = ih * (logoImg.width / logoImg.height);
      // 轻微放大入场
      const scale = 0.94 + 0.06 * clamp01(gL2);
      ctx.save();
      ctx.globalAlpha = ia;
      ctx.drawImage(
        logoImg,
        W / 2 - (iw * scale) / 2,
        H / 2 - (ih * scale) / 2,
        iw * scale,
        ih * scale
      );
      ctx.restore();
    }
  }

  // 密钥层淡出
  if (keyEls.length && t > T.KEYS_END - 500) {
    const box = document.getElementById('keylayer');
    if (box) box.style.opacity = '0';
  }

  if (t >= T.TEXT_IN) {
    endmsg.classList.add('is-on');
    if (!l1.textContent) { l1.textContent = REC04.lines[0]; l2.textContent = REC04.lines[1]; }
  }
  if (t >= T.FOOT) {
    endfoot.classList.add('is-on');
    skipBtn.classList.add('is-gone');
  }
  requestAnimationFrame(frame);
}

skipBtn.addEventListener('click', () => {
  skipped = true;
  document.getElementById('keylayer')?.remove();
  l1.textContent = REC04.lines[0];
  l2.textContent = REC04.lines[1];
  endmsg.classList.add('is-on');
  endfoot.classList.add('is-on');
  skipBtn.classList.add('is-gone');
});

/* BGM：尝试自动播放，失败则等首次交互 */
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
  l1.textContent = '';
  l2.textContent = '';
  start = performance.now();
  requestAnimationFrame(frame);
});
