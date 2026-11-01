// ui/zjView.js — 拓展玩法的「官方视图」判据（三态：官方 / 炸惊 / 湮灭），只给界面用。
//
// 数据层是一份：`data/bonds.json` 里既有官方盟约，也有炸惊的 5 条 `zjOnly` 盟约（岁 / 企鹅物流 / 医师 / S.E.E.S /
// 颂乐人偶）和湮灭的 2 条 `annOnly` 盟约（罗德岛 / 卡兹戴尔）；`data/bands.json` 里有炸惊的 2 条 `zjOnly` 策略
// （`band_zj_fuuka` / `band_zj_si`）。引擎侧 `GameData` 会按模式剔除，但**界面直接读 `data.list('bonds')` /
// `list('bands')`**，那条路绕过了 GameData —— 于是官方房间的「本局信息 / 盟约列表 / 卡池总览 / 战绩报告」会多出
// 专属内容，炸惊房里又会多出湮灭专属盟约（业主 2026-10-28 真机验收 P0-1）。
//
// 所以：任何**按全量盟约 / 策略渲染**的界面都过一遍 `officialBonds(list, modeId | difficulty)` /
// `officialBondsFor(list, mode)` / `officialBands(list, modeId | difficulty)`。判据与引擎同一口径：
//   · 官方（非拓展）：既没有 `zjOnly`，也没有 `annOnly`；
//   · 炸惊：有 `zjOnly`，没有 `annOnly`；
//   · 湮灭：有 `annOnly`，没有 `zjOnly`。
// 旗标之外还认「专属记录」本身（与引擎的「官方子集」同一写法）：`rec.zhajing === true || /^chess_zj_/.test(id)` 那套
// 用在棋子上，盟约/策略用 `zjOnly` / `annOnly` 两个显式旗标。

/** 这个 modeId / difficulty 是不是炸惊（与 `shared/zhajing-constants.js` 的 isZhajing* 同一判据）。 */
export const isZhajingRoom = (v) => {
  const s = String(v ?? '');
  return /zhajing/i.test(s) || s.toUpperCase() === 'ZHAJING';
};

/** 这个 modeId / difficulty 是不是湮灭（`ANNIHILATION_DIFFICULTY` / `mode_*_annihilation`）。 */
export const isAnnihilationRoom = (v) => {
  const s = String(v ?? '');
  return /annihilation/i.test(s) || s.toUpperCase() === 'ANNIHILATION';
};

/**
 * 当前房间属于哪一档（'zhajing' | 'annihilation' | 'official'）。炸惊优先：ZHAJING 房不会同时是湮灭房。
 * @param {string} [modeId] `m.public.modeId` 或难度
 * @returns {'official'|'zhajing'|'annihilation'}
 */
export function extensionRoomOf(modeId) {
  if (isZhajingRoom(modeId)) return 'zhajing';
  if (isAnnihilationRoom(modeId)) return 'annihilation';
  return 'official';
}

/** 一条记录是否某档专属（显式旗标；没有旗标 = 官方内容）。 */
const onlyOf = (rec) => (rec && rec.zjOnly === true ? 'zhajing' : rec && rec.annOnly === true ? 'annihilation' : null);

/**
 * 官方视图的盟约列表 —— 三态版：只留下「当前这一档能看见」的记录。
 * 入参就是 `data.list('bonds')` 或 `gd.list('bonds')` 的返回值；不是数组时返回 `[]`。
 * @param {any} list
 * @param {string} [modeId] 本局的 modeId（`m.public.modeId`）或难度（`m.public.difficulty`）；缺省 = 官方
 */
export function officialBonds(list, modeId) {
  const arr = Array.isArray(list) ? list : [];
  const room = extensionRoomOf(modeId);
  if (room === 'official') return arr.filter((b) => onlyOf(b) === null);
  return arr.filter((b) => { const only = onlyOf(b); return only === null || only === room; });
}

/** 当前这一档的「专属盟约」（给页面分组用：炸惊房里把 5 条单独标出来）。 */
export function extensionBondsOf(list, modeId) {
  const arr = Array.isArray(list) ? list : [];
  const room = extensionRoomOf(modeId);
  if (room === 'official') return [];
  return arr.filter((b) => onlyOf(b) === room);
}

/**
 * 官方视图的策略列表（`bands.json`）：`zjOnly` 的两条只在炸惊房里出现；湮灭没有专属策略，所以湮灭房照官方规则。
 * @param {any} list `data.list('bands')`
 * @param {string} [modeId] `m.public.modeId` 或难度
 */
export function officialBands(list, modeId) {
  const arr = Array.isArray(list) ? list : [];
  const room = extensionRoomOf(modeId);
  return arr.filter((b) => {
    const only = onlyOf(b);
    return only === null || only === room;
  });
}
