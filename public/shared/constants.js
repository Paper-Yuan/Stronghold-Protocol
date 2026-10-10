// Shared enums & constants (server + browser). Pure ESM, no Node APIs.

export const PROTOCOL_VERSION = 1;
/** Release version shown to players (title screen, server banner, /healthz). Kept equal to package.json "version"
 * (test/version.test.js); PROTOCOL_VERSION above is the separate wire-format number. */
export const APP_VERSION = '0.2.3-fusion';

export const MAX_SEATS = 4;
/**
 * Spectator seats of a co-op room (community report #26, owner's decision 2026-10-04) — a remake feature: the official
 * room has 1–4 players and no spectator seat (there only eliminated players and 联防 bystanders watch, research 09 §3.1).
 * A spectator never counts as a player, may not act, and watches like an eliminated player (server/lobby.js spectate,
 * server/match/Match.js addSpectator).
 */
export const MAX_SPECTATORS = 2;
export const ROOM_CODE_LEN = 4;
export const NAME_MAX_LEN = 12;

/** The four base difficulties, hardest last — the chips of every difficulty picker (大厅 §04 / 房间底栏). */
export const PICK_DIFFICULTIES = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'];
/** Every difficulty a room may hold. */
export const DIFFICULTIES = [...PICK_DIFFICULTIES];
export const DIFFICULTY_NAMES = {
  FUNNY: '标准模拟', NORMAL: '险境模拟', HARD: '绝境模拟', ABYSS: '终极模拟',
};
export const DIFFICULTY_COLORS = {
  FUNNY: '#f6a329', NORMAL: '#e85a1a', HARD: '#e73118', ABYSS: '#ff0024',
};

// modeId in data/config.json = `mode_${type}_${difficulty.toLowerCase()}` with type single|multi.
export const modeIdFor = (roomMode, difficulty) => {
  const t = roomMode === 'solo' ? 'single' : 'multi';
  return `mode_${t}_${String(difficulty).toLowerCase()}`;
};

/**
 * 回合 r 是否为 Boss 回合，依据 m.public 视图（服务端 gamedata.isBossRound 的客户端镜像）：bossRound / hiddenRound。
 * @param {{ bossRound?: number|null, hiddenRound?: number|null }} pub
 * @param {number} r
 */
export const isBossRoundOf = (pub, r) => {
  const n = Number(r);
  if (!Number.isInteger(n) || n < 1) return false;
  if (!pub || typeof pub !== 'object') return false;
  return n === pub.bossRound || n === pub.hiddenRound;
};

export const PHASE = Object.freeze({
  LOBBY: 'LOBBY',
  INFO_CHECK: 'INFO_CHECK',
  BAND_DRAFT: 'BAND_DRAFT',
  BATTLE_CHECK: 'BATTLE_CHECK',
  ROUND_START: 'ROUND_START',
  SP_DRAFT: 'SP_DRAFT',
  PREP: 'PREP',
  COMBAT: 'COMBAT',
  UNITE: 'UNITE',
  SETTLE: 'SETTLE',
  FINAL_ASSAULT: 'FINAL_ASSAULT',
  HIDDEN_CORE: 'HIDDEN_CORE',
  RESULT: 'RESULT',
});

export const PHASE_NAMES = {
  LOBBY: '等待中', INFO_CHECK: '确认本局信息', BAND_DRAFT: '选择策略', BATTLE_CHECK: '协议启动',
  ROUND_START: '回合开始', SP_DRAFT: '机变阶段', PREP: '休整期', COMBAT: '作战中', UNITE: '联防阶段',
  SETTLE: '结算', FINAL_ASSAULT: '最终攻势', HIDDEN_CORE: '隐秘核心', RESULT: '模拟结束',
};

// Board geometry on the 19x21 stage grid (row 0 = bottom). See DESIGN §3.
export const GEO = Object.freeze({
  ROWS: 19, COLS: 21,
  FIELD: { r0: 9, r1: 12, c0: 2, c1: 10 },        // own deployable board region
  NORMAL_RECT: { r0: 9, r1: 12, c0: 0, c1: 10 },  // simulation rect for a normal battle
  UNITE_RECT: { r0: 9, r1: 12, c0: 0, c1: 20 },
  BOSS_RECT: { r0: 0, r1: 5, c0: 0, c1: 20 },
  HAND_ROW: 7, HAND_SIZE: 10,                      // hand slot idx = col 0..9
  TEMP_ROW: 8, TEMP_C0: 4, TEMP_SIZE: 5,           // temp slot idx 0..4 = cols 4..8
  PARTNER_COL_OFFSET: 8,
});

export const AREA = Object.freeze({ BOARD: 'board', HAND: 'hand', TEMP: 'temp', OUTSIDE: 'outside' });

export const PIECE_KIND = Object.freeze({ CHESS: 'chess', ITEM: 'item', TOKEN: 'token' });

/**
 * Whether the placed piece of a skill's summon (赫默's 医疗探机, 巫恋's 诅咒娃娃) also deploys once, for free, at the
 * battle start. true = the PRTS reading (卫戍协议/帮助 §作战阶段: "所有手动部署的召唤物，无视所属干员的持有状态…作战开始时
 * 立即部署一次", example 赫默's drone), settled by the user on 2026-10-01 after playtest #6 (DESIGN §20); false = the
 * playtest #4 reading ("是赫默开技能释放一次，不是开局直接就部署了"): it takes its tile only when the owner's skill gives one.
 * Either way the piece re-appears on its tile each time the owner's skill gives one.
 * One switch for everything that depends on it: the sim (server/sim/content/tokens.js dockSkillSummons) and the summon
 * card's hint (public/js/ui/detailPanel.js summonDeployHint). docs/PLAYING.md §4 and docs/SIM.md (token pieces) state
 * the rule in prose — test/ui/playtest6_summons.test.js fails until they match the value.
 */
export const SKILL_SUMMON_START_DEPLOY = true;

/**
 * Official per-bond layer cap (docs/research/11-limits-official.md §1): the client's
 * `Torappu.Battle.AutoChessBattleConst.MAX_GARRISON_STACK = 999`, and its bond counter (`AddBondCount`) stores
 * `min(L + n, 999)` — each bond stops at 999 on its own; the community reports bonds sitting at 999 while fed (巴哈姆特
 * 12534 "每把都能999层", 12316 "999謝"; research 02 §layers). The only implementation of the cap (DESIGN §20.12). Every
 * writer of a bond's layers goes through `layerGainRoom`: the prep-side gains (server/match/PlayerState.js addLayers —
 * 特质, items, bands, 机变 cards, bonds), the settle of the in-battle gains (server/match/Match.js) and the live in-battle
 * copy (server/sim/Battle.js addLayers, as the client's AddBondCount) — and the dev tools' direct writes (tools/matchrun.mjs
 * --layers, tools/balance.mjs applyBoard); a gain at the cap adds 0 (no onLayers, no 'layer'
 * event), and the client-result check (server/match/fields.js) bounds a reported gain by the room left. Milestones paid
 * per N layers (远见, 奇迹, 维多利亚 …) stop with the count. 0 / Infinity = no cap.
 */
export const BOND_LAYER_CAP = 999;

/**
 * 按层数结算的「里程碑发奖」（每 N 层…）所用的层数基准 —— 钉在官方 BOND_LAYER_CAP (999)。
 *
 * 里程碑内容（docs/research/11-limits-official.md §1）是面向 ≤ 999 层写死的：维多利亚「每 25 层 → 1 件装备」、
 * 远见「每 10 层 → 2 资金」、奇迹「每 100 层 → 20 资金」。如果发奖跟着层数一起放大，一局就能刷出几百件装备 /
 * 几万资金，既不是官方原意，也会让「手牌/临时区」被塞爆。所以发奖的 due 一律以本函数为准：`min(层数, 999)`。
 *
 * 只用于发奖计数（payHammers / settleCoins 的 due），不改层数本身——层数仍写到本局上限
 * （layerGainRoom + gd.bondLayerCap），其它读层数的战斗效果（谢拉格冷风时长、奇迹刷新概率、投资人 ×3 门槛）
 * 不受影响。层数本就 ≤ 999，此函数是恒等映射。
 */
export function milestoneLayers(layers) {
  const L = Number.isFinite(layers) && layers > 0 ? layers : 0;
  return BOND_LAYER_CAP > 0 ? Math.min(L, BOND_LAYER_CAP) : L;
}

/**
 * The layers a gain of `n` actually adds to a bond holding `before` under a cap: min(n, cap − before), never negative
 * (a count already at or over the cap gains 0 and is never lowered); 0 for a non-positive / non-finite `n` except
 * +Infinity (= "the room left"). `cap` defaults to BOND_LAYER_CAP (999).
 */
export function layerGainRoom(before, n, cap = BOND_LAYER_CAP) {
  if (!(n > 0)) return 0;
  const c = cap > 0 ? cap : Infinity; // 0 / Infinity / NaN = no cap (matches the old BOND_LAYER_CAP > 0 test)
  const b = Number.isFinite(before) && before > 0 ? before : 0;
  return Math.max(0, Math.min(n, c - b));
}

/**
 * Official boss-hit limit "限伤" (docs/research/11-limits-official.md §2): `AutoChessBattleConst.MAX_BATTLE_DAMAGE =
 * 300000`. In a boss battle outside training — our battle kinds 'boss' (Final Assault) and 'hidden' (Hidden Core) — a
 * single hit on a leader (`AutoChessBattleUtil.IsBossEnemy`: an enemyId of activity_table autoChessData.bossInfoDict
 * = data/bosses.json `enemyKey`; in the sim the tag-'boss' units: those leaders and their mirrored copies, never parts,
 * escorts or drones) whose `ceil(final damage)` ≥ this is CANCELLED: 0 damage, nothing credited to the shared pool
 * (`AutoChessStepModeManager._OnBossEnemyTakeDamage` → `modifier.Cancel()`). It is not a clamp: a hit of 299999 lands.
 * Checked in server/sim/damage.js (dealDamage after DEF / RES and every multiplier, before shields; Battle.loseHp).
 * Minions, normal rounds and 联防 are unaffected. 0 / Infinity = off.
 */
export const BOSS_HIT_LIMIT = 300000;

// Snapshot unit flag bits (DESIGN §8.2)
export const UF = Object.freeze({
  BLOCKED: 1, STUNNED: 2, FROZEN: 4, STEALTH: 8, SKILL: 16, SHIELD: 32, INVULN: 64, COLD: 128, SLEEP: 256, FLYING: 512,
});

export const ANIM = Object.freeze({ IDLE: 0, MOVE: 1, ATTACK: 2, SKILL: 3, DIE: 4, STUN: 5, DEPLOY: 6 });

export const ERR = Object.freeze({
  BAD_MSG: 'BAD_MSG',             // malformed / unknown message
  RATE: 'RATE',                   // rate limited
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_STARTED: 'ROOM_STARTED',
  NOT_HOST: 'NOT_HOST',
  NOT_READY: 'NOT_READY',
  WRONG_PHASE: 'WRONG_PHASE',
  NO_FUNDS: 'NO_FUNDS',
  HAND_FULL: 'HAND_FULL',
  BOARD_FULL: 'BOARD_FULL',
  BAD_TILE: 'BAD_TILE',
  BAD_TARGET: 'BAD_TARGET',
  SOLD_OUT: 'SOLD_OUT',
  MAX_LEVEL: 'MAX_LEVEL',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  ALREADY: 'ALREADY',
  TEMP_NOT_EMPTY: 'TEMP_NOT_EMPTY',
  ELIMINATED: 'ELIMINATED',
  SPECTATOR: 'SPECTATOR',         // a spectator seat only watches (MAX_SPECTATORS)
  MAINTENANCE: 'MAINTENANCE',     // server maintenance in progress / shutting down
  DEBUG: 'DEBUG',                 // a debug/cheat intent was refused (wrong secret, name not whitelisted, or disabled)
  BUSY: 'BUSY',
  INTERNAL: 'INTERNAL',
});

export const ERR_TEXT = {
  BAD_MSG: '无效的请求', RATE: '操作过于频繁', NOT_IN_ROOM: '你不在房间中', ROOM_NOT_FOUND: '未找到该同盟密钥对应的房间',
  ROOM_FULL: '房间已满', ROOM_STARTED: '模拟已开始', NOT_HOST: '只有房主可以操作', NOT_READY: '仍有玩家未就绪',
  WRONG_PHASE: '当前阶段无法进行该操作', NO_FUNDS: '资金不足', HAND_FULL: '整备区已满', BOARD_FULL: '已达到部署上限',
  BAD_TILE: '无法部署在该位置', BAD_TARGET: '无效的目标', SOLD_OUT: '已售出', MAX_LEVEL: '调度中心已达最高等级',
  NOT_YOUR_TURN: '尚未轮到你', ALREADY: '已完成该操作', TEMP_NOT_EMPTY: '临时整备区不为空', ELIMINATED: '你已被淘汰',
  SPECTATOR: '观战中无法进行该操作', MAINTENANCE: '服务器即将维护，暂时关闭入口', BUSY: '服务器当前对局已满载，正在保护对局稳定，请稍后进入', INTERNAL: '服务器内部错误',
  DEBUG: '调试指令被拒绝（口令错误、昵称不在白名单，或多人局中限制了全局操作）',
};

// ---- Debug / cheat gate (服务器主人专用调试模式) ----------------------------------------------------------------
// Server-authoritative and OFF unless the owner configures DEBUG_SECRET (server/debug.js): the client only asks,
// the match decides. `DEBUG_OPS` is the closed set of intents `g.debug` accepts; `DEBUG_VALUE_MAX` bounds the
// free-form `value` field, and `DEBUG_DEFAULTS` are the amounts used when `value` is absent or non-positive.
export const DEBUG_OPS = Object.freeze(['funds', 'setFunds', 'lp', 'maxLevel', 'kill', 'skip']);
export const DEBUG_VALUE_MAX = 100000000;
export const DEBUG_DEFAULTS = Object.freeze({ funds: 1000, lp: 100 });
// 作用范围超出请求者本人的调试操作：`kill` / `skip` 推进的是**全局限定回合阶段机**（备战结束、所有战场收尾、
// Boss 血池清零），`lp` 在最终攻势 / 隐秘核心阶段改的是**队伍合并生命池**。这些操作只要局内还有第二个真人就会
// 波及他人 —— Match.debugOp 因此在多人局里一律拒绝（单人局 / 只有自己一个真人时照常可用）。
export const DEBUG_GLOBAL_OPS = Object.freeze(['kill', 'skip']);
/** Human labels for the debug panel (client + logs). */
export const DEBUG_OP_NAMES = Object.freeze({
  funds: '增加资金', setFunds: '设定资金', lp: '增加生命', maxLevel: '商店满级', kill: '秒杀本回合', skip: '跳过本回合',
});

// ---- Emotes (交流, research 09 §4) -----------------------------------------------------------------------------
// The 36 official in-match emotes: display_meta_table emoticonData, scene AUTOCHESS_BATTLE, 6 themes × 6, one wheel
// page per theme in activity_table autoChessData.enabledEmoticonThemeIdList order, emotes by sortId. `g.emote { id }`
// / `m.emote { playerId, id }` carry the official emoji id. Generated reference: data/emotes.json
// (tools/build-emotes.mjs); test/ui/emotes.test.js keeps this table identical to it.
// Official emotes have no text (desc is null): `label` is ours and only ever an aria-label, never displayed.
// Art: extracted from a local client (tools/local-extract) to /assets/local/emoticon/<dir>/<picId>.png and listed in
// data/local-assets.json group `emoticon/<dir>`; also downloaded from the public mirror by tools/fetch-assets.mjs
// (tools/assets/plan.mjs UI_EXTRAS → data/assets.json ui['emoticon/<dir>/<picId>'], GitHub issue #42). The UI takes the
// local picture first, then the mirror copy, and shows a neutral glyph when neither is there. The picId is not
// derived from the id (autochess_battle_fooldoctor_03…06 → pic_fooldoctor_04/05/06/08_battle).
const emo = (id, sortId, picId, label) => Object.freeze({ id, sortId, picId, label });
export const EMOTE_THEMES = Object.freeze([
  { themeId: 'emoticon_autochess_basic', dir: 'basic', sortId: 100000, isBasic: true, name: '表情套组：卫戍协议', emotes: [
    emo('autochess_battle_happy', 1001, 'pic_happy_battle', '开心'),
    emo('autochess_battle_scared', 1002, 'pic_scared_battle', '害怕'),
    emo('autochess_battle_sorry', 1003, 'pic_sorry_battle', '对不起'),
    emo('autochess_battle_thanks', 1004, 'pic_thanks_battle', '谢谢'),
    emo('autochess_battle_thinking', 1005, 'pic_thinking_battle', '思考'),
    emo('autochess_battle_nice_cooperate', 1006, 'pic_cooperate_battle', '合作愉快'),
  ] },
  { themeId: 'emoticon_originium_slug', dir: 'slug', sortId: 1001, isBasic: false, name: '表情套组：虫动', emotes: [
    emo('slug_autochess_battle_nice_work', 2001, 'pic_nice_work_battle', '合作愉快！'),
    emo('slug_autochess_battle_thanks', 2002, 'pic_thanks_battle', '谢谢！'),
    emo('slug_autochess_battle_sorry', 2003, 'pic_sorry_battle', '对不起！'),
    emo('slug_autochess_battle_bye', 2004, 'pic_bye_battle', '再见！'),
    emo('slug_autochess_battle_distrust', 2005, 'pic_distrust_battle', '？？？'),
    emo('slug_autochess_battle_very_soon', 2006, 'pic_very_soon_battle', '很快就好！'),
  ] },
  { themeId: 'emoticon_autochess_basic_2', dir: 'basic_2', sortId: 100001, isBasic: true, name: '表情套组：卫戍协议', emotes: [
    emo('autochess_battle_noproblem', 1007, 'pic_noproblem_battle', '没问题！'),
    emo('autochess_battle_respect', 1008, 'pic_respect_battle', '敬礼！'),
    emo('autochess_battle_call', 1009, 'pic_call_battle', '欢呼！'),
    emo('autochess_battle_playingcool', 1010, 'pic_playingcool_battle', '酷！'),
    emo('autochess_battle_sad', 1011, 'pic_sad_battle', '伤心'),
    emo('autochess_battle_dying', 1012, 'pic_dying_battle', '快死了'),
  ] },
  { themeId: 'emoticon_foolsday_doctor', dir: 'fooldoctor', sortId: 1002, isBasic: false, name: '表情套组：博士士', emotes: [
    emo('autochess_battle_fooldoctor_01', 1020, 'pic_fooldoctor_01_battle', '博士士 1'),
    emo('autochess_battle_fooldoctor_02', 1021, 'pic_fooldoctor_02_battle', '博士士 2'),
    emo('autochess_battle_fooldoctor_03', 1022, 'pic_fooldoctor_04_battle', '博士士 3'),
    emo('autochess_battle_fooldoctor_04', 1023, 'pic_fooldoctor_05_battle', '博士士 4'),
    emo('autochess_battle_fooldoctor_05', 1024, 'pic_fooldoctor_06_battle', '博士士 5'),
    emo('autochess_battle_fooldoctor_06', 1025, 'pic_fooldoctor_08_battle', '博士士 6'),
  ] },
  { themeId: 'emoticon_foolsday_amiya', dir: 'foolamiya', sortId: 1003, isBasic: false, name: '表情套组：米米子', emotes: [
    emo('autochess_battle_foolamiya_01', 1040, 'pic_foolamiya_01_battle', '米米子 1'),
    emo('autochess_battle_foolamiya_02', 1041, 'pic_foolamiya_02_battle', '米米子 2'),
    emo('autochess_battle_foolamiya_03', 1042, 'pic_foolamiya_03_battle', '米米子 3'),
    emo('autochess_battle_foolamiya_04', 1043, 'pic_foolamiya_04_battle', '米米子 4'),
    emo('autochess_battle_foolamiya_05', 1044, 'pic_foolamiya_05_battle', '米米子 5'),
    emo('autochess_battle_foolamiya_06', 1045, 'pic_foolamiya_06_battle', '米米子 6'),
  ] },
  { themeId: 'emoticon_foolsday_wisdel', dir: 'foolwisdel', sortId: 1004, isBasic: false, name: '表情套组：维维美', emotes: [
    emo('autochess_battle_foolwisdel_01', 1060, 'pic_foolwisdel_01_battle', '维维美 1'),
    emo('autochess_battle_foolwisdel_02', 1061, 'pic_foolwisdel_02_battle', '维维美 2'),
    emo('autochess_battle_foolwisdel_03', 1062, 'pic_foolwisdel_03_battle', '维维美 3'),
    emo('autochess_battle_foolwisdel_04', 1063, 'pic_foolwisdel_04_battle', '维维美 4'),
    emo('autochess_battle_foolwisdel_05', 1064, 'pic_foolwisdel_05_battle', '维维美 5'),
    emo('autochess_battle_foolwisdel_06', 1065, 'pic_foolwisdel_06_battle', '维维美 6'),
  ] },
].map((t) => Object.freeze({ ...t, emotes: Object.freeze(t.emotes) })));
/** Every emote with its theme: `{ id, sortId, picId, label, themeId, dir }`, in wheel order. */
export const EMOTE_CATALOG = Object.freeze(EMOTE_THEMES.flatMap((t) => t.emotes.map((e) => Object.freeze({ ...e, themeId: t.themeId, dir: t.dir }))));
/** The 36 official emote ids (protocol whitelist: `EMOTES.includes(id)`). */
export const EMOTES = Object.freeze(EMOTE_CATALOG.map((e) => e.id));
const EMOTE_INDEX = new Map(EMOTE_CATALOG.map((e) => [e.id, e]));
/** Catalog record of an emote id, or null (safe for any input, including '__proto__'). */
export const emoteInfo = (id) => (typeof id === 'string' && EMOTE_INDEX.get(id)) || null;
// id-keyed maps without a prototype: a wire id like '__proto__' / 'toString' looks up undefined, never an Object method
const emoteMap = (pick) => Object.freeze(Object.assign(Object.create(null), Object.fromEntries(EMOTE_CATALOG.map((e) => [e.id, pick(e)]))));
/** Emote id → theme id. */
export const EMOTE_THEME = emoteMap((e) => e.themeId);
/** Emote id → our aria-label (never displayed). */
export const EMOTE_LABEL = emoteMap((e) => e.label);
/** data/local-assets.json group of an emote's art (`emoticon/<dir>`), or null. */
export const emoteArtGroup = (id) => { const e = emoteInfo(id); return e ? `emoticon/${e.dir}` : null; };
/** Canonical URL of an emote's extracted art (`/assets/local/emoticon/<dir>/<picId>.png`), or null for unknown ids. */
export const emoteArtPath = (id) => { const e = emoteInfo(id); return e ? `/assets/local/emoticon/${e.dir}/${e.picId}.png` : null; };
export const EMOTE_COOLDOWN_MS = 1000; // activity_table autoChessData.constData.chatCD (s)
export const EMOTE_BUBBLE_MS = 3000;   // constData.chatTime (s): how long a bubble stays up

// DEV_BUILD: taken from v0.2.3:shared/constants.js during the v0.2.3 narrow merge (upstream code imports it).
export const DEV_BUILD = /-dev$/.test(APP_VERSION);
