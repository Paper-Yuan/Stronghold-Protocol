// server/sim/content/kits/shared/mod-tier3.js — MOD：我们自研 kit 在 v0.1.4 时代共用的文件级 helper。
//
// 来源：server/sim/content/kits/tier3.js（上游 v0.1.4 时代的单体 kit 文件）prologue 里的私有 helper。上游
// v0.2.x 把 kits/tierN.js 拆成 shared/tierN.js + ops/op-*.js，我们的三段自研 tier-3 kit 也随之搬进 ops/；
// 其中 **结城理 / 阿米娅(医疗)** 两段依赖下面这批 helper，所以在这里集中一份 —— 既不复制进两个 op 文件，
// 也不混进上游的 shared/tier1.js（那份要和上游逐字节一致，下次同步才不会漂）。
//
// 注意两处与上游 shared/tier1.js **同名但不同实现**的东西，按我们原有的行为保留：
//   · num(v, d)：这里只接受 number（上游那份额外接受数字字符串）；
//   · talentBb / traitBb：这里按 **def**（normalise 后的记录）取 talent[i].bb / traitBb，上游那份按
//     raw chess 记录取（并且会过滤掉 data index −1 的隐藏 module talent）。
// 两段 kit 的数值都来自 data/chess.json / data/backups.json 的 blackboard，换实现会改变行为，故不换。
//
// 用法： `import { num, skillData, … } from '../shared/mod-tier3.js';`
import { COLS } from '../../../constants.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';
import { bodyInKeys } from '../../../body.js';
import { normalizeChess, normalizeSkill } from '../../../simdata.js';
import { tacticalPoint as sharedTacticalPoint } from '../../tokens.js';

/** 结城理's <替身> clip-set change (render/units.js FORMS `char_4217_makoto`): the *SwitchIn / *SwitchOut clip length. */
export const MASK_SWITCH = 0.5;

export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const defOf = (chess, def) => def ?? normalizeChess(chess);

export const talentBb = (d, i) => d?.talents?.[i]?.bb ?? {};

export const traitBb = (d) => d?.traitBb ?? {};

/** Id of the SELECTED skill the kit is built for (DESIGN §16: `bb`, `chess.skill` and `def.skill` belong to it). */
export const selectedId = (chess, d) => d?.skill?.id ?? chess?.skill?.skillId ?? null;

/**
 * Normalised record (simdata normalizeSkill shape: bb, rangeGrid, maxCharges, duration, description, trigger) of the
 * selectable skill `id` at this chess's level: the selected one is `def.skill` with the kit's `bb`, any other comes
 * from `chess.skills[]` (DATA §2.2) — every spec of `skills` is built from its own numbers whichever skill is selected.
 */
export function skillData(chess, d, bb, id) {
  if (id != null && selectedId(chess, d) === id && d?.skill) return { ...d.skill, bb: bb ?? d.skill.bb ?? {} };
  const rec = (chess?.skills ?? []).find((s) => s && s.skillId === id);
  return (rec && normalizeSkill({ skill: rec })) || { id, bb: {}, rangeGrid: null, maxCharges: 1, duration: 0, description: '' };
}

/** `{ [skillId]: SkillSpec }` of the non-default selectable skills: `builders[id](skillData(id))` each. */
export function altSkills(chess, d, bb, builders) {
  const out = {};
  for (const [id, build] of Object.entries(builders)) out[id] = build(skillData(chess, d, bb, id));
  return out;
}

export const alive = (u) => !!(u && u.alive && u.deployed);

export const tileKeyOf = (u) => (u.side === 'ally' ? u.tileR * COLS + u.tileC : Math.round(u.y) * COLS + Math.round(u.x));

/** On a tile of `set`: an ally by its tile, an enemy by its body (every tile a huge enemy occupies — sim/body.js). */
export const onTiles = (x, set) => (x.side === 'ally' ? set.has(tileKeyOf(x)) : bodyInKeys(x, set));

export const gridKeys = (grid, u, ext = 0) => absoluteRangeKeys(grid || [[0, 0]], u.tileR, u.tileC, u.dir, ext);

export const fx = (battle, kind, u, extra = {}) => battle.fx(kind, { x: u.x, y: u.y, id: u.id, ...extra });

export const copyGrid = (g) => (Array.isArray(g) && g.length ? g.map((p) => [p[0], p[1]]) : null);

export const NINE = [[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]];

/**
 * A tile a summon may take: inside the field and not reserved (Battle.isReservedTile: nobody on it, no knocked-out
 * operator lying there, not the home tile of an ally that has not deployed yet / waits to redeploy — the initial
 * deployment runs one unit after another: a summon placed while it runs must not steal a later board unit's tile).
 */
export function freeTile(battle, r, c) {
  return Number.isInteger(r) && Number.isInteger(c) && battle.grid.inRect(r, c) && !battle.isReservedTile(r, c);
}

/** Walkable ground tile a melee summon can stand on. */
export const groundTile = (battle, r, c) => battle.grid.groundPassable(r, c) && battle.grid.canStand(r, c);

/**
 * Tactical point (战术点) of a tactician: `prefer` (the board piece's tile, i.e. the player's choice) when usable —
 * free, standable ground (never 深水区: grid.canStand) inside her initial range ("只能部署在召唤者攻击范围内"; the prep
 * already keeps the piece there, PlayerState._legal) —, else the shared tactical point (tokens.js tacticalPoint =
 * Battle.findTacticalPoint: a free walkable tile of its initial range on an enemy ground path first, then the nearest).
 */
export function tacticalPoint(battle, unit, prefer = null) {
  const inRange = (r, c) => (unit.baseRangeKeys || unit.rangeKeys || []).includes(r * COLS + c);
  if (prefer && freeTile(battle, prefer[0], prefer[1]) && groundTile(battle, prefer[0], prefer[1]) && inRange(prefer[0], prefer[1])) return prefer;
  return sharedTacticalPoint(battle, unit);
}

/** Targetable enemies on `keys`, sorted by the unit's priority (at most `n` when n > 0). */
export function enemiesOn(battle, unit, keys, n = 0, profile = null) {
  const list = battle.enemiesInKeys(keys, unit, profile ?? { canHitFly: true });
  sortEnemyTargets(battle, unit, list, (profile ?? unit.profile)?.priority ?? null);
  return n > 0 && list.length > n ? list.slice(0, n) : list;
}
