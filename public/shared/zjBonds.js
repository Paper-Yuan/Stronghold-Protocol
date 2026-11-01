// shared/zjBonds.js — 炸惊模拟 (ZHAJING) 专用盟约覆盖层。
//
// 需求（业主 2026-10-28）：16 项盟约改动**只在炸惊模拟生效**，其它难度（标准/险境/绝境/终极、同盟各难度）一律保持原样。
// 做法：`data/bonds.json` 的每个盟约记录可以带一个 `zj` 块，里面写炸惊下要覆盖的字段；本模块把它合并到
// 原记录上，得到「炸惊视图」。基础记录本身不动，所以其它模式读到的东西完全没变。
//
// 合并规则（逐条照搬参考包 0.3.1-mod.4 的语义）：
//   * 标量 / 数组字段（thresholds、activeCount、desc、effectDesc、effectDescParams、layerMilestones、
//     countMode、countsHand、countsGoldenOnly、spec …）：`zj` 里有就直接替换。
//   * `desc` / `effectDesc`：界面读的是带富文本标记的 `descRaw` / `effectDescRaw`（`Raw || 普通`），所以
//     `zj` 只写 `desc` / `effectDesc` 时，Raw 版本跟着一起换（`zj` 自己写了 Raw 就用 `zj` 的）。
//   * `bb` / `bbStr`（数值袋）：按键浅合并，`zj` 只写要改的那几个键；合并顺序 base.bb → base.env.bb → zj.bb →
//     zj.env.bb，`zj` 的键一律优先。
//   * `buffs`：按 `key` 合并 —— 同 key 的条目按键浅合并（`zj` 只写要改的键），新 key 追加（保持原有顺序，
//     新条目排在最后）；`buffsAll` 整条替换。
//   * 按 buff 分派的 `bb` 覆盖：`zj.bb` / `zj.bbStr` 里的键只覆盖**该 buff 自己的 bb 里本来就有**的同名键
//     （远见的折扣在 `bond_multi_layer_char_goods_price_bond_discount`，奇迹的概率在
//     `bond_refresh_shop_next_free`；只回写 env 会让它们的 `zj.bb` 覆盖静默失效，owner report 2026-10-14）。
//   * `zj` 键本身不出现在结果里。
//
// 这个模块是纯函数、无副作用、无 Node API，服务端（server/match/gamedata.js 与战斗模拟）和浏览器（客户端 UI 与
// 客户端战斗模拟）共用同一份实现，保证两边算出来的盟约记录逐字节一致。

/** 有 `zj` 块的盟约 id（供 UI / 测试快速判断某个盟约在炸惊下是否被改过）。 */
export function zjBondIds(bonds) {
  return bondIdsWithBlock(bonds, 'zj');
}

/**
 * 有覆盖块 `key` 的盟约 id（泛化版：`zj` = 炸惊模拟，`ann` = 湮灭模拟）。顺序 = 数据顺序。
 * @param {Record<string, any>} bonds
 * @param {string} key 覆盖块的键名（`'zj'` / `'ann'`）
 * @returns {string[]}
 */
export function bondIdsWithBlock(bonds, key) {
  const out = [];
  for (const [id, rec] of Object.entries(bonds || {})) if (rec && rec[key] && typeof rec[key] === 'object') out.push(id);
  return out;
}

/** 单个盟约记录 + 它的 `zj` 覆盖 → 新记录（没有 `zj` 时原样返回）。炸惊模拟用；等价于 `overlayBondRecord(base, zj, 'zj')`。 */
export function zjBondRecord(base, zj) {
  return overlayBondRecord(base, zj, 'zj');
}

/**
 * 单个盟约记录 + 它的覆盖块 → 新记录（没有覆盖块时**原样返回**，不复制）。
 *
 * 泛化自 `zjBondRecord`（2026-10-28，湮灭模拟的 `ann` 块复用同一套合并语义）：合并规则逐条不变，只是覆盖块的键名
 * 由 `blockKey` 决定，输出里也会删掉这个键。`zj` 的行为因此逐字节不变（同一份实现，`zjBondRecord` 只是它的别名）。
 * @param {any} base 基础记录（data/bonds.json 的一条）
 * @param {any} block 覆盖块（`zj` / `ann`）
 * @param {string} [blockKey] 覆盖块的键名，默认 `'zj'`
 */
export function overlayBondRecord(base, block, blockKey = 'zj') {
  const zj = block;
  if (!base || !zj || typeof zj !== 'object') return base;
  const baseBuffs = Array.isArray(base.buffs) ? base.buffs : [];
  const baseEnv = baseBuffs.find((b) => b && b.key === 'env_gbuff_new') || null;
  const zjBuffs = Array.isArray(zj.buffsAll) ? zj.buffsAll : Array.isArray(zj.buffs) ? zj.buffs : null;
  const zjEnv = zjBuffs ? zjBuffs.find((b) => b && b.key === 'env_gbuff_new') || null : null;

  const out = { ...base, ...zj };
  // 带富文本标记的文案：界面优先读 `descRaw` / `effectDescRaw`（richText.formatBondEffect、盟约弹窗的
  // 「盟约效果」都是 `xxxRaw || xxx`），而 `zj` 块只写 `desc` / `effectDesc`。不跟着换的话，基础记录里
  // 有 Raw 文案的盟约（突袭、炎…）在炸惊下会继续显示**普通模式的旧文案**，`Raw` 为空的盟约（岁、企鹅物流）
  // 则整段空白 —— 弹窗「没有描述」就是这么来的。`zj` 自己写了 Raw 版本时不覆盖。
  if (zj.desc != null && zj.descRaw == null) out.descRaw = zj.desc;
  if (zj.effectDesc != null && zj.effectDescRaw == null) out.effectDescRaw = zj.effectDesc;
  // 数值袋：基础记录本来就把同一份数值写在顶层 `bb` 和 `env_gbuff_new` 两处（顶层给界面公式，buffs 给战斗
  // 引擎）。合并顺序固定为 base.bb → base.env.bb → zj.bb → zj.env.bb，**`zj` 的键一律优先**。
  const bb = { ...(base.bb || {}), ...((baseEnv && baseEnv.bb) || {}), ...(zj.bb || {}), ...((zjEnv && zjEnv.bb) || {}) };
  const bbStr = { ...(base.bbStr || {}), ...((baseEnv && baseEnv.bbStr) || {}), ...(zj.bbStr || {}), ...((zjEnv && zjEnv.bbStr) || {}) };
  if (Object.keys(bb).length || base.bb) out.bb = bb;
  if (Object.keys(bbStr).length || base.bbStr) out.bbStr = bbStr;

  // buffs：`buffsAll` 整条替换（有的盟约本来就有两条同 key 的条目，按键合并表达不了）；否则按 `key` 合并。
  let buffs = baseBuffs;
  if (Array.isArray(zj.buffsAll)) {
    buffs = zj.buffsAll.slice();
  } else if (Array.isArray(zj.buffs)) {
    const byKey = new Map();
    for (const b of baseBuffs) if (b && b.key != null) byKey.set(b.key, b);
    for (const b of zj.buffs) {
      if (!b || b.key == null) continue;
      const prev = byKey.get(b.key);
      byKey.set(b.key, prev
        ? { ...prev, ...b, bb: { ...(prev.bb || {}), ...(b.bb || {}) }, bbStr: { ...(prev.bbStr || {}), ...(b.bbStr || {}) } }
        : b);
    }
    buffs = [...byKey.values()];
  }
  // 回写：`env_gbuff_new` 与顶层 `bb` / `bbStr` 永远保持同一份数值
  const envIdx = buffs.findIndex((b) => b && b.key === 'env_gbuff_new');
  if (envIdx >= 0) {
    buffs = buffs.slice();
    buffs[envIdx] = { ...buffs[envIdx], bb, bbStr };
  }
  // 按 buff 分派：上面合并出的 `bb` 只回写了 `env_gbuff_new`，可每条 buff 各有自己的数值袋
  // （远见的折扣在 `bond_multi_layer_char_goods_price_bond_discount`，奇迹的概率在
  // `bond_refresh_shop_next_free`）。只回写 env 会让它们的 `zj.bb` 覆盖【静默失效】：
  // 远见 `zj.bb.layer2 = 200` 没生效 → 读到的仍是 150 → 150 层就触发第三档。
  // 规则：`zj.bb` / `zj.bbStr` 里的键，只覆盖【该 buff 自己的 bb 里本来就有】的同名键
  // （键不存在就不硬塞，免得把 layer2 之类写进无关的 buff）。
  const zjBb = (zj.bb && typeof zj.bb === 'object') ? zj.bb : null;
  const zjBbStr = (zj.bbStr && typeof zj.bbStr === 'object') ? zj.bbStr : null;
  if ((zjBb || zjBbStr) && Array.isArray(buffs) && buffs.length) {
    let changed = false;
    const next = buffs.map((b) => {
      if (!b || typeof b !== 'object' || b.key === 'env_gbuff_new') return b;   // env 已在上面回写
      const hitBb = {}, hitStr = {};
      if (zjBb) for (const k of Object.keys(zjBb)) if (b.bb && Object.hasOwn(b.bb, k)) hitBb[k] = zjBb[k];
      if (zjBbStr) for (const k of Object.keys(zjBbStr)) if (b.bbStr && Object.hasOwn(b.bbStr, k)) hitStr[k] = zjBbStr[k];
      if (!Object.keys(hitBb).length && !Object.keys(hitStr).length) return b;
      changed = true;
      return { ...b, bb: { ...(b.bb || {}), ...hitBb }, bbStr: { ...(b.bbStr || {}), ...hitStr } };
    });
    if (changed) buffs = next;
  }
  if (buffs !== baseBuffs) out.buffs = buffs;
  delete out[blockKey];
  delete out.zj;   // `zj` 块永不出现在结果里（即使它是别的键名下的覆盖块，基础记录若自带 `zj` 也一并剥掉）
  return out;
}

/**
 * 炸惊视图：`{ [bondId]: 合并后的记录 }`。没有 `zj` 的盟约**原样引用**（不复制），所以普通模式的调用方
 * 即使误用也不会拿到被改过的对象。
 * @param {Record<string, any>} bonds data/bonds.json（或它的等价值）
 * @param {{ merge?: boolean }} [opts] `merge: false` → 只把 `zj` 键剥掉，不做任何覆盖（普通难度用，避免把
 *   覆盖块漏给客户端）；`zjOnly` 的盟约在非炸惊下整条剔除
 * @returns {Record<string, any>} 新的映射；没有任何 `zj` 时返回入参本身
 */
export function zjBondView(bonds, { merge = true } = {}) {
  return overlayBondView(bonds, 'zj', { merge });
}

/**
 * 覆盖块视图（泛化版）：`{ [bondId]: 合并后的记录 }`。没有覆盖块的盟约**原样引用**（不复制），所以普通模式的调用方
 * 即使误用也不会拿到被改过的对象。
 * @param {Record<string, any>} bonds data/bonds.json（或它的等价值）
 * @param {string} blockKey 覆盖块的键名（`'zj'` / `'ann'`）
 * @param {{ merge?: boolean }} [opts] `merge: false` → 只把覆盖块剥掉，不做任何覆盖；带 `<blockKey>Only: true` 的盟约
 *   （`zjOnly` 的 5 条、`annOnly` 的 2 条）在非合并视图下**整条剔除** —— 否则官方四档与另一个玩法包会列出一条自己
 *   永远用不上的盟约（`devtools/check-mode-isolation.mjs` 会红）
 * @returns {Record<string, any>} 新的映射；没有任何覆盖块时返回入参本身
 */
export function overlayBondView(bonds, blockKey, { merge = true } = {}) {
  if (!bonds || typeof bonds !== 'object') return bonds;
  const onlyKey = `${blockKey}Only`;
  let out = null;
  for (const [id, rec] of Object.entries(bonds)) {
    if (!merge && rec?.[onlyKey] === true) {
      if (!out) out = { ...bonds };
      delete out[id];
      continue;
    }
    if (!rec || !rec[blockKey] || typeof rec[blockKey] !== 'object') continue;
    if (!out) out = { ...bonds };
    out[id] = merge ? overlayBondRecord(rec, rec[blockKey], blockKey) : stripBlock(rec, blockKey);
  }
  return out || bonds;
}

/** 记录去掉覆盖块 `blockKey`（其它字段逐字节不变）。 */
function stripBlock(rec, blockKey) {
  const out = { ...rec };
  delete out[blockKey];
  return out;
}

/**
 * 炸惊视图里被改过的盟约 → 它的 `zj` 块。给「战斗模拟按 modeId 取覆盖」用：模拟侧拿到的是整份 bonds，
 * 它只需要知道哪些键要换。
 */
export function zjPatches(bonds) {
  return overlayPatches(bonds, 'zj');
}

/** 覆盖块视图里被改过的盟约 → 它的覆盖块（泛化版；供战斗模拟按 modeId 取覆盖）。 */
export function overlayPatches(bonds, blockKey) {
  const out = {};
  for (const [id, rec] of Object.entries(bonds || {})) if (rec && rec[blockKey] && typeof rec[blockKey] === 'object') out[id] = rec[blockKey];
  return out;
}

// =====================================================================================================================
// 湮灭模拟的 `ann` 覆盖层（2026-10-28）
//
// 语义与炸惊的 `zj` 块**完全同一套合并规则**（`overlayBondView(bonds, 'ann')`），只是门不同：`ann` 只在
// `gd.annihilation` 非空（difficulty === 'ANNIHILATION'）时被读，官方四档与炸惊一律读原记录。
// 这里只提供「把 ann 合并出来」的两个便捷入口，不负责安装视图 —— 战斗侧的安装点由 engine-core 的 Battle 决定。

/** 湮灭视图：`{ [bondId]: 合并了 ann 块的记录 }`（其它记录原样引用）。 */
export function annBondView(bonds) {
  return overlayBondView(bonds, 'ann');
}

/** 湮灭视图里被改过的盟约 → 它的 `ann` 块。 */
export function annPatches(bonds) {
  return overlayPatches(bonds, 'ann');
}

// =====================================================================================================================
// 超限模拟的 `inf` 覆盖层（2026-10-31）
//
// 语义与 `zj` / `ann` **完全同一套合并规则**（`overlayBondView(bonds, 'inf')`），只是门不同：`inf` 只在
// `gd.overlimit`（solo_infinite / coop_infinite）为真时被读，官方四档 / 炸惊 / 湮灭一律读原记录并把 `inf` 键剥掉。
// 本轮 `inf` 块**只带文案**（desc / descRaw / effectDesc / effectDescRaw：原版原文 + 追加的超限专属行），
// 数值全部在战斗侧（server/sim/content/bonds/core.js 的具名常量），所以这里不涉及 bb。

/** 超限视图：`{ [bondId]: 合并了 inf 块的记录 }`（其它记录原样引用）。 */
export function infBondView(bonds) {
  return overlayBondView(bonds, 'inf');
}

/** 超限视图里被改过文案的盟约 → 它的 `inf` 块。 */
export function infPatches(bonds) {
  return overlayPatches(bonds, 'inf');
}

// =====================================================================================================================
// 炸惊专用「装备组合激活盟约」
//
// 需求 15 / 16：同时装备【护盾无人机】和【变形同构体】获得企鹅物流盟约；同时装备【M3茧甲】和【变形同构体】获得
// 医师盟约。原版机制（data/items.json 的 `canGiveBond` + `giveBondId`）是**全模式生效**的，所以这里另开一张只在
// 炸惊下读取的组合表，写在各盟约的 `zj.equipCombo` 里。

/** 一件装备的注册键：id 去掉 `_a` / `_b` 后缀（与 sim 的 itemKeyOf / match 的 itemKeyOf 一致）。 */
export const zjItemKeyOf = (id) => String(id ?? '').replace(/_[ab]$/, '');

/**
 * 组合表：`[{ bondId, items: [itemKey, ...] }]`，按 bonds.json 的顺序，来自各盟约的 `zj.equipCombo`。
 * @param {Record<string, any>} bonds data/bonds.json
 */
export function zjEquipCombos(bonds) {
  const out = [];
  for (const [bondId, rec] of Object.entries(bonds || {})) {
    const zj = rec && rec.zj;
    if (!zj || !Array.isArray(zj.equipCombo)) continue;
    const items = zj.equipCombo.map(zjItemKeyOf).filter(Boolean);
    if (items.length) out.push({ bondId, items });
  }
  return out;
}

/**
 * 一组装备 id 命中的组合盟约 id（去重）。每张组合表要求 `items` 里的每一件都在场（普通 / 进阶都算，按注册键比）。
 * @param {Iterable<string>} itemIds 干员身上的装备 id
 * @param {Array<{ bondId: string, items: string[] }>} combos zjEquipCombos 的结果
 * @returns {string[]}
 */
export function equipComboBonds(itemIds, combos) {
  const have = new Set([...(itemIds || [])].map(zjItemKeyOf).filter(Boolean));
  const out = [];
  for (const c of Array.isArray(combos) ? combos : []) {
    if (!c || !c.bondId || out.includes(c.bondId)) continue;
    if (c.items.every((k) => have.has(k))) out.push(c.bondId);
  }
  return out;
}
