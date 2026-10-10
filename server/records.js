// server/records.js — 无尽模式 (ENDLESS) 的最高回合记录。
//
// 无尽没有胜负：成绩就是「坚持过的回合数」。对局结束时由 Match.finish 调用 recordEndlessResult，
// 按玩家名（社区服的玩家没有跨连接稳定 ID，重连 token 每次会话都会变）累积历史最高回合，并持久化到
// data/endless-records.json。结算页读取返回的 best / bestNew，管理后台用 endlessLeaderboard 展示榜单。
//
// 文件格式：
//   { version: 1, best: { "<name>": { name, rounds, last, runs, solo, difficulty, playerId, at } }, top: [...] }
//
// 入榜难度：只有「无尽·终极」（ENDLESS_ABYSS）的成绩进排行榜（服务器主人的要求 —— 四档底难度的无尽
// 敌方强度不同，成绩不可比，低难度刷出来的回合数没有参考价值）。其它难度的对局照样写进 best、
// 结算页照常显示自己的最高回合，但不进 top / 榜单，也不参与排名。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'endless-records.json');
/** 榜单最多保留多少名玩家。 */
const MAX_ENTRIES = 500;
/** 唯一计入排行榜的无尽难度（`mode_{single,multi}_endless_abyss`）。 */
export const RANK_DIFFICULTY = 'ENDLESS_ABYSS';

let cache = null;

function load() {
  if (cache) return cache;
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { raw = null; }
  if (!raw || typeof raw !== 'object') raw = {};
  cache = {
    version: 1,
    best: raw.best && typeof raw.best === 'object' ? raw.best : {},
    top: Array.isArray(raw.top) ? raw.top : [],
  };
  return cache;
}

/** 立即落盘（每局结束才调用一次，同步写足够便宜，且不惧进程随后退出）。 */
function saveNow() {
  try {
    const rec = load();
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, `${JSON.stringify(rec, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false; // 记录失败不影响对局
  }
}

/** 玩家的记录键：优先显示名（社区服的稳定标识），退化为 playerId。 */
const keyOf = (ps) => String((ps && (ps.name || ps.playerId)) || 'unknown');

/**
 * 记录一局无尽对局的结果。
 *
 * best 记录每一档难度（结算页据此显示「历史最高回合」），但返回给结算页的 best / bestNew 只在
 * 本局难度计入排行榜（无尽·终极）时填充 —— 其它难度不上榜，结算页也就不显示「刷新纪录」。
 * @param {import('./match/Match.js').Match} match
 * @returns {{ best: Map<string, number>, bestNew: Set<string> }} playerId → 历史最高回合 / 本局刷新纪录的 playerId
 */
export function recordEndlessResult(match) {
  const rec = load();
  const best = new Map();
  const bestNew = new Set();
  const rounds = Math.max(0, (Number(match.round) || 1) - 1);
  const diff = String(match.difficulty || '');
  const ranked = diff === RANK_DIFFICULTY;
  const players = match.players instanceof Map ? [...match.players.values()] : [];
  for (const ps of players) {
    if (!ps || ps.isBot) continue;
    const key = keyOf(ps);
    const prev = rec.best[key] && typeof rec.best[key] === 'object' ? rec.best[key] : null;
    const prevRounds = prev && Number.isFinite(prev.rounds) ? Math.max(0, Math.floor(prev.rounds)) : 0;
    const isNew = rounds > prevRounds;
    rec.best[key] = {
      name: String(ps.name || ''),
      rounds: Math.max(prevRounds, rounds),
      last: rounds,
      runs: (prev && Number.isFinite(prev.runs) ? prev.runs : 0) + 1,
      solo: !!match.isSolo,
      difficulty: diff,
      playerId: ps.playerId,
      at: Date.now(),
    };
    if (!ranked) continue;
    best.set(ps.playerId, rec.best[key].rounds);
    if (isNew) bestNew.add(ps.playerId);
  }
  // 榜单只收无尽·终极：先按难度过滤再排序切片，免得低难度的高回合把终极成绩挤出 MAX_ENTRIES。
  rec.top = Object.values(rec.best)
    .filter((r) => r && Number.isFinite(r.rounds) && String(r.difficulty || '') === RANK_DIFFICULTY)
    .sort((a, b) => b.rounds - a.rounds || (a.at || 0) - (b.at || 0))
    .slice(0, MAX_ENTRIES);
  saveNow();
  return { best, bestNew };
}

/**
 * 无尽最高回合榜单（降序）。
 *
 * 只含「无尽·终极」（RANK_DIFFICULTY）的成绩 —— 见文件头的入榜说明。
 * @param {number} [limit]
 */
export function endlessLeaderboard(limit = 50) {
  return endlessLeaderboardAll().slice(0, Math.max(1, Math.floor(limit) || 50));
}

/** 完整榜单（已排序，最多 MAX_ENTRIES 条；只含无尽·终极）。 */
export function endlessLeaderboardAll() {
  const rec = load();
  return rec.top
    .filter((r) => r && Number.isFinite(r.rounds) && String(r.difficulty || '') === RANK_DIFFICULTY)
    .map((r) => ({ ...r }));
}

/** 某位玩家的历史最高回合（0 = 无记录）。 */
export function bestRoundsOf(name) {
  const rec = load();
  const row = name && rec.best[String(name)];
  return row && Number.isFinite(row.rounds) ? row.rounds : 0;
}

/** 测试 / 运维用：清空内存缓存，下次读取重新落盘加载。 */
export function resetRecordsCache() { cache = null; }
