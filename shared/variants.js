// shared/variants.js — 变体 / 口径层 (the 口径 a pack may declare, DESIGN §28.39).
// (i18n-ignore-file: 工坊作者层的校验与推导文本 —— 给作者、编辑器与 AI 读的规则说明（编辑器有自己的中英词典，见 docs/EDITOR.md），不是客户端界面文案)
//
// 这一层要解决的那面墙，逐字记在 `docs/WORKSHOP.md` §1.1 与 `shared/workshop.js` 的 `PACK_FIELDS` 注释里：
// 三个社区 mod 的 `variants` 曾经「写了等于没写」（归一化时被静默丢掉）。今天 `variants` 是一个真字段 —— 但
// 它**不是**一条「包可以覆盖任意数值」的通道，那样等于把安装器做进引擎（`docs/WORKSHOP.md` §1.1 对 `official`
// / `config` / `meta` / `shared` / `theme` / `serverModules` 的判断逐字成立）。
//
// 判据（本文件就是那条判据的唯一一份）：
//   1. **闭枚举**。一个包只能声明**这张表里有的轴**，每个轴只能取**这个轴列出的选项名**。轴名不认识 ⇒
//      `VARIANTS_UNKNOWN_AXIS`；选项名不认识 ⇒ `VARIANTS_UNKNOWN_OPTION`。两者都是**整包拒绝**，不是忽略。
//   2. **包里没有数值**。包声明的是「哪一套口径」，不是「改成几」。值由引擎自己写（`DEPLOY_CAP_MAX`、
//      `shared/potential.js` 的潜能/练度缺省），所以一个包**永远**改不动一个它没有语义权的数字。
//   3. **缺省 = 引擎今天的行为**。不声明 `variants` 的包一个字节都不受影响；声明了但选了缺省选项的包，与
//      没声明在**数据上**等价（这一条让「口径层」不可能悄悄改默认游戏行为）。
//
// 轴**只在被一份真实投稿要求时才加**（业主裁决 2026-10-13）：不许为将来预留空轴。今天两条，各自的出处：
//   * `deploy`   — 投稿 `e4fe4d5cf0a0`（干员满练mod）的 `deploy.config.economy.deployCap = 12`。官方 8。
//   * `training` — 同一投稿的 `training` 一段（258 条干员 + 19 个召唤物的练度）。引擎今天**已经有**一串
//                  运行时的练度开关（`room.loadout.ops` 的 `{ potential, cultivate }`，`干员调配` 页：潜能 1–6
//                  与 未精英化→精英2 Lv.60），本轴把「一局用哪一套练度」收成一个可声明的口径，**值仍然由
//                  `shared/potential.js` 的缺省给**（`POTENTIAL_DEFAULT` / `CULTIVATE_DEFAULT`）。
//   * `form`     — 同一投稿 `training` 那一段**真正想要的东西**（业主裁决 2026-10-13）：普通干员按精锐形态出战。
//                  练度开关到不了那一档（潜能 / 练度都改不了 `phase` / `equipLevel`，也开不出精锐的技能 2 与模组
//                  天赋），所以这一条是**读取期的形态投影**（`shared/formProjection.js`），不是数值覆盖通道：
//                  值从引擎自己的 `_b` 记录来，身份与价格都不动。文档里的后果披露：`docs/WORKSHOP.md` §1.1。
//
// 这一份是**纯**的（`shared/` 的纪律）：没有 `process`、没有状态、没有文件系统，服务端与浏览器读到同一个判决。

import { DEPLOY_CAP_MAX } from './constants.js';

/**
 * 一条判罚。形状与 `shared/workshop.js` 的 `fail` 逐字相同（那个是模块私有的，这里不跨模块借一个内部函数）。
 * 显式标注返回类型是给 `npm run typecheck` 用的：推断出的 `{ ok: boolean }` 落不进下面那些 `ok: false` 的联合。
 * @param {string} error @param {string} detail
 * @returns {{ ok: false, error: string, detail: string }}
 */
const fail = (error, detail) => ({ ok: false, error, detail });
const isPlainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** 一个轴名 / 选项名 / 文案的长度上限（一个手写坏掉的 pack.json 可以有几万字符）。 */
const MAX_NAME = 40;
const MAX_TEXT = 160;

/**
 * 口径轴表 —— 这份格式认识的**每一个**轴与每一个选项名，一个不多一个不少。
 *
 * 每一条：`label` 是给作者与界面读的一句话（英文，与 `shared/workshop.js` 的校验文案同一条纪律），
 * `options` 是闭枚举，`default` 是**不声明这个轴**时引擎的表现（= 引擎今天的行为），`effect` 说清这个选项到底
 * 动了什么。`effect` 是一句**声明**，不是可执行的东西：包读不到它、也驱动不了它。
 *
 * @type {Readonly<Record<string, {
 *   label: string, options: readonly string[], default: string,
 *   optionLabels: Readonly<Record<string, string>>, effect: Readonly<Record<string, string>>,
 * }>>}
 */
export const VARIANT_AXES = Object.freeze({
  training: Object.freeze({
    label: '干员练度 (operator training)',
    options: Object.freeze(['official', 'full']),
    default: 'full',
    optionLabels: Object.freeze({
      official: '官方口径（潜能 1、未精英化、无练度加成）',
      full: '满潜能 / 精英2 Lv.60（引擎缺省）',
    }),
    effect: Object.freeze({
      // `official` = 业主 2026-10-07/08 那条「未持有的特许按潜能1、未精英化」的缺省，落点是引擎**已有的**
      // `room.loadout.ops` 设置（干员调配页），不是在数据里塞第二套数值。
      official: 'players are set to 潜能 1 / 未精英化 (no 练度 bonus) — the engine\'s own 干员调配 baseline',
      full: 'the engine default: 潜能 6 and 精英2 Lv.60 练度 bonus (POTENTIAL_DEFAULT / CULTIVATE_DEFAULT)',
    }),
  }),
  form: Object.freeze({
    label: '干员形态 (operator form)',
    options: Object.freeze(['official', 'elite']),
    default: 'official',
    optionLabels: Object.freeze({
      official: '官方口径（普通干员按普通形态出战）',
      elite: '普通干员按精锐形态出战（投影 `_b` 的战斗职能）',
    }),
    effect: Object.freeze({
      // 值与 `training` / `deploy` 同一条纪律：包说的是「哪一套」，值由引擎自己从**它自己的** `_b` 记录读
      // （`shared/formProjection.js`），所以一个包永远改不动一个它没有语义权的数字。
      official: 'the engine default: a normal chess fights with its own normal form (`data/chess.json`)',
      elite: 'every normal (`_a`) chess is projected onto its elite (`_b`) twin: status / stats / trait / skill / talents / module / assets from the engine\'s own elite record — identity (tier, price, bonds, 特质, merge) unchanged',
    }),
  }),
  deploy: Object.freeze({
    label: '部署位 (deploy slots)',
    options: Object.freeze(['official', 'max']),
    default: 'official',
    optionLabels: Object.freeze({
      official: '官方上限（8 个部署位）',
      max: '本模式上限（12 个部署位）',
    }),
    effect: Object.freeze({
      // 8 就是 `data/config.json economy.deployCap`（官方 maxBattleChessCnt），缺省路径读它、不重写它。
      official: 'config.economy.deployCap keeps the official value the data ships (8)',
      max: `config.economy.deployCap is raised to the mode ceiling (${DEPLOY_CAP_MAX})`,
    }),
  }),
});

/** 轴名，按声明顺序（界面 / 错误文案按它排）。 */
export const VARIANT_AXIS_NAMES = Object.freeze(Object.keys(VARIANT_AXES));

/** 一个轴名是不是这份格式认识的轴。 */
export const isVariantAxis = (name) => typeof name === 'string' && Object.hasOwn(VARIANT_AXES, name);

/** 一个选项名在这个轴上合不合法。 */
export const isVariantOption = (axis, option) => isVariantAxis(axis) && VARIANT_AXES[axis].options.includes(option);

/**
 * 解析 `pack.json.variants` 的形状（**只有形状与闭枚举**，与 `shared/workshop.js` 的其它 `parseXDecl` 同一条
 * 分工：判据只有这一份，装载器与校验器都调它）。
 *
 * 收的形状：`[{ axis, default?, name?, desc? }]`，`axis` 必须是 `VARIANT_AXES` 的键，`default` 必须是那个轴
 * `options` 里的一个。允许**只声明轴、不写 `default`**（那时用这个轴的 `default`）。
 *
 * 拒绝码（每一条都点名，绝不静默丢）：
 *   * `VARIANTS_BAD_SHAPE`     — 不是数组 / 一条不是对象 / `axis` 不是非空字符串 / `default` 类型不对 /
 *                                `name` / `desc` 不是字符串 / 出现未知字段；
 *   * `VARIANTS_UNKNOWN_AXIS`  — `axis` 不在表里（文案里列出全部合法轴）；
 *   * `VARIANTS_UNKNOWN_OPTION`— `default` 不在那个轴的 `options` 里（文案里列出这个轴的全部选项）；
 *   * `VARIANTS_BAD_DEFAULT`   — `default` 显式写成 `null` / `false` / 数字这类「不是选项名」的东西；
 *   * `VARIANTS_DUPLICATE_AXIS`— 同一个轴声明了两次（一个轴只有一个值，写两遍是作者的真实错误）。
 *
 * 归一化结果**按轴名排序**：键序是清单字节的一部分（`identifyPack` 把归一化清单哈希进去），所以它绝不能随作者
 * 书写顺序变。`default` 与轴的 `default` 相同时**仍然写出来** —— 作者写了什么就回什么，而「选缺省」与「没声明」
 * 在数据上等价这条由 `variantIsDefault` 承担，不是靠丢掉一个键。
 *
 * @param {any} raw `pack.json.variants`
 * @returns {{ ok: true, decl: Array<{ axis: string, default: string, name: string|null, desc: string|null }> }
 *          | { ok: false, error: string, detail: string }}
 */
export function parseVariantsDecl(raw) {
  if (!Array.isArray(raw)) {
    return fail('VARIANTS_BAD_SHAPE', `"variants" must be an array of { axis, default? } entries — one per 口径 this pack pins. Known axes: ${VARIANT_AXIS_NAMES.join(', ')}`);
  }
  /** @type {Array<{ axis: string, default: string, name: string|null, desc: string|null }>} */
  const out = [];
  const seen = new Set();
  for (const [i, entry] of raw.entries()) {
    const where = `variants[${i}]`;
    if (!isPlainObj(entry)) return fail('VARIANTS_BAD_SHAPE', `${where} must be an object of { axis, default? } — got ${Array.isArray(entry) ? 'an array' : typeof entry}`);
    for (const key of Object.keys(entry)) {
      if (key !== 'axis' && key !== 'default' && key !== 'name' && key !== 'desc') {
        return fail('VARIANTS_BAD_SHAPE', `${where}: "${key}" is not a declared field (axis, default, name, desc). A key this loader does not know is never read`);
      }
    }
    if (typeof entry.axis !== 'string' || !entry.axis) {
      return fail('VARIANTS_BAD_SHAPE', `${where}.axis must be a non-empty string (one of: ${VARIANT_AXIS_NAMES.join(', ')})`);
    }
    const axis = entry.axis;
    if (!isVariantAxis(axis)) {
      return fail('VARIANTS_UNKNOWN_AXIS', `${where}.axis "${axis.length > MAX_NAME ? `${axis.slice(0, MAX_NAME)}…` : axis}" is not an axis of this 口径 format. Known axes: ${VARIANT_AXIS_NAMES.map((a) => `"${a}"`).join(', ')} — a declaration the loader does not know is never applied, so it is refused instead of ignored`);
    }
    if (seen.has(axis)) {
      return fail('VARIANTS_DUPLICATE_AXIS', `${where}.axis "${axis}" is declared twice — one axis has exactly one 口径 per pack`);
    }
    seen.add(axis);
    const spec = VARIANT_AXES[axis];
    let chosen = spec.default;
    if (entry.default !== undefined) {
      if (typeof entry.default !== 'string' || !entry.default) {
        return fail('VARIANTS_BAD_DEFAULT', `${where}.default must be one of the option names of "${axis}" (${spec.options.map((o) => `"${o}"`).join(', ')}), got ${entry.default === null ? 'null' : typeof entry.default} — a non-string default would be read as "the axis default", i.e. silently not what the author wrote`);
      }
      if (!spec.options.includes(entry.default)) {
        return fail('VARIANTS_UNKNOWN_OPTION', `${where}.default "${entry.default.length > MAX_NAME ? `${entry.default.slice(0, MAX_NAME)}…` : entry.default}" is not an option of "${axis}". Its options are: ${spec.options.map((o) => `"${o}"`).join(', ')} (${spec.label})`);
      }
      chosen = entry.default;
    }
    /** @type {string|null} */
    let name = null;
    /** @type {string|null} */
    let desc = null;
    for (const [key, max] of /** @type {Array<[string, number]>} */ ([['name', MAX_NAME], ['desc', MAX_TEXT]])) {
      const v = entry[key];
      if (v === undefined || v === null) continue;
      if (typeof v !== 'string' || !v.trim()) {
        return fail('VARIANTS_BAD_SHAPE', `${where}.${key} must be a non-empty string when present`);
      }
      if (v.length > max) return fail('VARIANTS_BAD_SHAPE', `${where}.${key} is longer than ${max} characters`);
      if (key === 'name') name = v; else desc = v;
    }
    out.push({ axis, default: chosen, name, desc });
  }
  if (!out.length) {
    return fail('VARIANTS_BAD_SHAPE', '"variants" must declare at least one axis — an empty array is a declaration that does nothing, which is exactly the failure mode this field exists to prevent');
  }
  // 键序 = 清单字节（`identifyPack`）：按轴名排序，不随作者书写顺序变。
  out.sort((a, b) => (a.axis < b.axis ? -1 : a.axis > b.axis ? 1 : 0));
  return { ok: true, decl: out };
}

/**
 * 归一化的 `variants` 声明里，一个轴的取值（没声明这个轴 ⇒ null）。
 * @param {Array<{ axis: string, default: string }>|null|undefined} decl
 * @param {string} axis
 * @returns {string|null}
 */
export function variantValue(decl, axis) {
  if (!Array.isArray(decl)) return null;
  const hit = decl.find((e) => e && e.axis === axis);
  return hit && typeof hit.default === 'string' ? hit.default : null;
}

/** 这个轴的取值是不是「引擎今天的行为」（即不动任何东西）。没声明这个轴也算。 */
export function variantIsDefault(decl, axis) {
  const v = variantValue(decl, axis);
  return v === null || (isVariantAxis(axis) && v === VARIANT_AXES[axis].default);
}

/**
 * **口径 → 数据动作**：这一层唯一的执行点，也是「包里没有数值」这条纪律的落点。
 *
 * 只有 `deploy` 需要动数据（它改的是一个 `config` 标量）；`training` **不动数据** —— 它是玩家自己的
 * `干员调配`（`room.loadout.ops`）那套既有开关的口径名，`shared/potential.js` 的缺省就是 `full`。`form` 也**不动
 * 数据** —— 它不动 `data/` 里的任何一个字节，投影是**读取期**的（`shared/formProjection.js`：`GameData.chess()` /
 * `DataSource` 命中 `_a` 时返回按 `_b` 烘出来的那份记录，缺省路径返回原对象本身）。所以这里给出的
 * 第一条覆盖永远只有一条，且值来自引擎常量、不是包。
 *
 * 返回 `null` 表示「什么都不用改」—— 调用方（`server/data.js` 的 overlay 之后、deepFreeze 之前）据此**一个
 * 字节都不动**，缺省路径逐字节不变这条承诺就落在这里。
 *
 * @param {Array<{ axis: string, default: string }>|null|undefined} decl 一个**已归一化**的包声明列表（多包时先合并）
 * @returns {{ economy: { deployCap: number } } | null}
 */
export function variantDataPatch(decl) {
  if (variantIsDefault(decl, 'deploy')) return null;
  if (variantValue(decl, 'deploy') !== 'max') return null;
  return { economy: { deployCap: DEPLOY_CAP_MAX } };
}

/**
 * 多包的口径合成（DESIGN §28.3 的既有规则：**包 id 字典序小的赢**，与数据记录、kit、图标逐字同一条）。
 *
 * 一个轴只能有一个值，而两个包可以对同一个轴声明不同的选项。判据不是「谁后加载」（那会让结果依赖扫描顺序），
 * 而是这一层已有的那一条：按包 id 排序后的**第一个**声明赢，输的一方由调用方点名报告（`口径被 X 覆盖`）。
 *
 * @param {Array<{ id?: string, variants?: Array<{ axis: string, default: string }> }>} packs
 * @returns {{ decl: Array<{ axis: string, default: string, by: string }>, overridden: Array<{ axis: string, by: string, lostTo: string, value: string }> }}
 */
export function mergeVariantDecls(packs) {
  const sorted = (Array.isArray(packs) ? packs : [])
    .filter((p) => p && typeof p === 'object' && typeof p.id === 'string' && p.id)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  /** @type {Map<string, { axis: string, default: string, by: string }>} */
  const won = new Map();
  const overridden = [];
  for (const pack of sorted) {
    if (!Array.isArray(pack.variants)) continue;
    for (const entry of pack.variants) {
      if (!entry || !isVariantAxis(entry.axis)) continue;
      const held = won.get(entry.axis);
      if (!held) {
        won.set(entry.axis, { axis: entry.axis, default: entry.default, by: pack.id });
        continue;
      }
      if (held.default !== entry.default) {
        overridden.push({ axis: entry.axis, by: pack.id, lostTo: held.by, value: entry.default });
      }
    }
  }
  const decl = [...won.values()].sort((a, b) => (a.axis < b.axis ? -1 : a.axis > b.axis ? 1 : 0));
  return { decl, overridden };
}
