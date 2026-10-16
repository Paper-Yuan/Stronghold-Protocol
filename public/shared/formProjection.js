// shared/formProjection.js — 干员形态投影（口径轴 `form: "elite"`，DESIGN §28.41）。
//
// 这一层解决的是一面**能力**上的墙，不是数据上的：`data/chess.json` 里每名干员的两种形态是一对记录
// （`_a` 普通 / `_b` 精锐，互为 `baseId` / `goldenId`），而 `_b` 的战斗职能是**引擎自己烘出来的**那份
// ——`status`（`phase` / `level` / `skillLevel` / `equipLevel`）、`stats`、`trait`、`skill`、`talents`、`module`
// 与 `modules[]` 的模组天赋、`assets`、`upgradeChessId`。玩家侧的练度开关（`shared/potential.js` 的潜能 1–6 与练度
// 0–3）**到不了**那一档：潜能与练度都改不了 `phase` / `equipLevel`，也开不出精锐的技能 2 与模组天赋
// （`shared/potential.js:29-39`）。所以「普通干员按精锐形态出战」这件事**只能由这一层给**。
//
// 判据（与 `shared/variants.js` 的分工逐字相同：轴表判「哪一套」，这里判「那一套是什么」）：
//   1. **投影的是职能，不是身份**。身份字段取 `_a` 自己那一份（`shared/standIn.js` 的 `IDENTITY_FIELDS`：
//      棋子 id、阶级、价格、盟约、特质、合成数 —— 身份与价格**都不动**），其余字段整条取 `_b`。
//   2. **一个数都不来自包**。包只说「这一局用 `form: "elite"`」（`shared/variants.js` 的闭枚举），值只能从
//      **引擎自己的 `_b` 记录**读。这是这一层唯一的存在理由：包永远改不动一个它没有语义权的数字。
//   3. **缺省 = 引擎今天的行为**：`eliteProjected` 为假时**返回原对象本身**（`===`），调用方据此一个字节都不动。
//   4. **不许降级**：投影后每条记录的 `atk` / `maxHp` / `def` 必须 ≥ 投影前。引擎的 `_b` 是在满潜能（潜能 6）
//      烘的，投稿里那些比引擎低的旧数值**不许倒灌进来**。这条由 test/form-projection.test.js 对全部记录逐条钉住。
//   5. **召唤物同一个轴、同一套机制**：`data/tokens.json`（与 `backups.tokens`）的 `variants[ownerId]` 里，
//      `_a` 的 owner 变体同样按 `_b` 的 owner 变体投影 —— 只投干员不投召唤物是自相矛盾的。
//
// 这一份是**纯**的（`shared/` 的纪律）：没有 `process`、没有状态、没有文件系统，服务端与浏览器读到同一个判决。

import { IDENTITY_FIELDS } from './standIn.js';
//
// 后果（业主裁决 2026-10-13，如实披露、不许悄悄改平衡、也不许悄悄不说）：本轴下 `_a` 用**1 阶价格**拿到精锐形态的
// 数值，而 `upgradeNum` 保持 3 ⇒「3 张 `_a` 换 1 张 `_b`」的合成在本轴下**价值中性**（不是 bug，是投影只改职能
// 的证据）。这两条都写进 `docs/WORKSHOP.md` 的作者可见披露里，也写进发布说明。

/** 本模块认识的轴名与它的两个选项（与 `shared/variants.js` 的 `VARIANT_AXES.form` 逐字一致）。 */
export const FORM_AXIS = 'form';
export const FORM_ELITE = 'elite';

/**
 * `identify` 是不是这个轴认的「投影成精锐」。
 * @param {string|null|undefined} value `variantValue(decl, 'form')`
 * @returns {boolean}
 */
export const isEliteForm = (value) => value === FORM_ELITE;

/**
 * 投影一条记录：`rec` 的职能字段取 `donor`（精锐记录）的，身份字段留在 `rec` 自己那一份。
 *
 * 复制的是 `donor` 的**全部自有键**再减掉身份字段 —— 这样一份新造的字段（未来数据里多出来的一格）默认跟着
 * 精锐走，而不是被一张手写的白名单静默漏掉。`IDENTITY_FIELDS` 是 `shared/standIn.js` 的那一份（副产物
 * `composeUnitRecord` 逐字同一条，构建期已证明能重建每一条棋子），这里**不另开第二份判据**。
 *
 * 返回值里 `chessId` / `baseId` / `goldenId` / `isGolden` 显式回到 `rec` 的身份：一条投影过的 `_a` **仍然**是
 * `_a`（不是精锐），`goldenIdOf` / `baseIdOf` / 合成 / 商店都照旧看得见它。
 *
 * @template T
 * @param {T} rec 要投影的记录（`_a`）
 * @param {any} donor 它的精锐兄弟（`_b`）
 * @returns {any} 新对象；`rec` 与 `donor` 都不被改动
 */
export function projectElite(rec, donor) {
  const out = { ...donor };
  for (const k of IDENTITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rec, k)) out[k] = rec[k];
    else delete out[k];
  }
  out.chessId = rec.chessId ?? rec.id ?? out.chessId;
  out.baseId = rec.baseId ?? out.baseId;
  out.goldenId = donor.chessId ?? donor.id ?? out.goldenId;
  out.isGolden = false;
  return out;
}

/**
 * 一条 `data/tokens.json` 记录的投影：`variants` 里 owner 键为普通形态的变体，取它精锐兄弟那一条。
 *
 * 只动 `variants`：召唤物自己的 `stats` / `skill` / `talents`（没有 owner 变体的那 50 多个召唤物）与别的字段
 * 一条都不动 —— 一个没有 owner 变体的召唤物本来就不随 owner 的形态变。
 *
 * @template T
 * @param {T} rec 召唤物记录
 * @param {(id: string) => any} chessOf 棋子记录查询（投影后的那一份）
 * @returns {T} 原对象（无需投影）、或一份 `variants` 已换过的新对象
 */
export function projectEliteToken(rec, chessOf) {
  const variants = rec && typeof rec === 'object' ? rec.variants : null;
  if (!variants || typeof variants !== 'object') return rec;
  let out = null;
  for (const owner of Object.keys(variants)) {
    const golden = typeof owner === 'string' && owner.endsWith('_a') ? `${owner.slice(0, -2)}_b` : null;
    if (!golden || !Object.prototype.hasOwnProperty.call(variants, golden)) continue;
    const c = typeof chessOf === 'function' ? chessOf(owner) : null;
    const g = typeof chessOf === 'function' ? chessOf(golden) : null;
    if (!c || !g) continue;
    out ??= { ...rec, variants: { ...variants } };
    out.variants[owner] = variants[golden];
  }
  return out ?? rec;
}

/**
 * 一个**口径 → 记录**的查询器（`GameData` / `DataSource` 共用同一份，两边分叉就是 bug）：
 * `eliteProjected` 为假时 `chess(id)` 返回**原对象本身**（恒等，缺省路径逐字节不变）；为真时返回投影过的记录。
 *
 * 结果按 id 缓存并冻结 —— 与 `GameData.standIn()` 的缓存形状一致（同一局里同一条 id 拿到的是同一个对象）。
 *
 * @param {Record<string, any>} chess `data/chess.json`（或合并过工坊的那一份）
 * @param {boolean} eliteProjected
 * @param {{ tokens?: Record<string, any>|null }} [opts] `tokens` 给了才投影召唤物的 owner 变体
 * @returns {{
 *   eliteProjected: boolean,
 *   chess: (id: string) => any,
 *   token: (id: string) => any,
 * }}
 */
export function formView(chess, eliteProjected, { tokens = null } = {}) {
  const src = chess && typeof chess === 'object' ? chess : {};
  const tokSrc = tokens && typeof tokens === 'object' ? tokens : {};
  /** @type {Map<string, any>} */
  const chessCache = new Map();
  /** @type {Map<string, any>} */
  const tokenCache = new Map();
  /** `_a` 的投影记录：`_b` 不在 ⇒ 原对象（一条没有精锐兄弟的记录投不了，也不该假装投了）。 */
  const project = (rec) => {
    const gid = rec && typeof rec === 'object' && typeof rec.goldenId === 'string' ? rec.goldenId : null;
    const donor = gid && Object.prototype.hasOwnProperty.call(src, gid) ? src[gid] : null;
    if (!donor || donor === rec) return rec;
    return projectElite(rec, donor);
  };
  const chessAt = (id) => {
    const rec = typeof id === 'string' && Object.prototype.hasOwnProperty.call(src, id) ? src[id] : null;
    if (!rec || typeof rec !== 'object') return rec;
    // 只有**普通形态**被投影：精锐自己是 donor，缺 `goldenId` / `isGolden` 的记录（自选槽、召唤物）不动。
    if (!eliteProjected || rec.isGolden === true || rec.isDiy === true || !rec.goldenId) return rec;
    if (chessCache.has(id)) return chessCache.get(id);
    const out = Object.freeze(project(rec));
    chessCache.set(id, out);
    return out;
  };
  const token = (id) => {
    const rec = typeof id === 'string' && Object.prototype.hasOwnProperty.call(tokSrc, id) ? tokSrc[id] : null;
    if (!rec || typeof rec !== 'object' || !rec.variants) return rec;
    if (!eliteProjected) return rec;
    if (tokenCache.has(id)) return tokenCache.get(id);
    const out = Object.freeze(projectEliteToken(rec, chessAt));
    tokenCache.set(id, out);
    return out;
  };
  return { eliteProjected: !!eliteProjected, chess: chessAt, token };
}
