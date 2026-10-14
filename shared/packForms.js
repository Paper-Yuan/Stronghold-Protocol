// shared/packForms.js — 形态（clip set）通道的**统一入口**：第一方 `FORMS` 一件不动，包只做增量。
//
// 背景（docs/design/mod-layer.md §28.29）：`public/js/render/units.js` 的 `FORMS` 是一张**冻结的模块常量**，
// 按 spine id 键、值是「形态名 → {change, end, leave, next, roles}」。它是第一方常量，语义不许变味，所以
// 「包能不能改形态」这件事的答案不是去包一层可写表，而是：
//
//   1. 第一方那张表留在家（`units.js` 的 `FORMS`，一个字节不改，仍然是唯一的真相）；
//   2. 本模块只持**包带来的增量**，键与值都由 `pack.json.forms` 声明、由 `shared/workshop.js` 的
//      `parseFormsDecl` 在形状层判过（不合法**整包拒绝**，不是静默丢掉）；
//   3. 消费点（`units.js` 的 `_formSpec` / `setForm` 的准入与 `next`、`render/app.js` 的 fx `form` 那一处，
//      共四处）一律走 `formsFor(FORMS, spineId)`：
//      **第一方优先** —— `FORMS[spineId]` 里有这个 spine id 时，包在**同名形态**上永远改不了它
//      （声明阶段就被 `FORMS_FIRST_PARTY_OVERLAP` 拒了），包只能**新增**第一方没有的形态名，
//      或**整体补一个第一方完全没有的 spine id**。
//
// 为什么第一方优先，而不是「包可以覆盖」：`FORMS` 的每一条都是**用真 skeleton 的 clip 名对着官方 prefab 校出来的**
// （`units.js` 那段长注释里逐条记着来源），一个包把它盖掉会让第一方干员/怪物在**没有装这个包的机器上**照旧、
// 在装了的机器上变形 —— 那是「同一个摘要下有几种行为」的反面（DESIGN §28.2）。而包真正的需求（自己的干员/怪物
// 有自己的形态）从来不需要覆盖别人的名字：新 spine id + 新形态名就够了。
//
// 合并规则（形态通道只有这一份实现）：
//   * 第一方已有的形态名 ⇒ **第一方赢**，包的同名条目被丢掉（形状层本已拒绝，这里是第二道闸）；
//   * 只有包声明过这个 spine id ⇒ 包的形态进表；
//   * 两个包声明同一个 `spine id + 形态名` ⇒ 包 id 小的赢（与 art / skins 同一条规则），这里也照做。

import { FIRST_PARTY_FORM_NAMES } from './formNames.js';

/**
 * 包的形态声明在客户端数据里的落点：`data.get('assets').modForms`。
 *
 * 为什么落在 `assets.json`：形态是**模型（spine）的伴生语义**，而包的模型本来就走 `assets.json`
 * （`mergeWorkshopArt` / `mergeWorkshopFlatArt` / `mergeWorkshopSkins`），客户端**零改动**就能通过
 * `data.get('assets')` 读到它 —— 与 `assets.skins` 逐字同一条理由（`shared/workshop.js` mergeWorkshopSkins 的注释）。
 * 另开一个 `/data/*.json` 会多一条只有它一个人用的取数通道，而它解决的是同一张表上的问题。
 */
export const PACK_FORMS_KEY = 'modForms';

/** `pack.json.forms` 允许的顶层表名 —— 与 `ART_TABLES` 的对象表**同一组**（同一批 spine 模型）。 */
export const FORM_TABLES = Object.freeze(['chars', 'enemies', 'tokens']);

/** 形态名的形状（作者写的键；`units.js` 今天的形态名全是小写字母 + 下划线）。 */
export const FORM_KIND_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/** `roles` 里允许的角色键 —— 与 `units.js` 今天真在用的那一组一一对应（多了没用，少了画不出来）。 */
export const FORM_ROLE_KEYS = Object.freeze(['idle', 'deploy', 'die', 'stun', 'move', 'attack', 'skill']);

/** 形态级（`roles` 之外）的字段：进/结束/离开 clip，与指向同 spine 另一个形态的 `next`。 */
export const FORM_SPEC_KEYS = Object.freeze(['change', 'end', 'leave', 'next', 'roles']);

/** 一个 clip 循环对象（`loop(name)` 的形态）上允许的键。 */
export const FORM_LOOP_KEYS = Object.freeze(['begin', 'loop', 'end', 'via']);

const isPlainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * 第一方形态名的只读镜像（`shared/formNames.js`，由 `tools/build-form-names.mjs` 从 `FORMS` 生成、
 * 由 `test/packForms.test.js` 钉住）。客户端那一半用它把「第一方优先」这条合并规则也挡一遍 ——
 * 浏览器拿到的是 JSON，那份清单不该被信任；形状层（`parseFormsDecl`）已经拒过同名的声明了。
 *
 * 形状是 `{ <spine id>: { <形态名>: true } }` 的**集合语义**：`formNames.js` 给的是名字**数组**，
 * 而这里要回答的是「这个名字在不在这张表里」——数组的 `in` / 索引在别的名字上会给出**静默的错答案**
 * （`'shift' in ['doll']` 是 false，可 `'0' in ['doll']` 是 true）。
 */
const FIRST_PARTY_KINDS = (() => {
  /** @type {Record<string, Record<string, true>>} */
  const out = {};
  for (const [spineId, kinds] of Object.entries(FIRST_PARTY_FORM_NAMES)) {
    out[spineId] = Object.fromEntries(kinds.map((k) => [k, true]));
  }
  return out;
})();

/** 冻结一份形态表（两份表都是不可变的；包带来的那一份也一样，免得被画到一半的东西改）。 */
function freezeForms(map) {
  /** @type {Record<string, Readonly<Record<string, object>>>} */
  const out = {};
  for (const [spineId, forms] of Object.entries(map)) {
    const inner = {};
    for (const [kind, spec] of Object.entries(forms)) inner[kind] = Object.freeze(spec);
    out[spineId] = Object.freeze(inner);
  }
  return Object.freeze(out);
}

/**
 * 本模块持有的**包增量**：spine id → 形态名 → spec。空对象 = 今天的行为（没有一个包声明过 forms）。
 * @type {Readonly<Record<string, Readonly<Record<string, object>>>>}
 */
let packForms = freezeForms({});

/** 包增量的只读视图（守卫与测试读它；渲染器读 `formsFor`）。 */
export function installedPackForms() {
  return packForms;
}

/**
 * 装一份包增量（客户端：`/data/assets.json` 的 `assets.modForms`；测试：直接喂一份）。
 *
 * 返回**被丢掉的条目**（不抛、不静默）：`[{ spineId, kind, reason, definedBy? }]`。调用方该把它报出来
 * （渲染层记一条 console 警告）。形状层（`shared/workshop.js` 的 `parseFormsDecl`）已经拒过非法声明了，
 * 这里守的是**跨包**与**第一方**那两条合并规则 —— 它们只有把几份声明放到一起时才看得出。
 *
 * @param {Record<string, any>|null|undefined} decl `pack.json.forms`（已校验）或 `assets.modForms`
 * @returns {{ dropped: Array<{spineId: string, kind: string, reason: string, definedBy?: string}> }}
 */
export function installPackForms(decl) {
  /** @type {Record<string, Record<string, object>>} */
  const next = {};
  /** @type {Record<string, Record<string, string>>} spine id → 形态名 → 占住它的**包** id */
  const owner = {};
  /** @type {Array<{spineId: string, kind: string, reason: string, definedBy?: string}>} */
  const dropped = [];
  const sources = isPlainObj(decl) ? Object.entries(decl) : [];
  for (const [spineId, forms] of sources) {
    if (!isPlainObj(forms)) continue;
    // **按包 id 排序后再占位**：`assets.modForms` 里每条都带着自己的包 id，而「包 id 小的赢」这条规则
    // 只有在同一趟里按包 id 走一遍才成立 —— 否则结果会取决于这份 JSON 的键序（= 取决于服务端并表的次序），
    // 那正是 `artClaims` / `SKIN_COLLISION` 一直在拒绝的那件事（谁赢不取决于加载次序）。没有包 id 的条目
    // （手工构造的测试数据）排在最后：它们不该抢走一个真声明的位置。
    const entries = Object.entries(forms)
      .map(([kind, spec], i) => ({ kind, spec, i, pack: isPlainObj(spec) && typeof spec.pack === 'string' ? spec.pack : '\uffff' }))
      .sort((a, b) => (a.pack < b.pack ? -1 : a.pack > b.pack ? 1 : a.i - b.i));
    for (const { kind, spec } of entries) {
      const pack = isPlainObj(spec) && typeof spec.pack === 'string' ? spec.pack : '';
      const body = isPlainObj(spec) && isPlainObj(spec.form) ? spec.form : spec;
      const prior = owner[spineId]?.[kind];
      if (prior !== undefined) {
        // 包与包之间：**包 id 小的赢**（与 `artClaims` / `SKIN_COLLISION` 同一条：谁赢不取决于加载次序）。
        dropped.push({
          spineId, kind, definedBy: prior,
          reason: `another pack (${prior}) already adds this form name on this spine id; the pack with the smaller id keeps it`,
        });
        continue;
      }
      // 第一方优先是**合并规则**（§28.29 裁决 2）：第一方 `FORMS` 上已经有这个形态名时，包这条不生效。
      // **但它不占位** —— 占位的只有包自己，否则同一个包的第二条声明会被误报成「另一个包抢了它」。
      if (FIRST_PARTY_KINDS[spineId]?.[kind]) {
        dropped.push({
          spineId, kind, definedBy: '',
          reason: 'first-party FORMS already has this form name on this spine id (first-party wins; declare a different form name)',
        });
        continue;
      }
      // 跨包时把赢了的那一方定下来（先到的小 id 先占位：调用方按包 id 排序喂进来）。
      if (pack) (owner[spineId] ||= {})[kind] = pack;
      (next[spineId] ||= {})[kind] = body;
    }
  }
  packForms = freezeForms(next);
  return { dropped };
}

/** 清空包增量（测试用；浏览器里没有调用点）。 */
export function resetPackForms() {
  packForms = freezeForms({});
}

/**
 * 形态通道的**唯一入口**：`spine id` → 「形态名 → spec」。
 *
 * 包只做增量：返回的是 `first`（第一方 `FORMS[spineId]`，可以没有）与包增量的合并，**第一方先到、第一方赢**。
 * 第一个参数是**第一方那张表**（`units.js` 把它传进来，本模块不反向 import 渲染器）；传 `null` 时只看包增量。
 * 没有第一方形态、也没有包声明的 spine id 返回 `undefined`（与今天 `FORMS[id]` 的行为一致，调用点的 `?.` 照旧）。
 *
 * @param {Record<string, Record<string, object>>|null|undefined} first `units.js` 的 `FORMS`
 * @param {string|null|undefined} spineId `info.spine || info.defId`
 * @returns {Readonly<Record<string, object>>|undefined}
 */
export function formsFor(first, spineId) {
  const id = typeof spineId === 'string' && spineId ? spineId : '';
  const a = id && first ? first[id] : undefined;
  const b = id ? packForms[id] : undefined;
  if (!a) return b;
  if (!b) return a;
  /** @type {Record<string, object>} */
  const out = {};
  for (const [kind, spec] of Object.entries(b)) if (!(kind in a)) out[kind] = spec;
  return Object.keys(out).length ? Object.freeze({ ...a, ...out }) : a;
}

/**
 * 一个 `roles` 对象的形状是否合法（渲染器要吃它；包声明进形状层时用的是同一个函数，判据只有一份）。
 * 合法 = 对象、键在 `FORM_ROLE_KEYS` 里、值是非空字符串或 null 或一个合法的 clip 循环对象、至少一条。
 * @param {unknown} roles
 * @returns {{ ok: true, value: object } | { ok: false, reason: string }}
 */
export function checkFormRoles(roles) {
  if (!isPlainObj(roles)) return { ok: false, reason: 'roles must be an object of role → clip (or a {begin, loop, end} object)' };
  const value = {};
  let clips = 0;
  for (const [role, v] of Object.entries(roles)) {
    if (!FORM_ROLE_KEYS.includes(role)) {
      return { ok: false, reason: `roles.${role} is not a role this engine draws (one of: ${FORM_ROLE_KEYS.join(', ')})` };
    }
    if (v === null) { value[role] = null; continue; }
    if (typeof v === 'string') {
      if (!v) return { ok: false, reason: `roles.${role} is an empty clip name` };
      value[role] = v; clips++;
      continue;
    }
    const loop = checkLoopClip(v, `roles.${role}`);
    if (!loop.ok) return loop;
    if (loop.value) { value[role] = loop.value; clips++; } else value[role] = null;
  }
  if (!clips) return { ok: false, reason: 'roles has no clip in it (an empty form is `roles: {}` — but then nothing is drawn, so declare the clips or drop the form)' };
  return { ok: true, value };
}

/**
 * 一个 clip 循环对象（`{begin, loop, end}`，可带 `via`）的形状。`null` / 全空对象 = 这个角色没有 clip。
 * @param {unknown} v
 * @param {string} where 报错文案里的位置
 * @returns {{ ok: true, value: object|null } | { ok: false, reason: string }}
 */
export function checkLoopClip(v, where) {
  if (!isPlainObj(v)) return { ok: false, reason: `${where} must be a clip name string, null, or a { begin, loop, end } object` };
  const out = {};
  let any = false;
  for (const [k, name] of Object.entries(v)) {
    if (!FORM_LOOP_KEYS.includes(k)) return { ok: false, reason: `${where}.${k} is not a field of a clip loop (one of: ${FORM_LOOP_KEYS.join(', ')})` };
    if (name === null || name === undefined) { out[k] = null; continue; }
    if (typeof name !== 'string' || !name) return { ok: false, reason: `${where}.${k} must be a non-empty clip name string (or null)` };
    out[k] = name; any = true;
  }
  if (!any) return { ok: true, value: null };
  return { ok: true, value: out };
}
