// test/ui/annihilation-endless-rounds.test.js — 蚀流 6 · 无尽湮灭（m.public.endless === true、lastRound === null）的
// 回合显示。无尽局没有「满回合」（server/match/gamedata.js 的 lastRound 对 endless 返回 null），客户端不能把假回合数
// 写进界面：
//   ① 简报 / 敌方情报的「第 {r} 回合 · 最终攻势」取引擎逐回合算的 m.public.bossRound（server/match/match/views.js），
//      不是数据里定死的 mode.bossRound（config.json 里湮灭两个 mode 都是 19）：无尽第一章是 R14，R26 的下一章是 R29，
//      R33 起每 3 回合一章；蚀流 5（30 回合）的最终攻势是 R29，也不是 19。
//   ② 结算页的「/N」在无尽局不出现：m.result 本身不带 lastRound（server/match/results.js），normalizeResult 原先的
//      14 兜底会把「/14」写到一场没有终点的结算上——现在同超限局（isInfinite）传 null。
//   ③ HUD 的回合框只有当前回合（没有 /N），唯一读 lastRound 的是「??」判定且带 isFinite 守卫：无尽局 lastRound 为
//      null，守卫不成立 → 回合数字照常显示。
// 普通 14 回合与超限（isInfinite）是回归对照，行为必须不变。视图是 hook-free 的纯函数，直接画 vnode 树（同
// test/ui/match-info.test.js）；本机沙箱下 node --test 会 spawn EPERM，直接 `node test/ui/annihilation-endless-rounds.test.js`。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { data } = await import('../../public/js/data.js');
await data.loadAll('config', 'bosses', 'enemies', 'stages', 'factions', 'bonds', 'chess', 'assets');
const { MatchEnemies } = await import('../../public/js/ui/matchEnemies.js');
const { EnemyDrawer } = await import('../../public/js/ui/enemyDrawer.js');
const { makeLookups } = await import('../../public/js/ui/gameComponents.js');
const { normalizeResult } = await import('../../public/js/ui/gameLogic.js');

const gd = makeLookups();
const SRC_RESULT = read('public/js/screens/result.js');
const SRC_HUD = read('public/js/ui/hud.js');

// ---- vnode helpers — test/ui/match-info.test.js's shape, plus drawing the hook-free 敌方情报 tab -------------------------
const EXPAND = new Set(['EnemiesTab']);
function textOf(v, depth = 0) {
  if (Array.isArray(v)) return v.map((x) => textOf(x, depth)).join('');
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v !== 'object') return String(v);
  if (typeof v.type === 'function') return depth < 3 && EXPAND.has(v.type.name) ? textOf(v.type({ ...v.props }), depth + 1) : '';
  return textOf(v.props?.children, depth);
}
/** The briefing's text; fails on the three bad words the task names. */
const brief = (pub) => clean(textOf(MatchEnemies({ pub, gd })));
/** The 敌方情报 drawer's text (the boss block lives there). */
const drawer = (pub) => clean(textOf(EnemyDrawer({ tab: 'enemies', onTab: () => {}, pub, priv: { nextEnemies: [] }, onClose: () => {}, onEnemy: () => {}, onChess: () => {} })));
function clean(text) {
  assert.doesNotMatch(text, /undefined|NaN/, '回合文案不含 undefined / NaN');
  assert.doesNotMatch(text, /\bnull\b/, '回合文案不含 null');
  return text;
}

const pub = (over) => ({ modeId: 'mode_single_annihilation', difficulty: 'ANNIHILATION', erosion: 6, endless: true, lastRound: null, bossRound: 14, round: 1, bossId: 'boss_1', stageId: null, factions: [], ...over });

// ---- ①「第 {r} 回合 · 最终攻势」 ------------------------------------------------------------------------------------
test('简报：无尽局的最终攻势取 m.public.bossRound（R26 → 下一章 R29），不写数据的 19、也不落 14 的兜底', () => {
  // R26 已在 [24,25] 之后、[29,30] 之前：引擎的 bossRoundFor(26) = 29；config 的 mode.bossRound 恒为 19
  const text = brief(pub({ round: 26, bossRound: 29 }));
  assert.match(text, /第 29 回合 · 最终攻势/);
  assert.doesNotMatch(text, /第 (14|19) 回合 · 最终攻势/, '不退到数据的 19 或兜底的 14');
});

test('简报：无尽第一章的最终攻势是 R14（引擎的 [14,15]），此前被数据的 19 抢走', () => {
  const text = brief(pub({ round: 1, bossRound: 14 }));
  assert.match(text, /第 14 回合 · 最终攻势/);
  assert.doesNotMatch(text, /第 19 回合/);
});

test('简报：蚀流 5（30 回合）的最终攻势是 R29，同样不吃数据的 19', () => {
  const text = brief(pub({ erosion: 5, endless: false, lastRound: 30, round: 1, bossRound: 29 }));
  assert.match(text, /第 29 回合 · 最终攻势/);
  assert.doesNotMatch(text, /第 19 回合/);
});

test('敌方情报（局内抽屉）：无尽局写引擎的当前章节，不写 19', () => {
  const endless = drawer(pub({ round: 26, bossRound: 29 }));
  assert.match(endless, /第 29 回合 · 最终攻势/);
  assert.doesNotMatch(endless, /第 (14|19) 回合 · 最终攻势/);
  // 普通 14 回合的模式照旧
  assert.match(drawer({ modeId: 'mode_single_normal', lastRound: 14, bossRound: 14, round: 10, bossId: 'boss_1', factions: [] }), /第 14 回合 · 最终攻势/);
});

test('回归对照：普通 14 回合与超限（isInfinite）的最终攻势不变', () => {
  // 普通：数据与引擎都是 14
  assert.match(brief({ modeId: 'mode_single_normal', lastRound: 14, bossRound: 14, round: 10, bossId: 'boss_1', factions: [] }), /第 14 回合 · 最终攻势/);
  // 超限：gd.bossRound 仍是该 mode 的 14（超限的每 5 回合 Boss 关口不改这个「最终攻势」文案）
  const inf = brief({ modeId: 'mode_single_abyss', isInfinite: true, lastRound: null, bossRound: 14, round: 22, bossId: 'boss_1', factions: [] });
  assert.match(inf, /第 14 回合 · 最终攻势/);
});

// ---- ② 结算页的「/N」 ----------------------------------------------------------------------------------------------
test('结算：无尽局 lastRound 传 null（不落 14），普通 14 与超限不变', () => {
  const raw = { victory: false, roundsPassed: 9, players: [{ playerId: 'p_0', seat: 0, alive: true, lp: 3 }] };
  const endless = normalizeResult(raw, { modeId: 'mode_single_annihilation', difficulty: 'ANNIHILATION', erosion: 6, endless: true, lastRound: null });
  assert.equal(endless.lastRound, null, '无尽局没有满回合');
  assert.equal(endless.isInfinite, false, '无尽湮灭不是超限模式');
  assert.ok(Number.isFinite(endless.roundsPassed));
  assert.equal(normalizeResult({ ...raw, endless: true }, null).lastRound, null, '结算帧自带 endless 时同样不落 14');
  // 普通 14 回合照旧（pub.lastRound 与缺省兜底都是 14）
  assert.equal(normalizeResult(raw, { modeId: 'mode_single_normal', round: 9, lastRound: 14 }).lastRound, 14);
  assert.equal(normalizeResult(raw, { modeId: 'mode_single_normal' }).lastRound, 14);
  // 超限照旧 null
  assert.equal(normalizeResult({ ...raw, isInfinite: true }, { modeId: 'mode_single_abyss', isInfinite: true, lastRound: null }).lastRound, null);
});

test('结算页的 /N 与 HUD 回合框：守卫仍在（无限局因此什么都不写）', () => {
  // 结算页的「/N」只在 lastRound 是有限数时渲染；normalizeResult 给 null → 无尽局不写 /N
  assert.match(SRC_RESULT, /Number\.isFinite\(r\.lastRound\) && r\.roundsPassed <= r\.lastRound/);
  // HUD 只有当前回合：唯一读 lastRound 的是「隐藏核心 ??」判定（同一行），且带 isFinite 守卫（无尽局 null → 不隐藏）
  const hudLastRound = SRC_HUD.split(/\r?\n/).filter((line) => line.includes('lastRound'));
  assert.equal(hudLastRound.length, 1, 'HUD 只有一行读 lastRound，不渲染任何 /N');
  assert.match(hudLastRound[0], /const hidden = phase === PHASE\.HIDDEN_CORE \|\| \(Number\.isFinite\(pub\?\.lastRound\) && pub\.round > pub\.lastRound\);/);
  assert.doesNotMatch(SRC_HUD, /\/\$\{[^}]*lastRound/, 'HUD 没有 /lastRound 这种写法');
  assert.match(SRC_HUD, /const roundText = hidden \? '\?\?' : /);
});
