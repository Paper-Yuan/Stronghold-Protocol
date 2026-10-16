// 颂乐人偶 —— 工坊包 ave-mujica 的客户端面板（`pack.json.client.panels[]`）。
//
// 作用：在对局战场上，给每一名**在场**的【颂乐人偶】干员、贴一个「连音符」样式的 **Fever 积攒进度**图标
// （半透明黑底剪影 + 品红自下而上填充；触发 Fever 后 Fever 清零 ⇒ 图标同步清空）。
// 图标本身用业主给的两张 PNG（`assets/ui/fever_note_{empty,full}.png`），见下面「连音符图标」一节。
//
// 三件事都**不需要**引擎为它新增扩展点：
//   * **数据**：`battle/main.mjs`（本包的 `server.battle` 模块，客户端战斗时也在浏览器里跑）把每名玩家当前的
//     `{ fever, cap, on, until }` 写进模块级表 `FEVER_LIVE`。面板从 `battleRunner.currentBattle().spec.workshopBattle`
//     里取到那条**同 URL**（`/workshop-battle/ave-mujica/battle/main.mjs?v=<hash>`）再 `import()` —— ES module 按 URL
//     去重，拿到的就是运行器加载的**同一个实例**，于是读得到那张表。
//   * **谁在场上**：本包另声明一条 `game.hud.topBar` 的**组件改写**，把顶栏 props 里的 `pub` / `priv` / `myId`
//     抄进本模块（顶栏每帧都有最新的一份），再对照只读的 `chess` 表筛出棋盘上带 `aveMujica` 盟约的棋子。
//   * **贴在哪**：引擎的战场视图（`globalThis.__SP_VIEW__`，fieldHost 挂载时写入）给了 `tileScreen(row, col)` ——
//     把一枚棋子所在的 **board 格子**映射成屏幕上的位置与大小（`public/js/render/app.js`）。用格子、不用
//     `pieceScreenRect(uid)`：后者解析不了战斗单位（实测两枚在不同格上的棋子会返回**同一个**身体矩形 ⇒ 图标全叠一处）；
//     面板用 `position: fixed` 把图标贴到该格的**右下角**（干员模型右下方，尺寸/偏移都按「一格在屏幕上的高度」缩放）。

import { h, Fragment } from 'preact';
import { useEffect } from 'preact/hooks';
import htm from 'htm';
import { battleRunner } from '/js/battle/runner.js';

const html = htm.bind(h);

const CLS = 'amfv';
const PACK_ID = 'ave-mujica';
const BOND_ID = 'aveMujica';
/**
 * 图标相对**所在格子**的摆法（都以「一格在屏幕上的高度」为单位，随镜头缩放/远景自适应）：
 * 贴在干员模型的**右下角** —— 水平在身体右缘外侧、竖直落在脚下（业主 2026-10-13 用红框标的位置）。
 * 干员身体大约高 1.45 格、宽 0.8 格、脚底在格中心下方约 0.12 格。
 */
const ANCHOR_RIGHT = 0.43;  // 格中心 → 图标**左缘**的距离（格高倍数，向右）
const ANCHOR_BOTTOM = 0.12; // 格中心 → 图标**底缘**的距离（格高倍数，向下 ≈ 脚底）
const SIZE_RATIO = 0.44;    // 图标边长 = 格高 × 该比例，并夹在 [16, 32]

/** 面板的模块级表（同一槽位只有一个实例）。 */
const state = {
  feed: { priv: null, myId: null },
  data: null,
  root: null,
  els: new Map(), // uid -> { box, fill }
  raf: 0,
  mods: new Map(), // url -> Promise<module|null>
};

/**
 * 不画任何东西的数据喂食器：把顶栏这一帧的 `priv` / `myId` 抄进模块级表（面板每帧的 rAF 循环直接读它）。
 * @param {{ pub?: any, priv?: any, myId?: any }} props
 */
function Feed({ pub, priv, myId }) {
  useEffect(() => {
    state.feed.priv = priv ?? null;
    state.feed.myId = myId ?? null;
  });
  return null;
}

/**
 * 改写工厂：引擎那一份原样返回，旁边挂一个不画东西的数据喂食器（`game.hud.topBar` 每帧都有 `pub`/`priv`/`myId`）。
 * @param {{ component: string, props: any }} ctx
 * @returns {(orig: any) => any}
 */
export function wrap(ctx) {
  const { pub, priv, myId } = ctx.props || {};
  return (orig) => html`<${Fragment}>${orig}<${Feed} pub=${pub} priv=${priv} myId=${myId} /></${Fragment}>`;
}

// ---- 连音符图标（用业主给的两张 PNG：空态 = 半透明黑底剪影，满态 = 实心品红剪影）----------------------------------

/**
 * 两张素材都是**同一枚实心连音符剪影**、同尺寸且像素级对齐（业主在 500×500 同 bbox 上做的），所以实现是
 * 「把满态那张按 Fever 比例**从下往上切一条**，叠在空态那张上」——比用 SVG 描形状更忠实于他的稿：
 *   * `fever_note_empty.png`：黑、`alpha=72/255` 的半透明底；
 *   * `fever_note_full.png`：实心 `rgb(235,63,116)`。
 * 素材走 `/workshop-assets/<pack>/<rel>`（服务端把包内 `assets/` 下的任意文件按扩展名放行）。
 */
const ART_BASE = `/workshop-assets/${PACK_ID}/ui/`;
const ART_EMPTY = `${ART_BASE}fever_note_empty.png`;
const ART_FULL = `${ART_BASE}fever_note_full.png`;

/** 建 / 取某个 uid 的图标元素（建一次，之后只改进度）。 */
function elementFor(uid) {
  let e = state.els.get(uid);
  if (e) return e;
  const box = document.createElement('div');
  box.className = CLS;
  box.setAttribute('aria-hidden', 'true');
  // 空态（半透明黑底剪影）在下、满态的**下缘切片**在上：切片靠一个 overflow:hidden 的壳从底部对齐
  box.innerHTML = `<img class="${CLS}__plate" src="${ART_EMPTY}" alt="">`
    + `<div class="${CLS}__fillwrap"><img class="${CLS}__full" src="${ART_FULL}" alt=""></div>`;
  state.root.appendChild(box);
  e = { box, fillwrap: box.querySelector(`.${CLS}__fillwrap`) };
  state.els.set(uid, e);
  return e;
}

function hide(e) { if (e && e.box.style.display !== 'none') e.box.style.display = 'none'; }

// ---- 每帧：定位 + 填进度 ------------------------------------------------------------------------------------

/**
 * 取本包战斗模块的**同一实例**（按 URL 去重；与运行器 `import()` 的是同一条 URL ⇒ 同一个模块实例）。
 *
 * `paint()` 是同步的（rAF 回调），所以 `import()` 只**发起一次**、把 Promise 的结果落进记录里；
 * 解析完成之后的帧才读得到 `FEVER_LIVE`（之前先当作「还没到」，`paint` 会因此不画）。
 * @param {string} url
 * @returns {any|null} 已解析的模块，或 null（尚未解析完 / 加载失败 / 没有 url）
 */
function liveModule(url) {
  if (!url) return null;
  let rec = state.mods.get(url);
  if (!rec) {
    rec = { mod: null, ready: false };
    state.mods.set(url, rec);
    import(/* @vite-ignore */ url).then((m) => { rec.mod = m; rec.ready = true; }, () => { rec.ready = true; });
  }
  return rec.ready ? rec.mod : null;
}

/** 本机当前这一场的战斗模块 URL（来自 spec；没有战斗 / 没有本包 ⇒ null）。 */
function battleModuleUrl() {
  if (!battleRunner || typeof battleRunner.currentBattle !== 'function') return null;
  const b = battleRunner.currentBattle();
  const list = b && b.spec && Array.isArray(b.spec.workshopBattle) ? b.spec.workshopBattle : null;
  const entry = list ? list.find((m) => m && m.id === PACK_ID) : null;
  return entry && typeof entry.url === 'string' ? entry.url : null;
}

/** 棋盘上带【颂乐人偶】盟约的本机棋子：`{ uid, row, col }`。 */
function members() {
  const priv = state.feed.priv;
  const board = priv && Array.isArray(priv.board) ? priv.board : null;
  if (!board || !state.data) return [];
  const chess = state.data.get('chess');
  if (!chess) return [];
  const out = [];
  for (const p of board) {
    if (!p || p.kind !== 'chess' || !Number.isInteger(p.uid)) continue;
    const rec = chess[p.id];
    if (rec && Array.isArray(rec.bonds) && rec.bonds.includes(BOND_ID)) out.push({ uid: p.uid, row: p.row, col: p.col });
  }
  return out;
}

/**
 * 一枚棋子在屏幕上的锚点（视口坐标）+ 该处一格在屏幕上的高度（用来定图标大小/偏移）。
 *
 * **优先用所在格里子的屏幕位置** `view.tileScreen(row, col)`：单位在战斗里就站在它的 board 格上，格子是**逐棋子**的。
 * 不用 `view.pieceScreenRect(uid)` —— 实测它解析不了战斗单位（两枚在不同格上的棋子会返回**同一个**身体矩形 ⇒
 * 图标全叠在一处）；它只作为没有 `tileScreen` 时的兜底。
 * @param {any} raw 战场视图（`view.raw`）
 * @param {{ uid: number, row?: number, col?: number }} m
 * @returns {{ x: number, y: number, h: number }|null}
 */
function anchorOf(raw, m) {
  if (typeof raw.tileScreen === 'function' && Number.isInteger(m.row) && Number.isInteger(m.col)) {
    let ts = null;
    try { ts = raw.tileScreen(m.row, m.col); } catch { ts = null; }
    if (ts && Number.isFinite(ts.x) && Number.isFinite(ts.y)) {
      const p = Array.isArray(ts.poly) && ts.poly.length >= 4 ? ts.poly : null;
      const h = p ? Math.hypot(p[0][0] - p[3][0], p[0][1] - p[3][1]) : (Number(ts.s) || 60);
      return { x: ts.x, y: ts.y, h: h || 60 };
    }
  }
  if (typeof raw.pieceScreenRect === 'function') {
    let r = null;
    try { r = raw.pieceScreenRect(m.uid); } catch { r = null; }
    if (r && r.width > 0 && r.height > 0) {
      return { x: (r.left + r.right) / 2, y: r.top + r.height, h: r.height * 0.6 };
    }
  }
  return null;
}

function paint() {
  const root = state.root;
  if (!root) return;
  const view = globalThis.__SP_VIEW__;
  const raw = (view && view.raw) || view || null;
  const canAnchor = !!raw && (typeof raw.tileScreen === 'function' || typeof raw.pieceScreenRect === 'function');
  const url = canAnchor ? battleModuleUrl() : null;
  const mod = url ? liveModule(url) : null;

  // 没在战斗 / 没视图 / 本包战斗模块还没到 ⇒ 全部收起（不清表：等下一次条件满足再画）
  const live = canAnchor && mod && mod.FEVER_LIVE && state.feed.myId != null
    ? mod.FEVER_LIVE.byPid[state.feed.myId] : null;
  if (!canAnchor || !live) { for (const e of state.els.values()) hide(e); return; }

  const list = members();
  const want = new Set(list.map((m) => m.uid));
  for (const [uid, e] of state.els) if (!want.has(uid)) { e.box.remove(); state.els.delete(uid); }

  const cap = Number(live.cap) > 0 ? Number(live.cap) : 450;
  const ratio = Math.max(0, Math.min(1, (Number(live.fever) || 0) / cap));
  for (const m of list) {
    const a = anchorOf(raw, m);
    if (!a || !(a.h > 0)) { const e = state.els.get(m.uid); if (e) hide(e); continue; }
    const size = Math.max(16, Math.min(32, Math.round(a.h * SIZE_RATIO)));
    const e = elementFor(m.uid);
    e.box.style.display = '';
    e.box.style.width = `${size}px`;
    e.box.style.height = `${size}px`;
    e.box.style.left = `${Math.round(a.x + a.h * ANCHOR_RIGHT)}px`;
    e.box.style.top = `${Math.round(a.y + a.h * ANCHOR_BOTTOM - size)}px`;
    // 满态切片：壳的高度 = Fever 比例（底部对齐 ⇒ 品红自下而上）
    if (e.fillwrap) e.fillwrap.style.height = `${(ratio * 100).toFixed(1)}%`;
  }
}

/**
 * 面板挂载：在对局屏根部的 `.mod-host`（`screen.game.overlay`）里建一层**不吃指针**的全屏层，
 * 用 `requestAnimationFrame` 每帧把图标贴到各成员身上。
 * @param {{ host: any, data: any }} ctx
 * @returns {{ unmount?: () => void }}
 */
export function mount(ctx) {
  const host = ctx && ctx.host;
  if (!host || typeof host.appendChild !== 'function') return {};
  if (!state.data) state.data = ctx.data;
  const root = document.createElement('div');
  root.className = `${CLS}-layer`;
  root.setAttribute('aria-hidden', 'true');
  host.appendChild(root);
  state.root = root;
  const tick = () => { state.raf = requestAnimationFrame(tick); paint(); };
  state.raf = requestAnimationFrame(tick);
  return {
    unmount() {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
      state.root = null;
      for (const e of state.els.values()) e.box.remove();
      state.els.clear();
    },
  };
}
