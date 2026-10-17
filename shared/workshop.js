// shared/workshop.js — 创意工坊 (community workshop) pack format and the overlay merge, pure ESM shared by the server
// (i18n-ignore-file: 工坊作者层的校验与推导文本 —— 给作者、编辑器与 AI 读的规则说明（编辑器有自己的中英词典，见 docs/EDITOR.md），不是客户端界面文案)
// (the loader, the match data) and the browser (which reads the same merged /data/*.json).
//
// A workshop pack is DATA ONLY at this layer. It never edits `data/*.json` — the loader applies an additive overlay on
// top of the generated official data just before that object is frozen (server/data.js loadData). Two consequences are
// load-bearing for the whole feature:
//
//   1. `data/*.json` stays byte-identical, so the official integrity suite (test/data.test.js, incl. the offline
//      rebuild that must reproduce data/ byte-for-byte) keeps passing and the official content is a clean baseline.
//   2. The overlay runs BEFORE deepFreeze, so every consumer (match engine, sim, client) sees one ordinary merged
//      object and no downstream code needs to know workshop content exists.
//
// Overlay rule: **an id the official data already has is NOT replaced** unless the pack lists it in
// `pack.json.overrides` as `"<file>:<id>"`. Additive by default, explicit to override — a pack that silently redefines
// an official operator would otherwise corrupt every match on the server.
//
// Pack layout (`workshop/<packId>/`):
//   pack.json        { id, name, version, author, license, description, gameVersion, content: [file…], overrides: [] }
//   chess.json       { [chessId]:  record }   ← same shape as data/chess.json
//   items.json enemies.json stages.json waves.json tokens.json bosses.json factions.json   (any file in `content`)
//
// The behaviour layer (a pack's `kits/*.js`, wired to the battle.on(...) hook bus) is deliberately NOT part of this
// module: it is code, it is loaded by the server only, and it is documented in docs/WORKSHOP.md.

// 变体 / 口径层（DESIGN §28.39）：轴的闭枚举与解析只有一份，`shared/variants.js`。这一层**不**在这里重新判一遍
// —— 一个轴表有两份实现，就是一个「哪个才算数」的问题。
import { parseVariantsDecl } from './variants.js';

// `shared/` 跑在浏览器与 Node 两处：`URL` 两边都有（DOM lib 与 Node 全局），但 jsconfig 的 lib 里没有 DOM，
// 所以显式取全局构造器，免得 tsc 报 Cannot find name URL（2026-10-16）。
const URLGlobal = /** @type {typeof URL} */ (/** @type {any} */ (globalThis).URL);
// 行为开关层（DESIGN §28.43）：与口径**同一形状、不同一张表**，判据只有一份在 `shared/behaviour.js`。同样不在这里
// 重判一遍闭枚举 —— 而且这一层的表今天是**空的**（通道 + 守卫先落，第一格与它的引擎实现点一起落）。
import { parseBehaviourDecl } from './behaviour.js';
// 启用声明（DESIGN §28.50）：装好 ≠ 生效。判据只有一份在 `shared/enabled.js`（`parseEnabledDecl`）。
import { parseEnabledDecl } from './enabled.js';
// 特质授予的盟约（`trait.grantsBonds`，DESIGN §28.49）：装载期那一条点名走**同一份判据**（`traitGrantIssues`），
// 作者侧的点名在 `shared/chessAuthoring.js` 的 `validateChessRecord` 里读同一个函数。
import { traitGrantIssues } from './morph.js';

/** Data files a pack may contribute to. Deliberately a conservative subset of data/: `config` is excluded because a
 * pack that rewrote the economy or the round schedule would change the rules rather than the content.
 *
 * `variants`（变体 / 口径层，DESIGN §28.39）**也不在这张表里**，理由与 `config` 同一条但更强：一个口径不是一张
 * 数据表，而是一个**闭枚举的选项名**（`shared/variants.js` 的 `VARIANT_AXES`）。把它写成一张 `{ id: record }`
 * 的数据文件就等于开一条「包可以覆盖任意数值」的通道 —— 那就是把安装器做进引擎（`docs/WORKSHOP.md` §1.1 对
 * `official` / `config` 的判断逐字成立）。所以口径走 `pack.json.variants` 这一格，值由引擎自己给。 */
export const WORKSHOP_CONTENT_FILES = Object.freeze([
  'chess', 'units', 'items', 'enemies', 'stages', 'waves', 'tokens', 'bosses', 'factions', 'garrisons', 'bands', 'bonds', 'effects', 'choices',
]);

/** Files whose records are keyed by an id field that must equal the map key (catches copy-paste mistakes in a pack). */
const ID_FIELD_BY_FILE = Object.freeze({
  chess: 'chessId', units: 'charId', items: 'id', enemies: 'key', stages: 'stageId', waves: 'templateId',
  tokens: 'tokenId', bosses: 'bossId', factions: 'factionId', garrisons: 'garrisonId',
  bands: 'bandId', bonds: 'bondId', effects: 'effectId', choices: 'id',
});

/**
 * `units.json` 的一条干员记录**必须有的那几个字段**（docs/WORKSHOP.md §1.2）。
 *
 * 为什么只查这几个：这条记录是 `data/backups.json` 的 `units[charId]`，形状由**上游官方数据**决定（14 个顶层键，
 * 见 `test/modSurface.test.js`）。我们**不复制官方 schema** —— 复刻一份就是给自己加一个会漂移的第二真相，官方每次
 * 加字段我们都要跟一次；而下游（`server/sim`、`server/match`）真正读的也只是这几个键。其余字段一律照抄
 * （与 `ART_TABLES` 同一个哲学：作者照抄官方条目，我们不重新发明形状）。
 *
 * 每一条的形状用一套**声明**写出来（名字 + 一个判据 + 缺了它下游会怎样），所以校验、拒绝码与提示文案只有一个来源。
 */
export const UNIT_REQUIRED_FIELDS = Object.freeze([
  {
    key: 'charId',
    ok: (v) => typeof v === 'string' && v.length > 0,
    code: 'UNIT_MISSING_CHAR_ID',
    detail: 'must be a non-empty string (it is how the client asks for this operator\'s data)',
  },
  {
    key: 'name',
    ok: (v) => typeof v === 'string' && v.length > 0,
    code: 'UNIT_MISSING_NAME',
    detail: 'must be a non-empty string (the operator shows up nameless otherwise)',
  },
  {
    key: 'rarity',
    ok: (v) => Number.isInteger(v),
    code: 'UNIT_BAD_RARITY',
    detail: 'must be an integer (the star rating; the 自选池 screen draws it)',
  },
  {
    key: 'profession',
    ok: (v) => typeof v === 'string' && v.length > 0,
    code: 'UNIT_MISSING_PROFESSION',
    detail: 'must be a non-empty string (WARRIOR / SNIPER / … — the project\'s own profession names, not DEFENDER/VANGUARD)',
  },
  {
    key: 'subProfessionId',
    ok: (v) => typeof v === 'string' && v.length > 0,
    code: 'UNIT_MISSING_SUB_PROFESSION',
    detail: 'must be a non-empty string (the branch; `assets.prof.sub` carries its icon)',
  },
  {
    key: 'forms',
    ok: (v) => isPlainObj(v) && Object.keys(v).length > 0,
    code: 'UNIT_BAD_FORMS',
    detail: 'must be a non-empty object of "elite/level/skill/module" ranks (the operator has no stats without one)',
  },
]);

/** Pack ids: a short filesystem- and URL-safe slug (it names the directory under workshop/). */
export const PACK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/**
 * `pack.json` 的**顶层键闭集** —— 这份格式认识的每一个字段，一个不多一个不少。
 *
 * 为什么需要它（本刀最重要的那条纪律）：一个**声明了、而我们不认识的键**如果只是被读过去，作者看到的是
 * 「pack.json 合法、包加载了、可我写的那件事没发生」。这正是三个社区 mod 反复撞上的那面墙：
 *   * `variants`（fanpack G-01，口径/变体）—— `normalizePackManifest` 从没读过它，`{content:["chess","variants"]}`
 *     归一化之后只剩 `["chess"]`，作者以为写了；
 *   * `skins`（fanpack G-05）—— 与 `variants` 同一个形状：静默丢；
 *   * `i18n`（fanpack G-04）—— 归一化结果里根本没有这个键。
 * 三者都是「写了等于没写」，而且失败的方向是**静默**。所以这一层的判据是：任何一个不在下面这张表里的顶层键，
 * **点名整包拒绝**（`PACK_UNKNOWN_FIELD`），理由里列出这份格式认识的字段 —— 作者一眼能看到自己该写哪个。
 *
 * 这不是「不支持新特性」的门：一个我们**故意**不支持的键（`config`，见 `WORKSHOP_CONTENT_FILES` 的注释）与一个
 * 拼错的键在作者眼里是同一件事（都是「没用」），而拒绝的错误文案会把两种情况都解释清楚（"config" is not a
 * field of this pack format）。方向也一致：宁可当场说「这张表没有通道」，也不要收下一份没人读的声明。
 *
 * 加字段的规矩：新字段进这张表的那一刀，必须同时（a）在 `normalizePackManifest` 里给它一个解析分支、
 * （b）决定它算不算贡献项、（c）把它的文件并进 `identifyPack` 的哈希清单（能改变一端行为的声明不进哈希，
 * 同一个摘要下就有两种行为，DESIGN §28.2）。
 */
export const PACK_FIELDS = Object.freeze([
  // 身份与元信息
  'id', 'name', 'version', 'author', 'license', 'description', 'gameVersion', 'game', 'api', 'layer', 'combat',
  // 内容与覆盖
  'content', 'overrides',
  // 素材与声明（贡献项，见 EMPTY_PACK 那一处）
  'voices', 'voiceLangs', 'bondIcons', 'itemIcons', 'art', 'skins', 'support', 'operators', 'i18n',
  // 形态（clip set）通道与静态相位通道（DESIGN §28.29）：第一方 `FORMS` / `SILENT_PHASES` 冻结不动，包只做增量。
  // 两者都是**行为**声明而不是素材：`forms` 说的是「这个 spine id 还有哪些形态、每个形态用哪几条 clip」，
  // `fx.silentPhases` 说的是「这几个 'phase' 种类模型自己会表示，不要再撒一层通用特效」。
  'forms', 'fx',
  // 纯文本声明（公告 / 鸣谢，DESIGN §28.15）：一段**结构化文本**，既不是游戏数据也不是素材
  'notices',
  // 行为开关（**不是**贡献项）
  'playtest',
  // 启用声明（DESIGN §28.50）：装好 ≠ 生效。`false` = 装载期跳过（见 `shared/enabled.js`）。**不是**贡献项。
  'enabled',
  // 变体 / 口径声明（DESIGN §28.39）：这个包要哪一套口径（练度 / 部署位）。**不是**贡献项，也**不是**一条
  // 数值覆盖通道 —— 它只能声明轴的闭枚举里有的选项名，值由引擎自己给（`shared/variants.js`）。
  'variants',
  // 行为开关声明（DESIGN §28.43）：这个包要哪一格开关、哪一档。**不是**贡献项，也**不是**一条数值 / 文件覆盖
  // 通道 —— 它只能声明开关的闭枚举里有的选项名，**动作由引擎构造**（`shared/behaviour.js`）。那张表今天有 4 格
  // （`shopBias` / `prepLoadout` / `morphPairing` / `unequip`，每格与实现点同刀落地），声明表里没有的仍被点名拒。
  'behaviour',
  // 中间层四组能力声明（DESIGN §28.13）
  'assets', 'client', 'server', 'routes',
  // 目标引擎（DESIGN §28.46）：`forge`（缺省，本引擎自己装）或 `stardust`（给 Stardust 宿主的**声明型包** ——
  // 本引擎不装载它，但认识它、不拒绝它、也不把它算进数据叠加层；同一份 pack.json 两端各自读得懂）。
  // `target: "stardust"` 的包额外允许 Stardust profile 的几格（见 `STARDUST_TARGET_FIELDS`）。
  'target',
  // 管理器合同（DESIGN §28.48）：对**其它工坊包**的依赖与互斥声明，形状是 `[{ id, range? }]` —— `id` 是另一个
  // 工坊包的 id（同一套字符集），`range` 是那个包 `version` 的区间（`shared/packs.js` 的同一套语法，缺省 = 任意
  // 版本）。这里只管**形状**；**语义在装载期裁决**（`adjudicatePackGraph`：缺失依赖 / 版本不合 / 互斥 / 级联 /
  // 循环，全部具名拒绝）。与 `target` 同一条纪律：**只在写出来时**才进归一化结果 —— 没声明的包哈希逐字节不变。
  'dependencies', 'conflicts',
  // 自选干员去重行为声明
  'stripDiyOverlaps',
]);

/** `pack.json.target` 的闭枚举：`forge`（缺省）本引擎装载；`stardust` 是给 Stardust 宿主的声明型包（本引擎只认识、不装载）。 */
export const PACK_TARGETS = Object.freeze(['forge', 'stardust']);
/** `target: "stardust"` 的包额外允许的 Stardust profile 字段（本引擎自己的闭集里没有的那些拼法）：
 *  `type`（必须是 `mod`）与 `capabilities` 是必须的两格；`englishName` / `authors` / `app` 是**同一个东西的
 *  Stardust 拼法**（本引擎叫 `name` / `author` / `gameVersion`）—— 放行它们只为一件事：「同一份 pack.json
 *  两端各自读得懂」不该逼作者在两种拼法里二选一。`target: "forge"`（含缺省）一个都不放行。 */
export const STARDUST_TARGET_FIELDS = Object.freeze(['type', 'capabilities', 'englishName', 'authors', 'app']);
/**
 * **能力认领的字段**（`target: "stardust"`）：Stardust 宿主的 profile 里，一个能力可以额外收下它自己的字段
 * （例如 `announcements` 能力收 `announcements` 列表）。本引擎不装载这些包、也不解释那些字段 —— 但**必须认识它们**，
 * 否则「同一份 pack.json 两端各自读得懂」在这张闭集前就断了：作者会看到本引擎报 `PACK_UNKNOWN_FIELD`。
 * （注意名字：Stardust 用的字段叫 `announcements` **不是** `notices` —— 本引擎自己已经有一个 `notices`（DESIGN
 * §28.15 的纯文本声明，形状是一个对象），同一个键不能对两个宿主说两种形状。）
 *
 * 这张表是**手抄的镜像**（与 Stardust 的 `shared/modPacks.js MOD_CAPABILITY_FIELDS` 对应），故意的：
 * 一份远端仓库的表没法在这里被 import；漂移的代价是「本引擎拒装一份它其实该放行的包」——两端对照由作者侧的
 * `chain-test.mjs`（同一份 pack.json 两个宿主各自读）盯着，改一边就要改另一边。字段本身**不做语义校验**：
 * 它是 Stardust 的 profile 要判的东西，本引擎只看形状（必须是那份能力认领的名字）。
 */
export const STARDUST_CAPABILITY_FIELDS = Object.freeze({
  announcements: Object.freeze(['announcements']),
});

/** 未知顶层键的拒绝码（见 `PACK_FIELDS`）。 */
export const PACK_UNKNOWN_FIELD_CODE = 'PACK_UNKNOWN_FIELD';
/** 一个顶层键在错误文案里最多显示多少个字符（一个手写坏掉的 pack.json 可以有几千字符的键）。 */
const MAX_KEY_SHOWN = 60;

/**
 * 一条 `pack.json.overrides` 声明的形状：`"<文件>:<id>"`（例 `chess:chess_char_1_01_a`）。**只此一份**：
 * `normalizePackManifest` 下面用它过滤，编辑器的写入端与校验器用它拒绝（两处正则不一致的话，界面会写出一个
 * 加载器悄悄丢掉的声明 —— 那正是「写了等于没写」这一类静默失败）。
 */
export const OVERRIDE_ENTRY_RE = /^([a-z]+):([A-Za-z0-9_\-.:]{1,64})$/;

/**
 * The URL prefix a pack's own media is served under: `<prefix><packId>/<path inside that pack's assets/>`
 * (server/index.js serves the route, docs/WORKSHOP.md §5). One source of truth, because the voice URLs this module
 * writes into the data must be exactly the ones that route answers.
 */
export const WORKSHOP_MEDIA_PREFIX = '/workshop-assets/';

/**
 * **作者自备 CDN 的语音素材**（DESIGN §28.33）：一条 voice 表里的条目可以是
 * `{ url, sha256, file }` 而不是一个包内相对路径。三件一体，缺一条都不收：
 *   * `url` —— 作者自己的 `https://` 地址。**引擎只从这条地址取**，绝不内置任何语音素材地址，也绝不新增下载路由：
 *     素材仍然由 `/workshop-assets/<包>/<file>` 这一条**既有**路由送出（引擎在装载期把它取到本地缓存，见
 *     `server/voiceCdn.js`），所以客户端那边一个字节都没变；
 *   * `sha256` —— 作者声明的**内容摘要**。取回来必须对上，对不上就当作没取到（绝不落盘、绝不上线）；
 *   * `file` —— 素材在包里的**逻辑位置**（`assets/` 下的相对路径）。它是客户端看到的 URL、也是引擎缓存的键之外的
 *     身份部分，所以必须是一个安全的相对路径 + 音频扩展名。
 *
 * 三条红线（业主口径：**分发官方语音不行，但作者自备 CDN 可以**）：
 *   1. **协议只认 `https:`**（`http:` / `data:` / `file:` / 协议相对一律拒）—— 明文取素材等于允许中间人换掉音频；
 *   2. **绝不内置任何官方语音地址**，也没有任何「已知素材站」白名单：白名单要把官方域名写进引擎，那正是红线本身；
 *   3. **不放宽 `VOICE_LANG_*`**，也不新增任何「便于拿官方语音」的通道：语种闭枚举、槽位闭枚举、以及「默认语种不能
 *      写进 `voiceLangs`」三条一个字都没动。
 */
export const VOICE_CDN_FIELDS = Object.freeze(['url', 'sha256', 'file']);
/** CDN 素材的摘要形状：64 位小写十六进制 sha256。**小写**是刻意的 —— 大小写混写会让同一个摘要有两个字节形态。 */
export const VOICE_CDN_SHA256_RE = /^[0-9a-f]{64}$/;
/** CDN 素材允许的扩展名。与 `/workshop-assets` 那条路由的音频白名单**同一批**（否则引擎取回来了也送不出去）。 */
export const VOICE_CDN_AUDIO_EXTS = Object.freeze(['.mp3', '.ogg', '.wav', '.m4a']);

/**
 * The URL prefix a pack's **C-layer panel module** is served under: `<prefix><packId>/<module path inside the pack>`
 * (DESIGN §28.8, docs/WORKSHOP.md §1.9.3). The twin of `WORKSHOP_MEDIA_PREFIX` on the other side of the line
 * `/workshop-assets` draws: that route serves a pack's MEDIA and therefore refuses `.js`; this one serves its CODE and
 * therefore serves nothing else. One source of truth, because a URL the loader builds and a route that answers it must
 * be the same string — and because the browser-side guard (`public/js/ui/extensions.js`) accepts exactly this prefix.
 */
export const WORKSHOP_PANEL_PREFIX = '/workshop-panels/';

/**
 * The URL prefix a pack's **declared resource container and manifest** are served under
 * (`pack.json.assets`, DESIGN §28.13, docs/WORKSHOP.md §1.9.4): the twin of `WORKSHOP_PANEL_PREFIX` for the
 * `assets` declaration, and deliberately a prefix of its own rather than a branch of `/workshop-assets` — that route
 * serves a pack's MEDIA under an extension allowlist and knows nothing about a pack's ROOT, while this one serves two
 * files the manifest itself names (a `.spresources` container, which no allowlist covers, and a `.json` table).
 * Widening `/workshop-assets` would have traded one narrow rule for two looser ones; a separate prefix keeps both
 * maps "only the URLs the loader registered", which is the discipline every pack-scoped route here follows.
 */
export const WORKSHOP_RESOURCE_PREFIX = '/workshop-resources/';
/** Record ids follow the wire-id charset (shared/protocol.js isId) so an id can travel in a message. */
const RECORD_ID_RE = /^[A-Za-z0-9_\-.:]{1,64}$/;

import { VOICE_SLOTS, VOICE_LANGS, DEFAULT_VOICE_LANG, MOD_API_VERSION } from './constants.js';
import { SOURCE_LANG, isLangCode } from './i18nPacks.js';
import { isSupportTier } from './support.js';
import { isVersionRange, appVersionMatches } from './packs.js';
import { MOD_LAYERS } from './modIdentity.js';
import { requiredUnitForms } from './diy.js';
import { FORM_TABLES, FORM_KIND_RE, FORM_SPEC_KEYS, checkFormRoles } from './packForms.js';
import { firstPartyFormNames } from './formNames.js';
// `intercepts` 是「分发前的准入钩子拦哪几个消息类型」，所以它的**唯一真相**必须是 `C2S` 本身（DESIGN §28.13）：
// 一个写在 `intercepts` 里而协议不认识的类型，只会让作者以为钩子拦住了什么。同一条依赖方向已有先例 ——
// `shared/modIdentity.js` 的线格式就被 `shared/protocol.js` 反过来 re-export（那两个模块之间的唯一箭头）。
import { C2S } from './protocol.js';

const isPlainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/**
 * 归一化失败的统一形状。返回类型**必须**显式标成 `{ ok: false }`：`--checkJs` 下 `tsc` 会把箭头函数的返回值
 * 推断成 `{ ok: boolean, error: any, detail: any }`，于是每一处 `return fail(...)` 都和函数的
 * `{ ok: true, … } | { ok: false, … }` 注解冲突（2026-10-16 的 typecheck 里 225 条 TS2322 全来自这一条）。
 * @param {string} error @param {string} [detail]
 * @returns {{ ok: false, error: string, detail: string | undefined }}
 */
const fail = (error, detail) => ({ ok: false, error, detail });
/**
 * 一个可选的字符串字段：非空字符串就裁剪，其它一律 null（缺省与写错都读成「没声明」）。
 *
 * **这个「非字符串读成没声明」在这里是好事，但只在没人给它兜底的时候**：对调用方自己就是终点的字段（今天是
 * `api` / `game` / `gameVersion`），把 `api: 1` 读成 null 会让包「当没声明一样」通过 —— 作者写了等于没写，
 * 而包本身是合法的，失败方向是静默的。所以这三个字段在调用它**之前**先各自过一遍 `declaredString`（见下面
 * `normalizePackManifest` 的版本声明那一段），类型不对就当场 `BAD_API_TYPE` / `BAD_GAME_TYPE` 拒绝。
 * 本函数的行为**没有改**：它只负责「怎么读一个字符串」，不负责「类型错了要不要报」。
 */
const strField = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** 包内素材路径：相对、在包自己的 `assets/` 下、无穿越。语音、各类图标、外观素材共用这一条规则。 */
const isSafeAssetPath = (p) =>
  typeof p === 'string' && !!p && !p.startsWith('/') && !p.includes('\\')
  && !p.split('/').some((seg) => seg === '..' || seg === '.') && !/^[A-Za-z]:/.test(p);

/** 包内**相对路径**（`assets/` 之外的那些：资源容器、清单、包内模块、策略文件）。同一条安全规则，
 *  只是不要求它住在 `assets/` 下 —— 一条路径要么相对、要么点名拒绝，绝不静默丢掉。 */
const isSafeRelativePath = (p, max = 200) =>
  typeof p === 'string' && p.length > 0 && p.length <= max && isSafeAssetPath(p);

/** 从 `i` 处开始的键序（`JSON.parse` 保留书写顺序），与这个文件里其它「键序是清单字节的一部分」的地方同一做法。 */
const stableStringList = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x))].sort() : []);

// ---------------------------------------------------------------------------------------------------------------
// 四组中间层能力声明（DESIGN §28.13，《扩展提案》A 段）
//
// 这四组字段是**纯声明**：本轮没有一条行为读它们（分发前钩子、只读路由、C 层注册点与资源容器都是 B 段）。
// 它们存在的理由是「今天表达不了」：一个完整资源包导入/校验/准入的 mod 在我们的 A 层什么都不贡献，
// `pack.json` 没有地方说它要什么，于是两边都判它 `EMPTY_PACK`（`_up/mod4-pack/pack/validator-verdict.json`）。
//
// 三条载重纪律：
//   1. **默认缺省 = 今天逐字节不变**。归一化结果里**只在清单真的声明了这个键时**才多出这个键
//      （`normalizePackManifest` 末尾的 `declared` 循环），否则一个没声明新字段的包的归一化清单与内容哈希
//      都会变 —— 那会让所有已存在的包摘要改变、房间的摘要闸门误判（DESIGN §28.2）。
//   2. **声明了就必须进身份哈希**：能改变一端行为的声明不在哈希里，同一个摘要下就有两种行为。这里靠上面那条
//      实现：声明进了归一化清单，`identifyPack` 哈希的就是归一化清单（`canonicalJson(pack)`）。
//   3. **形状不对 / 未知键 / 非法值一律点名拒绝**，不静默丢弃。未知键尤其重要：一个把 `"container"` 写成
//      `"containers"` 的包如果只是被忽略，作者看到的是「包合法、但资源没生效」。
// ---------------------------------------------------------------------------------------------------------------

/** `assets.serverPolicy`（DESIGN §28.13）：`serve` = 素材照常由 `/workshop-assets` 送；`cache-only` =
 *  这个包要求 `/assets` / `/fonts` 回 412，只从包自己的缓存取（B 段实现，本轮只认这个值）。 */
export const ASSETS_SERVER_POLICIES = Object.freeze(['serve', 'cache-only']);
/** `assets.verify`：整包摘要的算法（旁挂 `<container>.sha256`）。今天只有 sha256 一种，枚举写出来是为了让
 *  第二个算法出现时**必须**改这里，而不是让校验器悄悄按 sha256 比对一份 md5。 */
export const ASSETS_VERIFY_ALGORITHMS = Object.freeze(['sha256']);
/** `assets` 的五个字段，一个不多一个不少。 */
const ASSETS_FIELDS = Object.freeze(['container', 'manifest', 'serverPolicy', 'verify', 'mirrors']);
/** 资源容器的扩展名：它是 `tools/make-spresources.mjs` 的产物，由格式定义（`SPRES001` 魔数 + 压紧 JSON 头）。 */
const SPRESOURCES_EXT = '.spresources';

/**
 * `assets.mirrors[]` —— **作者自备 CDN 承载本包自己的容器**（DESIGN §28.40）。它是「素材加载源」这一格的唯一入口，
 * 三条边界写在这里，一处也不在别处：
 *
 *   * **只镜像本包自己的容器。** 这条通道改的是「这份容器的字节从哪台主机取」，**不是**「整棵 `/assets` 树指向谁」。
 *     后者做不到诚实：`data/assets.json` 只有**清单级**的摘要、没有逐文件摘要，哈希锁得住清单字节、**锁不住图**；
 *     把一整个站点的素材树交给第三方主机也正是「不分发官方素材」那条红线要拦的形态。所以一个坏镜像的爆炸半径是
 *     **一个包自己的那份容器**，不是全站素材（`server/http/static.js` 的 `/assets` 分支一行都没动）。
 *   * **`base` 只认绝对 `https://`**，且必须写出尾斜杠：拼的是 `<base><包内文件名>`，少一个斜杠会拼出一个看起来
 *     对、取不到的地址。`http:` / `data:` / `file:` / 协议相对 / URL 里带凭据一律拒 —— 与 `VOICE_CDN_BAD_URL`
 *     （§28.36）逐字同一条口径。
 *   * **`sha256` 必须等于装载期算出来的容器摘要**（`assetsIssues.digest`）：镜像里的字节是不是「同一份容器」由这
 *     一步判定，它**不是**包自己的一句话 —— 服务端先按包内文件算出摘要，再拿它去比每一条镜像的声明
 *     （`server/workshop.js`），对不上的那条**不生效**并点名。于是「镜像换了内容」在装载期就被抓住。
 *
 * 镜像**不在服务端取字节**（与 `voiceCdn` 相反）：服务端一次网络请求都不发 —— 取字节的是**客户端**，走既有的
 * `bundle.js` 逐文件 SHA-1[0:12] 导入与 Cache Storage。所以这一格没有服务端超时、没有服务端磁盘缓存、没有启动期
 * 阻塞；一台 CDN 挂掉只影响**想用它的人**，而回落目标（包内那条 `/workshop-resources/` URL）永远在。
 */
export const ASSETS_MIRROR_FIELDS = Object.freeze(['id', 'base', 'sha256']);
/** 一个包最多声明几条镜像：多到「全都试一遍」比「一条都不试」更慢时，这条通道就不再是优化了。 */
export const ASSETS_MIRROR_MAX = 4;
/** 镜像 id：`sources(ctx)` 只许谈这个名字，所以它必须是一个能被点名的短标识（见 `CLIENT_SOURCES_BAD_ORDER`）。 */
export const ASSETS_MIRROR_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
/** 容器摘要的形态（与 `VOICE_CDN_SHA256_RE` 逐字相同）。 */
export const ASSETS_MIRROR_SHA256_RE = /^[0-9a-f]{64}$/;
/** 一条 `base` 的长度上限：与 `common.js isResourceUrl` 的 512 同一条口径，一条声明不该能拖住一次拼接。 */
const ASSETS_MIRROR_BASE_MAX = 512;

/**
 * `assets` 在**装载期**（文件真的在不在、摘要对不对）会用的两个拒绝码（DESIGN §28.13.3，B3a 段）。
 *
 * 为什么容器/清单的**文件级**失败沿用形状层的两个名字（`ASSETS_BAD_CONTAINER` / `ASSETS_BAD_MANIFEST`）而不是新造一对：
 * 作者看到的是同一条判据的两半 ——「你声明的那个容器」不相对、不是 `.spresources`、**或者这个文件不在包里**，
 * 三件事的修法都是「改 `assets.container` 指向一个真的在包里的 `.spresources`」。B2 段对面板模块正是这么做的
 * （形状层与服务面同名 `CLIENT_BAD_PANEL_MODULE`，理由写在 §28.13.3），本刀照抄那条先例，理由不同不另开码。
 * 一句话：**拒绝码点名的是「哪个字段坏了」，不是「在哪一层被发现的」。**
 *
 * `verify` 的两条是这一刀新增的，因为它们说的是另一件事 —— 容器在，但它的字节**不是**声明所要求的那份：
 *   * `ASSETS_VERIFY_FAILED` —— 旁挂 `<container>.sha256` 存在且可解析，但摘要对不上（或容器读不动 / 不是文件）；
 *   * `ASSETS_VERIFY_UNAVAILABLE` —— 声明了 `verify`，却找不到那份摘要（旁挂文件不在 / 格式不对）。
 * 两条都是**整个包被拒**，绝不静默放行：一个「校验失败但照旧服务」的资源包，会让客户端导入一份服务端已经
 * 知道是坏的字节，而唯一的信号是一行没人看的日志。
 */
export const ASSETS_FILE_CODES = Object.freeze({
  CONTAINER: 'ASSETS_BAD_CONTAINER',
  MANIFEST: 'ASSETS_BAD_MANIFEST',
  VERIFY_FAILED: 'ASSETS_VERIFY_FAILED',
  VERIFY_UNAVAILABLE: 'ASSETS_VERIFY_UNAVAILABLE',
});

/**
 * `client.panels[*].slot`（DESIGN §28.8）：**闭枚举**。写成自由字符串的话，一个拼错的挂载点就是一个永远不出现的
 * 界面 —— 而挂载点是设计稿里已经数得清的那些。
 *
 * 前四个是 0.11.0 的**浮层**（引擎按需创建容器、`position: fixed`）。后五个是业主 2026-10-10 裁决里
 * 「插进**已存在**的组件」那一半：容器由**组件自己**渲染（`[data-mod-slot]`），面板因此能往商店卡加一个角标、
 * 给盟约条加一个手势、往干员详情插一节 —— 而不是只能挂在浮层上。
 */
export const CLIENT_PANEL_SLOTS = Object.freeze([
  'root.overlays', 'root.guide', 'screen.game.aside', 'screen.result.footer',
  'screen.game.shopCard', 'screen.game.bondStrip', 'screen.game.hud', 'screen.game.overlay',
  'screen.loadout.detail',
]);
/**
 * **可重复的宿主**：引擎在这些位置渲染*多个*容器（每张商店卡一个），一个面板会挂进**每一个**，并通过
 * `ctx.hostKey` 知道自己是哪一份（商店卡那个键就是棋子的 id）。
 *
 * 为什么需要这一档：`cardMarks.js` 要的是「每张卡上一个标记」，而不是「屏幕上有一个标记」。把它塞进不可重复的
 * 浮层等于让包自己去做「哪张卡在哪」这件事 —— 而那需要 store，正是 §28.8 不给它的东西。
 */
export const CLIENT_PANEL_REPEATABLE = Object.freeze(['screen.game.shopCard']);
/**
 * 引擎**具名组件**的闭枚举（`client.panels[].wraps[].component`，DESIGN §28.19）。九个挂载点说的是「插进哪个
 * 位置」，这一张说的是「**哪个组件本身**被改写」—— 一个槽位永远表达不了「这个界面现在长得不一样了」。
 *
 * 名字与 `CLIENT_PANEL_SLOTS` 是**两个**命名空间（`game.bondStrip` vs `screen.game.bondStrip`）：前者是组件，
 * 后者是那个组件里的一个容器。作者看到的两份名单因此不能互相替代，理由与「slot 是闭枚举」逐字相同 ——
 * 一个拼错的组件名等于一条永远不会生效的改写，而那正是这一层到处在拒绝的形态。
 *
 * 唯一真相在客户端（`public/js/ui/modComponents.js MOD_COMPONENT_IDS`，每个 id 在组件自己的文件里经
 * `modComponent(id, impl)` 对上实现），这里是为了**形状层能在不加载客户端的前提下判死**而放的副本 —— 两个表由
 * `test/modPanelWraps.test.js` 钉在一起（与 `CLIENT_PANEL_SLOTS` / `MOD_PANEL_SLOTS` 同一条做法）。
 */
export const CLIENT_WRAP_COMPONENTS = Object.freeze([
  'game.bondStrip', 'game.hud.topBar', 'game.shopCard', 'loadout.detail',
  'briefing.bonds', 'briefing.banned', 'sweep.bonds',
]);
/** 改写方式：`wrap` = 包住引擎的那一份（外层拿到内层的结果当 `orig`）；`replace` = 整段换掉（`orig` 是 `null`）。 */
export const CLIENT_WRAP_MODES = Object.freeze(['wrap', 'replace']);
/** 面板的字段：四个 + `styles`（这个面板自带的样式表）+ `data`（它要读的数据表）+ `messages`（它要收发的通道）
 *  + `wraps`（它要包裹 / 替换的引擎组件）。 */
const CLIENT_PANEL_FIELDS = Object.freeze(['id', 'slot', 'module', 'order', 'gate', 'styles', 'data', 'messages', 'wraps']);
/** 一个面板最多声明几条包通道（上限让「通道」这件事有界；今天没有一个真包用到两条以上）。 */
const CLIENT_MAX_PANEL_MESSAGES = 8;
/**
 * 一条**包通道**的名字（docs/WORKSHOP.md §1.9.6）。作者只写后半段，线上是 `<包id>.<名字>` —— 所以这个名字必须是
 * **小写字母开头的短名**：它会出现在线上、会进 `pack.msg` 的字段、要能被 `^[a-z][a-z0-9_-]{0,63}$` 判死（拼错一个
 * 名字就是一条永远收不到的消息，那正是这一层到处在拒绝的形态）。
 *
 * **一份判据，两半共用**（DESIGN §28.23）：`client.panels[].messages`（这个包**说得出**哪些通道）与
 * `server.modules[].channels`（这个包的对局**收得到**哪些通道）必须是同一批名字 —— 各写一套就等于允许
 * 「说得出但收不到」或「收得到但说不出」这两种永远不生效的声明。所以它从这里导出，不再各写一份。
 */
export const PACK_CHANNEL_RE = /^[a-z][a-z0-9_-]{0,63}$/;
/**
 * 一个面板可以**读**的数据表（业主裁决 2026-10-10 的「数据口」那一半，DESIGN §28.8）。
 *
 * 为什么是**声明**而不是「客户端有什么就给什么」：`ctx.data.get('chess')` 拿到的是 `data/chess.json` 的**只读快照**
 * —— 那正是 `cardMarks.js` 需要 `visible` / `isHidden` 的唯一出路（§28.8 不给 store，而 store 里没有这些表）。
 * 声明的意义与 `registers` 逐字相同：作者写下的东西要能被看见、被审、进身份；一个包偷偷读整本数据而不说，
 * 下一个版本换了表名谁都不会知道。
 *
 * 名单就是**浏览器本来就抓得到的那几张**（`public/js/data.js` 的 `DATA_FILES`）—— 刻意不在这里发明第二份真相，
 * `test/modClientHosts.test.js` 用**反射**把两者钉在一起：少一个 = 一个合法声明被拒，多一个 = 一条浏览器拿不到的
 * 承诺。
 */
export const CLIENT_PANEL_DATA_TABLES = Object.freeze([
  'chess', 'bonds', 'items', 'bands', 'enemies', 'bosses',
  'stages', 'tokens', 'choices', 'config', 'assets', 'backups', 'local', 'notices',
]);
/**
 * 一个面板最多读几张表 —— **由上面那张名单推导**，不是一个手写的数字。
 *
 * 这里原本写着 `= 13`，而名单在 `notices`（§28.15）加进来之后是 **14** 张：于是「把这个面板要读的表全列出来」
 * 这件最自然的事会被 `CLIENT_BAD_PANEL_DATA` 拒掉，而错误文案还写着「at most 13 tables **(that is all of them)**」
 * —— 文案与事实正好相反，作者拿到的是「你列太多了」，而真相是「我们忘了改这个数」。这一格的语义本来就是
 * **「全部」**（它的判据是 `CLIENT_PANEL_DATA_TABLES.includes(...)`，名单是唯一的白名单），所以上限必须跟着名单走。
 *
 * 为什么**推导**而不是「把 13 改成 14」：手写第二个真相正是它漂掉的原因，改一次数字只换来下一次漂。
 * `export` 出去是为了让 `test/modClientData.test.js` 能把它钉住（「上限 == 名单长度」+「14 张全声明必须被接受」）。
 *
 * 提高这个数的**影响面为零**：它从来不是「哪几张表可以读」的判据（那是 `includes`），只是「一次能列几张」的数量上限，
 * 所以任何今天合法的声明在新值下**依然合法**（放宽只会多接受，不会少接受）。一个包今天就能单独声明 `notices`
 * （长度 1 < 13），所以「第 14 张表读不到」这件事从来没有发生过 —— 发生的是「一次列全 14 张」被判成错误。
 */
export const CLIENT_MAX_PANEL_DATA_TABLES = CLIENT_PANEL_DATA_TABLES.length;
/** 一个包能声明它需要哪些浏览器能力；缺一即「浏览器不支持」，不是「装了但静默不工作」（DESIGN §28.13）。 */
export const CLIENT_REQUIRES = Object.freeze(['serviceWorker', 'cacheStorage', 'webCrypto']);
/**
 * 面板自带样式表的扩展名 —— `.css` 是**唯一**一种。这个通道送的是**样式**：不是代码（`.js` 那条是 `module`），
 * 不是媒体（那条是 `assets` / `art`）。业主裁决 2026-10-10：两条路一起给 —— 主题变量写「几个值」，
 * 自带样式表写「一整份新组件的样式」。插件包那三份（`chat.css` 21 KB / `devices.css` 11.7 KB /
 * `title.css` 22 KB）走的是后者，光有变量装不下。
 */
const CLIENT_PANEL_STYLES_EXT = '.css';
/** 上限：一个面板最多带几份样式表、一份主题最多写几个变量 —— 「注入」这件事必须有界。 */
const CLIENT_MAX_PANEL_STYLES = 8;
const CLIENT_MAX_THEME_VARS = 200;
/** 一个主题里允许的字段，一个不多一个不少。 */
const CLIENT_THEME_FIELDS = Object.freeze(['vars']);
/** CSS 自定义属性的名字必须是 `--` 开头：一个不叫 `--x` 的键写进去等于什么都没发生（正是要消灭的静默失败）。 */
const CLIENT_THEME_VAR_RE = /^--[A-Za-z0-9_-]{1,64}$/;
/**
 * 一个变量值里**不许**出现的东西。这几个字符能让一条声明跑出它自己那一格：`;` 结束当前声明、`{}` 结束规则块、
 * `<` 是往标签里插内容的第一笔、换行同理。值本身是数据，不该有能力改结构。
 */
const CLIENT_THEME_VALUE_BAD = /[;{}<>\n\r]/;
const CLIENT_THEME_VALUE_MAX = 400;

/** `server.preDispatch`：包内模块、准入策略文件、以及它要拦的消息类型。三件都不能空 —— 少了 `policy`
 *  的钩子无法判定该放谁进来，那正是「声明了却没人能执行」这一类静默失败。 */
const PRE_DISPATCH_FIELDS = Object.freeze(['module', 'policy', 'intercepts']);
/** `server.meta` 的两个字段，一个不多一个不少（DESIGN §29）。 */
const META_FIELDS = Object.freeze(['module', 'registers']);
const META_MODULE_EXT = '.mjs';
/**
 * `server.battle` —— 包的**战斗逻辑**载荷（DESIGN §28.17）：一个导出 `install(battle)` 的模块，服务端与浏览器**都**
 * 会在这一局建起来之后跑一次。
 *
 * 为什么它必须与 `kits/` 并存，而不是拿 kit 凑：kit 是**一个干员**的代码（`kits/<chessId>.js`），而一份真实 mod 的
 * 盟约效果是**整场**的 —— 「我方所有成员对处于眩晕/停顿/束缚的敌人增伤」「凑够 6 名不同成员时全员加攻速」「某两件
 * 装备同时装备时每秒真实伤害」。这些条件要在**战场级别**读玩家、读全场单位、读装备组合，而 kit 只能看到自己那个
 * 单位。所以这一类载荷的粒度就是「一个包一份、一场一次」。
 *
 * 纪律与 `server.meta` 逐字相同（它同样是**改对局结果**的代码）：必须声明 `combat: true`（进摘要闸门与 golden），
 * 源码在 import 之前过静态确定性扫描，字节进内容哈希，装不上的整包移出已加载集合。
 */
const BATTLE_FIELDS = Object.freeze(['module']);
const BATTLE_MODULE_EXT = '.mjs';
/**
 * `server.room` —— 包的**房间级钩子**载荷（DESIGN §28.20）：一个导出 `install(room)` 的模块，服务端在**每一个**
 * 装上这个包的房间里跑一次，让包观察房间的生命周期（建房、加入、加入观战、对局开始 / 结束、离开、房间销毁）。
 *
 * 为什么它不是 `server.modules` 的一个 `uses`：这一层要的是**每个房间**一次、并且**按房间的集合**过滤（W-B，
 * §28.16）—— 而 `server.modules` 的挂载点是进程级的（boot / shutdown / healthz / matchClass，§28.14 明说房间的
 * 集合决定的是**一局**跑什么，不是进程启动什么）。一个包想知道「这个房间里是谁」，进程级钩子没有房间这个对象。
 *
 * 为什么它不要求 `combat: true`（与 `server.meta` / `server.battle` 相反）：它的契约里**没有任何一条**能改对局
 * 结果 —— `install(room)` 拿到的是一个只读的观察面（成员快照、阶段、事件），没有 store、没有战场句柄、没有 socket、
 * 没有文件系统，返回值被忽略。判据是**能力**而不是意图：等哪一天这一层真的交出一件能改「谁在玩 / 装了什么 / 这一局
 * 的结果」的东西，那件东西必须 `combat: true`（§28.20 的闸门分类规则）。
 */
const ROOM_FIELDS = Object.freeze(['module']);
/** 房间钩子模块的扩展名：它只由**服务端**加载（浏览器与战场都不加载），所以是 `.mjs`，与 `server.meta` 同一条。 */
const ROOM_MODULE_EXT = '.mjs';
/**
 * `server.modules[*]` —— 包的**服务端模块**载荷（DESIGN §28.14）。与 `kits/` 并列的一类载荷，但两者的契约相反：
 * kit 是**战斗里**的代码（禁文件系统、禁网络），而这一类要做的恰恰是写盘、挂启动钩子、给 `/healthz` 加字段。
 *
 * 所以它的安全性不来自「禁掉什么」，而来自**只给声明过的那几样**：
 *   * `uses` 是**挂载点**的闭枚举，模块只拿得到自己声明的那几个能力（没声明的那个属性一碰就抛，见
 *     `server/modModules.js` 的宿主对象）；
 *   * `write: true` 才拿到一个**被限定在 `<状态目录>/mod/<包id>/`** 里的文件门面（包自己的目录是只读的，引擎的
 *     目录根本不在门面里）；
 *   * `uses` 里有 `matchClass` 的包**必须**声明 `combat: true`：一个 `MatchClass` 包装器原则上能改对局结果，
 *     而「要改结果的必须进房间摘要闸门与 golden 那条线」是业主裁决（与 `server.meta` 同一条）。
 *
 * 后加的两格（`metrics` / `route`，加一格不抬 `MOD_API_VERSION`）都**不**要求 `combat: true`，因为它们都改不了
 * 对局：`metrics` 交出的是一份**深冻结的标量快照**（读，不是写），`route` 交出的是**只读 GET/HEAD 的公开 JSON**
 * （它甚至进不了对局进程 —— 它在 HTTP 处理器里跑）。判据是**能力**而不是意图，与 `server.room` 同一条。
 */
export const SERVER_MODULE_USES = Object.freeze(['boot', 'shutdown', 'matchClass', 'healthz', 'metrics', 'route']);
/** `server.modules[*]` 的字段，一个不多一个不少。 */
const SERVER_MODULE_FIELDS = Object.freeze(['id', 'entry', 'uses', 'write', 'channels']);
/** 一个包最多声明几个服务端模块。 */
const MAX_SERVER_MODULES = 8;
/**
 * 一个服务端模块最多声明几条**接收通道**（`server.modules[].channels`，DESIGN §28.23）：玩家从包自己的面板
 * （`client.panels[].messages` + `pack.msg`）发出来的消息，由**这一格**声明谁在对局里收。与面板那半边的
 * `CLIENT_MAX_PANEL_MESSAGES` 同一个数量级 —— 这不是数据通道，是玩法动作的入口，写着是为了让它有界。
 */
export const MAX_SERVER_MODULE_CHANNELS = 8;
/** 服务端模块的扩展名：它是**服务端**加载的 ESM（浏览器不加载，战斗也不加载）。 */
const SERVER_MODULE_EXT = '.mjs';
/**
 * 对局元注册表的**七个键类别**（DESIGN §29）：`server/match/effectsMeta.js` 的 `MetaRegistry` 恰好有七个
 * 对应的方法（`garrison` / `band` / `bond` / `item` / `choice` / `effect` / `global`），一条注册键就是
 * `<类别>:<id>`。
 *
 * 为什么这一份名单住在 `shared/` 而不是从 `effectsMeta.js` 读出来：那个模块在服务端（`server/match/`），
 * 而形状层要在浏览器也会加载的共享文件里判形状。第二份真相会漂 —— 所以 `test/packMeta.test.js` 用**反射**
 * 把两者钉在一起：`MetaRegistry.prototype` 上那七个方法必须与这份名单逐字相同，少一个或多一个都失败。
 */
export const META_KEY_CLASSES = Object.freeze(['garrison', 'band', 'bond', 'item', 'choice', 'effect', 'global']);
/**
 * 注册键里**类别之后**那一段允许的字符。与 `server/match/effectsMeta.js` 的 `KEY_RE` 的尾段逐字相同
 * （`[A-Za-z0-9_\-.:#]`）—— 「形状层放行、运行时抛异常」是最坏的一种分工，所以两处必须一致
 * （`test/packMeta.test.js` 用反射与实例各钉一遍）。
 */
const META_KEY_TAIL_RE = /^[A-Za-z0-9_\-.:#]+$/;
/** 分发前钩子只能拦 `shared/protocol.js` 的 `C2S` 里真实存在的类型（DESIGN §28.13）。刻意从协议反推而不是
 *  在这里抄一份名单：抄一份就是第二个会漂移的真相，而漂移的方向是「作者声明了一个拦不住的类型」。 */
const PRE_DISPATCH_INTERCEPTS = Object.freeze(Object.keys(C2S).sort());
/** 准入模块的扩展名：它是**服务端**加载的 ESM，浏览器不加载。 */
const PRE_DISPATCH_MODULE_EXT = '.mjs';

/** `routes[*].cache`：只读路由允许的三种缓存语义。 */
export const ROUTE_CACHE_POLICIES = Object.freeze(['no-cache', 'no-store', 'public']);
/** 只读路由的键，一个不多一个不少。 */
const ROUTE_FIELDS = Object.freeze(['path', 'file', 'cache']);

/**
 * `pack.json.assets` —— 客户端资源容器（§28.13）。缺省 `serverPolicy: "serve"` / `verify: "sha256"`；
 * 形状照扩展提案逐字，**只在键存在时**才写回归一化清单（见上面第 1 条纪律）。
 * @returns {{ ok: true, decl: object } | { ok: false, error: string, detail: string }}
 */
function parseAssetsDecl(raw) {
  if (!isPlainObj(raw)) {
    return fail('ASSETS_DECL_BAD_SHAPE', 'assets must be an object: { container, manifest, serverPolicy?, verify? }');
  }
  for (const key of Object.keys(raw)) {
    if (!ASSETS_FIELDS.includes(key)) {
      return fail('ASSETS_UNKNOWN_FIELD', `assets: "${key}" is not a declared field (${ASSETS_FIELDS.join(', ')})`);
    }
  }
  if (!isSafeRelativePath(raw.container)) {
    return fail('ASSETS_BAD_CONTAINER', 'assets.container must be a relative path inside the pack (no absolute paths, no "..")');
  }
  if (!raw.container.endsWith(SPRESOURCES_EXT) || raw.container.length <= SPRESOURCES_EXT.length) {
    return fail('ASSETS_BAD_CONTAINER', `assets.container must name a "${SPRESOURCES_EXT}" file (e.g. "packs/resources-0.1.0${SPRESOURCES_EXT}")`);
  }
  if (!isSafeRelativePath(raw.manifest)) {
    return fail('ASSETS_BAD_MANIFEST', 'assets.manifest must be a relative path inside the pack (no absolute paths, no "..")');
  }
  if (!raw.manifest.endsWith('.json')) {
    return fail('ASSETS_BAD_MANIFEST', 'assets.manifest must name a .json file — it is the flat file table the client validates');
  }
  const serverPolicy = raw.serverPolicy === undefined ? 'serve' : raw.serverPolicy;
  if (!ASSETS_SERVER_POLICIES.includes(serverPolicy)) {
    return fail('ASSETS_BAD_SERVER_POLICY', `assets.serverPolicy must be one of: ${ASSETS_SERVER_POLICIES.join(', ')}`);
  }
  const verify = raw.verify === undefined ? 'sha256' : raw.verify;
  if (!ASSETS_VERIFY_ALGORITHMS.includes(verify)) {
    return fail('ASSETS_BAD_VERIFY', `assets.verify must be one of: ${ASSETS_VERIFY_ALGORITHMS.join(', ')}`);
  }
  // `mirrors`（DESIGN §28.40）是**可选的**一格，而且与 `skins` / `voiceCdn` / `variants` 同一条纪律：
  // **只在真的声明过时才进归一化结果**。没声明它的包（今天所有的包）哈希逐字节不变；`identifyPack` 哈希的是
  // 这份清单的 `canonicalJson`，给每个包都加一个 `mirrors: []` 会换掉每一个已发布包的身份。
  const mirrorsParsed = raw.mirrors === undefined ? null : parseAssetsMirrors(raw.mirrors);
  if (mirrorsParsed && !mirrorsParsed.ok) return mirrorsParsed;
  return {
    ok: true,
    decl: {
      container: raw.container, manifest: raw.manifest, serverPolicy, verify,
      ...(mirrorsParsed ? { mirrors: mirrorsParsed.decl } : {}),
    },
  };
}

/**
 * `assets.mirrors[]` 的形状（DESIGN §28.40）。判据与理由见 `ASSETS_MIRROR_FIELDS` 上面那一段；这里只说两件
 * 实现上的事：
 *
 *   * **一条镜像不成立就拒整个 `assets`**，不做「丢掉坏的那条、留下好的」：形状层的既有纪律是「作者写下的东西
 *     要么全被读懂、要么点名拒」（§28.13.3），静默丢一条会让作者以为它有四条镜像、实际只有三条。**装载期**那条
 *     摘要比对相反 —— 它一次网络请求都不发，只把与包内字节不符的那条**停用**并点名（服务端算出来的摘要才是
 *     真相，而包仍然可用）。两处口径不同是因为它们回答的问题不同。
 *   * **`sha256` 只判形态，不比数值**：数值要等装载期把包内容器真的读一遍才有得比（`server/workshop.js`），
 *     形状层连包目录都看不到。
 * @param {unknown} raw
 * @returns {{ ok: true, decl: Array<{ id: string, base: string, sha256: string }> } | { ok: false, error: string, detail: string }}
 */
function parseAssetsMirrors(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    return fail('ASSETS_MIRROR_BAD_SHAPE', 'assets.mirrors must be a non-empty array of { id, base, sha256 } (drop the key instead of sending [])');
  }
  if (raw.length > ASSETS_MIRROR_MAX) {
    return fail('ASSETS_MIRROR_TOO_MANY', `assets.mirrors declares ${raw.length} mirrors; at most ${ASSETS_MIRROR_MAX} — the loader tries them in order, so a fifth one only ever costs time`);
  }
  /** @type {Array<{ id: string, base: string, sha256: string }>} */
  const out = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i++) {
    const at = `assets.mirrors[${i}]`;
    const entry = raw[i];
    if (!isPlainObj(entry)) return fail('ASSETS_MIRROR_BAD_SHAPE', `${at} must be an object: { id, base, sha256 }`);
    for (const key of Object.keys(entry)) {
      if (!ASSETS_MIRROR_FIELDS.includes(key)) {
        return fail('ASSETS_MIRROR_UNKNOWN_FIELD', `${at}: "${key}" is not a field of a mirror entry (${ASSETS_MIRROR_FIELDS.join(', ')})`);
      }
    }
    if (typeof entry.id !== 'string' || !ASSETS_MIRROR_ID_RE.test(entry.id)) {
      return fail('ASSETS_MIRROR_BAD_ID', `${at}.id must be a short lowercase id (a letter first, then a-z 0-9 _ -, at most 32) — it is the only name sources(ctx) is allowed to talk about`);
    }
    if (seen.has(entry.id)) {
      return fail('ASSETS_MIRROR_DUPLICATE_ID', `${at}.id "${entry.id}" is declared twice (one id, one mirror: the second one is unreachable and the ordering would be ambiguous)`);
    }
    seen.add(entry.id);
    if (typeof entry.base !== 'string' || entry.base.length > ASSETS_MIRROR_BASE_MAX || !entry.base.endsWith('/')) {
      return fail('ASSETS_MIRROR_BAD_BASE', `${at}.base must be a string of at most ${ASSETS_MIRROR_BASE_MAX} characters ending in "/" — the container is fetched as <base><its file name inside the pack>, so a missing slash builds an address that looks right and never resolves`);
    }
    let parsed = null;
    try { parsed = new URLGlobal(entry.base); } catch { parsed = null; }
    if (!parsed || parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return fail('ASSETS_MIRROR_BAD_BASE', `${at}.base must be an absolute "https://" URL with a host, no credentials, no query and no fragment — this channel fetches from the AUTHOR's own CDN, and https is the only protocol it will speak (http: / data: / file: / protocol-relative all refuse)`);
    }
    if (typeof entry.sha256 !== 'string' || !ASSETS_MIRROR_SHA256_RE.test(entry.sha256)) {
      return fail('ASSETS_MIRROR_BAD_DIGEST', `${at}.sha256 must be a 64-character lowercase hex sha256 of the container bytes that base serves — the loader compares it with the digest it computed from the pack's own container and drops any mirror that does not match`);
    }
    out.push({ id: entry.id, base: entry.base, sha256: entry.sha256 });
  }
  return { ok: true, decl: out };
}

/** 面板模块的扩展名：这个通道送的是**代码**（浏览器 import 它），所以只有 `.js`。 */
const CLIENT_PANEL_MODULE_EXT = '.js';

/**
 * 一个面板的 `module` 必须是**包内相对路径**、不是 URL、且是一个 `.js`：装载器要知道去哪个包的哪一层读它，
 * 而一条 `https://…` 或 `/…` 会把「代码来自哪个包」这件事从身份里抹掉（DESIGN §28.2）；`.html` / `.json` 之类
 * 则是这条通道**永远送不出去**的东西（服务面只送 `.js`，与 `/workshop-assets` 拒 `.js` 是同一条线的两侧）。
 *
 * `.js` 这一条是 B2 段补的：A 段只判了「相对、不是 URL」，而一条 `module: "x.html"` 在形状层合法、进了身份哈希，
 * 客户端却永远拿不到它 —— 作者看到的是「包合法、面板不出现」。两次判据（形状层与服务面）现在一致。
 * 目录段不许以 `.` 开头：与 `/workshop-assets`、核心静态挂载对点文件的处理同一条规则。
 */
const isSafeModulePath = (p) =>
  isSafeRelativePath(p) && p.endsWith(CLIENT_PANEL_MODULE_EXT) && p.length > CLIENT_PANEL_MODULE_EXT.length
  && !p.split('/').some((seg) => seg.startsWith('.'))
  && !/^[a-z][a-z0-9+.-]*:/i.test(p);

/**
 * 服务端模块（`server.modules[*].entry`）的路径判据：与上面那条**同一条规则**（相对、不是 URL、目录段不以 `.`
 * 开头），只有扩展名不同（`.mjs`）。分成两个函数而不是给上面那个加参数，是因为「面板模块」与「服务端模块」是
 * 两条不同的通道 —— 一个 `.js` 永远不该从服务端这条进来，反之亦然。
 */
const isSafeServerModulePath = (p) =>
  isSafeRelativePath(p) && p.endsWith(SERVER_MODULE_EXT) && p.length > SERVER_MODULE_EXT.length
  && !p.split('/').some((seg) => seg.startsWith('.'))
  && !/^[a-z][a-z0-9+.-]*:/i.test(p);

/**
 * `pack.json.client` —— C 层注册点（§28.13）。`panels` 按 id 排序（与 `operators` 同一个理由：键序是清单字节的
 * 一部分，不能随作者书写顺序变）；`requires` 按闭枚举的次序归一化。
 * @returns {{ ok: true, decl: object } | { ok: false, error: string, detail: string }}
 */
function parseClientDecl(raw) {
  if (!isPlainObj(raw)) {
    return fail('CLIENT_DECL_BAD_SHAPE', 'client must be an object: { panels: [...], requires: [...] }');
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'panels' && key !== 'requires' && key !== 'theme') {
      return fail('CLIENT_UNKNOWN_FIELD', `client: "${key}" is not a declared field (panels, requires, theme)`);
    }
  }
  // `client` 至少要声明**一件能用的东西**：面板，或主题变量。业主裁决 2026-10-10 之后主题可以单独存在 —— 一个只想
  // 换几个颜色的包不该为了合法而附一个空面板（那正是「多样性/简便性」要的东西）。`requires` 单独出现仍然被拒：
  // 一个既没有界面、也没有主题的能力声明等于什么都没声明。空 `panels` 数组照旧被拒（与不写没区别，却会让
  // 「这个包有客户端界面」这句话变成假的）。
  if (raw.panels !== undefined && !Array.isArray(raw.panels)) return fail('CLIENT_BAD_PANELS', 'client.panels must be an array of panel declarations');
  if (Array.isArray(raw.panels) && !raw.panels.length) return fail('CLIENT_BAD_PANELS', 'client.panels must declare at least one panel (drop the key instead of sending [])');
  if (raw.panels === undefined && raw.theme === undefined) {
    return fail('CLIENT_BAD_PANELS', 'client must declare at least one of: panels (client interfaces), theme (CSS variables) — a client block that declares neither, or only requires, says nothing at all');
  }
  const panels = [];
  const seen = new Set();
  for (const [i, panel] of (Array.isArray(raw.panels) ? raw.panels : []).entries()) {
    if (!isPlainObj(panel)) return fail('CLIENT_BAD_PANEL', `client.panels[${i}] must be an object: { id, slot, module, order?, gate? }`);
    for (const key of Object.keys(panel)) {
      if (!CLIENT_PANEL_FIELDS.includes(key)) {
        return fail('CLIENT_PANEL_UNKNOWN_FIELD', `client.panels[${i}]: "${key}" is not a panel field (${CLIENT_PANEL_FIELDS.join(', ')})`);
      }
    }
    if (typeof panel.id !== 'string' || !RECORD_ID_RE.test(panel.id)) {
      return fail('CLIENT_BAD_PANEL_ID', `client.panels[${i}].id: "${String(panel.id)}" is not a valid panel id`);
    }
    if (seen.has(panel.id)) {
      return fail('CLIENT_PANEL_DUPLICATE_ID', `client.panels: "${panel.id}" is declared twice (one id, one panel: the second would overwrite the first)`);
    }
    seen.add(panel.id);
    if (!CLIENT_PANEL_SLOTS.includes(panel.slot)) {
      return fail('CLIENT_BAD_PANEL_SLOT', `client.panels["${panel.id}"].slot must be one of: ${CLIENT_PANEL_SLOTS.join(', ')}`);
    }
    if (!isSafeModulePath(panel.module)) {
      return fail('CLIENT_BAD_PANEL_MODULE', `client.panels["${panel.id}"].module must be a relative path inside the pack (e.g. "resources/preloadModal.js")`);
    }
    if (panel.order !== undefined && !Number.isInteger(panel.order)) {
      return fail('CLIENT_BAD_PANEL_ORDER', `client.panels["${panel.id}"].order must be an integer`);
    }
    if (panel.gate !== undefined && (typeof panel.gate !== 'string' || !panel.gate)) {
      return fail('CLIENT_BAD_PANEL_GATE', `client.panels["${panel.id}"].gate must be a non-empty string (e.g. "session.preloadRequired")`);
    }
    // 面板自带的样式表（业主裁决 2026-10-10）：包内相对 `.css`，一份一份点名。`clean` 里放的是**稳定序**清单 ——
    // 注入顺序就是层叠顺序，所以同一份声明两处写法不同必须得到同一份字节（DESIGN §28.2）。
    /** @type {string[]} */
    let styles = [];
    if (panel.styles !== undefined) {
      if (!Array.isArray(panel.styles) || !panel.styles.length) {
        return fail('CLIENT_BAD_PANEL_STYLES', `client.panels["${panel.id}"].styles must be a non-empty array of pack-relative "${CLIENT_PANEL_STYLES_EXT}" paths (drop the key instead of sending [])`);
      }
      if (panel.styles.length > CLIENT_MAX_PANEL_STYLES) {
        return fail('CLIENT_BAD_PANEL_STYLES', `client.panels["${panel.id}"].styles: at most ${CLIENT_MAX_PANEL_STYLES} stylesheets per panel (got ${panel.styles.length})`);
      }
      for (const style of panel.styles) {
        if (typeof style !== 'string' || !isSafeRelativePath(style)
          || !style.endsWith(CLIENT_PANEL_STYLES_EXT) || style.length <= CLIENT_PANEL_STYLES_EXT.length) {
          return fail('CLIENT_BAD_PANEL_STYLE', `client.panels["${panel.id}"].styles: "${String(style)}" must be a pack-relative "${CLIENT_PANEL_STYLES_EXT}" path (e.g. "ui/chat${CLIENT_PANEL_STYLES_EXT}")`);
        }
      }
      styles = stableStringList(panel.styles);
      if (styles.length !== panel.styles.length) {
        const dup = panel.styles.find((s, i) => panel.styles.indexOf(s) !== i);
        return fail('CLIENT_DUPLICATE_PANEL_STYLE', `client.panels["${panel.id}"].styles: "${String(dup)}" is listed twice (a stylesheet injected twice is not a thing to reason about)`);
      }
    }
    /** @type {Record<string, unknown>} */
    const clean = { id: panel.id, slot: panel.slot, module: panel.module };
    if (panel.order !== undefined) clean.order = panel.order;
    if (panel.gate !== undefined) clean.gate = panel.gate;
    if (styles.length) clean.styles = styles;
    // 数据口（`client.panels[].data`）：声明这个面板要读哪几张表。名字必须在闭枚举里（拼错的表名 = 一个永远
    // 拿不到数据的读取），上限就是「全部」（`CLIENT_MAX_PANEL_DATA_TABLES`，由名单推导）、去掉重复、
    // 按枚举次序写进清单（清单字节要稳定）。
    if (panel.data !== undefined) {
      if (!Array.isArray(panel.data) || !panel.data.length) {
        return fail('CLIENT_BAD_PANEL_DATA', `client.panels["${panel.id}"].data must be a non-empty array of table names (drop the key instead of sending [])`);
      }
      if (panel.data.length > CLIENT_MAX_PANEL_DATA_TABLES) {
        return fail('CLIENT_BAD_PANEL_DATA', `client.panels["${panel.id}"].data: at most ${CLIENT_MAX_PANEL_DATA_TABLES} tables (that is all of them)`);
      }
      for (const table of panel.data) {
        if (!CLIENT_PANEL_DATA_TABLES.includes(table)) {
          return fail('CLIENT_BAD_PANEL_DATA', `client.panels["${panel.id}"].data: "${String(table)}" is not a data table this page can read (one of: ${CLIENT_PANEL_DATA_TABLES.join(', ')})`);
        }
      }
      const wanted = CLIENT_PANEL_DATA_TABLES.filter((t) => panel.data.includes(t));
      if (new Set(panel.data).size !== panel.data.length) {
        return fail('CLIENT_DUPLICATE_PANEL_DATA', `client.panels["${panel.id}"].data lists the same table twice`);
      }
      clean.data = wanted;
    }
    // 包通道（`client.panels[].messages`，§1.9.6）：这个面板可以收发的**自家**通道名。与 `data` / `registers`
    // 同一条口径 —— 写下来的要能被看见、被审；名字的字符集在形状层就要判死，否则作者得到一条永远收不到的消息。
    if (panel.messages !== undefined) {
      if (!Array.isArray(panel.messages) || !panel.messages.length) {
        return fail('CLIENT_BAD_PANEL_MESSAGES', `client.panels["${panel.id}"].messages must be a non-empty array of channel names (drop the key instead of sending [])`);
      }
      if (panel.messages.length > CLIENT_MAX_PANEL_MESSAGES) {
        return fail('CLIENT_BAD_PANEL_MESSAGES', `client.panels["${panel.id}"].messages: at most ${CLIENT_MAX_PANEL_MESSAGES} channels per panel`);
      }
      for (const channel of panel.messages) {
        if (typeof channel !== 'string' || !PACK_CHANNEL_RE.test(channel)) {
          return fail('CLIENT_BAD_PANEL_CHANNEL', `client.panels["${panel.id}"].messages: "${String(channel)}" is not a channel name (lowercase letter first, then a-z 0-9 _ -, at most 64 — the wire name is "<this pack's id>.<channel>")`);
        }
      }
      if (new Set(panel.messages).size !== panel.messages.length) {
        return fail('CLIENT_DUPLICATE_PANEL_CHANNEL', `client.panels["${panel.id}"].messages lists the same channel twice`);
      }
      clean.messages = stableStringList(panel.messages);
    }
    // 组件级改写（`client.panels[].wraps`，DESIGN §28.19）：这个面板要包裹 / 替换哪几个**引擎具名组件**。
    // 与 `data` / `messages` 那两格**不同**的一条纪律：一条用不了的 wraps 声明让**整个面板**落地不了 ——
    // 一半的改写（链挂上了、另一半没挂）比完全没有改写更难查，与坏模块 / 坏样式表同一个结局。
    if (panel.wraps !== undefined) {
      if (!Array.isArray(panel.wraps) || !panel.wraps.length) {
        return fail('CLIENT_WRAP_BAD_SHAPE', `client.panels["${panel.id}"].wraps must be a non-empty array of { component, mode } (drop the key instead of sending [])`);
      }
      // 上限就是**枚举的大小**（一个组件一条链，重复的那条下面会被拒）：链长在引擎组件上，一次渲染要走完整条链，
      // 所以这个数必须有界 —— 而且它不该是第二个会漂的常量。
      if (panel.wraps.length > CLIENT_WRAP_COMPONENTS.length) {
        return fail('CLIENT_WRAP_BAD_SHAPE', `client.panels["${panel.id}"].wraps: at most ${CLIENT_WRAP_COMPONENTS.length} components per panel (got ${panel.wraps.length})`);
      }
      /** @type {Array<{ component: string, mode: string }>} */
      const wraps = [];
      for (const entry of panel.wraps) {
        if (!isPlainObj(entry) || Object.keys(entry).some((k) => k !== 'component' && k !== 'mode')) {
          return fail('CLIENT_WRAP_BAD_SHAPE', `client.panels["${panel.id}"].wraps: every entry must be an object { component, mode } (got ${JSON.stringify(entry)})`);
        }
        if (typeof entry.component !== 'string' || !entry.component) {
          return fail('CLIENT_WRAP_BAD_SHAPE', `client.panels["${panel.id}"].wraps: "component" must name an engine component (got ${JSON.stringify(entry.component)})`);
        }
        if (!CLIENT_WRAP_COMPONENTS.includes(entry.component)) {
          return fail('CLIENT_WRAP_UNKNOWN_COMPONENT', `client.panels["${panel.id}"].wraps: "${entry.component}" is not an engine component this build renders (one of: ${CLIENT_WRAP_COMPONENTS.join(', ')})`);
        }
        if (!CLIENT_WRAP_MODES.includes(entry.mode)) {
          return fail('CLIENT_WRAP_BAD_MODE', `client.panels["${panel.id}"].wraps["${entry.component}"].mode must be one of: ${CLIENT_WRAP_MODES.join(', ')} (got ${JSON.stringify(entry.mode)})`);
        }
        wraps.push({ component: entry.component, mode: entry.mode });
      }
      if (new Set(wraps.map((w) => w.component)).size !== wraps.length) {
        return fail('CLIENT_WRAP_BAD_SHAPE', `client.panels["${panel.id}"].wraps names the same component twice (one component, one link: two links would be two wrappers nobody can tell apart)`);
      }
      // 按组件名排序写进清单：一个面板里两条链互不影响，但清单字节必须稳定（DESIGN §28.2）——
      // **链的次序不在这里**：同一条链上多个包的先后由 `order` → 包 id → 面板 id 决定（§28.3），
      // 与作者书写次序、发现次序都无关。
      clean.wraps = wraps.slice().sort((a, b) => (a.component < b.component ? -1 : a.component > b.component ? 1 : 0));
    }
    panels.push(clean);
  }
  const rawRequires = raw.requires === undefined ? [] : raw.requires;
  if (!Array.isArray(rawRequires)) {
    return fail('CLIENT_BAD_REQUIRES', `client.requires must be an array (one of: ${CLIENT_REQUIRES.join(', ')})`);
  }
  const requires = stableStringList(rawRequires);
  for (const r of requires) {
    if (!CLIENT_REQUIRES.includes(r)) {
      return fail('CLIENT_UNKNOWN_REQUIRE', `client.requires: "${r}" is not a capability this layer knows (one of: ${CLIENT_REQUIRES.join(', ')})`);
    }
  }
  panels.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // 主题（`client.theme.vars`）：写 CSS 自定义属性，**加法**语义 —— 只加/改这几个变量名，不整份替换样式表。
  // 与面板自带 `.css` 的分工：要「几个颜色」用这里，要「一整份新组件的样式」用 `panels[].styles`（业主裁决：两条路都给）。
  /** @type {{ vars: Record<string, string> }|undefined} */
  let theme;
  if (raw.theme !== undefined) {
    const spec = raw.theme;
    if (!isPlainObj(spec)) return fail('CLIENT_THEME_BAD_SHAPE', 'client.theme must be an object: { vars }');
    for (const key of Object.keys(spec)) {
      if (!CLIENT_THEME_FIELDS.includes(key)) {
        return fail('CLIENT_THEME_UNKNOWN_FIELD', `client.theme: "${key}" is not a declared field (${CLIENT_THEME_FIELDS.join(', ')})`);
      }
    }
    if (!isPlainObj(spec.vars) || !Object.keys(spec.vars).length) {
      return fail('CLIENT_THEME_BAD_VARS', 'client.theme.vars must be a non-empty object of CSS custom properties (e.g. { "--sp-accent": "#c33" })');
    }
    const names = Object.keys(spec.vars);
    if (names.length > CLIENT_MAX_THEME_VARS) {
      return fail('CLIENT_THEME_TOO_MANY_VARS', `client.theme.vars: at most ${CLIENT_MAX_THEME_VARS} variables (got ${names.length})`);
    }
    /** @type {Record<string, string>} */
    const vars = {};
    // 按名字排序写进清单：注入顺序不影响结果（变量之间不互相替换），但字节必须稳定（DESIGN §28.2）。
    for (const name of names.slice().sort()) {
      if (!CLIENT_THEME_VAR_RE.test(name)) {
        return fail('CLIENT_THEME_BAD_VAR_NAME', `client.theme.vars: "${name}" is not a CSS custom property name — it must start with "--", or writing it would do nothing at all`);
      }
      const value = spec.vars[name];
      const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
      if (typeof text !== 'string' || !text.trim()) {
        return fail('CLIENT_THEME_BAD_VAR_VALUE', `client.theme.vars["${name}"] must be a non-empty string or a finite number`);
      }
      // 值是**数据**：它不许有「结束自己这条声明、再开一条」的能力（`;` / `{}` / `<` / 换行）。
      if (text.length > CLIENT_THEME_VALUE_MAX || CLIENT_THEME_VALUE_BAD.test(text)) {
        return fail('CLIENT_THEME_BAD_VAR_VALUE', `client.theme.vars["${name}"] may not contain ; { } < > or a newline, and is limited to ${CLIENT_THEME_VALUE_MAX} characters — a variable value must not be able to end its own declaration and start another`);
      }
      vars[name] = text;
    }
    theme = { vars };
  }
  // requires 按闭枚举次序，不按作者书写顺序：同一个包两处写法不同的清单必须是同一份字节（DESIGN §28.2）
  return { ok: true, decl: { panels, requires: CLIENT_REQUIRES.filter((c) => requires.includes(c)), ...(theme ? { theme } : {}) } };
}

/**
 * `pack.json.server.modules` —— 包的**服务端模块**（DESIGN §28.14，业主 2026-10-10：插件包那三件 —— 停机播报与快照、
 * 匿名对局统计、`/healthz` 加字段 —— 要有一条**不用手改引擎文件**的挂载通道）。
 *
 * 形状层判四件事：id 唯一且合法、`entry` 是包内相对 `.mjs`、`uses` 是挂载点闭枚举的非空子集且不重复、`write` 是布尔。
 * 「文件真的在不在、模块能不能 import、它挂上去之后有没有抛」都在装载期与运行期判（`server/modModules.js`）。
 * @returns {{ ok: true, decl: object } | { ok: false, error: string, detail: string }}
 */
function parseServerModulesDecl(raw) {
  if (!Array.isArray(raw)) return fail('MODULES_BAD_SHAPE', 'server.modules must be an array of { id, entry, uses, write? }');
  if (!raw.length) return fail('MODULES_BAD_SHAPE', 'server.modules must declare at least one module (drop the key instead of sending [])');
  if (raw.length > MAX_SERVER_MODULES) {
    return fail('MODULES_TOO_MANY', `server.modules: at most ${MAX_SERVER_MODULES} modules per pack (got ${raw.length})`);
  }
  const out = [];
  const seen = new Set();
  for (const [i, mod] of raw.entries()) {
    if (!isPlainObj(mod)) return fail('MODULES_BAD_SHAPE', `server.modules[${i}] must be an object: { id, entry, uses, write? }`);
    for (const key of Object.keys(mod)) {
      if (!SERVER_MODULE_FIELDS.includes(key)) {
        return fail('MODULES_UNKNOWN_FIELD', `server.modules[${i}]: "${key}" is not a module field (${SERVER_MODULE_FIELDS.join(', ')})`);
      }
    }
    if (typeof mod.id !== 'string' || !RECORD_ID_RE.test(mod.id)) {
      return fail('MODULES_BAD_ID', `server.modules[${i}].id: "${String(mod.id)}" is not a valid module id`);
    }
    if (seen.has(mod.id)) {
      return fail('MODULES_DUPLICATE_ID', `server.modules: "${mod.id}" is declared twice (one id, one module)`);
    }
    seen.add(mod.id);
    if (!isSafeServerModulePath(mod.entry)) {
      return fail('MODULES_BAD_ENTRY', `server.modules["${mod.id}"].entry must be a pack-relative "${SERVER_MODULE_EXT}" path (e.g. "server/ops${SERVER_MODULE_EXT}") — the server loads it, the browser and the battle sim never do`);
    }
    if (!Array.isArray(mod.uses) || !mod.uses.length) {
      return fail('MODULES_BAD_USES', `server.modules["${mod.id}"].uses must be a non-empty array of mount points (one of: ${SERVER_MODULE_USES.join(', ')})`);
    }
    for (const use of mod.uses) {
      if (!SERVER_MODULE_USES.includes(use)) {
        return fail('MODULES_BAD_USES', `server.modules["${mod.id}"].uses: "${String(use)}" is not a mount point this layer knows (one of: ${SERVER_MODULE_USES.join(', ')})`);
      }
    }
    if (new Set(mod.uses).size !== mod.uses.length) {
      return fail('MODULES_DUPLICATE_USE', `server.modules["${mod.id}"].uses lists the same mount point twice`);
    }
    if (mod.write !== undefined && typeof mod.write !== 'boolean') {
      return fail('MODULES_BAD_WRITE', `server.modules["${mod.id}"].write must be true or false (may this module write into its own state directory?)`);
    }
    // `channels`（DESIGN §28.23）：这个模块在对局里**接收**哪些包通道。判据四条，与面板那半边同一个通道名形状
    //（`PACK_CHANNEL_RE`）——「客户端能说什么」与「服务端在对局里收什么」必须是同一批名字，不能各写一套。
    if (mod.channels !== undefined) {
      if (!Array.isArray(mod.channels) || !mod.channels.length) {
        return fail('MODULES_BAD_CHANNELS', `server.modules["${mod.id}"].channels must be a non-empty array of channel names (drop the key instead of sending []) — the names are the ones a panel of this pack declares in "messages"`);
      }
      if (mod.channels.length > MAX_SERVER_MODULE_CHANNELS) {
        return fail('MODULES_TOO_MANY_CHANNELS', `server.modules["${mod.id}"].channels: at most ${MAX_SERVER_MODULE_CHANNELS} channels per module (got ${mod.channels.length})`);
      }
      for (const channel of mod.channels) {
        if (typeof channel !== 'string' || !PACK_CHANNEL_RE.test(channel)) {
          return fail('MODULES_BAD_CHANNEL', `server.modules["${mod.id}"].channels: "${String(channel)}" is not a channel name (^[a-z][a-z0-9_-]{0,63}$ — the same shape client.panels[].messages uses)`);
        }
      }
      if (new Set(mod.channels).size !== mod.channels.length) {
        return fail('MODULES_DUPLICATE_CHANNEL', `server.modules["${mod.id}"].channels lists the same channel twice`);
      }
      // 通道的接收人是**对局**（`Match.handlePackMsg`），而对局只可能是 `matchClass` 包装器交给平台的 —— 所以
      // 没有 matchClass 的 channels 是一条没有接收人的声明。拒掉，而不是让它永远不生效（本层到处在消灭的形态）。
      if (!mod.uses.includes('matchClass')) {
        return fail('MODULES_CHANNELS_NEED_MATCH', `server.modules["${mod.id}"].channels is delivered to the running match (Match.handlePackMsg, DESIGN §28.23), so this module must also declare the "matchClass" mount point — channels without matchClass have no receiver`);
      }
    }
    out.push({
      id: mod.id,
      entry: mod.entry,
      // 按闭枚举次序（不按作者书写顺序）：清单字节要稳定，与 `requires` / `registers` 同一条。
      uses: SERVER_MODULE_USES.filter((u) => mod.uses.includes(u)),
      write: mod.write === true,
      // 只在**声明了的时候**进清单（声明进身份哈希，没声明的包逐字节不变），并且排序：两个书写顺序不同的
      // 写法必须是同一个包（与 `uses` 按闭枚举次序同一条纪律）。
      ...(mod.channels === undefined ? {} : { channels: [...mod.channels].sort() }),
    });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ok: true, decl: { modules: out } };
}

/**
 * `pack.json.server` 允许的成员。**一份真相**：形状校验、`SERVER_EMPTY_MEMBER` 的文案，以及
 * `shared/modSurface.js` 的表面清单都锚在这一个符号上（`test/modSurface.test.js` 逐条断言它的成员仍在）。
 *
 * 加一格（例如历史上的 `meta`、`modules`、`battle`、`room`）= 一起做三件事：加进这张表、进表面清单、加一条钉它的测试。
 * 三处缺一，守卫就红 —— 这就是「引擎被移植改写时，中间层不会静默少一格」的那道闸门。
 */
export const SERVER_MEMBERS = Object.freeze(['preDispatch', 'meta', 'modules', 'battle', 'room', 'transport']);

/**
 * `pack.json.server.transport` —— **声明式的启动期传输配置**（DESIGN §28.30）。
 *
 * 为什么需要它：WebSocket 的 `perMessageDeflate` **从前**写死在 `server/http/websocket.js`（`false`）；0.2.6 起引擎缺省**自己开着**（`WS_DEFLATE`，`server/http/websocket.js:45-50`），包依旧只能**声明**。一个包
 * （参考包 `ws-compression-reference`）能拿到的唯一办法是**手改引擎那一行** —— 正是这一层到处在消灭的东西。
 *
 * 为什么它**只是声明**、而不是「包注入服务端代码去改 wss」：
 *   * 后者的能力面是**进程启动选项写权限**（一个包能改监听、改压缩、改超时），那已经不是「内容 / 界面 /
 *     只读观察」里的任何一层，而是运维杠杆；业主裁决「**声明式足够就不做**」说的就是这条；
 *   * 声明能给的同一个结果，代价小一个数量级：一张字段闭集、每个字段有上下界、启动日志点名生效值。
 *
 * 语义（与 `assets.serverPolicy` 的 `resourcePolicy` 逐字同一条先例）：它是**进程级**的 —— `perMessageDeflate`
 * 是 `WebSocketServer` 的构造选项，不是某个房间的属性，所以一个包声明它，全服务器的 socket 都变了。因此
 * **任何一条声明都会在启动日志里点名**，而多包声明时按 **DESIGN §28.3「包 id 小的赢」**取一份，其余点名忽略。
 *
 * 它改不了对局：压缩只改字节怎么走线，不改任何一条消息的内容与顺序 ⇒ **不要求** `combat: true`。
 */
export const TRANSPORT_FIELDS = Object.freeze([
  'deflate', 'threshold', 'level', 'memLevel', 'concurrencyLimit',
  'serverNoContextTakeover', 'clientNoContextTakeover', 'serverMaxWindowBits', 'clientMaxWindowBits',
]);
/** `deflate` 之外的每个字段的合法区间（闭区间，整数）。写出来是为了让「一个包能设多细」有界。 */
export const TRANSPORT_BOUNDS = Object.freeze({
  threshold: [0, 1048576],
  level: [0, 9],
  memLevel: [1, 9],
  concurrencyLimit: [1, 1000],
  serverMaxWindowBits: [8, 15],
  clientMaxWindowBits: [8, 15],
});

/**
 * `pack.json.server.transport` —— 声明式启动期传输配置（DESIGN §28.30，字段与理由见 `TRANSPORT_FIELDS`）。
 *
 * 归一化两条：`deflate` **必须在**（一个没有开关的块什么都没说，与 `SERVER_EMPTY_MEMBER` 同一条口径 ——
 * 宁可拒绝，也不收一份读不出意图的声明）；其余字段可省，省掉 = 用 `ws` 自己的缺省（引擎**不**在这里抄一份
 * 库的缺省值，抄一份就是第二个会漂的真相）。写回时按 `TRANSPORT_FIELDS` 的次序，所以清单字节稳定（进身份哈希）。
 * @returns {{ ok: true, decl: object } | { ok: false, error: string, detail: string }}
 */
function parseTransportDecl(raw) {
  if (!isPlainObj(raw)) {
    return fail('TRANSPORT_BAD_SHAPE', 'server.transport must be an object: { deflate, threshold?, level?, memLevel?, concurrencyLimit?, serverNoContextTakeover?, clientNoContextTakeover?, serverMaxWindowBits?, clientMaxWindowBits? }');
  }
  for (const key of Object.keys(raw)) {
    if (!TRANSPORT_FIELDS.includes(key)) {
      return fail('TRANSPORT_UNKNOWN_FIELD', `server.transport: "${key}" is not a declared field (${TRANSPORT_FIELDS.join(', ')})`);
    }
  }
  if (typeof raw.deflate !== 'boolean') {
    return fail('TRANSPORT_BAD_DEFLATE', 'server.transport.deflate must be true or false — it is the switch itself, and a block without it says nothing');
  }
  /** @type {Record<string, any>} */
  const out = { deflate: raw.deflate };
  for (const [key, [lo, hi]] of Object.entries(TRANSPORT_BOUNDS)) {
    if (raw[key] === undefined) continue;
    if (!Number.isInteger(raw[key]) || raw[key] < lo || raw[key] > hi) {
      return fail('TRANSPORT_BAD_VALUE', `server.transport.${key} must be an integer between ${lo} and ${hi}, got ${JSON.stringify(raw[key])}`);
    }
    out[key] = raw[key];
  }
  for (const key of ['serverNoContextTakeover', 'clientNoContextTakeover']) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'boolean') {
      return fail('TRANSPORT_BAD_VALUE', `server.transport.${key} must be true or false, got ${JSON.stringify(raw[key])}`);
    }
    out[key] = raw[key];
  }
  // 键序稳定：清单是身份哈希的输入，写法不同不该换一个摘要。
  /** @type {Record<string, any>} */
  const ordered = {};
  for (const key of TRANSPORT_FIELDS) if (out[key] !== undefined) ordered[key] = out[key];
  return { ok: true, decl: { transport: ordered } };
}

/**
 * `pack.json.server` —— 分发前的准入钩子（§28.13）、对局元注册表（§29）、**服务端模块**（§28.14）与
 * **房间级钩子**（§28.20）。
 * @returns {{ ok: true, decl: object } | { ok: false, error: string, detail: string }}
 */
function parseServerDecl(raw) {
  if (!isPlainObj(raw)) {
    return fail('SERVER_DECL_BAD_SHAPE', `server must be an object with at least one of: ${SERVER_MEMBERS.join(', ')}`);
  }
  for (const key of Object.keys(raw)) {
    if (!SERVER_MEMBERS.includes(key)) {
      return fail('SERVER_UNKNOWN_FIELD', `server: "${key}" is not a declared field (${SERVER_MEMBERS.join(', ')})`);
    }
  }
  // 「成员一个都没写」用名单本身判，不抄第二份 —— 加一格时这里不会忘（漏改一处就是一条永远判不出的拒绝）。
  if (SERVER_MEMBERS.every((m) => raw[m] === undefined)) {
    return fail('SERVER_EMPTY_MEMBER', `server must declare at least one member (${SERVER_MEMBERS.join(', ')}) — an empty object says nothing and is refused rather than ignored`);
  }
  /** @type {Record<string, object>} */
  const decl = {};
  if (raw.battle !== undefined) {
    const battle = parseBattleDecl(raw.battle);
    if (!battle.ok) return battle;
    decl.battle = battle.decl.battle;
  }
  if (raw.room !== undefined) {
    const room = parseRoomDecl(raw.room);
    if (!room.ok) return room;
    decl.room = room.decl.room;
  }
  if (raw.modules !== undefined) {
    const modules = parseServerModulesDecl(raw.modules);
    if (!modules.ok) return modules;
    decl.modules = modules.decl.modules;
  }
  if (raw.meta !== undefined) {
    const meta = parseMetaDecl(raw.meta);
    if (!meta.ok) return meta;
    decl.meta = meta.decl.meta;
  }
  if (raw.transport !== undefined) {
    const transport = parseTransportDecl(raw.transport);
    if (!transport.ok) return transport;
    decl.transport = transport.decl.transport;
  }
  if (raw.preDispatch === undefined) return { ok: true, decl };
  const pre = raw.preDispatch;
  if (!isPlainObj(pre)) {
    return fail('PREDISPATCH_BAD_SHAPE', 'server.preDispatch must be an object: { module, policy, intercepts }');
  }
  for (const key of Object.keys(pre)) {
    if (!PRE_DISPATCH_FIELDS.includes(key)) {
      return fail('PREDISPATCH_UNKNOWN_FIELD', `server.preDispatch: "${key}" is not a declared field (${PRE_DISPATCH_FIELDS.join(', ')})`);
    }
  }
  for (const key of ['module', 'policy']) {
    if (!isSafeRelativePath(pre[key])) {
      return fail('PREDISPATCH_BAD_PATH', `server.preDispatch.${key} must be a relative path inside the pack (no absolute paths, no "..")`);
    }
  }
  if (!pre.module.endsWith(PRE_DISPATCH_MODULE_EXT)) {
    return fail('PREDISPATCH_BAD_MODULE', `server.preDispatch.module must be a "${PRE_DISPATCH_MODULE_EXT}" module — the server loads it, the browser does not`);
  }
  if (!pre.policy.endsWith('.json')) {
    return fail('PREDISPATCH_BAD_POLICY', 'server.preDispatch.policy must name a .json policy file (the list of files a client must prove it holds)');
  }
  if (!Array.isArray(pre.intercepts) || !pre.intercepts.length) {
    return fail('PREDISPATCH_BAD_INTERCEPTS', 'server.preDispatch.intercepts must be a non-empty array of C2S message types (a hook that intercepts nothing gates nothing)');
  }
  for (const t of pre.intercepts) {
    if (typeof t !== 'string' || !PRE_DISPATCH_INTERCEPTS.includes(t)) {
      return fail('PREDISPATCH_UNKNOWN_TYPE', `server.preDispatch.intercepts: "${String(t)}" is not a message type of shared/protocol.js C2S (the bus never delivers a name no client sends)`);
    }
  }
  // 与 `client.panels` / `operators` 同一个理由：键序（列表次序也是字节）不能随作者书写顺序变。
  // 返回值保持提案的形状（外面那一层 `preDispatch` 是包格式的一部分，不在这里拆平）。
  const intercepts = stableStringList(pre.intercepts);
  decl.preDispatch = { module: pre.module, policy: pre.policy, intercepts };
  return { ok: true, decl };
}

/**
 * 一条注册键的形状：`<类别>:<id>`，或结尾带**一个** `*` 的前缀通配（`garrison:custom_*`）。
 * @returns {string|null} 拒绝理由；`null` = 形状合法
 */
function metaKeyIssue(key) {
  if (typeof key !== 'string' || !key) return `server.meta.registers: ${JSON.stringify(key)} is not a registry key`;
  const starred = key.endsWith('*');
  const body = starred ? key.slice(0, -1) : key;
  // 星号只能是**结尾那一个**：`bond:a*b` 既不是精确键（注册表的 id 字符集不含 `*`）也不是前缀匹配，
  // 它会变成一条永远注册不上的声明 —— 而「写了等于没写」正是这一节要消灭的东西。
  if (body.includes('*')) {
    return `server.meta.registers: "${key}" may carry at most ONE trailing "*" (a prefix match such as "garrison:custom_*")`;
  }
  if (starred && !body) return `server.meta.registers: "${key}" is only a "*": name a class and a prefix`;
  const at = body.indexOf(':');
  if (at <= 0 || at === body.length - 1) {
    return `server.meta.registers: "${key}" must look like "<class>:<id>" — one of ${META_KEY_CLASSES.join(', ')}`;
  }
  const cls = body.slice(0, at);
  if (!META_KEY_CLASSES.includes(cls)) {
    return `server.meta.registers: "${key}" names the registry class "${cls}", which is not one of ${META_KEY_CLASSES.join(', ')}`;
  }
  // id 的字符集与注册表自己那条 `KEY_RE` 一致（`[A-Za-z0-9_\-.:#]`）：形状层放行、运行时抛异常，是最坏的一种分工。
  if (!META_KEY_TAIL_RE.test(body.slice(at + 1))) {
    return `server.meta.registers: "${key}" has characters the registry does not accept after the class (allowed: letters, digits, _ - . : #)`;
  }
  return null;
}

/**
 * `pack.json.server.meta` —— 包的**对局元注册表**载荷（DESIGN §29）。它是 B 层的第二类载荷：一个 `.mjs` 导出
 * `registerMeta(registry)`（与官方内容模块同形），在**这一局**的注册表上登记它自己的处理器。
 *
 * `registers` 是**白名单，不是提示**：运行时那个受限注册表对任何没列在这里的键**一注册就抛**。理由与
 * `intercepts` 逐字相同 —— 不声明就可能**悄悄顶掉官方的**处理器（`register()` 是「后注册的赢」），
 * 而「静默改官方行为」正是本仓每个面都在拒绝的那一类。
 *
 * 形状层判形状；「文件真的在不在、能不能 import」是装载期（`server/workshop.js metaIssues` 与装配路径）。
 * @returns {{ ok: true, decl: object } | { ok: false, error: string, detail: string }}
 */
function parseMetaDecl(raw) {
  if (!isPlainObj(raw)) {
    return fail('META_BAD_SHAPE', 'server.meta must be an object: { module, registers }');
  }
  for (const key of Object.keys(raw)) {
    if (!META_FIELDS.includes(key)) {
      return fail('META_UNKNOWN_FIELD', `server.meta: "${key}" is not a declared field (${META_FIELDS.join(', ')})`);
    }
  }
  if (!isSafeRelativePath(raw.module)) {
    return fail('META_BAD_PATH', 'server.meta.module must be a relative path inside the pack (no absolute paths, no "..")');
  }
  if (!raw.module.endsWith(META_MODULE_EXT)) {
    return fail('META_BAD_MODULE', `server.meta.module must be a "${META_MODULE_EXT}" module — the server loads it, the browser does not`);
  }
  if (!Array.isArray(raw.registers) || !raw.registers.length) {
    return fail('META_BAD_REGISTERS', 'server.meta.registers must be a non-empty array of the registry keys this pack may register (a module allowed to register nothing is a module that does nothing)');
  }
  for (const key of raw.registers) {
    const issue = metaKeyIssue(key);
    if (issue) return fail('META_BAD_KEY', issue);
  }
  const registers = stableStringList(raw.registers);
  if (registers.length !== raw.registers.length) {
    const seen = new Set();
    const dup = raw.registers.find((k) => (seen.has(k) ? true : (seen.add(k), false)));
    return fail('META_DUPLICATE_KEY', `server.meta.registers: "${String(dup)}" is listed twice (one key, one owner)`);
  }
  return { ok: true, decl: { meta: { module: raw.module, registers } } };
}

/**
 * `pack.json.server.battle` —— 包的**战斗逻辑**模块（DESIGN §28.17）。形状只有 `{ module }`：
 * 一个包内相对 `.mjs`，导出 `install(battle)`。
 *
 * 形状为什么这么小：这一层**不需要** `registers` 那样的白名单 —— 一个 `install(battle)` 拿到的是 Battle 对象的
 * 公开方法（`docs/SIM.md` §6 那一套，与官方内容模块用的是同一个），它**不是**往一个共享命名空间里注册键，
 * 所以没有「悄悄顶掉官方处理器」这条失败模式。真正的边界在 import 面（`@battle/` + `@sim/`）与确定性扫描上。
 * 形状层判形状；「文件在不在、能不能 import、有没有 `install` 导出」是装载期与装配路径。
 * @returns {{ ok: true, decl: object } | { ok: false, error: string, detail: string }}
 */
function parseBattleDecl(raw) {
  if (!isPlainObj(raw)) {
    return fail('BATTLE_BAD_SHAPE', 'server.battle must be an object: { module }');
  }
  for (const key of Object.keys(raw)) {
    if (!BATTLE_FIELDS.includes(key)) {
      return fail('BATTLE_UNKNOWN_FIELD', `server.battle: "${key}" is not a declared field (${BATTLE_FIELDS.join(', ')})`);
    }
  }
  if (!isSafeRelativePath(raw.module)) {
    return fail('BATTLE_BAD_PATH', 'server.battle.module must be a relative path inside the pack (no absolute paths, no "..")');
  }
  if (!raw.module.endsWith(BATTLE_MODULE_EXT)) {
    return fail('BATTLE_BAD_MODULE', `server.battle.module must be a "${BATTLE_MODULE_EXT}" module — it runs on both ends (the server recomputes the battle the browser simulated)`);
  }
  return { ok: true, decl: { battle: { module: raw.module } } };
}

/**
 * `pack.json.server.room` —— 包的**房间级钩子**模块（DESIGN §28.20）。形状与 `server.battle` 逐字同形：只有
 * `{ module }`，一个包内相对 `.mjs`，导出 `install(room)`。
 *
 * 为什么形状这么小：与战斗逻辑模块同一个理由 —— 房间钩子**不是**往一个共享命名空间里注册键（没有 `registers`
 * 那样的白名单），它拿到的是引擎递进来的一个对象。真正的边界在**那个对象有什么**（`server/roomPack.js` 的成员表）
 * 与 **import 面**（只有 `@sim/`，§28.20）上。形状层判形状；「文件在不在、能不能 import、有没有 `install` 导出」
 * 是装载期与运行期。
 * @returns {{ ok: true, decl: object } | { ok: false, error: string, detail: string }}
 */
function parseRoomDecl(raw) {
  if (!isPlainObj(raw)) {
    return fail('ROOM_BAD_SHAPE', 'server.room must be an object: { module }');
  }
  for (const key of Object.keys(raw)) {
    if (!ROOM_FIELDS.includes(key)) {
      return fail('ROOM_UNKNOWN_FIELD', `server.room: "${key}" is not a declared field (${ROOM_FIELDS.join(', ')})`);
    }
  }
  if (!isSafeRelativePath(raw.module)) {
    return fail('ROOM_BAD_PATH', 'server.room.module must be a relative path inside the pack (no absolute paths, no "..")');
  }
  if (!raw.module.endsWith(ROOM_MODULE_EXT) || raw.module.length <= ROOM_MODULE_EXT.length) {
    return fail('ROOM_BAD_MODULE', `server.room.module must be a "${ROOM_MODULE_EXT}" module — the server loads it, the browser never does (unlike server.battle, which both ends run)`);
  }
  return { ok: true, decl: { room: { module: raw.module } } };
}

/**
 * `pack.json.routes` —— 包能声明的**只读** HTTP 路由（§28.13）。刻意窄：绝对路径、包内 `.json`、三种缓存语义。
 *   * `path` 必须是 `/` 开头的绝对路径：一条相对路径落到哪个前缀上是路由表说了算，作者不该猜；
 *   * `file` 必须以 `.json` 结尾：`.js` / `.html` 一律不在此通道（那与 `/workshop-assets` 拒绝它们同一个理由
 *     —— 那是代码执行面，不是数据面）。
 * @returns {{ ok: true, decl: object[] } | { ok: false, error: string, detail: string }}
 */
function parseRoutesDecl(raw) {
  if (!Array.isArray(raw)) return fail('ROUTES_BAD_SHAPE', 'routes must be an array of { path, file, cache? }');
  const out = [];
  const seen = new Set();
  for (const [i, route] of raw.entries()) {
    if (!isPlainObj(route)) return fail('ROUTES_BAD_SHAPE', `routes[${i}] must be an object: { path, file, cache? }`);
    for (const key of Object.keys(route)) {
      if (!ROUTE_FIELDS.includes(key)) {
        return fail('ROUTE_UNKNOWN_FIELD', `routes[${i}]: "${key}" is not a route field (${ROUTE_FIELDS.join(', ')})`);
      }
    }
    if (typeof route.path !== 'string' || !route.path.startsWith('/') || route.path.length < 2
      || route.path.includes('\\') || route.path.split('/').some((seg) => seg === '..' || seg === '.')) {
      return fail('ROUTE_BAD_PATH', `routes[${i}].path must be an absolute HTTP path (e.g. "/data/resource-manifest.json")`);
    }
    if (seen.has(route.path)) return fail('ROUTE_DUPLICATE_PATH', `routes: "${route.path}" is declared twice (one path, one file)`);
    seen.add(route.path);
    if (!isSafeRelativePath(route.file)) {
      return fail('ROUTE_BAD_FILE', `routes["${route.path}"].file must be a relative path inside the pack (no absolute paths, no "..")`);
    }
    if (!route.file.endsWith('.json')) {
      return fail('ROUTE_BAD_FILE', `routes["${route.path}"].file must name a .json file — this channel never serves code or markup`);
    }
    const cache = route.cache === undefined ? 'no-cache' : route.cache;
    if (!ROUTE_CACHE_POLICIES.includes(cache)) {
      return fail('ROUTE_BAD_CACHE', `routes["${route.path}"].cache must be one of: ${ROUTE_CACHE_POLICIES.join(', ')}`);
    }
    out.push({ path: route.path, file: route.file, cache });
  }
  return { ok: true, decl: out };
}

/**
 * `pack.json.i18n` —— 给**已有语种**补词条的通道（fanpack G-04 / plugin-pack G4，docs/WORKSHOP.md §1.10）。
 *
 * 为什么需要它：`packs/` 的 `lang` 类型只能**新增**一个语种 —— 一个包带 `en` / `ja` / `ko` / `zh-TW` 里的任何一个，
 * 真实的扫描器都会整包跳过，原文是 `the language en is already provided by public/i18n/en.json`。而任何带新界面的
 * 包（新面板、新按钮、新提示）都需要**给已有语种补键**，所以这是个结构性的缺口，不是配置问题。
 *
 * 形状刻意是「语种 → 包内 .json 文件」而不是内联对象：
 *   * 一个包给四个语种各补 74 键，内联会让 `pack.json` 长出 20 KB，而这份清单是身份哈希的输入（`identifyPack`
 *     哈希的是归一化后的清单），内联等于把整份译文塞进哈希清单的**一个字符串**里；
 *   * 文件路径是**可哈希**的：`identifyPack` 对每一个声明的 i18n 文件单独 `sha256`（与 `client.panels` 的模块同一条
 *     纪律）—— 换一份译文就是换一个包；
 *   * 形状与语言包本身逐字相同（`{ "<中文 msgid>": "<译文>" }`），作者可以照抄 `public/i18n/<code>.json`。
 *
 * 拒绝的三种形状（都点名，不静默）：语种码不是 `shared/i18nPacks.js` 认的常用大小写、语种是源语言 `zh`
 * （msgid 自己，没有包）、路径不是包内相对 `.json`。至于「这个文件在不在、是不是 JSON 对象」要读磁盘，
 * 在装载期（`server/workshop.js i18nIssues`）。
 *
 * @returns {{ ok: true, decl: Record<string, string> } | { ok: false, error: string, detail: string }}
 */
/**
 * `pack.json.dependencies` / `pack.json.conflicts` —— 管理器合同（DESIGN §28.48）的形状：`[{ id, range? }]`。
 *
 * `id` 是**另一个工坊包**的 id（`PACK_ID_RE` 同一套字符集 —— 一个 `../escape` 在这里就被点名拒，绝不留到
 * 装载期去拼路径），`range` 是那个包 `version` 的区间（`shared/packs.js` 的同一套语法，缺省 = 任意版本）。
 *
 * 两条形状纪律，都是「不许猜作者的意思」：
 *   * **逐字重复的条目去重**（`{id:'b'}` 写两遍是同一个意思），输出按 `(id, range)` 排序 ⇒ 归一化确定、
 *     同一个包在两端得到同一份清单；
 *   * **同一个 id 配两个不同的 range 是点名拒绝**（`*_CONFLICTING_RANGES`）—— 哪个区间算数？作者没说，
 *     猜一个就等于替他做了一个会影响装载的决定。
 *
 * 这里只管形状。**语义在装载期**：是不是真的缺、版本合不合、有没有和别的包互斥、链上有没有断、有没有环，
 * 全部由 `adjudicatePackGraph` 在那份**已加载的包集合**上裁决（形状对、语义照样可以死）。
 * @param {unknown} raw
 * @param {string} what `dependencies` / `conflicts`（进错误码与文案）
 * @returns {{ ok: true, decl: object[] } | { ok: false, error: string, detail: string }}
 */
function parseModRefsDecl(raw, what) {
  if (!Array.isArray(raw)) {
    return fail(`${what.toUpperCase()}_BAD_SHAPE`, `${what} must be a list of { id, range? } entries (a pack id of another workshop pack)`);
  }
  const out = [];
  const seen = new Map();
  for (const [i, row] of raw.entries()) {
    const where = `${what}[${i}]`;
    if (!isPlainObj(row)) return fail(`${what.toUpperCase()}_BAD_ENTRY`, `${where} must be an object: { id, range? }`);
    for (const key of Object.keys(row)) {
      if (!['id', 'range'].includes(key)) return fail(`${what.toUpperCase()}_UNKNOWN_FIELD`, `${where}: "${key}" is not a declared field (id, range)`);
    }
    if (typeof row.id !== 'string' || !PACK_ID_RE.test(row.id)) {
      return fail(`${what.toUpperCase()}_BAD_ID`, `${where}.id ${JSON.stringify(row.id ?? null)} is not a pack id`);
    }
    if (row.range !== undefined && (typeof row.range !== 'string' || !isVersionRange(row.range))) {
      return fail(`${what.toUpperCase()}_BAD_RANGE`, `${where}.range: ${JSON.stringify(row.range ?? null)} is not a version range (">=1.0.0", "1.x" …)`);
    }
    const key = `${row.id}@${row.range ?? '*'}`;
    if (seen.has(key)) continue; // 逐字相同的重复条目：去重（输出按 (id, range) 排序，确定性不变）
    seen.set(key, row.id);
    out.push(row.range === undefined ? { id: row.id } : { id: row.id, range: row.range });
  }
  // 同 id 不同 range：语义没法确定（哪个区间算数？），点名拒绝而不是猜
  const byId = new Map();
  for (const e of out) {
    if (!byId.has(e.id)) byId.set(e.id, []);
    byId.get(e.id).push(e.range ?? '*');
  }
  for (const [id, ranges] of byId) {
    if (new Set(ranges).size > 1) return fail(`${what.toUpperCase()}_CONFLICTING_RANGES`, `${what}: "${id}" is listed with different ranges (${ranges.join(' vs ')}) — one entry per dependency`);
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : (a.range ?? '') < (b.range ?? '') ? -1 : 1));
  return { ok: true, decl: out };
}

/**
 * `pack.json.notices` —— 包的**纯文本声明**（DESIGN §28.15，业主 2026-10-10：「公告 / 鸣谢这一类非游戏内容的声明」）。
 *
 * 两个成员都是**包内相对 `.json` 路径**（不是内联文本）：与 `i18n` 同一条理由 —— 一段要展示给人看的正文属于内容，
 * 写在 `pack.json` 里会让清单变成一篇文档；落成 `.json` 之后它进身份哈希、能被工具检查、也能被服务面的合并体送达。
 *
 * 两份文件的形状（服务面合并时逐条复判，作者侧 `tools/workshop-validate.mjs` 看同一份判据）：
 *   * `announcement`：`{ version, date, summary, sections: [{ name, items: [string] }] }`；
 *   * `credits`：`[{ name, note?, url? }]`（`url` 只能是 `https://`）。
 *
 * 与 `i18n` 的差别：这里的对象是**这一份声明自己的**（一个包一条公告、一张署名表），所以合并是**追加**而不是逐键
 * 覆盖 —— 两个包的公告不会互相覆盖，引擎的公告也不会被包顶掉。
 * @returns {{ ok: true, decl: object } | { ok: false, error: string, detail: string }}
 */
function parseNoticesDecl(raw) {
  if (!isPlainObj(raw)) return fail('NOTICES_BAD_SHAPE', 'notices must be an object: { announcement?, credits? }');
  const NOTICES_FIELDS = ['announcement', 'credits'];
  for (const key of Object.keys(raw)) {
    if (!NOTICES_FIELDS.includes(key)) {
      return fail('NOTICES_UNKNOWN_FIELD', `notices: "${key}" is not a declared field (${NOTICES_FIELDS.join(', ')})`);
    }
  }
  if (raw.announcement === undefined && raw.credits === undefined) {
    return fail('NOTICES_EMPTY', `notices must declare at least one of: ${NOTICES_FIELDS.join(', ')} — an empty object says nothing and is refused rather than ignored`);
  }
  /** @type {Record<string, string>} */
  const decl = {};
  for (const field of NOTICES_FIELDS) {
    if (raw[field] === undefined) continue;
    const rel = raw[field];
    if (!isSafeRelativePath(rel) || !rel.endsWith('.json') || rel.length <= '.json'.length) {
      return fail('NOTICES_BAD_PATH', `notices.${field} must be a pack-relative ".json" path (e.g. "notice/${field}.json") — the file is hashed into the pack's identity and served inside the merged notice body`);
    }
    decl[field] = rel;
  }
  return { ok: true, decl };
}

function parseI18nDecl(raw) {
  if (!isPlainObj(raw)) {
    return fail('I18N_BAD_SHAPE', 'i18n must be an object: { "<lang code>": "<relative path to a .json of msgid → translation>" }');
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const code of Object.keys(raw).sort()) {
    const file = raw[code];
    if (!isLangCode(code)) {
      return fail('I18N_BAD_LANG', `i18n: "${code}" is not a language code in its usual case (en, ja, ko, zh-TW, pt-BR …)`);
    }
    if (code === SOURCE_LANG) {
      return fail('I18N_SOURCE_LANG', `i18n: "${SOURCE_LANG}" is the source language (the msgids themselves) — it has no language file to add to`);
    }
    if (!isSafeRelativePath(file) || !file.endsWith('.json')) {
      return fail('I18N_BAD_FILE', `i18n["${code}"] must be a relative path inside the pack, ending in .json (e.g. "i18n/${code}.json") — the loader reads those bytes, and they are part of this pack's identity`);
    }
    out[code] = file;
  }
  // 键序不影响 `canonicalJson`（它排键），但**键在不在**影响哈希，所以这里只保证「声明过才有」，
  // 顺序由 `parseI18nDecl` 的 sort 定死，不随作者书写顺序变。
  return { ok: true, decl: out };
}

/**
 * 形态（clip set）通道的形状（`pack.json.forms`，DESIGN §28.29）。
 *
 * 判据逐条（每条都对应一种「作者写了却不生效」的失败方向）：
 *   * 表名必须是 `chars` / `enemies` / `tokens` —— 与 `ART_TABLES` 的对象表**同一组**（形态说的是 spine 模型，
 *     而模型只住在这三张表里）；写别的名字**点名拒绝**（`FORMS_UNKNOWN_TABLE`），不是悄悄丢掉；
 *   * 形态名必须是 `FORM_KIND_RE` 形状的字符串（它会成为 `FORMS[spine][kind]` 的键，也是 sim fx 里 `form` 的值）；
 *   * 形态级字段只许 `change` / `end` / `leave` / `next` / `roles`（`FORMS_SPEC_UNKNOWN_FIELD`）；
 *   * 三个 clip 名（`change` / `end` / `leave`）必须是字符串或 null —— 渲染器拿它去 skeleton 里找 clip；
 *   * `roles` 由 `checkFormRoles` 判（键在白名单里、值是非空字符串 / null / 一个 `{begin, loop, end}` 对象）；
 *   * **第一方已有的形态名一律拒绝**（`FORMS_FIRST_PARTY_OVERLAP`）：合并规则是第一方优先（§28.29 裁决 2），
 *     所以「包想覆盖第一方」这件事一旦被静静丢掉，作者面对的就是「写了等于没写」—— 这一层存在的全部理由就是
 *     消灭那个方向，所以它在这里被点名，而不是在并表时被过滤。
 *
 * `next` 的死链判定**不在这里**：它要等同一个 spine id 上的形态名都收齐（`formNextDeadLink`，在
 * `normalizePackManifest` 里形状判完之后跑）。
 */
function parseFormsDecl(raw) {
  if (!isPlainObj(raw)) {
    return fail('FORMS_BAD_SHAPE', `forms must be an object: { ${FORM_TABLES.join('|')}: { "<spine id>": { "<form name>": { roles } } } }`);
  }
  /** @type {Record<string, Record<string, object>>} */
  const decl = {};
  for (const [table, entries] of Object.entries(raw)) {
    if (!FORM_TABLES.includes(table)) {
      return fail('FORMS_UNKNOWN_TABLE', `forms: "${table}" is not a form table (one of: ${FORM_TABLES.join(', ')} — the three tables that carry a spine model)`);
    }
    if (!isPlainObj(entries)) {
      return fail('FORMS_BAD_SHAPE', `forms.${table} must be an object: { "<spine id>": { "<form name>": { roles } } }`);
    }
    for (const [id, spec] of Object.entries(entries)) {
      if (!RECORD_ID_RE.test(id)) {
        return fail('FORMS_BAD_ID', `forms.${table}: "${id}" is not a valid spine id (the key is the spine id / defId the view looks the form up by)`);
      }
      if (!isPlainObj(spec)) {
        return fail('FORMS_BAD_SHAPE', `forms.${table}["${id}"] must be an object of { "<form name>": { change?, end?, leave?, next?, roles } }`);
      }
      const official = firstPartyFormNames(id);
      for (const [kind, form] of Object.entries(spec)) {
        const where = `forms.${table}["${id}"].${kind}`;
        if (!FORM_KIND_RE.test(kind)) {
          return fail('FORMS_BAD_KIND', `${where}: the form name must be a plain name (letters, digits, "_", starting with a letter) — it becomes a key of the form table and the value of an fx "form"`);
        }
        if (official.has(kind)) {
          return fail('FORMS_FIRST_PARTY_OVERLAP', `${where}: the first-party FORMS table already has the form "${kind}" on "${id}" and it wins (DESIGN §28.29) — pick a form name of your own; a declaration that cannot take effect is refused rather than dropped`);
        }
        if (!isPlainObj(form)) return fail('FORMS_BAD_SHAPE', `${where} must be an object: { change?, end?, leave?, next?, roles }`);
        for (const key of Object.keys(form)) {
          if (!FORM_SPEC_KEYS.includes(key)) {
            return fail('FORMS_SPEC_UNKNOWN_FIELD', `${where}: "${key}" is not a field of a form (${FORM_SPEC_KEYS.join(', ')}) — the renderer reads change / end / leave / next / roles`);
          }
        }
        for (const clip of ['change', 'end', 'leave']) {
          const v = form[clip];
          if (v === undefined || v === null) continue;
          if (typeof v !== 'string' || !v) return fail('FORMS_BAD_CLIP', `${where}.${clip} must be a non-empty clip name string (or null: no such clip)`);
        }
        if (form.next !== undefined && form.next !== null) {
          if (typeof form.next !== 'string' || !FORM_KIND_RE.test(form.next)) {
            return fail('FORMS_BAD_NEXT', `${where}.next must be the name of another form on "${id}"`);
          }
        }
        if (form.roles === undefined || form.roles === null) {
          // `roles: null` / `roles: {}` 在渲染器里是同一件事（什么都不画的形态，中间态与终态都用得上），
          // 但**省略** roles 与「这个形态没有 clip」不是同一件事：前者多半是作者忘了写。
          return fail('FORMS_MISSING_ROLES', `${where} has no "roles" — every form states its clip set (use "roles": {} for a form that draws nothing of its own)`);
        }
        const roles = checkFormRoles(form.roles);
        if (!roles.ok) return fail('FORMS_BAD_ROLES', `${where}.${roles.reason}`);
        (decl[table] ||= {})[id] ||= {};
        decl[table][id][kind] = {
          ...(form.change !== undefined && form.change !== null ? { change: form.change } : {}),
          ...(form.end !== undefined && form.end !== null ? { end: form.end } : {}),
          ...(form.leave !== undefined && form.leave !== null ? { leave: form.leave } : {}),
          ...(form.next !== undefined && form.next !== null ? { next: form.next } : {}),
          roles: roles.value,
        };
      }
    }
  }
  return { ok: true, decl };
}

/**
 * `next` 那条链的判据（`FORMS_NEXT_UNKNOWN`）：`next` 必须指向**同一个 spine id 上**已声明的形态 ——
 * 第一方 `FORMS` 里的那一个，或本包同一份声明里的那一个。指向别处就是死链：渲染器读
 * `formsFor(spine)?.[f.next]`，取到 `undefined` 时那条 `end` 动画落地后**什么都不会切**。
 *
 * 纯函数（喂一份声明就能测失败分支），调用点在 `normalizePackManifest` 的形状判完之后。
 * @param {Record<string, Record<string, object>>} decl 已过形状层的 `forms`
 * @returns {{ table: string, id: string, kind: string, next: string } | null} 第一条死链
 */
export function formNextDeadLink(decl) {
  for (const [table, entries] of Object.entries(isPlainObj(decl) ? decl : {})) {
    for (const [id, forms] of Object.entries(entries)) {
      const known = firstPartyFormNames(id);
      for (const kind of Object.keys(forms)) known.add(kind);
      for (const [kind, form] of Object.entries(forms)) {
        const next = form && form.next;
        if (typeof next === 'string' && !known.has(next)) return { table, id, kind, next };
      }
    }
  }
  return null;
}

/**
 * 静态相位通道的形状（`pack.json.fx.silentPhases`，DESIGN §28.29）。
 *
 * 判据只有两条，但两条都是「不生效」的方向：未知字段点名拒绝（`FX_UNKNOWN_FIELD`），数组里每一条必须是
 * 非空字符串（`FX_BAD_SILENT_PHASE`）。`silentPhases: []` 是**合法但什么都不做**的声明 —— 与 `routes: []`
 * 同一个语义，所以它不算贡献项（见 `contributes` 那一处）。
 */
function parseFxDecl(raw) {
  if (!isPlainObj(raw)) return fail('FX_BAD_SHAPE', 'fx must be an object: { silentPhases: ["<phase kind>", …] }');
  const FX_FIELDS = ['silentPhases'];
  for (const key of Object.keys(raw)) {
    if (!FX_FIELDS.includes(key)) {
      return fail('FX_UNKNOWN_FIELD', `fx: "${key}" is not a declared field (${FX_FIELDS.join(', ')})`);
    }
  }
  if (raw.silentPhases === undefined) {
    return fail('FX_BAD_SHAPE', `fx must declare at least one of: ${FX_FIELDS.join(', ')} — an empty object says nothing and is refused rather than ignored`);
  }
  if (!Array.isArray(raw.silentPhases)) {
    return fail('FX_BAD_SHAPE', 'fx.silentPhases must be an array of phase kinds (e.g. ["bombed", "warning"])');
  }
  /** @type {string[]} */
  const silentPhases = [];
  for (const kind of raw.silentPhases) {
    if (typeof kind !== 'string' || !kind) {
      return fail('FX_BAD_SILENT_PHASE', `fx.silentPhases: ${JSON.stringify(kind)} must be a non-empty string (the "kind" of a 'phase' fx)`);
    }
    if (!silentPhases.includes(kind)) silentPhases.push(kind);
  }
  silentPhases.sort();
  return { ok: true, decl: { silentPhases } };
}

/**
 * `pack.json.operators[<charId>]` 允许的两个列表字段。**只此一份**：形状校验（`normalizePackManifest`）与
 * 「盟约存不存在」那一步（`mergeWorkshopOperators`）读的是同一张表，两处不会漂移。
 *
 * 为什么 `bonds` 必须点名：盟约 id 写错时那条盟约条**永远不会出现**，而作者只会以为「盟约没生效」—— 静默失效
 * （与 `bondIcons` 同一个理由：一个没人读到的声明比一条报错坏得多）。
 */
const OPERATOR_LIST_FIELDS = Object.freeze(['powers', 'bonds']);

/**
 * 一个「字符串列表」字段（`operators[*].bonds` / `.powers`）：数组、每一项是非空字符串、去重、排序（键序是清单
 * 字节的一部分）。不是数组、或里面有一个不是字符串 → 拒绝，并指出**是哪一条的哪一个字段**。
 * @returns {{ ok: true, list: string[] } | { ok: false, detail: string }}
 */
function parseStringList(value, where) {
  const list = value === undefined ? [] : value;
  if (!Array.isArray(list)) return { ok: false, detail: `${where} must be an array of ids` };
  const out = [];
  for (const id of list) {
    if (typeof id !== 'string' || !id.trim()) return { ok: false, detail: `${where}: "${String(id)}" is not a valid id` };
    const clean = id.trim();
    if (!out.includes(clean)) out.push(clean);
  }
  return { ok: true, list: out.sort() };
}

/**
 * 外观素材的三张表，以及每张表的条目允许带什么。
 *
 * 形状与 `data/assets.json` 里对应条目**1:1**，作者可以照抄官方条目（tools/assets 计划的产物）再改路径，所以这里
 * 只描述「哪些字段是路径、spine 在哪一层」，不重新发明一套 schema：
 *   * `urls`   —— 这个条目上直接是路径的字段（头像/立绘/图标）；
 *   * `strings`—— 原样抄过去的字符串字段（`enemies.spineAliasOf` 指向另一个怪物的模型、`tokens.owner` 是它属于谁）；
 *   * `spine`  —— `'sides'`：spine 在 `spine.front` / `spine.back` 两层下（chars）；`'flat'`：spine 就是条目上的
 *                 `spine` 字段（enemies / tokens）。
 *   * `flat`   —— 这一张表的**条目本身就是一条路径字符串**（不是"对象 + `urls` 字段"）。今天的成员是 `skills`
 *                 （技能图标）与 `profSub`（分支图标）：`assets.skills[key]` 与 `assets.prof.sub[key]` 的值**直接
 *                 就是路径字符串**（`data/assets.json` 实测），所以这里没有字段可列。谁赢与落盘位置由 `target`
 *                 给出（见 `mergeWorkshopFlatArt`）。
 */
/**
 * 时装（`pack.json.skins`）允许的字段。**一个不多一个不少** —— 与 art 表同一个纪律：写错的名字点名拒绝，
 * 而不是静默丢掉（静默丢掉的那一半正是 `variants` / `skins` 在 0.10.0 时代的遭遇）。
 */
export const SKIN_FIELDS = Object.freeze(['id', 'charId', 'name', 'series', 'desc', 'art', 'voices']);

/** 一套时装的 id：包内唯一、短、出现在 `settings.skinByChar` 的 `<包id>:<皮肤id>` 指针里。 */
export const SKIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export const ART_TABLES = {
  chars: { urls: ['avatar', 'avatarE2', 'portrait', 'portraitE2'], strings: [], spine: 'sides' },
  enemies: { urls: ['icon'], strings: ['spineAliasOf'], spine: 'flat' },
  // tokens 按官方条目的**实际字段**放开（G-08 / G-09 收口）：官方 `data/assets.json` 的 58 条 token 里有
  // `owner` / `avatar` / `spine|spineLocal`（spine 那两种写法是既有现实），而 `portrait`（召唤物立绘）与
  // `spineVariant`（同一套 spine 换个皮）是**这一层一直缺的两个格子**：真实 mod 要用它们，而白名单里没有，
  // 于是作者只能弃用。`portrait` 与 `avatar` 同类（一条包内相对路径），`spineVariant` 是一条非空字符串
  // （它选的是**引擎已有**的某个变体名，不是路径 —— 路径那一半是 `spine`）。两者都不改对局结果。
  tokens: { urls: ['avatar', 'portrait'], strings: ['owner', 'spineVariant'], spine: 'flat' },
  skills: { flat: true, target: ['skills'] },
  profSub: { flat: true, target: ['prof', 'sub'] },
  // 盟约图标与分队（策略）图标：与 skills / profSub **同一张脸** —— `data/assets.json` 实测 `bonds["yanShip"]`
  // 与 `bands["band_bldsk"]` 的值直接就是路径字符串（`/assets/bond/yanShip.png` / `/assets/band/band_bldsk.png`），
  // 不是「对象 + urls 字段」。这两张表缺了会让**整包**在下面的闸门处被拒（`ART_UNKNOWN_TABLE`），而真实 mod
  // （盟约拓展包把 `aveMujica` / `band_wuyouyoumeng` 摆在这里）正是这么写的 —— 一个只多两张图标表的合法包，
  // 代价却是连 `data.chess` 都进不去。
  //
  // 落点：`assets.bonds` / `assets.bands`，客户端 `public/js/ui/assetUrls.js` 的 `bondIconUrl(m, bondId)` /
  // `bandIconUrl(m, bandId)` 读的就是这两个键 —— **键名必须与消费端一致**，写成 `bond` / `band` 不会报错，
  // 只会静默回落到没有图标（`test/workshopArtTables.test.js` 钉住了这一点）。
  bonds: { flat: true, target: ['bonds'] },
  bands: { flat: true, target: ['bands'] },
};

/**
 * 每一张扁平表都必须给出 `target`（它在 `assets.json` 里的落点路径）。
 *
 * 为什么在**模块加载**时抛而不是留到运行时：`target` 只有 `mergeWorkshopFlatArt` 一个读者，一张扁平表缺了它
 * 出现的症状是「校验通过、`report.flatArt` 也数到了、图就是没进清单」—— 又一个静默失效，正是这一层一直在拒绝
 * 的那一类。纪律是「加一张扁平表 = 两行」，漏掉第二行现在会在导入时就炸，而不是等到有人发现图标不显示。
 */
for (const [table, shape] of Object.entries(ART_TABLES)) {
  if (!shape.flat) continue;
  if (Array.isArray(shape.target) && shape.target.length) continue;
  throw new Error(`ART_TABLES["${table}"] is flat and must declare a non-empty "target" (the path inside assets.json it is merged into)`);
}
/**
 * 一个 spine 对象里的路径字段、路径数组字段，以及原样抄过去但要查类型的字段。
 *
 * 这些类型**不是我们定的**，是 `data/assets.json` 里官方条目的实际类型（工具链产物，0.8.0 实测）：
 * `anims` 与 `animations` 都是**对象**（前者是"角色 → 动画名"的映射，后者是"动画名 → 时长"），
 * `events` 是**数组**（事件名列表，例如 `["OnAttack","OnStart"]`），`pma` 是布尔、`hits`/`bounds` 是对象。
 * 文档教作者「照官方条目抄」，所以这里必须与官方一致 —— 类型写反，一个正确的条目会被我们拒掉。
 */
export const ART_SPINE_URLS = ['skel', 'atlas'];
export const ART_SPINE_LISTS = ['textures'];
export const ART_SPINE_PASSTHROUGH = {
  pma: ['boolean'],
  anims: ['object'],
  animations: ['object'],
  events: ['array'],
  hits: ['object'],
  bounds: ['object', 'array'],
};
const ART_SPINE_FIELDS = [...ART_SPINE_URLS, ...ART_SPINE_LISTS, ...Object.keys(ART_SPINE_PASSTHROUGH)];

/** 一个 spine 对象（`{ skel, atlas, textures?, pma?, anims?, … }`）。`skel` 与 `atlas` 缺一不可：加载器是从 skel
 * 的路径**推出** atlas 的，清单里的 atlas 只用来做内存回收，写错不会报错 —— 所以形状这一层就要求它必须在。 */
function parseArtSpine(spine, where) {
  if (!isPlainObj(spine)) return { error: 'ART_BAD_SHAPE', detail: `${where} must be a spine object { skel, atlas, … }` };
  const out = {};
  for (const [key, value] of Object.entries(spine)) {
    if (!ART_SPINE_FIELDS.includes(key)) {
      return { error: 'ART_UNKNOWN_FIELD', detail: `${where}: "${key}" is not a spine field (${ART_SPINE_FIELDS.join(', ')})` };
    }
    if (ART_SPINE_URLS.includes(key)) {
      if (!isSafeAssetPath(value)) return { error: 'ART_PATH_UNSAFE', detail: `${where}.${key}: "${String(value)}" must be a relative path inside assets/` };
      out[key] = value;
      continue;
    }
    if (ART_SPINE_LISTS.includes(key)) {
      if (!Array.isArray(value) || !value.length) return { error: 'ART_BAD_SHAPE', detail: `${where}.${key} must be a non-empty array of paths` };
      for (const p of value) {
        if (!isSafeAssetPath(p)) return { error: 'ART_PATH_UNSAFE', detail: `${where}.${key}: "${String(p)}" must be a relative path inside assets/` };
      }
      out[key] = [...new Set(value)];
      continue;
    }
    const got = Array.isArray(value) ? 'array' : (value && typeof value === 'object' ? 'object' : typeof value);
    if (!ART_SPINE_PASSTHROUGH[key].includes(got)) {
      return { error: 'ART_BAD_SHAPE', detail: `${where}.${key} must be a ${ART_SPINE_PASSTHROUGH[key].join(' or ')}` };
    }
    out[key] = value;
  }
  for (const need of ART_SPINE_URLS) {
    if (!out[need]) return { error: 'ART_SPINE_INCOMPLETE', detail: `${where} needs both "skel" and "atlas"` };
  }
  return { spine: out, error: null };
}

/** 一张外观表里的一个条目：路径字段、原样字符串、以及（按表）嵌套或扁平的 spine。 */
function parseArtEntry(entry, where, shape) {
  // 扁平表（skills / profSub）：条目本身就是一条路径。`isSafeAssetPath` 由调用方判，好让拒绝码是 ART_PATH_UNSAFE
  // 而不是形状错误 —— 作者写一条 `../x.png` 与写一个对象是两种错，提示要分开。
  if (shape.flat) return { entry, error: null };
  if (!isPlainObj(entry)) return { error: 'ART_BAD_SHAPE', detail: `${where} must be an object` };
  const out = {};
  for (const [key, value] of Object.entries(entry)) {
    if (shape.urls.includes(key)) {
      if (!isSafeAssetPath(value)) return { error: 'ART_PATH_UNSAFE', detail: `${where}.${key}: "${String(value)}" must be a relative path inside assets/` };
      out[key] = value;
      continue;
    }
    if (shape.strings.includes(key)) {
      if (typeof value !== 'string' || !value) return { error: 'ART_BAD_SHAPE', detail: `${where}.${key} must be a non-empty string` };
      out[key] = value;
      continue;
    }
    if (key === 'spine') {
      if (shape.spine === 'flat') {
        const parsed = parseArtSpine(value, `${where}.spine`);
        if (parsed.error) return parsed;
        out.spine = parsed.spine;
        continue;
      }
      if (!isPlainObj(value)) return { error: 'ART_BAD_SHAPE', detail: `${where}.spine must map sides to a spine object ({ front: {…}, back: {…} })` };
      const sides = {};
      for (const [side, obj] of Object.entries(value)) {
        if (side !== 'front' && side !== 'back') return { error: 'ART_UNKNOWN_FIELD', detail: `${where}.spine: "${side}" is not a side (front, back)` };
        const parsed = parseArtSpine(obj, `${where}.spine.${side}`);
        if (parsed.error) return parsed;
        sides[side] = parsed.spine;
      }
      if (Object.keys(sides).length) out.spine = sides;
      continue;
    }
    return {
      error: 'ART_UNKNOWN_FIELD',
      detail: `${where}: "${key}" is not a field of this art entry (${[...shape.urls, ...shape.strings, 'spine'].join(', ')})`,
    };
  }
  return { entry: out, error: null };
}

/**
 * Validate and normalise one pack's `pack.json`.
 * @param {any} raw parsed pack.json
 * @param {string} [dirName] the pack's directory name (authoritative when the manifest omits / contradicts `id`)
 * @param {{ hasAssets?: boolean, behaviourSwitches?: Record<string, any> }} [opts] `hasAssets` = 这个包在磁盘上有
 *   `assets/` 文件夹（判贡献项用）；`behaviourSwitches` = 行为开关的闭枚举表，**默认就是真的那一份**
 *   （`shared/behaviour.js` 的 `BEHAVIOUR_SWITCHES`）。它做成入参的唯一理由与 `surfaceLedgerIssues(ids,
 *   generation)` / `behaviourSwitchIssues(table)` 逐字相同：本刀那张表是**空的**，写死的话「写了才进清单」
 *   与 `BEHAVIOUR_NEEDS_COMBAT` 这两条分支就**任何测试都碰不到** —— 一条从来没验过失败分支的守卫，和没有
 *   守卫是一回事。生产路径（装载器 / 校验器 / 编辑器）一律不传它。
 * @returns {{ ok: true, pack: { id: string, name: string, version: string, author: string|null, license: string|null,
 *   description: string|null, gameVersion: string|null, content: string[], overrides: string[],
 *   voices: Record<string, Record<string, string[]>>, voiceLangs: Record<string, Record<string, Record<string, string[]>>>,
 *   bondIcons: Record<string, string>, itemIcons: Record<string, string>,
 *   art: Record<string, Record<string, object>>, support: string[],
 *   operators: Record<string, { powers: string[], bonds: string[] }>, i18n?: Record<string, string> } }
 *   | { ok: false, error: string, detail: string }}
 */
export function normalizePackManifest(raw, dirName = '', opts = {}) {
  if (!isPlainObj(raw)) return fail('BAD_MANIFEST', 'pack.json must be a JSON object');
  // 顶层键闭集（`PACK_FIELDS`）：一个我们不认识的键**点名拒绝**，绝不读过去。这是本刀那条共通纪律的落点 ——
  // 三个社区 mod 里的 `variants` / `skins` / `i18n` 全都是「写了等于没写」的静默丢，而作者从错误文案里
  // 得不到任何线索。判据放在最前面：一个连键都不认识的清单，后面的字段级判据都是在猜它想说什么。
  //
  // 例外只有一条：`target: "stardust"` 的包（给 Stardust 宿主的**声明型包**）额外允许 Stardust profile 的几格
  // （`type` / `capabilities` / `englishName` / `authors` / `app`），以及**那格里声明的能力自己认领的字段**
  // （`STARDUST_CAPABILITY_FIELDS`，例如 `announcements` 能力的 `announcements`）—— 同一份 pack.json 两端各自
  // 读得懂，谁都不许把对方认识的键当成笔误。
  const starTarget = raw.target === 'stardust';
  // 能力认领的字段只对**声明了那个能力**的包放行：`announcements` 字段跟着 `capabilities: ["announcements"]` 走
  // （与 Stardust 侧 `MOD_CAPABILITY_NOT_DECLARED` 同一条规则，本引擎这边只管形状）。
  const starClaimed = new Set();
  if (starTarget && Array.isArray(raw.capabilities)) {
    for (const cap of raw.capabilities) {
      for (const name of STARDUST_CAPABILITY_FIELDS[cap] || []) starClaimed.add(name);
    }
  }
  for (const key of Object.keys(raw)) {
    if (PACK_FIELDS.includes(key)) continue;
    if (starTarget && STARDUST_TARGET_FIELDS.includes(key)) continue;
    if (starClaimed.has(key)) continue;
    return fail(PACK_UNKNOWN_FIELD_CODE,
      `pack.json: "${key.length > MAX_KEY_SHOWN ? `${key.slice(0, MAX_KEY_SHOWN)}…` : key}" is not a field of this pack format (${PACK_FIELDS.join(', ')}${starTarget ? `, plus ${STARDUST_TARGET_FIELDS.join(', ')} (and the fields a declared Stardust capability claims) for target "stardust"` : ''}). A key this loader does not know is never read: write it as one of the fields above, or drop it — a declaration that is ignored is worse than a refusal`);
  }
  const id = typeof raw.id === 'string' && raw.id ? raw.id : dirName;
  if (!PACK_ID_RE.test(id)) return fail('BAD_PACK_ID', `"${id}" is not a valid pack id (letters, digits, _ and - only)`);
  if (dirName && typeof raw.id === 'string' && raw.id && raw.id !== dirName) {
    return fail('PACK_ID_MISMATCH', `pack.json id "${raw.id}" does not match its directory "${dirName}"`);
  }
  // `content` 的成员资格：**不认识的条目点名整包拒绝**，不再静默过滤。
  //
  // 从前这里是 `raw.content.filter(… includes(f))`：一个包写 `content: ["chess", "variants"]` 时，`variants` 被
  // 安静地丢掉，作者看到的是「pack.json 合法、包加载了、可我写的那件事没发生」—— 正是 `PACK_FIELDS` 那段注释
  // 点名的三个社区 mod（`variants` / `skins` / `i18n`）撞上的那面墙，只是位置从「顶层键」挪到了「这张表的成员」。
  // 这一刀把它一并修掉（业主口径：不认识的声明必须响亮失败）。
  if (raw.content !== undefined && !Array.isArray(raw.content)) {
    return fail('BAD_CONTENT_LIST', '"content" must be an array of file names (an empty array is a pack that brings no data file)');
  }
  for (const f of Array.isArray(raw.content) ? raw.content : []) {
    if (typeof f === 'string' && WORKSHOP_CONTENT_FILES.includes(f)) continue;
    const shown = typeof f === 'string' ? (f.length > MAX_KEY_SHOWN ? `${f.slice(0, MAX_KEY_SHOWN)}…` : f) : (Array.isArray(f) ? 'an array' : typeof f);
    return fail('UNKNOWN_CONTENT_FILE',
      `content: "${shown}" is not a data file of this pack format (${WORKSHOP_CONTENT_FILES.join(', ')}). A name this loader does not know is never read: a pack that wrote it would ship a file nothing merges — "variants" and "config" in particular have NO content channel (see docs/WORKSHOP.md §1.1); a 口径 is declared as pack.json.variants instead`);
  }
  const content = Array.isArray(raw.content)
    ? [...new Set(raw.content.filter((f) => typeof f === 'string' && WORKSHOP_CONTENT_FILES.includes(f)))].sort()
    : [];
  // (EMPTY_PACK is checked after `voices` below: a pack whose whole contribution is a 助战 operator's voice lines has no
  // data file at all, and refusing it here would make the reserved voice pack impossible to write.)
  const overrides = Array.isArray(raw.overrides)
    ? [...new Set(raw.overrides.filter((o) => typeof o === 'string' && OVERRIDE_ENTRY_RE.test(o)))].sort()
    : [];
  const license = typeof raw.license === 'string' && raw.license ? raw.license : null;
  // A pack that SHIPS ITS OWN ART must say under what terms (`hasAssets` = it has an assets/ folder; the loader passes
  // it, since this function only sees the manifest). The repo ships no game assets, so a pack's art is the pack author's
  // to license — and the redistributor carries the risk, which is why the manifest has to name the licence rather than
  // leave it to a README nobody reads (docs/WORKSHOP.md §5).
  if (opts.hasAssets === true && !license) {
    return fail('ASSETS_NEED_LICENSE',
      'this pack has an assets/ folder, so pack.json must declare a license (e.g. "CC0-1.0", "CC-BY-4.0", or "see assets/LICENSE.txt")');
  }
  // Voice lines of a pack's own (or its 助战) operators — the RESERVED workshop half of the voice interface
  // (docs/WORKSHOP.md §1.4, docs/ASSETS.md "Voice lines"): `voices: { <charId>: { <slot>: ["<path inside assets/>", …] } }`.
  // The files live under the pack's assets/, so the licence gate above already applies to them, and the client reads
  // them from /workshop-assets/<pack>/<path> — the one route that serves pack media. Only the fixed slot vocabulary is
  // accepted, so a typo cannot silently produce a line that never plays.
  const voices = raw.voices === undefined ? {} : raw.voices;
  if (!isPlainObj(voices)) return fail('VOICE_BAD_SHAPE', 'voices must be an object: { "<charId>": { "<slot>": ["<path>"] } }');
  /**
   * `voices` / `voiceLangs` 里**包内相对路径**的那几条（字符串条目）。CDN 条目（对象）不要求 `assets/` 文件夹 ——
   * 它读的不是包里的字节。这个判据放在解析**之前**是刻意的：`VOICE_NEEDS_ASSETS` 与 `VOICE_SLOT_UNKNOWN` 谁先报
   * 是既有行为，不动它（`test/workshopVoices.test.js` 钉着那几条）。
   */
  const anyLocalVoicePath = (tbl) => isPlainObj(tbl) && Object.values(tbl).some((slots) => isPlainObj(slots)
    && Object.values(slots).some((v) => (Array.isArray(v) ? v : [v]).some((e) => typeof e === 'string' && e)));
  const hasLocalVoice = anyLocalVoicePath(voices)
    || Object.values(isPlainObj(raw.voiceLangs) ? raw.voiceLangs : {}).some(anyLocalVoicePath);
  if (Object.keys(voices).length && opts.hasAssets !== true && hasLocalVoice) {
    return fail('VOICE_NEEDS_ASSETS', 'a pack that declares voices must put the files in its assets/ folder (e.g. assets/voice/…)');
  }
  /**
   * Parse ONE `<charId> → <slot> → [path inside assets/]>` table. `voices` (the default dub) and every
   * `voiceLangs[<lang>]` carry exactly this shape and these rules, so they share one implementation — a rule that held
   * for one table but not the other would be a silent hole. `where` is how the author wrote the table, so a refusal
   * points at the exact place in pack.json (`voices["c"]["place"]`, `voiceLangs["jp"]["c"]["place"]`).
   * Paths are relative and inside assets/, with no traversal — the same rule the /workshop-assets route enforces
   * (that route refuses `.` and `..` segments, so a `.` here would only ever produce a URL that 404s).
   */
  /** CDN 条目的登记处（`pack.voiceCdn`）：`{ lang, charId, slot, file, url, sha256 }`。 */
  const voiceCdn = [];
  const parseVoiceTable = (table, where, lang) => {
    if (!isPlainObj(table)) return fail('VOICE_BAD_SHAPE', `${where} must map slots to file lists`);
    /** @type {Record<string, Record<string, string[]>>} */
    const out = {};
    for (const [charId, slots] of Object.entries(table)) {
      if (!/^[A-Za-z0-9_\-]{1,64}$/.test(charId)) return fail('VOICE_BAD_CHAR_ID', `${where}: "${charId}" is not a valid operator id`);
      if (!isPlainObj(slots)) return fail('VOICE_BAD_SHAPE', `${where}["${charId}"] must map slots to file lists`);
      const clean = {};
      for (const [slot, files] of Object.entries(slots)) {
        if (!VOICE_SLOTS.includes(slot)) {
          return fail('VOICE_SLOT_UNKNOWN', `${where}["${charId}"]["${slot}"] is not a voice slot (one of: ${VOICE_SLOTS.join(', ')})`);
        }
        /** @type {string[]} */
        const list = [];
        for (const [i, entry] of (Array.isArray(files) ? files : [files]).entries()) {
          const at = `${where}["${charId}"]["${slot}"]${Array.isArray(files) ? `[${i}]` : ''}`;
          // 作者自备 CDN 的条目（DESIGN §28.33）：`{ url, sha256, file }`。它解析出来的**文件位置**进同一张表，
          // 所以播放侧（索引 / 合并 / 客户端）一个字节都不用改；引擎装载期负责把字节从作者的地址取到本地缓存
          // （`server/voiceCdn.js`），客户端仍然只看见 /workshop-assets 那一条既有路由。
          if (isPlainObj(entry)) {
            for (const key of Object.keys(entry)) {
              if (!VOICE_CDN_FIELDS.includes(key)) {
                return fail('VOICE_CDN_UNKNOWN_FIELD', `${at}: "${key}" is not a field of a CDN voice entry (${VOICE_CDN_FIELDS.join(', ')})`);
              }
            }
            if (typeof entry.url !== 'string' || !entry.url.startsWith('https://')) {
              return fail('VOICE_CDN_BAD_URL', `${at}.url must be an absolute "https://" URL — this channel fetches from the AUTHOR's own CDN, and https is the only protocol it will speak (http: / data: / file: / protocol-relative all refuse)`);
            }
            let parsed = null;
            try { parsed = new URLGlobal(entry.url); } catch { parsed = null; }
            if (!parsed || parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
              return fail('VOICE_CDN_BAD_URL', `${at}.url must be an absolute "https://" URL with a host and no credentials in it`);
            }
            if (typeof entry.sha256 !== 'string' || !VOICE_CDN_SHA256_RE.test(entry.sha256)) {
              return fail('VOICE_CDN_BAD_DIGEST', `${at}.sha256 must be a 64-character lowercase hex sha256 of the bytes that URL serves — the engine checks it against what it downloads and refuses anything else`);
            }
            const lowerFile = String(entry.file).toLowerCase();
            if (!isSafeRelativePath(entry.file) || !VOICE_CDN_AUDIO_EXTS.some((ext) => lowerFile.endsWith(ext))) {
              return fail('VOICE_CDN_BAD_FILE', `${at}.file must be a relative path inside assets/ ending in ${VOICE_CDN_AUDIO_EXTS.join(' / ')} (e.g. "voice/char_1/place_1.mp3") — that is the URL the client will ask for`);
            }
            voiceCdn.push({ lang: lang || null, charId, slot, file: entry.file, url: entry.url, sha256: entry.sha256 });
            list.push(entry.file);
            continue;
          }
          if (typeof entry === 'string' && entry) list.push(entry);
        }
        if (!list.length) return fail('VOICE_EMPTY', `${where}["${charId}"]["${slot}"] names no file`);
        for (const f of list) {
          if (f.startsWith('/') || f.includes('\\') || f.split('/').some((seg) => seg === '..' || seg === '.') || /^[A-Za-z]:/.test(f)) {
            return fail('VOICE_PATH_UNSAFE', `${where}["${charId}"]["${slot}"]: "${f}" must be a relative path inside assets/ (no absolute paths, no "..")`);
          }
        }
        clean[slot] = [...new Set(list)].sort();
      }
      if (Object.keys(clean).length) out[charId] = clean;
    }
    return { ok: true, table: out };
  };
  const parsedVoices = parseVoiceTable(voices, 'voices', null);
  if (!parsedVoices.ok) return parsedVoices;
  const voiceLines = parsedVoices.table;
  // 多语言配音：`voiceLangs: { "<lang>": { <charId>: { <slot>: ["<path>"] } } }` —— 一个语种一张表，与上面 `voices`
  // 同一个形状、同一套路径规则、同一个槽位词表。`voices` 是**默认配音**那一档（清单的 `audio.voiceLang`，
  // 见 docs/ASSETS.md），所以默认语种键写进 voiceLangs 会被拒（VOICE_LANG_DEFAULT）：同一批台词有两个写法的话，
  // 「客户端到底读哪一份」就成了作者猜不出来的事。播放侧不需要任何新通道 —— 加载时并进 `assets.audio.voiceLangs`
  // （mergeWorkshopVoices），客户端 public/js/audio.js voiceLinesFor 本来就在那张表里按语种取台词。
  const voiceLangs = raw.voiceLangs === undefined ? {} : raw.voiceLangs;
  if (!isPlainObj(voiceLangs)) {
    return fail('VOICE_LANG_BAD_SHAPE', 'voiceLangs must be an object: { "<lang>": { "<charId>": { "<slot>": ["<path>"] } } }');
  }
  if (Object.keys(voiceLangs).length && opts.hasAssets !== true && hasLocalVoice) {
    return fail('VOICE_NEEDS_ASSETS', 'a pack that declares voices must put the files in its assets/ folder (e.g. assets/voice/…)');
  }
  /** @type {Record<string, Record<string, Record<string, string[]>>>} */
  const voiceLangLines = {};
  for (const [lang, table] of Object.entries(voiceLangs)) {
    if (!VOICE_LANGS.includes(lang)) {
      return fail('VOICE_LANG_UNKNOWN', `"${lang}" is not a dub (one of: ${VOICE_LANGS.join(', ')})`);
    }
    if (lang === DEFAULT_VOICE_LANG) {
      return fail('VOICE_LANG_DEFAULT', `"${lang}" is the default dub — declare its lines in "voices", not in "voiceLangs"`);
    }
    const parsed = parseVoiceTable(table, `voiceLangs["${lang}"]`);
    if (!parsed.ok) return parsed;
    if (!Object.keys(parsed.table).length) return fail('VOICE_LANG_EMPTY', `voiceLangs["${lang}"] declares no operator`);
    voiceLangLines[lang] = parsed.table;
  }
  // VOICE_LANGS order is the canonical one (same reason workshopVoiceLangIndex sorts): the table this function returns
  // goes straight into the merged manifest, whose bytes must not depend on how the author happened to write pack.json.
  const orderedLangLines = Object.fromEntries(VOICE_LANGS.filter((l) => voiceLangLines[l]).map((l) => [l, voiceLangLines[l]]));
  // 作者自备 CDN 的语音素材（DESIGN §28.33）：登记表按 `lang → charId → slot → file` 排序后再输出，因为它是**身份
  // 哈希的输入**（`canonicalJson(pack)`），作者书写次序不同不该换一个摘要。
  //
  // 两条闸门，都在这里（解析完才知道有没有 CDN 条目）：
  //   * `license` **必须有**：素材的再分发者是这个包的作者，与 assets/ 那条同一条理由 —— 只是字节放在别人的 CDN 上，
  //     授权问题一点没变（`ASSETS_NEED_LICENSE` 只管 `assets/` 文件夹，所以这里单独判一条）；
  //   * 一条 CDN 条目都没有时，归一化结果里**没有** `voiceCdn` 这个键（与 `client` / `i18n` 同一条「只在键存在时
  //     才写回」的纪律）⇒ 今天所有包的归一化清单与哈希**逐字节不变**。
  const orderedVoiceCdn = voiceCdn
    .slice()
    .sort((a, b) => `${a.lang || ''}\u0000${a.charId}\u0000${a.slot}\u0000${a.file}`.localeCompare(`${b.lang || ''}\u0000${b.charId}\u0000${b.slot}\u0000${b.file}`));
  if (orderedVoiceCdn.length && !license) {
    return fail('VOICE_CDN_NEEDS_LICENSE',
      'a pack that fetches voice lines from a CDN must declare a license (e.g. "CC0-1.0", "CC-BY-4.0", or "see assets/LICENSE.txt") — the pack redistributes those bytes, so the manifest has to say under what terms');
  }
  // 盟约图标（这个包自带的 art）：`bondIcons: { "<bondId>": "<path inside assets/>" }`。
  //
  // 为什么需要它：客户端按**盟约 id** 从 `data/assets.json` 的 `bonds` 取图标（public/js/assets.js bondIconUrl），
  // 而一个包没法往 `assets.json` 里加条目 —— 于是新增盟约在盟约条上只能是一个圆点。这里把这个口子开在
  // **pack.json 的一个字段**上（和一个包的语音是同一个做法），装载时叠加进 `assets.bonds`，URL 走同一条
  // /workshop-assets 路由。路径安全规则与语音逐字相同（相对 assets/、无穿越）。
  const bondIcons = raw.bondIcons === undefined ? {} : raw.bondIcons;
  if (!isPlainObj(bondIcons)) return fail('BOND_ICON_BAD_SHAPE', 'bondIcons must be an object: { "<bondId>": "<path inside assets/>" }');
  if (Object.keys(bondIcons).length && opts.hasAssets !== true) {
    return fail('BOND_ICON_NEEDS_ASSETS', 'a pack that declares bondIcons must put the image in its assets/ folder');
  }
  /** @type {Record<string, string>} */
  const bondIconFiles = {};
  for (const [bondId, file] of Object.entries(bondIcons)) {
    if (!/^[A-Za-z0-9_\-.:]{1,64}$/.test(bondId)) return fail('BOND_ICON_BAD_ID', `"${bondId}" is not a valid bond id`);
    if (typeof file !== 'string' || !file) return fail('BOND_ICON_BAD_SHAPE', `bondIcons["${bondId}"] must be a path inside assets/`);
    if (file.startsWith('/') || file.includes('\\') || file.split('/').some((seg) => seg === '..' || seg === '.') || /^[A-Za-z]:/.test(file)) {
      return fail('BOND_ICON_PATH_UNSAFE', `"${file}" must be a relative path inside assets/ (no absolute paths, no "..")`);
    }
    bondIconFiles[bondId] = file;
  }
  // 装备/道具图标（这个包自带的 art）：`itemIcons: { "<iconId>": "<path inside assets/>" }`。
  //
  // 为什么需要它：客户端按**道具 id** 从 `data/assets.json` 的 `assets.items` 取图标（public/js/assets.js
  // itemIconUrl：先看 `item.iconId`、再看 `item.trapId`，然后查 `m.items[id]`），而一个包没法往 assets.json 里加
  // 条目 —— 于是包新增的装备在界面上没有图标。做法与 `bondIcons` 逐字相同：口子开在 pack.json 的一个字段上，
  // 装载时叠加进 `assets.items`（mergeWorkshopItemIcons），URL 走同一条 /workshop-assets 路由 —— 客户端零改动。
  // 键的字符集与其它 record id 同一套（RECORD_ID_RE），路径安全规则与语音/盟约图标逐字相同。
  const itemIcons = raw.itemIcons === undefined ? {} : raw.itemIcons;
  if (!isPlainObj(itemIcons)) return fail('ITEM_ICON_BAD_SHAPE', 'itemIcons must be an object: { "<itemId>": "<path inside assets/>" }');
  if (Object.keys(itemIcons).length && opts.hasAssets !== true) {
    return fail('ITEM_ICON_NEEDS_ASSETS', 'a pack that declares itemIcons must put the image in its assets/ folder');
  }
  /** @type {Record<string, string>} */
  const itemIconFiles = {};
  for (const [itemId, file] of Object.entries(itemIcons)) {
    if (!RECORD_ID_RE.test(itemId)) return fail('ITEM_ICON_BAD_ID', `"${itemId}" is not a valid item id`);
    if (typeof file !== 'string' || !file) return fail('ITEM_ICON_BAD_SHAPE', `itemIcons["${itemId}"] must be a path inside assets/`);
    if (file.startsWith('/') || file.includes('\\') || file.split('/').some((seg) => seg === '..' || seg === '.') || /^[A-Za-z]:/.test(file)) {
      return fail('ITEM_ICON_PATH_UNSAFE', `"${file}" must be a relative path inside assets/ (no absolute paths, no "..")`);
    }
    itemIconFiles[itemId] = file;
  }
  // 包自带的外观素材：`art: { chars | enemies | tokens: { "<id>": <该条目在 assets.json 里的形状的子集> } }`。
  //
  // 为什么需要它：客户端画一个单位时，模型与头像都从 `data/assets.json` 取 —— `public/js/assets.js spineEntry()` 读
  // `chars[id].spine.front/back`（嵌套）或 `tokens[id].spine` / `enemies[id].spine`（扁平），头像读
  // `chars[id].avatar/portrait`、`enemies[id].icon`。包没法往 assets.json 加条目，于是**新干员/新怪物只能画成
  // 一张菱形贴图**（shared/workshop.js chessLookIssues 会在启动日志里警告这件事）。这个字段把口子开在 pack.json 上：
  // 装载时叠加进 `assets.<表>`（mergeWorkshopArt），路径变成 /workshop-assets 的绝对 URL —— 客户端零改动
  // （validSpine 只要求 skel 是 `/` 开头的路径，包素材路由天然满足）。
  //
  // 两条**包改不了**的硬约束（由 vendor 里的 pixi-spine 决定，校验器会逐条查，见 tools/workshop-validate.mjs）：
  //   * `.atlas` 必须与 `.skel` **同目录同名** —— 加载器是从 skel 的路径推出 atlas 的，清单里的 `atlas` 字段我方代码
  //     只是用来做内存回收（assets.js forgetPendingSpine），写错不会报错，只会画不出来；
  //   * `.atlas` 里写的每一页 png 必须与它**同目录同名**。
  // 形状按表驱动（ART_TABLES）：哪几个字段是路径、spine 是嵌套（chars 的 front/back）还是扁平（enemies/tokens），
  // 都写在那一张表里，校验、索引与并表三处共用，不会各自漂移。
  const art = raw.art === undefined ? {} : raw.art;
  if (!isPlainObj(art)) return fail('ART_BAD_SHAPE', 'art must be an object: { chars|enemies|tokens: { "<id>": { … } } }');
  if (Object.keys(art).length && opts.hasAssets !== true) {
    return fail('ART_NEEDS_ASSETS', 'a pack that declares art must put the files in its assets/ folder (e.g. assets/art/…)');
  }
  /** @type {Record<string, Record<string, object>>} */
  const artEntries = {};
  for (const [table, entries] of Object.entries(art)) {
    const shape = ART_TABLES[table];
    if (!shape) return fail('ART_UNKNOWN_TABLE', `"${table}" is not an art table (one of: ${Object.keys(ART_TABLES).join(', ')})`);
    if (!isPlainObj(entries)) return fail('ART_BAD_SHAPE', `art.${table} must be an object: { "<id>": { … } }`);
    const clean = {};
    for (const [id, entry] of Object.entries(entries)) {
      if (!RECORD_ID_RE.test(id)) return fail('ART_BAD_ID', `art.${table}: "${id}" is not a valid id`);
      // 扁平表：条目本身就是路径（`assets.skills[key]` / `assets.prof.sub[key]` 的值就是路径字符串）
      if (shape.flat) {
        if (!isSafeAssetPath(entry)) {
          return fail('ART_PATH_UNSAFE', `art.${table}["${id}"]: "${String(entry)}" must be a relative path inside assets/`);
        }
        clean[id] = entry;
        continue;
      }
      const parsed = parseArtEntry(entry, `art.${table}["${id}"]`, shape);
      if (parsed.error) return fail(parsed.error, parsed.detail);
      if (Object.keys(parsed.entry).length) clean[id] = parsed.entry;
    }
    if (Object.keys(clean).length) artEntries[table] = clean;
  }
  // `art.bonds` 与 `bondIcons` 是**同一件事的两个写法** —— 两条路最后都写 `assets.bonds[<bondId>]`，客户端
  // （`public/js/ui/assetUrls.js` 的 `bondIconUrl`）只看得到一条。同一个 id 两处都声明时**点名拒绝整包**，
  // 而不是「谁赢」：`mergeWorkshopFlatArt` 排在 `mergeWorkshopBondIcons` 之后（见 `applyWorkshop` 的调用序），
  // 真按顺序判就是 `art.bonds` 静默压掉 `bondIcons` —— 作者改了 `bondIcons` 那一份却发现图标没变，日志一句话
  // 都没有。**两边都声明同一个 id 就是一次真正的冲突**（它们给的是同一个最终值），必须由作者自己删掉一份。
  //
  // 只撞**同一个 id**才算冲突：两处声明**不同**的盟约是各管一个图标，两份声明都生效，谁也不覆盖谁。
  const artBondIds = isPlainObj(artEntries.bonds) ? Object.keys(artEntries.bonds) : [];
  for (const bondId of artBondIds) {
    if (!Object.hasOwn(raw.bondIcons && isPlainObj(raw.bondIcons) ? raw.bondIcons : {}, bondId)) continue;
    return fail('BOND_ICON_CONFLICT',
      `"${bondId}" is declared in both pack.json.bondIcons and pack.json.art.bonds — both write assets.bonds["${bondId}"], so only one of them can be the icon. Keep exactly one: drop it from art.bonds, or drop it from bondIcons`);
  }
  // 时装（`pack.json.skins`，皮肤层设计稿 §3）：一套外观的**数据**在 A 层声明，**行为**在 mod 里。
  //
  // 形状刻意与 `ART_TABLES.chars` **完全同形**（`art` 字段就是 `chars` 那一份子集）：复用同一个 `parseArtEntry`，
  // 所以「白名单字段 / 路径必须包内相对 / spine 要齐 skel+atlas」这些判据不会出现第二份实现。新增的只有
  // 时装自己的元数据（id / charId / name / series / desc）与可选语音。
  const skins = raw.skins === undefined ? [] : raw.skins;
  if (!Array.isArray(skins)) {
    return fail('SKIN_BAD_SHAPE', 'skins must be an array of { id, charId, name, art } entries (one entry per outfit)');
  }
  /** @type {Array<object>} */
  const skinEntries = [];
  const skinIds = new Set();
  for (const [i, entry] of skins.entries()) {
    const where = `skins[${i}]`;
    if (!isPlainObj(entry)) return fail('SKIN_BAD_SHAPE', `${where} must be an object`);
    for (const key of Object.keys(entry)) {
      if (!SKIN_FIELDS.includes(key)) {
        return fail('SKIN_UNKNOWN_FIELD', `${where}: "${key}" is not a declared field (${SKIN_FIELDS.join(', ')})`);
      }
    }
    if (typeof entry.id !== 'string' || !SKIN_ID_RE.test(entry.id)) {
      return fail('SKIN_BAD_ID', `${where}.id must be a short id matching ${SKIN_ID_RE} (letters/digits/underscore/dash, ≤32)`);
    }
    if (skinIds.has(entry.id)) {
      return fail('SKIN_DUPLICATE_ID', `${where}.id "${entry.id}" appears twice — one id per outfit`);
    }
    skinIds.add(entry.id);
    if (typeof entry.charId !== 'string' || !RECORD_ID_RE.test(entry.charId)) {
      return fail('SKIN_BAD_CHAR_ID', `${where}.charId must name the official operator this outfit belongs to (an existing charId)`);
    }
    if (typeof entry.name !== 'string' || !entry.name.trim()) {
      return fail('SKIN_BAD_SHAPE', `${where}.name must be a non-empty string (the player sees it in the picker)`);
    }
    for (const opt of ['series', 'desc']) {
      if (entry[opt] !== undefined && (typeof entry[opt] !== 'string' || !entry[opt].trim())) {
        return fail('SKIN_BAD_SHAPE', `${where}.${opt} must be a non-empty string when present`);
      }
    }
    // 外观那一半与 `art.chars` **同一个解析器**（同形 ⇒ 同一套判据，不新造一份）
    if (entry.art !== undefined) {
      if (!isPlainObj(entry.art)) return fail('SKIN_BAD_SHAPE', `${where}.art must be an object shaped like art.chars`);
      const parsed = parseArtEntry(entry.art, `${where}.art`, ART_TABLES.chars);
      if (parsed.error) return fail(parsed.error, parsed.detail);
      if (!Object.keys(parsed.entry).length) {
        return fail('SKIN_BAD_SHAPE', `${where}.art is empty — an outfit must bring at least one of avatar / portrait / spine`);
      }
    }
    // 可选语音：形状与 `pack.json.voices` 的槽位表一致（`{ <槽位>: [路径…] }`），走同一条包内路径判据
    let voices = null;
    if (entry.voices !== undefined) {
      if (!isPlainObj(entry.voices)) return fail('SKIN_BAD_SHAPE', `${where}.voices must be { "<slot>": ["<path>"] }`);
      voices = {};
      for (const [slot, list] of Object.entries(entry.voices)) {
        if (!Array.isArray(list) || !list.length) return fail('SKIN_BAD_SHAPE', `${where}.voices["${slot}"] must be a non-empty array of paths`);
        for (const p of list) {
          if (!isSafeAssetPath(p)) return fail('SKIN_PATH_UNSAFE', `${where}.voices["${slot}"]: "${String(p)}" must be a relative path inside assets/`);
        }
        voices[slot] = [...list];
      }
    }
    skinEntries.push({
      id: entry.id, charId: entry.charId, name: entry.name,
      ...(entry.series !== undefined ? { series: entry.series } : {}),
      ...(entry.desc !== undefined ? { desc: entry.desc } : {}),
      ...(entry.art !== undefined ? { art: parseArtEntry(entry.art, `${where}.art`, ART_TABLES.chars).entry } : {}),
      ...(voices ? { voices } : {}),
    });
  }
  // 助战卡池贡献 (docs/WORKSHOP.md §2): the operators of THIS pack that should be selectable as 助战. The tier is NOT
  // written here — it is derived from the pack's own chess record, exactly like every other derived field, so a tier can
  // never disagree with the record (a mismatch would silently disable the operator: shared/support.js isSupportChess
  // requires the id to sit under its own tier).
  const support = raw.support === undefined ? [] : raw.support;
  if (!Array.isArray(support)) {
    return fail('SUPPORT_BAD_SHAPE', 'support must be an array of operator ids this pack adds, e.g. ["chess_char_ws_my_op_a"]');
  }
  const supportIds = [];
  for (const id of support) {
    if (typeof id !== 'string' || !RECORD_ID_RE.test(id)) {
      return fail('SUPPORT_BAD_ID', `"${String(id)}" is not a valid operator id`);
    }
    if (!supportIds.includes(id)) supportIds.push(id);
  }
  // 自选池贡献 (`pack.json.operators`, docs/WORKSHOP.md §1.2): the operators of THIS pack that should be **selectable
  // in the 自选 pool** (`data/backups.json` 的 `diy.ownedPool` / `diy.operators`) — the half that made a community
  // "new operator" mod a hand-patch instead of a pack.
  //
  // 形状是**对象**（不是数组）：每个干员要带它自己的盟约与该盟约的权能。而 `name` / `rarity` / `profession` /
  // `subProfessionId` **一律从同一个包的 `units[charId]` 派生**（`mergeWorkshopOperators`），清单里再写一遍就是
  // 两份会漂移的真相 —— `diy.operators` 那份今天是生成器产出的，包不该抄它。
  //
  // 这里只查**形状**与「同一个 id 只出现一次」；「有没有同名的 units 记录」「是不是 6★」「盟约存不存在」三条要读
  // 数据，它们失败要关闭，所以在加载期（`mergeWorkshopOperators`）判定并点名报告。
  const operators = raw.operators === undefined ? {} : raw.operators;
  if (!isPlainObj(operators)) {
    return fail('OPERATOR_BAD_SHAPE', 'operators must be an object: { "<charId>": { bonds: ["<bondId>"], powers: ["<powerId>"] } }');
  }
  /** @type {Record<string, { powers: string[], bonds: string[] }>} */
  const operatorDecls = {};
  for (const [charId, decl] of Object.entries(operators)) {
    if (!RECORD_ID_RE.test(charId)) return fail('OPERATOR_BAD_SHAPE', `operators: "${charId}" is not a valid operator id`);
    if (!isPlainObj(decl)) return fail('OPERATOR_BAD_SHAPE', `operators["${charId}"] must be an object: { bonds, powers }`);
    const parsed = { powers: [], bonds: [] };
    for (const field of OPERATOR_LIST_FIELDS) {
      const list = parseStringList(decl[field], `operators["${charId}"].${field}`);
      if (!list.ok) return fail('OPERATOR_BAD_SHAPE', list.detail);
      parsed[field] = list.list;
    }
    operatorDecls[charId] = parsed;
  }
  // 键序是**清单的字节**的一部分（`identifyPack` 把归一化后的清单哈希进去），所以按 id 排序，不随作者书写顺序变。
  const orderedOperators = Object.fromEntries(Object.keys(operatorDecls).sort().map((k) => [k, operatorDecls[k]]));
  // 试玩行为开关（行为层，不进记录）：`playtest: { "directToHand": ["<chessId>", …] }`。
  //
  // 为什么住在 pack.json 而不是 chess 记录里：覆盖模式下记录必须与官方**同形**（官方记录没有
  // `directToHand` 这个键，保存路径因此会在写补丁前把它摘掉），而「试玩时直接发到手上」是**行为层**的开关，
  // 不是「覆盖官方数据」这件事 —— 于是覆盖一条官方干员时它曾经静默失效。搬到这里之后，记录继续同形，
  // 开关照旧能用（见 docs/WORKSHOP.md §1.2）。
  //
  // 形状这一层只查「是不是对象、值是不是字符串数组」；「名单里的 id 真的属于这个包吗」要看包自己的
  // chess 记录与 `overrides`，那只有文件系统/加载器知道（`server/workshop.js` 与 `tools/workshop-pack.mjs`
  // 用同一个 `playtestUnknownIds` 判）。
  const playtest = raw.playtest === undefined ? {} : raw.playtest;
  if (!isPlainObj(playtest)) {
    return fail('PLAYTEST_BAD_SHAPE', 'playtest must be an object: { "directToHand": ["<chessId>", …] }');
  }
  /** @type {string[]} */
  let directToHand = [];
  if (playtest.directToHand !== undefined) {
    if (!Array.isArray(playtest.directToHand)) {
      return fail('PLAYTEST_BAD_SHAPE', 'playtest.directToHand must be an array of chess ids this pack ships (or declares in overrides)');
    }
    for (const id of playtest.directToHand) {
      if (typeof id !== 'string' || !RECORD_ID_RE.test(id)) {
        return fail('PLAYTEST_BAD_SHAPE', `playtest.directToHand: "${String(id)}" is not a valid chess id`);
      }
      if (!directToHand.includes(id)) directToHand.push(id);
    }
    directToHand.sort();
  }
  // 中间层四组能力声明（DESIGN §28.13）：`assets` 客户端资源容器、`client` C 层注册点、`server.preDispatch`
  // 分发前钩子、`routes` 只读路由。本轮**纯加法**：解析、点名拒绝、并进身份哈希，没有一条行为读它们。
  //
  // 这里的四段顺序与 `declared` 收集顺序只影响可读性：返回对象的键序不影响哈希（`canonicalJson` 排序键），
  // 但**键在不在**影响哈希 —— 所以下面用 `raw[k] !== undefined` 判定「这个包声明了没有」。
  const assetsParsed = raw.assets === undefined ? null : parseAssetsDecl(raw.assets);
  if (assetsParsed && !assetsParsed.ok) return assetsParsed;
  // 镜像也是**再分发**：同一份字节从作者的域名上发给别人时，授权问题不因为换了一台主机就消失 —— 与
  // `VOICE_CDN_NEEDS_LICENSE`（§28.36）逐字同一条理由。`ASSETS_NEED_LICENSE` 判的是「包里有没有 `assets/`
  // 文件夹」，而容器路径不一定要落在那棵树下，所以这里单独判一条，并且只对**声明了 mirrors 的包**生效
  // （今天一个都没有 ⇒ 已发布包的哈希与判据一字不变）。
  if (assetsParsed && assetsParsed.decl.mirrors && !license) {
    return fail('ASSETS_MIRROR_NEEDS_LICENSE',
      'assets.mirrors makes this pack the redistributor of its own container, so pack.json must declare a license (e.g. "CC0-1.0", "CC-BY-4.0", or "see assets/LICENSE.txt")');
  }
  const clientParsed = raw.client === undefined ? null : parseClientDecl(raw.client);
  if (clientParsed && !clientParsed.ok) return clientParsed;
  const serverParsed = raw.server === undefined ? null : parseServerDecl(raw.server);
  if (serverParsed && !serverParsed.ok) return serverParsed;
  // 包通道的服务端那一半（DESIGN §28.23）：`server.modules[].channels` 里点名的每一条，必须也被本包的某个面板
  // 声明过（`client.panels[].messages`）。理由不是洁癖：Lobby 的 `packChannels` 白名单是**从面板清单推出来的**
  // —— 没有面板声明过的通道，客户端根本发不出来，那是一条「声明了却不可能发生」的声明。
  if (serverParsed) {
    const panelChannels = new Set();
    for (const panel of (clientParsed ? clientParsed.decl.panels : [])) {
      for (const channel of (panel.messages || [])) panelChannels.add(channel);
    }
    for (const m of serverParsed.decl.modules || []) {
      for (const channel of m.channels || []) {
        if (!panelChannels.has(channel)) {
          return fail('MODULES_UNKNOWN_CHANNEL', `server.modules["${m.id}"].channels: "${channel}" is not declared by any of this pack's client.panels[].messages — the engine only lets a pack send the channels its panels declare, so this one could never arrive (add it to a panel's "messages", or drop it here)`);
        }
      }
    }
  }
  const routesParsed = raw.routes === undefined ? null : parseRoutesDecl(raw.routes);
  if (routesParsed && !routesParsed.ok) return routesParsed;
  // `i18n`（fanpack G-04）：给**已有语种**补词条的声明，形状见 `parseI18nDecl`。它同样遵守上面那条
  // 「只在清单真的写了这个键时才进归一化结果」的纪律 —— 没声明 i18n 的包（今天所有的包）哈希逐字节不变。
  const i18nParsed = raw.i18n === undefined ? null : parseI18nDecl(raw.i18n);
  if (i18nParsed && !i18nParsed.ok) return i18nParsed;
  // `notices`（DESIGN §28.15）：公告 / 鸣谢这类纯文本声明的形状，见 `parseNoticesDecl`。同一条「写了才进归一化
  // 结果」的纪律 —— 没声明 notices 的包哈希逐字节不变。
  const noticesParsed = raw.notices === undefined ? null : parseNoticesDecl(raw.notices);
  if (noticesParsed && !noticesParsed.ok) return noticesParsed;
  // 管理器合同（DESIGN §28.48）：对**其它工坊包**的依赖与互斥声明 —— 形状在这里，**语义在装载期裁决**
  //（`adjudicatePackGraph`：缺失 / 版本不合 / 互斥 / 级联 / 循环，全部具名拒绝）。与 `notices` 同一条
  // 「写了才进归一化结果」的纪律 —— 没声明的包哈希逐字节不变（DESIGN §28.2）。
  const depsParsed = raw.dependencies === undefined ? null : parseModRefsDecl(raw.dependencies, 'dependencies');
  if (depsParsed && !depsParsed.ok) return depsParsed;
  const conflictsParsed = raw.conflicts === undefined ? null : parseModRefsDecl(raw.conflicts, 'conflicts');
  if (conflictsParsed && !conflictsParsed.ok) return conflictsParsed;
  // 形态（clip set）通道与静态相位通道（DESIGN §28.29）：两条都是**行为增量** —— 第一方 `FORMS` / `SILENT_PHASES`
  // 冻结不动，包只能在自己新声明的 spine id / 形态名 / 'phase' 种类上加东西。同一条「写了才进归一化结果」的
  // 纪律：没声明这两个键的包（今天所有的包）哈希逐字节不变。
  const formsParsed = raw.forms === undefined ? null : parseFormsDecl(raw.forms);
  if (formsParsed && !formsParsed.ok) return formsParsed;
  if (formsParsed) {
    // `next` 的死链要等同一个 spine id 上的形态名都收齐才判 —— 形状层已经收齐了，这里判。
    const dead = formNextDeadLink(formsParsed.decl);
    if (dead) {
      return fail('FORMS_NEXT_UNKNOWN', `forms.${dead.table}["${dead.id}"].${dead.kind}.next points at "${dead.next}", which is not a form of "${dead.id}" (declare it in this pack, or name a first-party form of that spine) — the renderer would fall through on that link`);
    }
  }
  const fxParsed = raw.fx === undefined ? null : parseFxDecl(raw.fx);
  if (fxParsed && !fxParsed.ok) return fxParsed;
  // 变体 / 口径声明（DESIGN §28.39）：形状与闭枚举都在 `shared/variants.js` 判，这里只负责「写了才进清单」。
  // **不是贡献项**（与 `playtest` 同一个语义）：一个只声明了 `variants: [{ axis: "deploy" }]` 的包什么都没带来
  // —— 口径选的是引擎已有的另一套表现，不是内容。所以它不进 `contributesDecl`，一个只带它的包照旧 `EMPTY_PACK`。
  const variantsParsed = raw.variants === undefined ? null : parseVariantsDecl(raw.variants);
  if (variantsParsed && !variantsParsed.ok) return variantsParsed;
  // 行为开关声明（DESIGN §28.43）：形状与闭枚举都在 `shared/behaviour.js` 判，这里只负责「写了才进清单」。
  // **不是贡献项**（与 `variants` / `playtest` 同一个语义）：行为开关改的是引擎里**已经实现**的一条规则，
  // 它自己不带来任何内容。所以一个只带 `behaviour` 的包照旧 `EMPTY_PACK`（文案里点名它）。
  const behaviourParsed = raw.behaviour === undefined ? null : parseBehaviourDecl(raw.behaviour, opts.behaviourSwitches);
  if (behaviourParsed && !behaviourParsed.ok) return behaviourParsed;
  // 启用声明（DESIGN §28.50）：`false` = 这个包装好了但现在不参与。**不是贡献项**（与 `variants` 同一个语义）：
  // 一个只写 `"enabled": true` 的包什么都没带来，照旧 `EMPTY_PACK`；而 `"enabled": false` 的包连装载都不进
  // （`server/workshop.js loadWorkshop` 在归一化之后读它），所以它也到不了 `EMPTY_PACK` 那一行。
  const enabledParsed = raw.enabled === undefined ? null : parseEnabledDecl(raw.enabled);
  if (enabledParsed && !enabledParsed.ok) return enabledParsed;
  // 目标引擎（`target`，DESIGN §28.46）：缺省 `forge`（本引擎自己装）。`stardust` 的包是**声明型**的 ——
  // 本引擎认识它、不装载它（server/workshop.js 记一行 foreign），所以它不需要任何 Forge 贡献项
  // （EMPTY_PACK 对它不适用），`type` / `capabilities` 两格按 Stardust profile 校验。写了才进归一化结果。
  const target = raw.target === undefined ? 'forge' : raw.target;
  if (!PACK_TARGETS.includes(target)) {
    return fail('PACK_TARGET_UNKNOWN', `target: ${JSON.stringify(raw.target)} is not one of ${PACK_TARGETS.join(' / ')}`);
  }
  let starProfile = null;
  if (target === 'stardust') {
    if (raw.type !== 'mod') return fail('STARDUST_TARGET_BAD_TYPE', `target "stardust" needs "type": "mod" (got ${JSON.stringify(raw.type ?? null)}) — it is the type the Stardust host loads`);
    const caps = raw.capabilities === undefined ? [] : raw.capabilities;
    if (!Array.isArray(caps) || caps.some((c) => typeof c !== 'string' || !/^[a-z][A-Za-z0-9_.-]{0,63}$/.test(c))) {
      return fail('STARDUST_TARGET_BAD_CAPABILITIES', 'capabilities must be a list of capability ids (lowercase first, then letters/digits/._-)');
    }
    starProfile = { capabilities: [...new Set(caps)].sort() };
  }
  // 一条声明只有在清单里**真的写了这个键**时才进归一化结果。这一条是本刀最容易做坏的地方：无条件写进去会让
  // 每一个已存在的包（它们没有这些键）的归一化清单多出四个键，于是内容哈希全变、`identifyPack` 的
  // `manifest` 与 `hash` 也跟着变 —— 房间的摘要闸门会开始误判（DESIGN §28.2）。
  /** @type {Array<[string, object]>} */
  const declared = [];
  if (assetsParsed) declared.push(['assets', assetsParsed.decl]);
  if (clientParsed) declared.push(['client', clientParsed.decl]);
  if (serverParsed) declared.push(['server', serverParsed.decl]);
  if (routesParsed) declared.push(['routes', routesParsed.decl]);
  if (i18nParsed) declared.push(['i18n', i18nParsed.decl]);
  if (noticesParsed) declared.push(['notices', noticesParsed.decl]);
  if (depsParsed) declared.push(['dependencies', depsParsed.decl]);
  if (conflictsParsed) declared.push(['conflicts', conflictsParsed.decl]);
  if (formsParsed) declared.push(['forms', formsParsed.decl]);
  if (fxParsed) declared.push(['fx', fxParsed.decl]);
  // `enabled` 比 `variants` / `behaviour` 多一条约束（§28.50 的判据 2：**缺省 = 引擎今天的行为**）：
  // 无条件写进去会让 `"enabled": true` 与「没写」在**数据上**不再等价 —— 而 `identifyPack` 哈希的正是
  // `canonicalJson(pack)`（`server/workshop.js` step 1），于是写了 `true` 的包会换掉包身份、房间摘要跟着漂，
  // 而它做的事与没写一字不差。所以**只有 `false` 才进清单**：那是这一格唯一真正改变行为的取值，
  // 「装好了但不参与」必须进身份（两台机器摘要相同 ⇒ 行为相同）；`true` 与缺席在数据上逐字等价。
  if (enabledParsed && enabledParsed.value === false) declared.push(['enabled', false]);
  /** 一条声明算不算「贡献」：归一化后的值里有没有东西。`routes: []` 与 `client: { panels: [], requires: [] }`
   *  都是**合法但什么都不做**的声明（与 `voices: {}` / `art: { chars: {} }` 同一个语义），照旧不算贡献 ——
   *  所以「一个只写了 `routes: []` 的包」仍然是空包。反向的那条同样载重：`assets` / `client.panels` /
   *  `server.preDispatch` 的必填字段在形状层就各自非空，所以它们只声明出来就**是**贡献项；`server.battle` 与
   *  `server.room` 同理（形状层就要求 `module` 是一个合法的包内 `.mjs`）。 */
  const contributes = (v) => (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0);
  /**
   * 一条声明算不算**贡献项**。与上面 `contributes` 的差别只有 `fx` 那一处：`fx` 的归一化结果永远是
   * `{ silentPhases: [...] }`，所以 `Object.keys` 恒为 1 —— 而 `silentPhases: []` 与 `routes: []`、
   * `client: { panels: [], requires: [] }` 是同一个语义（**合法但什么都不做**）。照 `contributes` 数的话，
   * 一个只写了 `"fx": { "silentPhases": [] }` 的包会从空包变成「有贡献」，那正是这一层最不该出现的
   * 「声明了等于没声明还不报错」。声明本身仍然留在归一化清单里（作者写了什么就回什么），只是不算贡献。
   */
  const contributesDecl = ([name, v]) => (name === 'fx' ? Array.isArray(v.silentPhases) && v.silentPhases.length > 0 : contributes(v));
  // A pack may bring data files, voice lines (either table), 盟约图标, 装备图标, 外观素材, 助战声明, 自选池声明
  // — never none of them (docs/WORKSHOP.md §1.4). 这条检查必须放在**所有**贡献项都解析完之后：放在前面会出现
  // 「一个只带 `operators` 的包被判成空包」，而在它前面引用后面声明的变量则是 TDZ 报错。
  // `playtest` **不是**贡献项：它是行为开关，一个只带它的包仍然什么都没带来，照旧 EMPTY_PACK
  // （test/playtestDirectToHand.test.js 有断言钉住这一点）。四组新声明的贡献语义见上面 `contributes` 的注释：
  // A 段把提案的语义落死（B 段实现行为时不用再改），而「只带 `playtest` 照旧被拒」这条既有裁决一字未动。
  // `target: "stardust"` 的包**不是**本引擎的包：它的价值在 Stardust 宿主那一侧，本引擎只看形状、不装载
  //（server/workshop.js 记一行 foreign），所以「没有 Forge 贡献项」是它的正常形态，EMPTY_PACK 对它不适用。
  if (target !== 'stardust' && !content.length && !Object.keys(voiceLines).length && !Object.keys(orderedLangLines).length
    && !Object.keys(bondIconFiles).length && !Object.keys(itemIconFiles).length && !Object.keys(artEntries).length
    && !skinEntries.length
    && !Object.keys(orderedOperators).length && !declared.some(contributesDecl)) {
    // 这份清单里「声明了也不算贡献」的字段**都要点名**：`support` / `playtest`（当初只有这两个），
    // 以及后加的 `variants` / `behaviour`（它们只是「这一局按哪一套跑」的声明，自己不往对局里带任何东西），
    // 以及管理器合同的 `dependencies` / `conflicts`（DESIGN §28.48：它们说的是「和别的包什么关系」，
    // 一个只声明依赖的包自己不带来任何内容 —— 与 `support` 同一条）。
    // 只声明助战的包今天整包被拒（plugin-pack G6：一个 `support: [...]` + `content: []` 的包得到的就是这一条），
    // 而原来的文案里**没有** `support` 这个词，作者只能对着 `EMPTY_PACK` 猜。`support` 只决定**助战卡池**里放谁，
    // 干员本体还是由 `content: ["chess"]` 带进来的 —— 所以放宽它不是这一刀的活（那是既有裁决），把话说明白才是。
    const notContributions = ['support', 'playtest', 'variants', 'behaviour', 'dependencies', 'conflicts']
      .filter((n) => raw[n] !== undefined);
    const names = [...WORKSHOP_CONTENT_FILES, 'voices', 'voiceLangs', 'bondIcons', 'itemIcons', 'art', 'skins', 'operators',
      'assets', 'client', 'server.preDispatch', 'server.meta', 'server.battle', 'server.room', 'server.modules', 'server.transport', 'routes', 'i18n', 'notices', 'forms', 'fx'];
    const alsoNot = notContributions.length
      ? ` (note: ${notContributions.map((n) => `"${n}"`).join(' and ')} ${notContributions.length === 1 ? 'is' : 'are'} NOT a contribution — a pack that declares ${notContributions.length === 1 ? 'it' : 'them'} alone brings nothing into a match)`
      : '';
    return fail('EMPTY_PACK', `content must name at least one of: ${WORKSHOP_CONTENT_FILES.join(', ')} — or the pack must declare ${names.filter((n) => !WORKSHOP_CONTENT_FILES.includes(n)).join(' / ')}${alsoNot}`);
  }
  // 版本声明（DESIGN §28.5）：`api` 是**模组 API** 的区间（钩子总线与 kit 契约），`game` 是**上游游戏版本**的区间，
  // 两者都用 shared/packs.js isVersionRange 的语法（`>=0.2.0`、`0.2.x`、`^0.2.0`、`~0.2.1`、`*`、`||`）。
  // `gameVersion` 保留一代作为 `game` 的别名：编辑器与现成的包都在写它，读的时候优先 `game`。
  //
  // 三条**类型闸门先于一切**（B7 段）。理由是这个缺口最坏的地方不是「写错了没人管」，而是**失败方向是静默的**：
  // `strField` 把非字符串读成 null，于是 `api: 1` 在下面两条 `api &&` 的校验里**都短路**，归一化结果 `api: null`
  // —— 包当没声明一样通过，作者看到的是「包合法、我写的区间没生效」，正是本仓库 §1.1 那句「写了等于没写」。
  // 三条纪律：
  //   1. **只有键存在且不是字符串才拒**。缺键 / `undefined` / `null` **照旧一个字节都不受影响**：`null` 在
  //      JSON 里的意思就是「没有值」—— 编辑器的写元数据那一端也把它当「删掉这个键」（`packMetaEditor.test.js`：
  //      `description: null` ⇒ `!Object.hasOwn(obj, 'description')`），`layer` 的既有解析分支逐字相同
  //      （`raw.layer === undefined || raw.layer === null ? null : …`）。所以「显式 null = 等于没写」是既有语义，
  //      这里跟随它，不发明一条「null 也算无效声明」。空串 / 全空白同理（`""` 与 `"   "` 只是把键写成了空的）。
  //   2. **空串不是错误**：它连区间都没写成，`BAD_API_RANGE` 也只对「写了但写坏」的**非空**区间开口。
  //   3. **不问「这个字段有没有人读」**：`game` 有 `gameVersion` 兜底时，`game` 写坏仍然是错 —— 一个作者改错的
  //      键如果只是被另一个键盖住，他看到的是「包里明明写着 game，怎么读出来是 gameVersion」。三个键各自的类型
  //      独立判，判完再按 `game` > `gameVersion` 的既有优先级解析（这里**没有**改优先级）。
  /** 一个**声明了就不能是别的类型**的字符串字段：`{ s }` 成功（缺省 / `null` / 空串读成 `null`），否则一个判罚。
   *  与 `strField` 的分工是「谁负责报错」：它保持沉默，这一层点名。@type {(key: string, v: any, code: string) => { s?: string|null, bad?: object }} */
  const declaredString = (key, v, code) => {
    if (v === undefined || v === null) return { s: null };
    if (typeof v === 'string') return { s: strField(v, 60) };
    return { bad: fail(code, `"${key}" must be a string (a version range such as ">=1 <2" or "1.x"), got ${Array.isArray(v) ? 'an array' : typeof v} — a non-string declaration would be read as "not declared"`) };
  };
  const apiDecl = declaredString('api', raw.api, 'BAD_API_TYPE');
  if (apiDecl.bad) return apiDecl.bad;
  const gameDecl = declaredString('game', raw.game, 'BAD_GAME_TYPE');
  if (gameDecl.bad) return gameDecl.bad;
  // `gameVersion` 是别名，所以它拿同一个码：一个包声明了两个版本号而坏的那个叫 `gameVersion`，作者该知道的
  // 是「这个键的类型不对」，而不是两个看起来无关的判罚。
  const gameVersionDecl = declaredString('gameVersion', raw.gameVersion, 'BAD_GAME_TYPE');
  if (gameVersionDecl.bad) return gameVersionDecl.bad;
  const api = apiDecl.s;
  if (api && !isVersionRange(api)) return fail('BAD_API_RANGE', `"api": "${api}" is not a version range (">=1 <2", "1.x" …)`);
  // `api` 的可比对那一半（DESIGN §28.5 的前置项，本轮补上）：`shared/constants.js MOD_API_VERSION` 是钩子总线与
  // kit 契约的版本，**只在包自己声明了 `api` 时才比对** —— 没声明的包（今天所有的包）一个字节都不受影响。
  // 拒绝而不是降级：一个按别的总线写的钩子无法被证明是安全的，而「运行它」正是「有声明、没验证」那一类错误。
  // 版本串由常量推导（`appVersionMatches` 读三段的 `vM.m.p`，**读不出来时算匹配** —— 那个兜底会让每一次比对
  // 都通过，所以这里绝不能把整数直接传进去）。
  if (api && !appVersionMatches(api, `${MOD_API_VERSION}.0.0`)) {
    return fail('MOD_API_INCOMPATIBLE', `this pack declares "api": "${api}", which excludes the installed mod API ${MOD_API_VERSION} (DESIGN §28.5: write the range this pack was written against, or drop the field)`);
  }
  // 优先级**一字未改**（`game` > `gameVersion`），只是两边都已经过类型闸门，所以这里的 `??` 今天能到达的
  // 只有「都写了、`game` 是空串」这一种情形 —— 空串读成没声明，于是落到 `gameVersion` 那一侧。
  const game = gameDecl.s ?? gameVersionDecl.s;
  if (game && !isVersionRange(game)) return fail('BAD_GAME_RANGE', `"game": "${game}" is not a version range (">=0.2.0", "0.2.x" …)`);
  // 声明的层（DESIGN §28.1）：A 内容 / B 服务端逻辑 / C 客户端界面。写错了要拒，不能猜。
  const layer = raw.layer === undefined || raw.layer === null ? null : String(raw.layer).trim().toUpperCase();
  if (layer !== null && !MOD_LAYERS.includes(layer)) return fail('BAD_LAYER', `"layer": "${raw.layer}" is not one of ${MOD_LAYERS.join(' / ')}`);
  if (raw.combat !== undefined && typeof raw.combat !== 'boolean') return fail('BAD_COMBAT', '"combat" must be true or false (may this pack change a battle result?)');
  // `server.meta` 改的是**对局结果**，所以按业主裁决（2026-10-10）它必须声明 `combat: true` —— 那正是「要改
  // 对局结果的包进入房间摘要闸门 + golden 语料」这条线的入口（DESIGN §28.13.1 与 §29）。**硬闸门，不是警告**：
  // 一个能改结果却把自己标成 `combat: false` 的包，会让「不声明 combat 的包改不了结果」这句话从**结构性保证**
  // 退化成一句口号。位置放在这里（而不是形状层刚解析完 `server` 的地方）是为了让 `combat` 的**类型**错误先报出来。
  if (serverParsed && serverParsed.decl.meta && raw.combat !== true) {
    return fail('META_NEEDS_COMBAT', 'server.meta changes match results, so this pack must declare "combat": true — that is what puts it into the room digest gate and the golden corpus (DESIGN §29); a pack that cannot state that must not ship server-side match logic');
  }
  // `server.battle` 是**战斗里**跑的代码：它比 meta 更直接地改对局结果（增伤、攻速、真实伤害），所以同一条硬闸门。
  if (serverParsed && serverParsed.decl.battle && raw.combat !== true) {
    return fail('BATTLE_NEEDS_COMBAT', 'server.battle runs inside every battle and can change its result, so this pack must declare "combat": true — that is what puts it into the room digest gate and the golden corpus (DESIGN §28.17); a pack that cannot state that must not ship battle logic');
  }
  // `server.modules` 里挂了 `matchClass` 的模块**也**要 `combat: true`：一个 `MatchClass` 包装器原则上能改对局结果
  // （它可以覆写 `finish` / `dispose` 之外的任何东西），而「要改结果的必须进摘要闸门与 golden 那条线」是业主裁决。
  // 只挂 `boot` / `shutdown` / `healthz` 的模块不在此列 —— 那三件碰不到对局。
  if (serverParsed && (serverParsed.decl.modules || []).some((m) => m.uses.includes('matchClass')) && raw.combat !== true) {
    return fail('MODULES_NEED_COMBAT', 'a server module whose uses includes "matchClass" wraps the match itself, so this pack must declare "combat": true — that is what puts it into the room digest gate and the golden corpus (DESIGN §28.14); a module that only mounts boot / shutdown / healthz does not need it');
  }
  // 变体 / 口径（DESIGN §28.39）**也**要 `combat: true`，理由与上面三条逐字同构：一个口径改的就是**对局的结果**
  // —— `deploy: "max"` 把 `config.economy.deployCap` 从官方的 8 抬到 12（场上同时多站四个人），
  // `training` 说的是这一局用哪一套练度。判据是**能力**而不是意图：一条**能**改结果的口径声明，必须进房间摘要
  // 闸门与 golden 语料，否则「不声明 combat 的包改不了结果」这句话就从结构性保证退化成一句口号。
  // `form`（第 6 刀，DESIGN §28.41）同样：`form: "elite"` 让每条普通干员按精锐形态的职能出战，改的就是对局结果。
  //
  // 位置在 `EMPTY_PACK` 之**后**（一个只声明了口径、什么都没带来的包照旧先得到 `EMPTY_PACK` —— 那才是它的真
  // 问题），并且在上面三条 `combat` 类型检查之后：`BAD_COMBAT` 先报，作者才知道该改的是类型而不是缺一个 `true`。
  if (variantsParsed && raw.combat !== true) {
    return fail('VARIANTS_NEED_COMBAT', 'a pack that declares "variants" pins a 口径 that changes match results (deploy slots / operator training / operator form), so it must declare "combat": true — that is what puts it into the room digest gate and the golden corpus (DESIGN §28.39, §28.41); a pack that cannot state that must not pin a 口径');
  }
  // 行为开关（DESIGN §28.43）**也**要 `combat: true`，理由与上面四条逐字同构 —— 第五道同一条线。一格的入场券本就是
  // 「它改一条规则」（`docs/WORKSHOP.md` §1.1 的 `giveBondBiasOnly` 就是活例子：它改的是一局的商店出货概率＝改对局
  // 结果）。判据是**能力**而不是意图：一条**能**改结果的开关声明，必须进房间摘要闸门与 golden 语料，否则「不声明
  // combat 的包改不了结果」这句话就从结构性保证退化成一句口号。
  //
  // 位置与 `VARIANTS_NEED_COMBAT` 同序：在 `BAD_COMBAT`（类型）之后、`EMPTY_PACK` 之后、上面四条 `*_NEEDS_COMBAT`
  // 之后。将来若有一格**明确改不了结果**的开关（例如纯客户端规则），它必须**不**要求 `combat: true`，并把
  // 「不改结果」写进那一格的 `effect` —— 判据是能力，不是意图（§28.20 的闸门分类规则）。
  if (behaviourParsed && raw.combat !== true) {
    return fail('BEHAVIOUR_NEEDS_COMBAT', 'a pack that declares "behaviour" pins a rule switch that changes how the engine plays, which can change match results, so it must declare "combat": true — that is what puts it into the room digest gate and the golden corpus (DESIGN §28.43); a pack that cannot state that must not pin a behaviour switch');
  }
  // `server.room` **不在**上面这条线里（DESIGN §28.20）：它的契约是「观察与声明」——`install(room)` 拿到的是一个只读
  // 观察面（成员快照 / 阶段 / 事件 / 一条日志），没有 store、没有战场句柄、没有 socket、没有文件系统，返回值被忽略。
  // 判据是**能力**而不是意图：一件改不了结果的能力不要求 `combat: true`（要求了只会让诚实的包被拒，而闸门本身变成
  // 一句口号）。反过来，这一层**将来**若交出任何能改「谁在玩 / 装了什么 / 这一局的结果」的东西，那件东西必须
  // `combat: true` —— 那条规则写在 §28.20 的分类规则那一段，落点在 `server/roomPack.js` 的成员表上。
  return {
    ok: true,
    pack: {
      id,
      name: typeof raw.name === 'string' && raw.name ? raw.name : id,
      version: typeof raw.version === 'string' && raw.version ? raw.version : '0.0.0',
      author: typeof raw.author === 'string' && raw.author ? raw.author : null,
      license,
      hasAssets: opts.hasAssets === true,
      description: typeof raw.description === 'string' && raw.description ? raw.description : null,
      gameVersion: typeof raw.gameVersion === 'string' && raw.gameVersion ? raw.gameVersion : null,
      api,
      game,
      layer,
      combat: typeof raw.combat === 'boolean' ? raw.combat : null,
      content,
      overrides,
      voices: voiceLines,
      voiceLangs: orderedLangLines,
      // 作者自备 CDN 的语音素材（DESIGN §28.33）：**只在声明过时才存在** —— 与 `skins` 同一条纪律，
      // 理由逐字相同（给每个包都加一个 `voiceCdn: []` 会让所有已发布包的哈希全部改变）。
      ...(orderedVoiceCdn.length ? { voiceCdn: orderedVoiceCdn } : {}),
      bondIcons: bondIconFiles,
      itemIcons: itemIconFiles,
      art: artEntries,
      // 时装**只在声明过时才存在**（与下面 `declared` 同一条纪律，理由逐字相同）：`identifyPack` 哈希的是这份
      // 归一化清单的 `canonicalJson`，所以给每个包都加一个 `skins: []` 会让**所有已发布包的哈希全部改变**
      // —— 而哈希是房间身份与 W-D 对齐的依据，动它等于让每个老包在同一条房间里被判成「另一个包」。
      ...(skinEntries.length ? { skins: skinEntries } : {}),
      support: supportIds,
      operators: orderedOperators,
      playtest: { directToHand },
      // 变体 / 口径声明（DESIGN §28.39）：**只在声明过时才存在**，与 `skins` / `voiceCdn` 同一条纪律、理由逐字
      // 相同 —— `identifyPack` 哈希的就是这份归一化清单的 `canonicalJson`（`server/workshop.js`），给每个包都加
      // 一个 `variants: []` 会让**所有已发布包的哈希全部改变**。而它**必须**进哈希：一个口径改的是对局结果，
      // 两份只差口径的包共用同一个摘要，房间的摘要闸门就会放行两种不同的行为（DESIGN §28.2）。
      ...(variantsParsed ? { variants: variantsParsed.decl } : {}),
      // 行为开关声明（DESIGN §28.43）：**只在声明过时才存在**，与 `variants` / `skins` / `voiceCdn` 同一条纪律、
      // 理由逐字相同 —— `identifyPack` 哈希的就是这份归一化清单的 `canonicalJson`（`server/workshop.js`），给每个
      // 包都加一个 `behaviour: []` 会让**所有已发布包的哈希全部改变**。而它**必须**进哈希：一条开关改的是引擎的
      // 规则，两份只差开关的包共用同一个摘要，房间的摘要闸门就会放行两种不同的行为（DESIGN §28.2）。
      ...(behaviourParsed ? { behaviour: behaviourParsed.decl } : {}),
      ...(typeof raw.stripDiyOverlaps === 'boolean' ? { stripDiyOverlaps: raw.stripDiyOverlaps } : {}),
      // 四组新声明：**只在声明过时才存在**（见上面 `declared` 的注释）。哈希覆盖它们靠的就是这一条 ——
      // `identifyPack` 哈希的是这份归一化清单的 `canonicalJson`（server/workshop.js）。
      ...Object.fromEntries(declared),
      // 目标引擎与 Stardust profile（同一条「写了才进归一化结果」的纪律）：`target: "forge"` 显式写出来时也进
      // （那是一个声明），`type` / `capabilities` 只在 stardust 目标下存在。
      ...(raw.target !== undefined ? { target } : {}),
      ...(starProfile ? { type: 'mod', capabilities: starProfile.capabilities } : {}),
    },
  };
}

/**
 * `pack.json.playtest.directToHand` 里那些**不属于这个包**的 id（`PLAYTEST_UNKNOWN_CHESS` 的判罚依据）。
 *
 * 为什么要有这条：名单里的 id 只要加载器不认识，开关就是**静默失效** —— 作者在界面上勾了、试玩里却什么都没发生。
 * 静默无效正是这个缺口的老毛病，所以这里点名拒绝。合法的 id 只有两类：
 *   * 本包自己的 chess 记录 id（`ownChessIds`，非覆盖的工坊干员）；
 *   * 本包在 `overrides` 里声明过的官方 id（覆盖模式：记录写的是官方 id，加载器只认这条声明）。
 *
 * 形状（不是对象、值不是字符串数组）在 `normalizePackManifest` 就已经被拒了，这里只管成员资格。
 * 判罚只有这一份：加载器（`server/workshop.js`）、`tools/workshop-pack.mjs` 的 `readPackDir`
 * 与编辑器读包的地方都调它，所以三处不可能给出不同结论。
 *
 * @param {string[]} declared `pack.json.playtest.directToHand`（已归一化）
 * @param {string[]} overrides `pack.json.overrides`（`"<file>:<id>"` 列表）
 * @param {Iterable<string>} ownChessIds 本包 chess.json 自己的记录 id
 * @returns {string[]} 不认识的 id（保持声明顺序，去重）
 */
export function playtestUnknownIds(declared, overrides, ownChessIds) {
  const own = ownChessIds instanceof Set ? ownChessIds : new Set(Array.isArray(ownChessIds) ? ownChessIds : []);
  const declaredOverrides = new Set(Array.isArray(overrides) ? overrides : []);
  const out = [];
  for (const id of Array.isArray(declared) ? declared : []) {
    if (typeof id !== 'string' || !id) continue;
    if (own.has(id)) continue;
    if (declaredOverrides.has(`chess:${id}`)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Validate one content file of a pack: a `{ [id]: record }` map, every key a safe id, every value a JSON object, and —
 * when the record carries its own id field — that field equal to the key.
 *
 * `units`（新干员的干员记录）**另外**要过一遍「下游用得上吗」：见 `UNIT_REQUIRED_FIELDS` 的长注释 —— 我们只查那
 * 六个字段，其余一律照抄，不复制官方 schema。
 * @param {string} file data file basename, e.g. 'chess'
 * @param {any} json parsed file
 * @returns {{ ok: true, records: Record<string, object> } | { ok: false, error: string, detail: string }}
 */
export function normalizeContentFile(file, json) {
  if (!isPlainObj(json)) return fail('BAD_CONTENT', `${file}.json must be a JSON object of { id: record }`);
  const field = ID_FIELD_BY_FILE[file] || null;
  /** @type {Record<string, object>} */
  const records = {};
  for (const [id, rec] of Object.entries(json)) {
    if (!RECORD_ID_RE.test(id)) return fail('BAD_RECORD_ID', `${file}.json key "${id}" is not a valid id`);
    if (!isPlainObj(rec)) return fail('BAD_RECORD', `${file}.json["${id}"] must be a JSON object`);
    if (field && rec[field] !== undefined && rec[field] !== id) {
      return fail('ID_MISMATCH', `${file}.json["${id}"].${field} is "${rec[field]}" — it must equal the key`);
    }
    if (file === 'units') {
      for (const need of UNIT_REQUIRED_FIELDS) {
        if (need.ok(rec[need.key])) continue;
        return fail(need.code, `units.json["${id}"].${need.key} ${need.detail}`);
      }
    }
    records[id] = rec;
  }
  if (!Object.keys(records).length) return fail('EMPTY_CONTENT', `${file}.json has no records`);
  return { ok: true, records };
}

// ---------------------------------------------------------------------------------------------------------------
// i18n：给**已有语种**补词条（fanpack G-04 / plugin-pack G4，docs/WORKSHOP.md §1.10）
//
// 背景：`packs/` 的 `lang` 类型只能**新增**一个语种 —— 带 `en` / `ja` / `ko` / `zh-TW` 的包会被真实的扫描器整包
// 跳过，原文是 `the language en is already provided by public/i18n/en.json`。而任何带新界面的包都需要给已有语种
// 补键，所以这是一个结构性的缺口。补法只有三条规矩，三条都必须有测试钉住：
//   1. **已有键绝不覆盖**（官方/先到的译文永远赢）；
//   2. **冲突显式报告**，点名 **键 + 语种 + 包 id**（外加双方的值）—— 只报「值不同」的重叠；
//   3. **包里的值必须是字符串**，否则整包拒绝（非字符串会让 `t()` 把原文打印到界面上，是查不出源头的那种故障）。
// ---------------------------------------------------------------------------------------------------------------

/**
 * 一个包的 `i18n` 声明摊平成 `Map<语种, { pack, file }>`（装载期校验、HTTP 合并体与校验器共用的**唯一**解析）。
 *
 * 同一个语种被多个包声明时**按包 id 排序后的第一个赢**（与 `workshopVoiceIndex` / DESIGN §28.3 同一条规则），
 * 其余的进 `overridden`：输的那个作者必须看到一行字，否则他会以为自己那份译文生效了。
 *
 * @param {Array<{ id?: string, i18n?: Record<string, string> }>} packs
 * @returns {{ langs: Map<string, { pack: string, file: string }>, overridden: Array<{ pack: string, lang: string, definedBy: string, reason: string }> }}
 */
export function parsePackI18n(packs) {
  /** @type {Map<string, { pack: string, file: string }>} */
  const langs = new Map();
  /** @type {Array<{ pack: string, lang: string, definedBy: string, reason: string }>} */
  const overridden = [];
  for (const pack of (Array.isArray(packs) ? packs : []).filter((p) => p && typeof p === 'object' && p.id).sort(byPackId)) {
    const decl = isPlainObj(pack.i18n) ? pack.i18n : {};
    for (const lang of Object.keys(decl).sort()) {
      const file = decl[lang];
      if (typeof file !== 'string' || !file) continue;
      const holder = langs.get(lang);
      if (holder) {
        overridden.push({
          pack: pack.id, lang, definedBy: holder.pack.id,
          reason: `i18n["${lang}"] is already contributed by pack "${holder.pack.id}" — the pack with the smaller id keeps it (DESIGN §28.3). Drop this file, or let "${holder.pack.id}" drop it`,
        });
        continue;
      }
      langs.set(lang, { pack, file });
    }
  }
  return { langs, overridden };
}

/**
 * 把包带的词条并进一份已存在的语言文件 —— **已有键绝不覆盖**，冲突逐条报告（见上面那一节的三条规矩）。
 *
 * `entries` 的形状就是一条 i18n 声明的形状（`{ "<msgid>": "<译文>" }`）。校验与合并共用这一个函数：不可能出现
 * 「校验器放行的值，合并时被丢掉」。
 *
 * @param {Record<string, any>|null|undefined} base 已有的语言文件（`public/i18n/<code>.json` 的解析结果）
 * @param {Record<string, any>|null|undefined} entries 包声明的词条
 * @param {{ pack?: string, lang?: string }} [where] 点名信息（拒绝文案与冲突报告都带上）
 * @returns {{ ok: true, merged: Record<string, any>, added: string[], conflicts: Array<{ pack: string, lang: string, key: string, official: string, packValue: string }>, skippedSame: number }
 *   | { ok: false, error: string, detail: string }}
 */
export function mergeWorkshopI18n(base, entries, { pack = '', lang = '' } = {}) {
  if (entries !== undefined && !isPlainObj(entries)) {
    return fail('I18N_BAD_FILE', `i18n["${lang}"] must be a JSON object of { "<msgid>": "<translation>" } (got ${Array.isArray(entries) ? 'an array' : typeof entries})`);
  }
  const clean = isPlainObj(entries) ? entries : {};
  /** @type {string[]} */
  const added = [];
  /** @type {Array<{ pack: string, lang: string, key: string, official: string, packValue: string }>} */
  const conflicts = [];
  let skippedSame = 0;
  for (const key of Object.keys(clean).sort()) {
    const value = clean[key];
    if (!key || key.startsWith('_')) {
      return fail('I18N_BAD_KEY', `i18n["${lang}"]: "${key}" is not a valid msgid (a non-empty key that does not start with "_" — the "_"-prefixed keys are a language file's metadata block)`);
    }
    if (typeof value !== 'string') {
      return fail('I18N_BAD_VALUE', `i18n["${lang}"]: "${key}" must map to a string (got ${Array.isArray(value) ? 'an array' : typeof value}) — t() would print the raw value, and the broken interface could never be traced back to this pack`);
    }
    const official = isPlainObj(base) ? base[key] : undefined;
    if (typeof official === 'string') {
      // 已有键**绝不覆盖**。值相同就什么都不用做（也不是冲突）；值不同就是一条要报出来的冲突。
      if (official === value) skippedSame++;
      else conflicts.push({ pack, lang, key, official, packValue: value });
      continue;
    }
    if (!added.includes(key)) added.push(key);
  }
  const merged = { ...(isPlainObj(base) ? base : {}) };
  for (const key of added) merged[key] = clean[key];
  return { ok: true, merged, added, conflicts, skippedSame };
}

/**
 * `parsePackI18n` + `mergeWorkshopI18n` 的一站式版本：遍历每个声明的语种，读出包的文件并合并。
 *
 * 读盘由调用方注入（`shared/` 两端共用，浏览器没有 fs）：`readFile(packId, file)` 返回**已解析的对象**，或 `null`
 * （文件不在 / 不是 JSON）。所以「文件在不在」的判罚点只有调用方一处，而「值合不合法」的判罚点只有这里一个。
 *
 * @param {Array<{ id?: string, i18n?: Record<string, string> }>} packs
 * @param {(pack: string, file: string) => Record<string, any>|null} readFile `(pack id, declared path)` → the parsed file
 * @param {(lang: string) => Record<string, any>|null} readBase 读官方语言文件（`public/i18n/<code>.json`）
 * @returns {{ files: Map<string, Record<string, any>>, added: Record<string, string[]>, conflicts: object[], skippedSame: Record<string, number>, errors: Array<{ pack: string, lang: string, code: string, reason: string }> }}
 */
export function workshopI18nFiles(packs, readFile, readBase) {
  const { langs, overridden } = parsePackI18n(packs);
  /** @type {Map<string, Record<string, any>>} */
  const files = new Map();
  /** @type {Record<string, string[]>} */
  const added = {};
  /** @type {object[]} */
  const conflicts = [...overridden];
  /** @type {Record<string, number>} */
  const skippedSame = {};
  /** @type {Array<{ pack: string, lang: string, code: string, reason: string }>} */
  const errors = [];
  for (const lang of [...langs.keys()].sort()) {
    const { pack, file } = langs.get(lang);
    const entries = readFile(pack.id, file);
    if (entries === null || entries === undefined) {
      errors.push({
        pack: pack.id, lang, code: 'I18N_BAD_FILE',
        reason: `i18n["${lang}"] names "${file}", which is not a readable JSON object inside the pack`,
      });
      continue;
    }
    const merged = mergeWorkshopI18n(readBase(lang), entries, { pack: pack.id, lang });
    if (!merged.ok) {
      errors.push({ pack: pack.id, lang, code: merged.error, reason: merged.detail });
      continue;
    }
    files.set(lang, merged.merged);
    if (merged.added.length) (added[pack.id] ||= []).push(...merged.added.map((k) => `${lang}:${k}`));
    for (const c of merged.conflicts) conflicts.push(c);
    if (merged.skippedSame) skippedSame[lang] = merged.skippedSame;
  }
  for (const list of Object.values(added)) list.sort();
  return { files, added, conflicts, skippedSame, errors };
}

/**
 * `stripPackOperators`（fanpack G-16）：**包把一名官方干员变成棋子**时，他与自选池的关系要**记录下来** ——
 * 一个被包变成棋子的干员同时躺在自选池里，意味着同一个干员能被上两次（一次作为棋子、一次作为自选槽），
 * 而且还绕过棋子自己的盟约。原件在它自己的 `shared/customContent.js` 里为此写了一条装载层规则：**把人摘出池**。
 *
 * 本刀**只做「记录 + 拒绝重复」这一半**，理由必须说清（业主需要裁决的那一半）：
 *
 *   * `diy.ownedPool` 是「自选槽能挑的已拥有干员」这份**名单本身**（`shared/diy.js` 从它出格子，
 *     `tools/golden.mjs` 给池里每一位配一个精锐场景）。把它摘掉不是「去重」，而是**改对局结果**：
 *     池子变小、可挑的干员变少、语料里那一位的场景整个消失。实测：fanpack 那份真实数据里 **8 名**
 *     干员同时在池里（`char_147_shining`、`char_4088_hodrer`、`char_4132_ascln`、`char_1035_wisdel`、
 *     `char_017_huang`、`char_003_kalts`、`char_4179_monstr`、`char_4133_logos`），摘掉就是 `ownedPool` 71 → 63。
 *   * 而本刀的验收要求 `test/golden/*.json` 一个字节都不动、六份语料的数字不变 —— 这两件事不可能同时成立。
 *     按 `AGENTS.md`「Deliberate deviations from the official mode are the maintainer's decision only」，
 *     这一半是**维护者的决定**，所以它停在这里，写进报告等裁决。
 *
 * 「拒绝重复」那一半**今天已经成立**，而且不在这个函数里：`mergeWorkshopOperators` 的 `if (!pool.includes(id))`
 * 是一条既有的不变量（`test/workshopOperators.test.js` 钉着「一个 id 只进池一次」）。所以一个包把池里已有的
 * 干员声明进 `operators` 时**不会**让池里出现第二条 —— 但「他本来就在池里、现在又被这个包变成棋子」这件事
 * 以前**没有任何地方说出来**，这个函数就是那句话。
 *
 * @param {Array<{ id?: string, operators?: Record<string, unknown>, files?: Record<string, Record<string, object>> }>} packs
 * @param {Readonly<Record<string, any>>} data 合并后的数据（`data.backups.units` / `data.backups.diy.ownedPool`）
 * @param {{ apply?: boolean }} [opts] `apply: true` 时**真的摘除**（见下）；默认 false = 只报告（今天的口径）
 * @returns {{ overlaps: Array<{ pack: string, charId: string, inPoolBefore: boolean, poolEntry: boolean, entryFrom: string, note: string }>, stripped: string[], applied: boolean }}
 *   `overlaps` 逐条点名（`inPoolBefore` = 官方池里本来就有他，`poolEntry` = 他是这个包声明进池的）；
 *   `stripped` 是**被摘掉**的 id（`apply: false` 时这一列是「如果摘会是哪些」，好让改动面一目了然）；
 *   `applied` 说明这一次到底改没改数据。
 *
 * **为什么默认不摘**：摘掉一份已经在池里的干员 = 池子变小、可挑的干员变少、`tools/golden.mjs` 给池里每一位
 * 配的那个精锐场景整个消失（实测 fanpack 那份数据里 8 名，`ownedPool` 71 → 63）。按 `AGENTS.md` 的 golden 规矩，
 * 一次**有意的玩法改动**必须在同一个提交里跑 `golden:update` 并逐条点名移动了哪些场景 —— 而那不是一个
 * 加载器函数有权替维护者决定的事。所以这里给的是**开关**：`apply: true` 才摘，且摘了谁必须能被点名。
 */
export function stripPackOperators(packs, data, { apply = false } = {}) {
  const backups = isPlainObj(data) && isPlainObj(data.backups) ? data.backups : {};
  const ownedPool = Array.isArray(backups.diy?.ownedPool) ? backups.diy.ownedPool : [];
  const inPool = new Set(ownedPool);
  /** @type {Array<{ pack: string, charId: string, inPoolBefore: boolean, poolEntry: boolean, entryFrom: string, note: string }>} */
  const overlaps = [];
  /** @type {string[]} */
  const stripped = [];
  for (const pack of (Array.isArray(packs) ? packs : []).filter((p) => p && typeof p.id === 'string' && p.id).sort(byPackId)) {
    /** @type {Map<string, string>} charId → 这个包把它变成棋子的那条记录 id */
    const chessByChar = new Map();
    for (const [chessId, rec] of Object.entries(isPlainObj(pack.files?.chess) ? pack.files.chess : {})) {
      const charId = isPlainObj(rec) && typeof rec.charId === 'string' && rec.charId ? rec.charId : null;
      if (charId && !chessByChar.has(charId)) chessByChar.set(charId, chessId);
    }
    const declared = isPlainObj(pack.operators) ? pack.operators : {};
    for (const charId of [...chessByChar.keys()].sort()) {
      const inPoolBefore = inPool.has(charId);
      const poolEntry = Object.hasOwn(declared, charId);
      if (!inPoolBefore && !poolEntry) continue;
      if (inPoolBefore) stripped.push(charId);
      overlaps.push({
        pack: pack.id, charId, inPoolBefore, poolEntry,
        entryFrom: chessByChar.get(charId),
        note: inPoolBefore
          ? `"${charId}" is in the 自选 pool (data/backups.json diy.ownedPool) AND this pack turns him into the chess piece "${chessByChar.get(charId)}" — he can be fielded twice, and the 自选 slot bypasses the piece's own bond.${apply ? ' Stripped from the pool (opt-in): the pool offers one fewer operator and the golden corpus moves with it' : ' Stripping him from the pool changes what the pool offers, so it is the maintainer\'s call — pass { apply: true } to do it (see the loader report)'}`
          : `this pack puts "${charId}" into the 自选 pool through pack.json operators AND ships the chess piece "${chessByChar.get(charId)}" for the same operator — one operator with two ways in`,
      });
    }
  }
  // 真的摘除：只动 `ownedPool` 这一份名单（`diy.operators` 那一条记录留着 —— 它在池外也仍被界面按 id 读，
  // 摘掉名单条目就够了，删记录反而会让别的引用找不到它）。摘除是**就地**改一个拷贝，调用方决定要不要采用。
  let applied = false;
  if (apply && stripped.length && isPlainObj(backups.diy)) {
    const drop = new Set(stripped);
    const remaining = ownedPool.filter((id) => !drop.has(id));
    if (remaining.length !== ownedPool.length) {
      data.backups = { ...backups, diy: { ...backups.diy, ownedPool: remaining } };
      applied = true;
    }
  }
  return { overlaps, stripped, applied };
}

/**
 * The voice lines every pack contributes, keyed exactly like the manifest the client looks them up in:
 * `{ <charId>: { <slot>: [url, …] } }` (docs/ASSETS.md "Voice lines").
 *
 * The URLs point into the pack media route (`WORKSHOP_MEDIA_PREFIX`), so the client needs no new channel: the overlay
 * merges this map into `assets.audio.voice` and the game server serves `/data/assets.json` merged, which is the object
 * public/js/audio.js already reads (`installAudio({ getManifest: () => data.get('assets') })`).
 *
 * Every path segment is percent-encoded: a pack filename may legitimately hold a `#`, a space or a `+`, and the route
 * decodes the path before it resolves it (`/workshop-assets/<pack>/voice/a%23b.mp3`).
 *
 * @param {Array<{ id: string, voices?: Record<string, Record<string, string[]>>, voiceLangs?: Record<string, Record<string, Record<string, string[]>>> }>} packs loaded packs (server/workshop.js)
 * @param {{ prefix?: string, lang?: string|null }} [opts] `lang` selects a dub's table (`voiceLangs[lang]`); the default
 *   (null) is the pack's default-dub table `voices`.
 * @returns {Record<string, Record<string, string[]>>}
 */
export function workshopVoiceIndex(packs, { prefix = WORKSHOP_MEDIA_PREFIX, lang = null } = {}) {
  /** @type {Record<string, Record<string, string[]>>} */
  const out = {};
  const list = (Array.isArray(packs) ? packs : []).filter((p) => p && typeof p.id === 'string' && p.id);
  // sorted by pack id: the merged line list must not depend on the order the filesystem handed the packs over
  for (const pack of [...list].sort(byPackId)) {
    const table = lang === null
      ? (isPlainObj(pack.voices) ? pack.voices : null)
      : (isPlainObj(pack.voiceLangs) && isPlainObj(pack.voiceLangs[lang]) ? pack.voiceLangs[lang] : null);
    if (!table) continue;
    for (const [charId, slots] of Object.entries(table)) {
      if (!isPlainObj(slots)) continue;
      for (const [slot, files] of Object.entries(slots)) {
        if (!Array.isArray(files) || !files.length) continue;
        const bySlot = (out[charId] ||= {});
        const urls = (bySlot[slot] ||= []);
        for (const f of files) {
          if (typeof f !== 'string' || !f) continue;
          urls.push(prefix + pack.id + '/' + f.split('/').map(encodeURIComponent).join('/'));
        }
      }
    }
  }
  return out;
}

/**
 * Every NON-default dub the packs declare, one index each: `{ <lang>: <workshopVoiceIndex shape> }`.
 *
 * The default dub's table is `voices` itself, so it is not repeated here — `normalizePackManifest` refuses a
 * `voiceLangs[<default>]` outright (VOICE_LANG_DEFAULT). A language no pack declares is simply absent, so the overlay
 * never writes an empty `voiceLangs` into a manifest that had none.
 * @param {Array<object>} packs @param {{ prefix?: string }} [opts]
 * @returns {Record<string, Record<string, Record<string, string[]>>>}
 */
export function workshopVoiceLangIndex(packs, { prefix = WORKSHOP_MEDIA_PREFIX } = {}) {
  /** @type {Record<string, Record<string, Record<string, string[]>>>} */
  const out = {};
  for (const pack of Array.isArray(packs) ? packs : []) {
    if (!pack || !isPlainObj(pack.voiceLangs)) continue;
    for (const lang of Object.keys(pack.voiceLangs)) {
      if (out[lang] || !VOICE_LANGS.includes(lang) || lang === DEFAULT_VOICE_LANG) continue;
      const index = workshopVoiceIndex(packs, { prefix, lang });
      if (Object.keys(index).length) out[lang] = index;
    }
  }
  // VOICE_LANGS order decides the key order: this object ends up in the merged manifest, and that file must not change
  // with the order the packs happened to load in.
  return Object.fromEntries(VOICE_LANGS.filter((l) => out[l]).map((l) => [l, out[l]]));
}

/**
 * The ONE arbitration order of the overlay (DESIGN §28.3): pack ids are slugs, so a plain code-unit compare is a stable,
 * locale-independent order, and "the pack with the smaller id wins" is decided by this comparator on **every** face —
 * data records, kit ids, icons, item icons and art. Exported because the kit loader (server/workshop.js) must sort by
 * the same rule; two orderings would be two contracts, and the loser of a collision would depend on which one ran.
 */
export const byPackId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * 「试玩时直接发到手上」名单的**声明侧**：把所有包的 `pack.json.playtest.directToHand` 汇成一份名单，并裁掉撞车的。
 *
 * 沿用 §1.2 的**谁赢**规则（DESIGN §28.3）：两个包声明同一个 id 时，包 id 字典序最小者赢，输的一方拿到一条
 * **点名**报告（`definedBy` 是赢家的包 id）。与其它面一样，结果只取决于包 id —— 先把包按 `byPackId` 排序再处理，
 * 所以与「目录是按什么顺序扫描到的」无关。
 *
 * 这只是名单的**一半**：另一半是记录里自带 `directToHand: true` 的工坊件（非覆盖的包，向后兼容）。
 * 两半的并集在引擎侧算（`server/match/match/phases.js` 的 `directToHandIds`）—— 正式服务器一个都不发，
 * 因为那里 `SP_PLAYTEST` 不是 `1`。
 *
 * @param {Array<{ id: string, playtest?: { directToHand?: string[] } }>} packs
 * @returns {{ ids: string[], errors: Array<{ pack: string, id: string, code: string, definedBy: string, reason: string }> }}
 */
export function workshopPlaytestIndex(packs) {
  /** @type {string[]} */
  const ids = [];
  const owner = new Map();
  const errors = [];
  for (const pack of (Array.isArray(packs) ? packs : []).filter((p) => p && typeof p.id === 'string' && p.id).sort(byPackId)) {
    const declared = isPlainObj(pack.playtest) && Array.isArray(pack.playtest.directToHand) ? pack.playtest.directToHand : [];
    for (const id of declared) {
      if (typeof id !== 'string' || !id) continue;
      const holder = owner.get(id);
      if (holder) {
        if (holder === pack.id) continue;
        errors.push({
          pack: pack.id, id, code: 'PLAYTEST_ID_COLLISION', definedBy: holder,
          reason: `"${id}" is already declared by pack "${holder}" — the pack with the smaller id keeps it (DESIGN §28.3). Remove it from this pack, or rename the record; an "overrides" entry does not win against another pack`,
        });
        continue;
      }
      owner.set(id, pack.id);
      ids.push(id);
    }
  }
  return { ids, errors };
}

/**
 * Keys of a record that an override REPLACES wholesale instead of merging field by field (DESIGN §28.3, owner's
 * request of 2026-10-09). Two classes, one reason each:
 *
 *   * **behaviour / structure** — `skill`, `skills`, `talents`, `trait`, `traitBase`, `traitOverride`, `modules`,
 *     `rangeGrid`, `attackRangeGrid`, `assets`, `diy`, `bonds`: these are read as whole units by the sim and the
 *     loadout layer (`shared/loadoutRecord.js` resolveRecordLoadout / loadoutRecord, `server/sim/simdata.js`).
 *     Half-merging e.g. a `skill` (a new index with the old blackboard) would create a record nobody wrote and no
 *     validator describes; replacing is the only honest reading of "this pack ships its own skill".
 *   * **arrays** — replaced by definition, a field-wise array merge has no meaning here.
 *
 * Everything else (numbers, strings, booleans and the plain objects that hold them, e.g. `stats`, `assets`' sibling
 * numeric maps) is merged field by field, recursively, so an override that writes ONE number keeps every other field of
 * the official record. That is the whole point: before this, a one-key override silently reduced a 44-field operator to
 * two fields, and `applyWorkshop` reported no error at all.
 */
export const OVERRIDE_REPLACE_KEYS = Object.freeze([
  'skill', 'skills', 'trait', 'traitBase', 'traitOverride', 'modules',
  'rangeGrid', 'attackRangeGrid', 'assets', 'diy', 'bonds',
]);

/**
 * Lists whose entries carry a **stable identity key**: merged entry by entry on that key instead of wholesale, so an
 * author's partial edit cannot erase data they never wrote.
 *
 * Why this exists (0.2.2's potential annotations): a record in `data/chess.json` carries `potDown`, and a talent carries
 * `potMin` + `potBelow` — the chain that changes that talent below a potential rank (`shared/potential.js`). A record
 * the editor derives deliberately carries **none** of them (that is the engine's convention; `stripPotential` is "what a
 * record built at one rank looks like"). So replacing `talents` wholesale dropped the official's whole potential chain
 * the moment an author touched one talent — while `potDown` survived only because the patch never mentioned it. Merging
 * by `index` keeps the chain: the author's fields win, everything they did not write stays.
 *
 * The key is a property of the **list**, not of the entry shape, and it is not always `index`:
 *
 *   * `talents` / `talentsBase` — a talent entry is keyed by `index` (sparse: 0, 1, 3).
 *   * `talentChanges` — the module-internal talent rewrites, keyed by `talentIndex` (the `name` of the field says it).
 *     It sits INSIDE an entry of `modules`, which is itself replaced wholesale; the key list still applies, because
 *     `mergeRecord` recurses into the entries it pairs up. Without it the same silent loss happened one level deeper:
 *     a record opened as an override template comes back without `potMin`/`potBelow`, `modules` is replaced wholesale,
 *     and the official's chained module talent is gone (see `test/overridePotential.test.js`).
 *
 * Deliberately narrow: only lists that HAVE such a key. `bonds` / `immunities` / `rangeGrid` / `modules` itself still
 * replace wholesale (see the note above `OVERRIDE_REPLACE_KEYS`): a field-wise merge of a bare list would invent a
 * record nobody wrote, and `modules` is an ordered list the loadout screen reads as a whole.
 */
export const OVERRIDE_KEYED_LISTS = Object.freeze({ talents: 'index', talentsBase: 'index', talentChanges: 'talentIndex' });

/**
 * Merge one override record onto the record it replaces: field by field, with `OVERRIDE_REPLACE_KEYS` and arrays taken
 * wholesale (`OVERRIDE_KEYED_LISTS` excepted — those merge on their identity key). The input objects are never mutated
 * (the caller may keep the official data frozen).
 * @param {object} base the record being overridden (official, or a record an earlier pack contributed)
 * @param {object} patch the pack's record
 * @returns {object} a new record
 */
export function mergeRecord(base, patch) {
  if (!isPlainObj(base) || !isPlainObj(patch)) return patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const idKey = OVERRIDE_KEYED_LISTS[key];
    if (idKey && Array.isArray(value) && Array.isArray(base[key])) {
      out[key] = mergeKeyedList(base[key], value, idKey);
      continue;
    }
    if (OVERRIDE_REPLACE_KEYS.includes(key) || Array.isArray(value)) { out[key] = value; continue; }
    out[key] = isPlainObj(value) && isPlainObj(base[key]) ? mergeRecord(base[key], value) : value;
  }
  return out;
}

/**
 * Merge a list whose entries carry an identity key (`OVERRIDE_KEYED_LISTS`) onto the base list: entries pair up by that
 * key and merge field by field, unmatched base entries stay where they are, unmatched patch entries are appended.
 *
 * Order and the base's own order are preserved (a `talents` index is sparse — 0, 1, 3 — so array position is not the
 * key). An entry without a usable key is appended rather than guessed at: that is a talent the author added.
 *
 * **A key that repeats is not an identity.** `talentChanges` uses `-1` for "a hidden module talent", and an official
 * module may carry several of those, so the same key can address more than one entry. When either side has a duplicate
 * key the whole list falls back to the behaviour every other list gets (replace wholesale): pairing two of them would
 * drop an entry, and appending the ambiguous ones would reorder a list the loadout screen reads positionally. Merging
 * is for a list that really is keyed; when the data says otherwise, honesty beats cleverness.
 * @param {unknown[]} baseList @param {unknown[]} patchList @param {string} idKey
 * @returns {unknown[]}
 */
function mergeKeyedList(baseList, patchList, idKey) {
  const at = new Map();
  const dup = (list) => {
    const seen = new Set();
    for (const entry of list) {
      if (!isPlainObj(entry) || !Number.isInteger(entry[idKey])) continue;
      if (seen.has(entry[idKey])) return true;
      seen.add(entry[idKey]);
    }
    return false;
  };
  if (dup(baseList) || dup(patchList)) return patchList;
  for (const [i, entry] of baseList.entries()) {
    if (isPlainObj(entry) && Number.isInteger(entry[idKey])) at.set(entry[idKey], i);
  }
  const out = baseList.map((e) => e);
  const added = [];
  for (const entry of patchList) {
    const i = isPlainObj(entry) && Number.isInteger(entry[idKey]) ? at.get(entry[idKey]) : undefined;
    if (i === undefined) { added.push(entry); continue; }
    out[i] = mergeRecord(baseList[i], entry);
  }
  return [...out, ...added];
}

/**
 * The keys of `patch` that the record it overrides does not have (DESIGN §28.3, "closed world"): a declared override
 * may only speak about fields that exist, because today any well-formed nonsense is accepted silently and the author
 * gets a record that is quietly not what they wrote. `null` when `base` is not an object (nothing to compare against).
 * @param {object} base @param {object} patch
 * @returns {string[]|null}
 */
export function unknownOverrideKeys(base, patch) {
  if (!isPlainObj(base) || !isPlainObj(patch)) return null;
  return Object.keys(patch).filter((k) => !Object.hasOwn(base, k));
}

/**
 * Resolve every pack's 助战 declaration (`pack.json.support`) into the pool entries it asks for, plus the reasons a
 * declaration is refused (docs/WORKSHOP.md §2).
 *
 * ONE rule, two callers: the overlay (`mergeWorkshopSupport`, which actually publishes them) and
 * `tools/workshop-validate.mjs` (which reports them to the author). Two restrictions, both deliberate:
 *   * only an operator THIS pack adds may enter the pool — a pack must not change which OFFICIAL operators are
 *     available as 助战 (that is a rules decision, and the pool belongs to the install);
 *   * the TIER is derived from the record, never written in the manifest, so it cannot disagree with it — a mismatch
 *     would silently disable the operator, because shared/support.js `isSupportChess` requires an id to sit under the
 *     tier its record declares.
 *
 * @param {Readonly<Record<string, any>>} data merged game data (the tier is read from the MERGED chess record)
 * @param {Array<{ id: string, support?: string[], files?: Record<string, Record<string, object>> }>} packs
 * @returns {{ entries: Array<{ pack: string, id: string, tier: number }>, errors: Array<{ pack: string, id: string, code: string, reason: string }> }}
 */
export function workshopSupportEntries(data, packs) {
  const entries = [];
  const errors = [];
  const chess = isPlainObj(data) && isPlainObj(data.chess) ? data.chess : {};
  for (const pack of (Array.isArray(packs) ? packs : []).filter((p) => p && typeof p.id === 'string' && p.id).sort(byPackId)) {
    const own = isPlainObj(pack.files) && isPlainObj(pack.files.chess) ? pack.files.chess : {};
    for (const id of Array.isArray(pack.support) ? pack.support : []) {
      if (!Object.hasOwn(own, id)) {
        errors.push({
          pack: pack.id, id, code: 'SUPPORT_FOREIGN_OPERATOR',
          reason: `"${id}" is not an operator this pack adds — only a pack's OWN operators may enter the 助战 pool`,
        });
        continue;
      }
      const rec = isPlainObj(chess[id]) ? chess[id] : own[id];
      const tier = rec ? rec.tier : null;
      if (!isSupportTier(tier)) {
        errors.push({
          pack: pack.id, id, code: 'SUPPORT_TIER_UNKNOWN',
          reason: `"${id}" has no integer tier 1–6 (got ${JSON.stringify(tier)}), so it can never be a 助战`,
        });
        continue;
      }
      entries.push({ pack: pack.id, id, tier });
    }
  }
  return { entries, errors };
}

/**
 * Publish the 助战 pool entries the packs ask for into `data/support.json` (docs/WORKSHOP.md §2) — this is what makes a
 * distributed pack SELF-CONTAINED: without it, a player who installs a pack that adds a 助战 operator would also have to
 * hand-edit `data/support.json` before the operator could be picked.
 *
 * The installer keeps the last word: `"workshop": false` in `data/support.json` turns every pack contribution off.
 */
function mergeWorkshopSupport(data, packs, report) {
  const { entries, errors } = workshopSupportEntries(data, packs);
  for (const e of errors) report.errors.push({ pack: e.pack, file: 'support', id: e.id, code: e.code, reason: e.reason });
  if (!entries.length) return;
  const support = isPlainObj(data.support) ? data.support : null;
  if (!support) {
    const seen = new Set();
    for (const e of entries) {
      if (seen.has(e.pack)) continue;
      seen.add(e.pack);
      report.errors.push({
        pack: e.pack, file: 'support', id: e.id, code: 'MANIFEST_MISSING',
        reason: 'this pack declares 助战 operators, but data/support.json is missing — 助战 is off for this install',
      });
    }
    return;
  }
  if (support.workshop === false) { report.supportOff = true; return; }
  const pool = { ...(isPlainObj(support.pool) ? support.pool : {}) };
  /** @type {Record<string, string[]>} */
  const added = {};
  for (const { pack, id, tier } of entries) {
    const key = String(tier);
    const list = Array.isArray(pool[key]) ? pool[key].slice() : [];
    if (!list.includes(id)) list.push(id);
    list.sort();
    pool[key] = list;
    (added[pack] ||= []).push(id);
  }
  data.support = { ...support, pool };
  report.support = added;
}

/**
 * 内容文件的记录**落在哪个容器**里 —— 只对本仓库的**真实数据布局**与文件名不一致的那一个文件开口子。
 *
 * `units.json` 是唯一一个：「新增一个干员的干员记录」在 `data/` 里**没有顶层 `units.json`**，那条记录住在
 * `data/backups.json` 的 `units[charId]`（`server/sim/simdata.js:541`、`shared/standIn.js:36`、客户端
 * `data.get('backups').units` 都只读这一个位置）。所以 `content: ["units"]` 的 `units.json` 会被并进
 * `data.backups.units` —— 这也正是合同 §1.1 写的那句「落盘：`applyWorkshop` 里写进 `data.backups.units[id]`」。
 *
 * 其它文件一律同名：`chess.json` → `data.chess`，`items.json` → `data.items`，依此类推（不在这里出现）。
 */
const OVERLAY_TARGET_BY_FILE = Object.freeze({ units: ['backups', 'units'] });

/**
 * 把一组记录并进 `out` 上由 `OVERLAY_TARGET_BY_FILE` 指定的那一层。
 *
 * 非嵌套的文件（绝大多数）：就是 `out[file]` 的一份浅复制，写完挂回去。
 * 嵌套的文件（今天的 `units` → `backups.units`）：路径上的每一层各浅复制一次，**只复制这条路径**，
 * 所以 `backups` 的同层兄弟（`diy` / `tokens`）原样留着，`data/*.json` 也一个字节都不动。
 *
 * @param {Record<string, any>} out 合并中的顶层数据
 * @param {Record<string, any>} base 加载出来的官方数据（`overrides` 的「官方那条」从这里取）
 * @param {string} file 内容文件基名
 * @param {Record<string, object>} records 归一化过的记录
 * @param {(id: string, rec: object, prior: Record<string, object>) => 'added'|'overridden'} mergeOne
 *   把一条记录并进 `prior`（调用方负责判定与报错）；返回它是新增还是覆盖。
 * @returns {Record<string, number>} `{ added, overridden }`
 */
function overlayContentFile(out, base, file, records, mergeOne) {
  const path = OVERLAY_TARGET_BY_FILE[file] || [file];
  /** @type {Array<{ owner: Record<string, any>, key: string, value: Record<string, any> }>} */
  const chain = [];
  let cur = out;
  for (const seg of path.slice(0, -1)) {
    const inner = isPlainObj(cur[seg]) ? { ...cur[seg] } : {};
    chain.push({ owner: cur, key: seg, value: inner });
    cur = inner;
  }
  const leaf = path[path.length - 1];
  const prior = isPlainObj(cur[leaf]) ? cur[leaf] : {};
  const merged = { ...prior };
  let added = 0;
  let overridden = 0;
  for (const [id, rec] of Object.entries(records || {})) {
    const outcome = mergeOne(id, rec, prior);
    if (!outcome) continue;
    merged[id] = outcome.record;
    if (outcome.existed) overridden++; else added++;
  }
  cur[leaf] = merged;
  for (let i = chain.length - 1; i >= 0; i--) chain[i].owner[chain[i].key] = chain[i].value;
  return { added, overridden };
}

/** `base` 上这条记录所在的容器（`overrides` 的「官方那条」要按落盘位置取，不是按内容文件名取）。 */
function baseContainerFor(base, file) {
  const path = OVERLAY_TARGET_BY_FILE[file] || [file];
  let cur = isPlainObj(base) ? base : null;
  for (const seg of path) {
    if (!cur || !isPlainObj(cur[seg])) return null;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Apply every pack's content on top of the official data and return a NEW top-level object (the input is never
 * mutated; the caller freezes the result). Official ids are only replaced when the pack declared them in `overrides`;
 * a collision that was not declared is a reported error and the record already in place is kept.
 *
 * The record already in place is not always an OFFICIAL one: packs are merged in `byPackId` order (DESIGN §28.3 — the
 * order is the rule, not the caller's array order), so a later pack claiming an earlier pack's new id collides with
 * that pack. Such an error says which pack holds the id (`definedBy`, and in the text); it used to say "already exists
 * in the official data" for both cases, which sent the author looking for a record that is not in `data/`.
 *
 * @param {Readonly<Record<string, any>>} base the loaded official data (server/data.js)
 * @param {Array<{ id: string, name?: string, overrides?: string[], files: Record<string, Record<string, object>> }>} packs
 * @returns {{ data: Record<string, any>, report: { packs: object[], added: Record<string, string[]>, overridden: Record<string, string[]>, errors: Array<{ pack: string, file: string, id: string, code: string, definedBy?: string, reason: string }> } }}
 */
export function applyWorkshop(base, packs) {
  const out = { ...(isPlainObj(base) ? base : {}) };
  /**
   * 合并报告。类型标注是给 tsc 看的（`--checkJs`）：`added`/`overridden` 用字符串索引，其余分节在下面按需补上
   * （voices / art / bondIcons / … 只在实际有包提供时才出现，见本文件后面那几个分支）。没有标注时 tsc 会把它们
   * 推断成 `{}`，随后每一次 `report.voices[...]` 都报 TS2339（2026-10-16 的 typecheck 就是这么红的）。
   * @type {{ packs: string[], added: Record<string, string[]>, overridden: Record<string, string[]>, errors: any[],
   *   voices?: Record<string, any>, voiceLangs?: Record<string, any>, bondIcons?: Record<string, any>,
   *   itemIcons?: Record<string, any>, art?: Record<string, any>, support?: Record<string, any>,
   *   operators?: Record<string, any>, traitGrants?: Record<string, any>, looks?: Record<string, any>,
   *   supportOff?: Record<string, any> }}
   */
  const report = { packs: [], added: {}, overridden: {}, errors: [] };
  const push = (bag, file, id) => { (bag[file] ||= []).push(id); };
  /** 工坊新增/覆盖的每一条干员记录（供 `chessLookIssues` 事后判断它有没有模型）。 */
  const looked = [];
  /** 同上，怪物记录（`enemies`）：包自带怪物模型这条路本来没有任何启动保护，见 `enemyLookIssues`。 */
  const lookedEnemies = [];

  /** `"<file>:<id>"` → the pack id that put that record into `out` (a pack-vs-pack collision is attributed with it). */
  const contributors = new Map();

  // THE ordering rule (DESIGN §28.3): the smaller pack id wins every collision, so the merge never depends on the
  // order the caller happened to hand the packs over in. Sorting a copy keeps the caller's array untouched.
  for (const pack of (Array.isArray(packs) ? packs : []).filter((p) => p && typeof p === 'object' && p.id).sort(byPackId)) {
    const declared = new Set(Array.isArray(pack.overrides) ? pack.overrides : []);
    const entry = { id: pack.id, name: pack.name || pack.id, files: {} };
    for (const [file, records] of Object.entries(pack.files || {})) {
      // 落盘位置由 `overlayContentFile` 决定（`units` 并进 `data.backups.units`，其余文件就是 `out[file]`）。
      // `priorMap` 是 **官方数据 + 这个包之前已经并进去的每一个包**（变量曾经叫 `official`，把它当成「只有官方」
      // 正是那条把作者引到 `data/` 去找一条其实属于另一个包的记录的错误文案）。
      const { added, overridden } = overlayContentFile(out, base, file, records, (id, rec, priorMap) => {
        const key = `${file}:${id}`;
        const exists = Object.hasOwn(priorMap, id);
        const holder = contributors.get(key);
        // The owner's refinement (2026-10-09, DESIGN §28.3): when another PACK already contributed this record, pack id
        // order decides the winner — the later pack loses even if it declared `"<file>:<id>"` in `overrides`, because a
        // declaration is the authorisation to replace OFFICIAL data, not a licence to overwrite another pack. Two packs
        // adding the same NEW id is the same rule seen from the other side: the id is refused and the holder is named.
        if (holder) {
          report.errors.push({
            pack: pack.id, file, id, code: 'PACK_ID_COLLISION', definedBy: holder,
            reason: `"${id}" is already contributed by pack "${holder}" — the pack with the smaller id keeps it (DESIGN §28.3). Rename this record, or let "${holder}" drop it; an "overrides" entry does not win against another pack`,
          });
          return null;
        }
        if (exists && !declared.has(key)) {
          report.errors.push({
            pack: pack.id, file, id, code: 'OFFICIAL_ID_COLLISION', definedBy: 'official',
            reason: `"${id}" already exists in the official data — add "${file}:${id}" to pack.json overrides to replace it`,
          });
          return null;
        }
        // A declared override is a FIELD-LEVEL patch, not a replacement (DESIGN §28.3): writing one number must keep
        // every other field of the record it overrides. And it may only speak about fields that exist ("closed world").
        if (exists) {
          const official = baseContainerFor(base, file)?.[id] ?? priorMap[id];
          const unknown = unknownOverrideKeys(official, rec);
          if (unknown && unknown.length) {
            report.errors.push({
              pack: pack.id, file, id, code: 'UNKNOWN_OVERRIDE_FIELD', definedBy: 'official',
              reason: `the override of "${id}" names ${unknown.map((k) => `"${k}"`).join(', ')}, which the record does not have — an override may only change fields that exist (add the record under a new id to invent one)`,
            });
            return null;
          }
        }
        contributors.set(key, pack.id);
        if (file === 'chess') looked.push({ pack: pack.id, id, rec });
        if (file === 'enemies') lookedEnemies.push({ pack: pack.id, id, rec });
        if (exists) push(report.overridden, file, id); else push(report.added, file, id);
        let record = exists ? mergeRecord(priorMap[id], rec) : { ...rec, packId: pack.id };
        if (exists && file === 'bonds' && priorMap[id]) {
          // 工坊 Mod 经常只声明自己新增的干员（如 members: [若麦]），而非全量覆盖；
          // 此时对 members 与 visibleMembers 取并集，保留官方原有名册干员
          if (Array.isArray(priorMap[id].members) && Array.isArray(rec.members)) {
            record.members = Array.from(new Set([...priorMap[id].members, ...rec.members]));
          }
          if (Array.isArray(priorMap[id].visibleMembers) && Array.isArray(rec.visibleMembers)) {
            record.visibleMembers = Array.from(new Set([...priorMap[id].visibleMembers, ...rec.visibleMembers]));
          }
        }
        if (!exists && !record.packId) record.packId = pack.id;
        return { record, existed: exists };
      });
      entry.files[file] = { added, overridden };
    }
    report.packs.push(entry);
  }
  linkWorkshopStages(out, report);
  mergeWorkshopVoices(out, packs, report);
  mergeWorkshopBondIcons(out, packs, report);
  mergeWorkshopItemIcons(out, packs, report);
  // 必须在 chessLookIssues 之前：那条检查读的是**合并后**的 assets.chars，包自带模型到位之后
  // 「这个干员没有模型（会画成贴纸）」的警告就该消失（反过来放在后面，日志会一直报一条已经解决的问题）。
  mergeWorkshopArt(out, packs, report);
  // 扁平的那两张图标表（`assets.skills` / `assets.prof.sub`）—— 与上一条同一个理由放在 looks 之前，
  // 而且必须在 mergeWorkshopOperators 之前：干员进池时读的 `units` 记录已经由内容文件那一层并好了，
  // 但它的**分支图标**要靠这一条（`prof.sub[subProfessionId]`），顺序反了自选界面就是一个没有分支图的格子。
  mergeWorkshopFlatArt(out, packs, report);
  // 时装（`pack.json.skins` → `assets.skins`）：与 art 同一条「并进既有清单、路径变绝对 URL」的路，
  // 所以客户端零改动就能 `ctx.data.get('assets').skins[charId]` 读到它（皮肤 mod 的 list/lookup 全靠这一张表）。
  mergeWorkshopSkins(out, packs, report);
  // 形态（clip set）通道（`pack.json.forms` → `assets.modForms`）：与 art / skins 同一条「并进既有清单」的路，
  // 所以客户端零改动就能 `data.get('assets').modForms` 读到它，`shared/packForms.js` 的 `formsFor` 把它折进
  // 第一方 `FORMS`（第一方优先，§28.29）。包与包撞同名形态在**这里**点名（照跑 `artClaims` / `SKIN_COLLISION`
  // 的既有规矩），因为「谁赢取决于加载次序」是这个仓库一直在拒绝的东西。
  mergeWorkshopForms(out, packs, report);
  // 静态相位（`pack.json.fx.silentPhases` → `assets.silentPhases`）：落点是同一张清单，但它不是素材，
  // 而是 `fx/kinds.js` 那个 `SILENT_PHASES` Set 的成员集合 —— 去重 / 排序，声明次序不影响结果。
  mergeWorkshopFx(out, packs, report);
  mergeWorkshopSupport(out, packs, report);
  // 自选池（`diy.ownedPool` / `diy.operators`）：读 `data.backups.units` 里那条已经合并好的记录，
  // 所以必须排在内容文件那一层之后 —— 它在这个函数里是最末一批，天然满足。
  mergeWorkshopOperators(out, packs, report);
  // 试玩开关（`pack.json.playtest`）不并进任何数据文件 —— 它是**行为层**的声明，引擎只在试玩服务器里读它
  // （`SP_PLAYTEST=1`）。但两个包撞同一个 id 这件事必须与其它面一样被点名报告，否则输的一方会在
  // 「我明明勾了」和「试玩里没有」之间反复，而日志一句话都不说。
  for (const e of workshopPlaytestIndex(packs).errors) report.errors.push({ pack: e.pack, file: 'playtest', id: e.id, code: e.code, definedBy: e.definedBy, reason: e.reason });
  report.looks = [...chessLookIssues(out, looked), ...enemyLookIssues(out, lookedEnemies)];
  // 特质授予的盟约（`trait.grantsBonds`，DESIGN §28.49）：与 `looks` 并列的一条**只读**点名通道（它查的不是外观，
  // `workshopSummary` 也分开数）。必须排在内容文件那一层之后 —— 它要读**合并后**的 `out.chess` 与 `out.bonds`
  // （盟约可能是另一个包加进来的）。**不改数据、不拒包**：坏 id 由读取点的 `hasBond` 挡在计数之外。
  report.traitGrants = traitGrantWarnings(out, looked);
  // `stripPackOperators`（fanpack G-16）：**只记录，不摘除**。一个被包变成棋子的干员同时还在自选池里这件事，
  // 以前没有任何地方说出来；而「真的把他摘出池」会改变自选槽能挑到的干员（= 改对局结果），
  // 与「`test/golden/*.json` 一个字节不动」的验收不能同时成立 —— 所以它是一条**待裁决**的记录，
  // 不是一次静默的行为差异（理由与实测数字见 `stripPackOperators` 的注释）。
  // 摘除是**开关**（`{ apply: true }`），这条默认路径不摘：`applied` 与 `stripped` 照实带出来，好让报告说清
  // 「如果摘会是哪些」与「这一次到底改没改」。默认路径下 `applied` 恒为 false。
  {
    const pool = stripPackOperators(packs, out);
    report.overlaps = pool.overlaps;
    report.strippedPool = pool.stripped;
    report.poolStripped = pool.applied;
  }
  for (const list of Object.values(report.added)) list.sort();
  for (const list of Object.values(report.overridden)) list.sort();
  return { data: out, report };
}

/**
 * `trait.grantsBonds` 写歪了的地方 —— 一条 chess 记录的「特质授予哪些盟约」（DESIGN §28.49）。
 *
 * **为什么单独一趟、为什么只读**：`unknownOverrideKeys` 只比**顶层**键（`Object.keys`），所以往 `trait` 里加子键
 * **天然通得过装载器** —— 一个拼错的盟约 id、或一个写歪的形状，会安安静静地变成「这条特质什么都不授予」。
 * 业主吃过这一类亏（docs/WORKSHOP.md §1.1：`content` 没声明 `chess` ⇒ 编辑器里在、磁盘里在、**永远进不了游戏、
 * 没有任何报错**）。所以这里**逐条点名**；但**不拒包、不改记录**（一条 typo 不该让整包装不上，与 `assets.mirrors`
 * 那条「停用并点名，不拒包」同一条），坏 id 由读取点的 `hasBond` 挡在计数之外。
 *
 * 判据本体在 `shared/morph.js` 的 `traitGrantIssues`；作者侧的同一个函数在 `shared/chessAuthoring.js` 里被
 * `validateChessRecord` 调用（`npm run workshop:validate` 与编辑器）。没有盟约表就不判存在性。
 * @param {Readonly<Record<string, any>>} data 合并后的数据
 * @param {Array<{ pack: string, id: string }>} looked 工坊贡献的干员记录
 * @returns {Array<{ pack: string, id: string, code: string, field: string, value: any, reason: string }>}
 */
function traitGrantWarnings(data, looked) {
  const chess = isPlainObj(data) && isPlainObj(data.chess) ? data.chess : null;
  const bonds = isPlainObj(data) && isPlainObj(data.bonds) ? data.bonds : null;
  if (!chess || !bonds) return [];
  const bondIds = new Set(Object.keys(bonds));
  const out = [];
  for (const { pack, id } of looked) {
    const rec = chess[id];
    for (const issue of traitGrantIssues(isPlainObj(rec) ? rec.trait : null, { bondIds })) {
      out.push({ pack, id, code: issue.code, field: issue.field, value: issue.value, reason: `${id}: ${issue.message}` });
    }
  }
  return out;
}

/**
 * 工坊干员的**外观能不能真的渲染成模型**：`assets.spine`（或 `charId`）必须是本机素材清单 `assets.chars` 里的键。
 *
 * 为什么单独查这一条：查不到时游戏**不会报错** —— `assets.spineEntry()` 返回 null，单位就画成一张头像菱形贴图，
 * 于是作者只会觉得「模型没加载出来」。这个仓库不携带干员美术，但**包可以自带**（`pack.json.art.chars` 里的
 * `spine`，0.8.0 起）：所以这条检查读的是**合并后**的 `assets.chars` —— 包把自己的模型接上去之后，警告自然消失
 * （applyWorkshop 里必须在写 `report.looks` 之前先合并 art，否则日志会一直报一条已经解决的问题）。
 * 没带模型时，「复用已装好的 spine id」仍是唯一的路；手写包与编辑器写出来的包在这一层同样能被发现。
 *
 * 只查干员、不查怪物：怪物那条在 `enemyLookIssues`（同一个 `report.looks`，条目上带 `kind: 'enemy'`）。
 *
 * 没有清单（素材流程没跑）时不判断：宁可不说，也不要乱说。
 *
 * @param {Readonly<Record<string, any>>} data 合并后的数据
 * @param {Array<{ pack: string, id: string, rec: object }>} looked 工坊贡献的干员记录
 * @returns {Array<{ pack: string, id: string, spine: string|null, code: string, reason: string }>}
 */
function chessLookIssues(data, looked) {
  const chars = isPlainObj(data.assets) && isPlainObj(data.assets.chars) ? data.assets.chars : null;
  if (!chars || !Object.keys(chars).length) return [];
  const out = [];
  for (const { pack, id, rec } of looked) {
    const spine = isPlainObj(rec) && isPlainObj(rec.assets) && typeof rec.assets.spine === 'string' ? rec.assets.spine
      : (isPlainObj(rec) && typeof rec.charId === 'string' ? rec.charId : null);
    if (spine && Object.hasOwn(chars, spine)) continue;
    out.push({
      pack, id, spine, code: spine ? 'MODEL_UNKNOWN' : 'MODEL_MISSING',
      reason: spine
        ? `${id}: assets.spine "${spine}" is not in this install's model list (data/assets.json chars) — it renders as a flat portrait, not a model`
        : `${id}: no assets.spine — it renders as a flat portrait, not a model. Reuse an installed spine id (an existing operator's) instead`,
    });
  }
  return out;
}

/**
 * 包自带的**怪物**模型有没有着落 —— `chessLookIssues` 的怪物版（同一条 `report.looks`，条目带 `kind: 'enemy'`）。
 *
 * 为什么要有它：干员那条检查只由 `chess` 记录填（`looked`），而怪物走 `enemies.json` —— 包新增的怪物如果把 `spine`
 * 写成一个本机没有的模型 id，客户端**同样一条日志都不打**：`assets.spineEntry()` 返回 null，那只怪物画成一张图标
 * 贴图。判定链与客户端逐字一致（`server/sim/simdata.js` 取 `rec.spine ?? key`；`public/js/assets.js spineEntry` 读
 * `enemies[key].spine`，条目里的 `spineAliasOf` 指向另一个模型），所以别名链要跟着走（官方有 8 个敌人是这样）。
 *
 * `assets.json` 里没有 `enemies` 表（没跑过素材管线）时不判断：宁可不说，也不要乱说。
 * @param {Readonly<Record<string, any>>} data 合并后的数据
 * @param {Array<{ pack: string, id: string, rec: object }>} looked 工坊贡献的怪物记录
 * @returns {Array<{ pack: string, id: string, spine: string, kind: string, code: string, reason: string }>}
 */
function enemyLookIssues(data, looked) {
  if (!looked.length) return [];
  const enemies = isPlainObj(data.assets) && isPlainObj(data.assets.enemies) ? data.assets.enemies : null;
  if (!enemies || !Object.keys(enemies).length) return [];
  const out = [];
  for (const { pack, id, rec } of looked) {
    const want = isPlainObj(rec) && typeof rec.spine === 'string' && rec.spine ? rec.spine : id;
    let cur = want;
    let ok = false;
    // 跟着 spineAliasOf 走：别名链是有向的、官方数据里不会成环，但这里仍然限深，坏数据不能把启动卡住
    for (let hop = 0; hop < 8 && cur; hop++) {
      const entry = enemies[cur];
      if (!isPlainObj(entry)) break;
      if (isPlainObj(entry.spine)) { ok = true; break; }
      cur = typeof entry.spineAliasOf === 'string' && entry.spineAliasOf ? entry.spineAliasOf : '';
    }
    if (ok) continue;
    const known = Object.hasOwn(enemies, want);
    out.push({
      pack, id, spine: want, kind: 'enemy', code: known ? 'MODEL_MISSING' : 'MODEL_UNKNOWN',
      reason: known
        ? `${id}: assets.enemies "${want}" carries no model of its own (no spine, and no spineAliasOf to borrow one) — it renders as a flat icon, not a model`
        : `${id}: assets.spine "${want}" is not in this install's model list (data/assets.json enemies) — it renders as a flat icon, not a model`,
    });
  }
  return out;
}

/**
 * Publish every pack's voice lines to the client by extending `assets.audio.voice` — the manifest the client looks an
 * operator's line up in (public/js/audio.js `voice()`), which the HTTP layer then serves merged
 * (server/index.js `buildWorkshopDataFiles` + `workshopTouchedFiles`).
 *
 * APPEND, never replace: a pack that adds lines to an operator the official data already has keeps both, and
 * `pickVoiceLine` picks among them. The DEFAULT dub's lines go into `audio.voice`; a pack's other dubs
 * (`pack.json.voiceLangs`, v0.7.3) go into `audio.voiceLangs[lang]` — the same two tables the player's 配音语言
 * setting chooses between (public/js/audio.js voiceLinesFor), so a pack line is heard exactly when the player picks
 * that dub, and a dub no pack touches is left byte-identical. Mutates `data` (a fresh copy) and records the counts in
 * `report.voices` / `report.voiceLangs`.
 *
 * An install without `data/assets.json` (the asset pipeline was never run) has no audio at all, so there is nowhere to
 * publish to: that is reported rather than silently dropped.
 */

/** Append every line of ONE index into a `<charId> → <slot> → [url]>` table; the input table is not mutated. */
function appendVoiceLines(table, index) {
  const out = { ...table };
  for (const [charId, slots] of Object.entries(index)) {
    const lines = isPlainObj(out[charId]) ? { ...out[charId] } : {};
    for (const [slot, urls] of Object.entries(slots)) {
      // The official manifest writes a slot with ONE line as a bare string and several as an array (0.2.0's
      // tools/assets/audio.mjs); the client accepts both. Normalize before appending, or a pack line would silently
      // REPLACE that single official line instead of joining it.
      const cur = lines[slot];
      const official = Array.isArray(cur) ? cur : (typeof cur === 'string' && cur ? [cur] : []);
      lines[slot] = [...new Set([...official, ...urls])];
    }
    out[charId] = lines;
  }
  return out;
}

/** Files one `<charId> → <slot> → [paths]>` table declares (the boot log counts, not a validation). */
function countVoiceLines(table) {
  let n = 0;
  if (!isPlainObj(table)) return 0;
  for (const slots of Object.values(table)) {
    if (!isPlainObj(slots)) continue;
    for (const files of Object.values(slots)) if (Array.isArray(files)) n += files.length;
  }
  return n;
}

/** Does this pack declare voice lines at all — in either table? */
const packDeclaresVoices = (pack) =>
  (isPlainObj(pack?.voices) && Object.keys(pack.voices).length > 0)
  || (isPlainObj(pack?.voiceLangs) && Object.keys(pack.voiceLangs).length > 0);

function mergeWorkshopVoices(data, packs, report) {
  const index = workshopVoiceIndex(packs);
  const langIndex = workshopVoiceLangIndex(packs);
  const langs = Object.keys(langIndex);
  if (!Object.keys(index).length && !langs.length) return;
  const assets = isPlainObj(data.assets) ? data.assets : null;
  if (!assets) {
    for (const pack of Array.isArray(packs) ? packs : []) {
      if (!packDeclaresVoices(pack)) continue;
      report.errors.push({
        pack: pack.id, file: 'assets', id: 'audio.voice', code: 'MANIFEST_MISSING',
        reason: 'this pack declares voice lines, but data/assets.json is missing — run `npm run assets` so the client has an audio manifest to extend',
      });
    }
    return;
  }
  const audio = isPlainObj(assets.audio) ? { ...assets.audio } : {};
  const voice = appendVoiceLines(isPlainObj(audio.voice) ? audio.voice : {}, index);
  /** @type {Record<string, number>} */
  const counts = {};
  // 按包 id 排序后再数：这两个 map 会随合并后的 manifest 一起发给客户端，键序不能随加载顺序变（DESIGN §28.3）
  for (const pack of (Array.isArray(packs) ? packs : []).slice().sort(byPackId)) {
    const n = countVoiceLines(pack?.voices);
    if (n) counts[pack.id] = n;
  }
  // `undefined` while no pack declares another dub: a manifest that had no `voiceLangs` must not gain an empty one.
  /** @type {Record<string, Record<string, Record<string, string[]>>>|undefined} */
  let voiceLangs;
  /** @type {Record<string, Record<string, number>>|undefined} */
  let langCounts;
  if (langs.length) {
    const base = isPlainObj(audio.voiceLangs) ? audio.voiceLangs : {};
    voiceLangs = { ...base };
    for (const [lang, idx] of Object.entries(langIndex)) {
      voiceLangs[lang] = appendVoiceLines(isPlainObj(base[lang]) ? base[lang] : {}, idx);
      for (const pack of (Array.isArray(packs) ? packs : []).slice().sort(byPackId)) {
        const n = countVoiceLines(isPlainObj(pack?.voiceLangs) && isPlainObj(pack.voiceLangs[lang]) ? pack.voiceLangs[lang] : null);
        if (n) ((langCounts ||= {})[pack.id] ||= {})[lang] = n;
      }
    }
  }
  data.assets = { ...assets, audio: { ...audio, voice, ...(voiceLangs ? { voiceLangs } : {}) } };
  report.voices = counts;
  if (langCounts) report.voiceLangs = langCounts;
}

/**
 * 包自带盟约图标的 URL 表：`{ <bondId>: '/workshop-assets/<pack>/<path>' }`。
 * 与 `workshopVoiceIndex` 同一套：URL 指向 /workshop-assets 那条唯一的包素材路由，客户端不需要任何新通道。
 * 同一个 bondId 被两个包声明时**第一个赢**，并记一条错误 —— 两个包抢同一个盟约的图标是作者要自己解决的事，
 * 静默让后加载的那个覆盖掉，会变成「换个包顺序图标就变了」这种没人能查的问题。
 * @param {Array<object>} packs @param {{ prefix?: string }} [opts]
 */
export function workshopBondIconIndex(packs, { prefix = WORKSHOP_MEDIA_PREFIX } = {}) {
  /** @type {Record<string, string>} */
  const out = {};
  // 按包 id 排序再处理（与 workshopVoiceIndex 同一条规则）：谁赢只取决于包 id，不取决于加载顺序。
  for (const pack of [...(Array.isArray(packs) ? packs : [])].sort(byPackId)) {
    const icons = isPlainObj(pack?.bondIcons) ? pack.bondIcons : null;
    if (!icons) continue;
    for (const [bondId, file] of Object.entries(icons)) {
      if (Object.hasOwn(out, bondId)) continue;
      // 逐段百分号编码：文件名里的 `#` / 空格 / 中文在 URL 里必须编码，否则 `#` 会把 URL 从此截断
      const path = String(file).split('/').map(encodeURIComponent).join('/');
      out[bondId] = `${prefix}${pack.id}/${path}`;
    }
  }
  return out;
}

/**
 * Publish every pack's 盟约图标 by extending `assets.bonds` — the map the client resolves a bond's icon in
 * (`public/js/assets.js bondIconUrl`), served merged like every other workshop overlay.
 *
 * REPLACE for a bond the official data already has (that is how a pack gives its **override** of an official bond a
 * custom icon), APPEND for a new one. Mutates `data` (a fresh copy) and records the ids in `report.bondIcons`.
 */
function mergeWorkshopBondIcons(data, packs, report) {
  const index = workshopBondIconIndex(packs);
  const ids = Object.keys(index);
  if (!ids.length) return;
  const list = [...(Array.isArray(packs) ? packs : [])].sort(byPackId);
  // 谁跟谁抢了同一个 id：按包 id 排序后第一个赢，后面的写进 report.errors（不阻断，但作者必须知道）
  const claimed = new Map();
  for (const pack of list) {
    for (const bondId of Object.keys(isPlainObj(pack?.bondIcons) ? pack.bondIcons : {})) {
      if (claimed.has(bondId)) {
        report.errors.push({
          pack: pack.id, file: 'assets', id: `bonds.${bondId}`, code: 'ASSET_COLLISION',
          definedBy: claimed.get(bondId),
          reason: `another pack (${claimed.get(bondId)}) already ships an icon for this bond; keep only one`,
        });
      } else claimed.set(bondId, pack.id);
    }
  }
  const assets = isPlainObj(data.assets) ? data.assets : null;
  if (!assets) {
    for (const pack of list) {
      if (!isPlainObj(pack?.bondIcons) || !Object.keys(pack.bondIcons).length) continue;
      report.errors.push({
        pack: pack.id, file: 'assets', id: 'bonds', code: 'MANIFEST_MISSING',
        reason: 'this pack ships a bond icon, but data/assets.json is missing — run `npm run assets` so the client has a manifest to extend',
      });
    }
    return;
  }
  const bonds = isPlainObj(assets.bonds) ? { ...assets.bonds } : {};
  for (const id of ids) bonds[id] = index[id];
  data.assets = { ...assets, bonds };
  /** @type {Record<string, string[]>} */
  const counts = {};
  for (const [bondId, packId] of claimed) (counts[packId] ??= []).push(bondId);
  for (const list of Object.values(counts)) list.sort();
  report.bondIcons = counts;
}

/**
 * 包自带装备图标的 URL 表：`{ <iconId>: '/workshop-assets/<pack>/<path>' }`。
 * 与 `workshopBondIconIndex` / `workshopVoiceIndex` 同一套：URL 指向 /workshop-assets 那条唯一的包素材路由，
 * 客户端不需要任何新通道 —— public/js/assets.js itemIconUrl 本来就在读 `assets.items`。
 * 同一个 id 被两个包声明时**第一个赢**，并记一条错误（理由与盟约图标相同：静默让后加载的那个覆盖掉，会变成
 * 「换个包顺序图标就变了」这种没人能查的问题）。
 * @param {Array<object>} packs @param {{ prefix?: string }} [opts]
 */
export function workshopItemIconIndex(packs, { prefix = WORKSHOP_MEDIA_PREFIX } = {}) {
  /** @type {Record<string, string>} */
  const out = {};
  // 按包 id 排序再处理（与 workshopBondIconIndex 同一条规则）：谁赢只取决于包 id，不取决于加载顺序。
  for (const pack of [...(Array.isArray(packs) ? packs : [])].sort(byPackId)) {
    const icons = isPlainObj(pack?.itemIcons) ? pack.itemIcons : null;
    if (!icons) continue;
    for (const [itemId, file] of Object.entries(icons)) {
      if (Object.hasOwn(out, itemId)) continue;
      // 逐段百分号编码：文件名里的 `#` / 空格 / 中文在 URL 里必须编码，否则 `#` 会把 URL 从此截断
      const path = String(file).split('/').map(encodeURIComponent).join('/');
      out[itemId] = `${prefix}${pack.id}/${path}`;
    }
  }
  return out;
}

/**
 * Publish every pack's 装备图标 by extending `assets.items` — the map the client resolves an item icon in
 * (`public/js/assets.js itemIconUrl`, which reads `item.iconId` / `item.trapId` and then looks the id up in it),
 * served merged like every other workshop overlay. **No client change**: that lookup already existed.
 *
 * REPLACE for an id the official data already has (that is how a pack gives an official equip a picture of its own),
 * APPEND for a new one. Mutates `data` (a fresh copy) and records the ids in `report.itemIcons`.
 *
 * `assets.items` that does NOT exist is left alone (the same rule as `voiceLangs`): the pack's icons are reported
 * instead, because a manifest the asset pipeline never produced is not something this overlay should invent.
 */
function mergeWorkshopItemIcons(data, packs, report) {
  const index = workshopItemIconIndex(packs);
  const ids = Object.keys(index);
  if (!ids.length) return;
  const list = [...(Array.isArray(packs) ? packs : [])].sort(byPackId);
  // 谁跟谁抢了同一个 id：按包 id 排序后第一个赢，后面的写进 report.errors（不阻断，但作者必须知道）
  const claimed = new Map();
  for (const pack of list) {
    for (const itemId of Object.keys(isPlainObj(pack?.itemIcons) ? pack.itemIcons : {})) {
      if (claimed.has(itemId)) {
        report.errors.push({
          pack: pack.id, file: 'assets', id: `items.${itemId}`, code: 'ASSET_COLLISION',
          definedBy: claimed.get(itemId),
          reason: `another pack (${claimed.get(itemId)}) already ships an icon for this item; keep only one`,
        });
      } else claimed.set(itemId, pack.id);
    }
  }
  const assets = isPlainObj(data.assets) ? data.assets : null;
  if (!assets || !isPlainObj(assets.items)) {
    for (const pack of list) {
      if (!isPlainObj(pack?.itemIcons) || !Object.keys(pack.itemIcons).length) continue;
      report.errors.push({
        pack: pack.id, file: 'assets', id: 'items', code: 'MANIFEST_MISSING',
        reason: 'this pack ships an item icon, but data/assets.json has no "items" map — run `npm run assets` so the client has an icon table to extend',
      });
    }
    return;
  }
  const items = { ...assets.items };
  for (const id of ids) items[id] = index[id];
  data.assets = { ...assets, items };
  /** @type {Record<string, string[]>} */
  const counts = {};
  for (const [itemId, packId] of claimed) (counts[packId] ??= []).push(itemId);
  for (const list of Object.values(counts)) list.sort();
  report.itemIcons = counts;
}

/**
 * 把包自带的外观素材变成合并后清单里的那几条：`{ <表>: { <id>: <条目，路径已换成 /workshop-assets 的绝对 URL> } }`。
 *
 * 与 `workshopVoiceIndex` / `workshopBondIconIndex` 同一套：URL 指向 /workshop-assets 那条唯一的包素材路由，客户端
 * 不需要任何新通道（`public/js/assets.js validSpine` 只要求 skel 是 `/` 开头的路径，包素材 URL 天然满足）。
 * 同一个 `<表>.<id>` 被两个包声明时**第一个赢**（按包 id 排序），后一个包在启动日志里得到一条错误。
 * @param {Array<object>} packs @param {{ prefix?: string }} [opts]
 */
export function workshopArtIndex(packs, { prefix = WORKSHOP_MEDIA_PREFIX } = {}) {
  /** @type {Record<string, Record<string, object>>} */
  const out = {};
  const toUrl = (packId, p) => `${prefix}${packId}/${String(p).split('/').map(encodeURIComponent).join('/')}`;
  // 按包 id 排序再处理：谁赢只取决于包 id，不取决于加载顺序（与既有的三条素材通道同一条规则）
  for (const pack of [...(Array.isArray(packs) ? packs : [])].sort(byPackId)) {
    const art = isPlainObj(pack?.art) ? pack.art : null;
    if (!art) continue;
    for (const [table, entries] of Object.entries(art)) {
      const shape = ART_TABLES[table];
      if (!shape || !isPlainObj(entries)) continue;
      const bucket = (out[table] ||= {});
      for (const [id, entry] of Object.entries(entries)) {
        if (Object.hasOwn(bucket, id)) continue;
        if (shape.flat) {
          // 扁平表：条目本身就是路径，转成 URL 就是终点（没有字段可映射）；校验阶段已经确认它是安全相对路径
          if (typeof entry === 'string' && entry) bucket[id] = toUrl(pack.id, entry);
          continue;
        }
        if (!isPlainObj(entry)) continue;
        bucket[id] = artEntryUrls(entry, shape, (p) => toUrl(pack.id, p));
      }
    }
  }
  return out;
}

/** 一个条目里路径字段换成 URL 之后的副本；`spine` 按表嵌套（chars 的 front/back）或扁平（enemies/tokens）。 */
function artEntryUrls(entry, shape, toUrl) {
  const out = {};
  for (const [key, value] of Object.entries(entry)) {
    if (shape.urls.includes(key)) out[key] = toUrl(value);
    else if (shape.strings.includes(key)) out[key] = value;
    else if (key === 'spine' && isPlainObj(value)) {
      out.spine = shape.spine === 'flat'
        ? spineUrls(value, toUrl)
        : Object.fromEntries(Object.entries(value).map(([side, s]) => [side, spineUrls(s, toUrl)]));
    }
  }
  return out;
}

/** 一个 spine 对象里的路径字段换成 URL，其余（`anims`/`events`/`pma`…）原样抄。 */
function spineUrls(spine, toUrl) {
  const out = {};
  for (const [key, value] of Object.entries(spine)) {
    if (ART_SPINE_URLS.includes(key)) out[key] = toUrl(value);
    else if (ART_SPINE_LISTS.includes(key)) out[key] = value.map(toUrl);
    else out[key] = value;
  }
  return out;
}

/**
 * 把包自带的外观并进 `assets.chars` / `assets.enemies` / `assets.tokens` —— 客户端画单位与头像时读的那三张表。
 *
 * **字段级合并**，不是整条替换：包只给头像时官方模型照旧；包给 `spine.front` 的 `skel`/`atlas` 时，官方那一侧的
 * `anims`/`events` 等字段留着（整侧替换会让一个官方模型变成「能出来但不动」，而且一条日志都没有）。官方没有这个
 * id 时就是新增。`assets.json` 本身不存在（没跑过素材管线）时报告出来，不凭空造一份。
 */
function mergeWorkshopArt(data, packs, report) {
  const index = workshopArtIndex(packs);
  // 扁平表（skills / profSub）不住在 `assets.<表>` 下，它们的家是 `assets.skills` / `assets.prof.sub`，所以拿掉
  const tables = Object.keys(index).filter((t) => !ART_TABLES[t]?.flat);
  if (!tables.length) return;
  const list = [...(Array.isArray(packs) ? packs : [])].sort(byPackId);
  // 谁跟谁抢了同一个 <表>.<id>：按包 id 排序后第一个赢，后面的写进 report.errors
  const claimed = artClaims(list, (t) => !ART_TABLES[t]?.flat, report);
  const assets = isPlainObj(data.assets) ? data.assets : null;
  if (!assets) {
    for (const pack of list) {
      if (!isPlainObj(pack?.art) || !Object.keys(pack.art).filter((t) => !ART_TABLES[t]?.flat).length) continue;
      report.errors.push({
        pack: pack.id, file: 'assets', id: 'art', code: 'MANIFEST_MISSING',
        reason: 'this pack ships art (avatars / portraits / spine models), but data/assets.json is missing — run `npm run assets` so the client has a manifest to extend',
      });
    }
    return;
  }
  const next = { ...assets };
  for (const table of tables) {
    const entries = isPlainObj(next[table]) ? { ...next[table] } : {};
    for (const [id, patch] of Object.entries(index[table])) {
      entries[id] = mergeArtEntry(isPlainObj(entries[id]) ? entries[id] : {}, patch);
    }
    next[table] = entries;
  }
  data.assets = next;
  report.art = artClaimCounts(claimed, (t) => !ART_TABLES[t]?.flat);
}

/**
 * 时装（`pack.json.skins`）并进 `assets.skins`（皮肤层设计稿 §3）。
 *
 * 形状：`assets.skins[<charId>] = [{ pack, id, name, series?, desc?, art?, voices? }, …]` —— **按干员分组的一列**，
 * 不是一个扁平的表。理由：客户端要问的问题永远是「这个干员有哪几套」，按 charId 分好组，那个问题的答案就是
 * `skins[charId]` 本身（面板的 `list(charId)` 直接读它）；反过来（一张扁平表 + 每次过滤）会让每个消费点各写一遍
 * 过滤，而那些过滤迟早会漂。
 *
 * 三条与既有素材通道**逐字相同**的规则：
 *   * 路径转成 `/workshop-assets/<包>/<路径>` 的绝对 URL（客户端零改动，走的还是那条只服务登记 URL 的路由）；
 *   * 两个包给**同一个干员的同一套 id** 时，按包 id 升序**第一个赢**，输的一方点名 `SKIN_COLLISION`
 *     （`definedBy` = 占住的那一方）—— 谁赢不能取决于加载次序；
 *   * `assets`（清单）不在时点名报告，而不是静默丢掉（与 art 的 `MANIFEST_MISSING` 同一条）。
 *
 * **不同干员、或同一干员的不同 id，互不冲突**：时装天然是并列的（一个人可以有好几套），
 * 这与 art 的「一个 id 一条记录」不同，也是它必须单独一个函数而不是复用 `mergeWorkshopArt` 的原因。
 */
function mergeWorkshopSkins(data, packs, report) {
  const list = [...(Array.isArray(packs) ? packs : [])].sort(byPackId);
  const withSkins = list.filter((p) => Array.isArray(p?.skins) && p.skins.length);
  if (!withSkins.length) return;
  const assets = isPlainObj(data.assets) ? data.assets : null;
  if (!assets) {
    for (const pack of withSkins) {
      report.errors.push({
        pack: pack.id, file: 'assets', id: 'skins', code: 'MANIFEST_MISSING',
        reason: 'this pack declares 时装 (skins), but data/assets.json is missing — run `npm run assets` so the client has a manifest to extend',
      });
    }
    return;
  }
  const toUrl = (packId, p) => `${WORKSHOP_MEDIA_PREFIX}${packId}/${String(p).split('/').map(encodeURIComponent).join('/')}`;
  /** @type {Record<string, object[]>} */
  const byChar = {};
  /** @type {Record<string, number>} 包 id → 真的并进 `assets.skins` 的套数（日志那一份，见函数尾）。 */
  const entriesByPack = {};
  /** @type {Map<string, string>} `"<charId>|<skinId>"` → 占住它的包 id */
  const claimed = new Map();
  for (const pack of withSkins) {
    for (const skin of pack.skins) {
      const key = `${skin.charId}|${skin.id}`;
      const holder = claimed.get(key);
      if (holder) {
        report.errors.push({
          pack: pack.id, file: 'skins', id: key, code: 'SKIN_COLLISION', definedBy: holder,
          reason: `another pack (${holder}) already ships the outfit "${skin.id}" for "${skin.charId}"; keep only one`,
        });
        continue;
      }
      claimed.set(key, pack.id);
      entriesByPack[pack.id] = (entriesByPack[pack.id] || 0) + 1;
      // 外观那一半与 art 同一条转换（字段级、spine 再往下一层）：复用 `artEntryUrls`，判据只有一份
      const art = isPlainObj(skin.art) ? artEntryUrls(skin.art, ART_TABLES.chars, (p) => toUrl(pack.id, p)) : null;
      const voices = isPlainObj(skin.voices)
        ? Object.fromEntries(Object.entries(skin.voices).map(([slot, paths]) => [slot, paths.map((p) => toUrl(pack.id, p))]))
        : null;
      (byChar[skin.charId] ||= []).push({
        pack: pack.id, id: skin.id, name: skin.name,
        ...(skin.series !== undefined ? { series: skin.series } : {}),
        ...(skin.desc !== undefined ? { desc: skin.desc } : {}),
        ...(art && Object.keys(art).length ? { art } : {}),
        ...(voices ? { voices } : {}),
      });
    }
  }
  if (!Object.keys(byChar).length) return;
  // 同一个干员的那一列按 `(包 id, 时装 id)` 排序：**列表次序不该取决于加载次序**（面板直接按它画）
  for (const arr of Object.values(byChar)) {
    arr.sort((a, b) => (a.pack < b.pack ? -1 : a.pack > b.pack ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const prevSkins = isPlainObj(assets.skins) ? assets.skins : {};
  const next = { ...prevSkins };
  for (const [charId, arr] of Object.entries(byChar)) next[charId] = [...(Array.isArray(prevSkins[charId]) ? prevSkins[charId] : []), ...arr];
  data.assets = { ...assets, skins: next };
  report.skins = Object.fromEntries(Object.entries(byChar).map(([charId, arr]) => [charId, arr.length]));
  // 启动日志那一份（`workshopSummary`）：按**包**数，而不是按干员。`report.skins` 的键是 charId（消费点按
  // 干员问「有哪几套」），而日志说的是「这个包带来了几套」—— 两个问题，所以两张表，都从同一趟循环里出来。
  // 数的是**真的进了 `assets.skins` 的那些**：被 `SKIN_COLLISION` 拒掉的与「清单不在」的都没进，也就不该出现在
  // 这一行里（否则日志会替一个什么都没生效的包邀功）。
  report.skinsByPack = Object.fromEntries(Object.entries(entriesByPack).filter(([, n]) => n));
}

/**
 * 把包声明的**形态（clip set）**并进 `assets.modForms`（`pack.json.forms`，DESIGN §28.29）。
 *
 * 为什么落在 `assets.json`：形态是 spine 模型的伴生语义，而包的模型本来就并进这一张清单
 * （`mergeWorkshopArt` / `mergeWorkshopFlatArt` / `mergeWorkshopSkins`），客户端**零改动**就能通过
 * `data.get('assets')` 读到 —— 与 `assets.skins` 逐字同一条理由（见 mergeWorkshopSkins 的注释）。
 *
 * 落盘形状：`assets.modForms[spineId][formName] = { pack: '<包 id>', form: { change?…, roles } }` ——
 * 带上 `pack` 是为了两件事：（a）两个包撞同名形态时谁赢了要说得出名字（`FORM_COLLISION`）；
 * （b）客户端 `installPackForms` 按包 id 判「谁先占位」，于是**结果不取决于加载次序**。
 *
 * 第一方优先那一半不在这里判：`FORMS_FIRST_PARTY_OVERLAP` 在形状层（`parseFormsDecl`）就已经把
 * 「包想盖第一方」拒了，所以并到这里的每一条都是第一方没有的形态名。第二道闸仍在客户端
 * （`installPackForms` 显式丢掉同名条目并报出来），因为浏览器拿到的是 JSON，而那张清单不该被信任。
 */
function mergeWorkshopForms(data, packs, report) {
  const list = [...(Array.isArray(packs) ? packs : [])].sort(byPackId);
  const withForms = list.filter((p) => isPlainObj(p?.forms) && Object.keys(p.forms).length);
  if (!withForms.length) return;
  const assets = isPlainObj(data.assets) ? data.assets : null;
  if (!assets) {
    for (const pack of withForms) {
      report.errors.push({
        pack: pack.id, file: 'assets', id: 'forms', code: 'MANIFEST_MISSING',
        reason: 'this pack declares forms (clip sets), but data/assets.json is missing — run `npm run assets` so the client has a manifest to extend',
      });
    }
    return;
  }
  /** @type {Record<string, Record<string, object>>} */
  const bySpine = {};
  /** @type {Map<string, string>} `"<spine id>|<form name>"` → 占住它的包 id */
  const claimed = new Map();
  /** @type {Record<string, string[]>} 包 id → 真的并进去的 `"<spine id>|<形态名>"` */
  const byPack = {};
  for (const pack of withForms) {
    for (const [table, entries] of Object.entries(pack.forms)) {
      for (const [id, forms] of Object.entries(entries)) {
        for (const [kind, form] of Object.entries(forms)) {
          const key = `${id}|${kind}`;
          const holder = claimed.get(key);
          if (holder) {
            report.errors.push({
              pack: pack.id, file: 'assets', id: `forms.${table}.${id}.${kind}`, code: 'FORM_COLLISION', definedBy: holder,
              reason: `another pack (${holder}) already adds the form "${kind}" on spine "${id}"; the pack with the smaller id keeps it — rename the form, or let "${holder}" drop it`,
            });
            continue;
          }
          claimed.set(key, pack.id);
          ((bySpine[id] ||= {})[kind] = { pack: pack.id, form });
          (byPack[pack.id] ||= []).push(`forms.${table}.${id}.${kind}`);
        }
      }
    }
  }
  if (!Object.keys(bySpine).length) return;
  const prev = isPlainObj(assets.modForms) ? assets.modForms : {};
  const next = { ...prev };
  for (const [spineId, forms] of Object.entries(bySpine)) {
    next[spineId] = { ...(isPlainObj(prev[spineId]) ? prev[spineId] : {}), ...forms };
  }
  data.assets = { ...assets, modForms: next };
  for (const arr of Object.values(byPack)) arr.sort();
  report.forms = byPack;
}

/**
 * 把包声明的**静态相位**并进一个数据文件（`pack.json.fx.silentPhases`，DESIGN §28.29）。
 *
 * 落点与形态不同：相位名不是素材，是 `fx/kinds.js` 里一个 Set 的成员，所以它并进 `assets.silentPhases`。
 * 为什么仍然走 `assets.json`：客户端的 `fxSpec` 在**每一个特效**上被调用，它必须是一次同步查表，不能是
 * 「等一个文件加载」——而 `assets.json` 是渲染层启动时就已经在手里的那份清单（`ui/fieldHost.js` 把它交给
 * 渲染器），所以它是这条通道唯一不需要新增取数路径的家。
 *
 * 去重 + 排序：`silentPhases` 是**声明**（谁先说的不重要），两句话说同一件事不该变成两个成员。
 */
function mergeWorkshopFx(data, packs, report) {
  const list = [...(Array.isArray(packs) ? packs : [])].sort(byPackId);
  const withPhases = list.filter((p) => isPlainObj(p?.fx) && Array.isArray(p.fx.silentPhases) && p.fx.silentPhases.length);
  if (!withPhases.length) return;
  const assets = isPlainObj(data.assets) ? data.assets : null;
  if (!assets) {
    for (const pack of withPhases) {
      report.errors.push({
        pack: pack.id, file: 'assets', id: 'fx', code: 'MANIFEST_MISSING',
        reason: 'this pack declares fx.silentPhases, but data/assets.json is missing — run `npm run assets` so the client has a manifest to extend',
      });
    }
    return;
  }
  const prev = Array.isArray(assets.silentPhases) ? assets.silentPhases : [];
  const merged = [...prev];
  /** @type {Record<string, string[]>} */
  const byPack = {};
  for (const pack of withPhases) {
    for (const kind of pack.fx.silentPhases) {
      if (!merged.includes(kind)) merged.push(kind);
      (byPack[pack.id] ||= []).push(kind);
    }
  }
  merged.sort();
  for (const arr of Object.values(byPack)) arr.sort();
  data.assets = { ...assets, silentPhases: merged };
  report.silentPhases = byPack;
}

/**
 * 谁跟谁抢了同一张 art 表里的同一个 id：按包 id 排序后第一个赢（`claimArt`），输的一方**点名**记一条
 * `ASSET_COLLISION`（`definedBy` = 占住的那一方）。
 *
 * 两张 art 面（对象表与扁平表）共用它：规则只有一份，输出两张面孔 —— 谁赢这件事不该因为「这张表的条目是对象还是
 * 字符串」而不同。
 * @param {Array<object>} list 已按包 id 排好序的包
 * @param {(table: string) => boolean} include 这次要处理哪些表
 * @param {{ errors: object[] }} report 错误去处
 * @returns {Map<string, string>} `"<表>.<id>"` → 占住它的包 id
 */
function artClaims(list, include, report) {
  /** @type {Map<string, string>} */
  const claimed = new Map();
  for (const pack of list) {
    for (const [table, entries] of Object.entries(isPlainObj(pack?.art) ? pack.art : {})) {
      if (!ART_TABLES[table] || !include(table)) continue;
      // 扁平表的条目**是路径字符串**，`isPlainObj` 会为假 —— 用 `entries` 存在与否判断，不是「它是不是对象」
      for (const id of Object.keys(isPlainObj(entries) ? entries : {})) {
        const key = `${table}.${id}`;
        if (claimed.has(key)) {
          report.errors.push({
            pack: pack.id, file: 'assets', id: key, code: 'ASSET_COLLISION',
            definedBy: claimed.get(key),
            reason: `another pack (${claimed.get(key)}) already ships art for this entry; keep only one`,
          });
        } else claimed.set(key, pack.id);
      }
    }
  }
  return claimed;
}

/** `artClaims` 的结果按包归拢、每张表内按 key 排序（`report.art` / `report.flatArt` 的形状）。 */
function artClaimCounts(claimed, include) {
  /** @type {Record<string, string[]>} */
  const counts = {};
  for (const [key, packId] of claimed) {
    const table = key.slice(0, key.indexOf('.'));
    if (!include(table)) continue;
    (counts[packId] ??= []).push(key);
  }
  for (const arr of Object.values(counts)) arr.sort();
  return counts;
}

/**
 * 把包自带的**两张扁平图标表**并进 `assets.skills` / `assets.prof.sub`（`pack.json.art.skills` /
 * `pack.json.art.profSub`）—— 客户端画技能图标与分支图标时读的那两张表。
 *
 * 为什么单独一条通道：这两张表的值**直接就是路径字符串**（`data/assets.json` 实测：`skills["skchr_kalts_1"]`
 * 与 `prof.sub["fastshot"]`），不像 `chars` 那样是一个带 `urls` 字段的对象，所以它可以复用 `mergeWorkshopArt`
 * 的一切（路径安全规则、`/workshop-assets` 路由、包 id 排序、点名撞车），只有「写进哪一层」不同 —— 那一层由
 * `ART_TABLES[表].target` 给出（`['skills']` / `['prof','sub']`）。
 *
 * 官方已有这个 id 时**替换**（这就是一个包给官方技能换图标的方式）；`assets.json` 缺失时报告，不凭空造一份。
 */
function mergeWorkshopFlatArt(data, packs, report) {
  const index = workshopArtIndex(packs);
  const tables = Object.keys(index).filter((t) => ART_TABLES[t]?.flat);
  if (!tables.length) return;
  const list = [...(Array.isArray(packs) ? packs : [])].sort(byPackId);
  const claimed = artClaims(list, (t) => ART_TABLES[t]?.flat, report);
  if (!isPlainObj(data.assets)) {
    for (const pack of list) {
      if (!Object.keys(isPlainObj(pack?.art) ? pack.art : {}).some((t) => ART_TABLES[t]?.flat)) continue;
      report.errors.push({
        pack: pack.id, file: 'assets', id: 'art', code: 'MANIFEST_MISSING',
        reason: 'this pack ships skill / sub-profession icons, but data/assets.json is missing — run `npm run assets` so the client has an icon table to extend',
      });
    }
    return;
  }
  const next = { ...data.assets };
  /** 这一趟**真的并进去了**的表（缺落点的那几张不算：日志里数了却没并，就是一句假话）。 */
  const merged = new Set();
  for (const table of tables) {
    const target = ART_TABLES[table].target;
    // 「清单里**本来就有**这张表」是写入的前置条件 —— `mergeWorkshopItemIcons` 对 `assets.items` 立的是同一条
    // 规矩（`:3021`），理由也一样：`art.bonds` / `art.bands` 的用途是给**已有的**盟约/分队配图（`assets.bonds` /
    // `assets.bands` 是素材管线产物，官方那 23 + 40 条），把一个不存在的落点凭空造出来，就成了「客户端按 id 查得到
    // 一张图，可 `data/bonds.json` 里根本没有这个盟约」的假象。缺这张表时**点名报告**，让作者去跑 `npm run assets`。
    //
    // 守卫只对**落点是 `assets.<表>` 自己**的扁平表生效（`bonds` / `bands`）。`skills` / `profSub` 的落点是
    // `assets.skills` / `assets.prof.sub` —— 那两张是 art 这一层**本来就在创建**的表（既有语义，见
    // test/workshopOperators.test.js「并进 assets.skills / assets.prof.sub」那组用例），对它们查 pre-existence
    // 会把一条已经定下来的行为改掉。
    const ownMap = target.length === 1 && target[0] === table;
    if (ownMap && !isPlainObj(next[target[0]])) {
      for (const p of list) {
        if (!Object.hasOwn(isPlainObj(p?.art) ? p.art : {}, table)) continue;
        report.errors.push({
          pack: p.id, file: 'assets', id: `art.${table}`, code: 'MANIFEST_MISSING',
          reason: `this pack ships art.${table} icons, but data/assets.json has no "${target[0]}" map — run \`npm run assets\` so the client has a table to extend`,
        });
      }
      continue;
    }
    // **逐个**段浅复制（长度 1 时落点就是 `assets.<表>` 这个表本身 —— 要往表里写，不是把整张表换成一条路径）。
    const chain = [];
    let cur = /** @type {Record<string, any>} */ (next);
    for (const seg of target) {
      const inner = isPlainObj(cur[seg]) ? { ...cur[seg] } : {};
      chain.push({ owner: cur, key: seg, value: inner });
      cur = inner;
    }
    for (const [id, url] of Object.entries(index[table])) cur[id] = url;
    for (let i = chain.length - 1; i >= 0; i--) chain[i].owner[chain[i].key] = chain[i].value;
    merged.add(table);
  }
  data.assets = next;
  report.flatArt = artClaimCounts(claimed, (t) => merged.has(t));
}

/** 一个条目按字段合并；`spine` 再往里一层（一侧之内的字段逐项合并，见 mergeWorkshopArt 的注释）。 */
function mergeArtEntry(cur, patch) {
  const out = { ...cur };
  for (const [key, value] of Object.entries(patch)) {
    if (key !== 'spine' || !isPlainObj(value)) { out[key] = value; continue; }
    const spine = isPlainObj(cur.spine) ? { ...cur.spine } : {};
    for (const [k, v] of Object.entries(value)) {
      spine[k] = isPlainObj(v) && isPlainObj(spine[k]) ? { ...spine[k], ...v } : v;
    }
    out.spine = spine;
  }
  return out;
}

/**
 * 一个包声明要进**自选池**的干员，逐条判定它能不能进（`pack.json.operators`，docs/WORKSHOP.md §1.2）。
 *
 * 与 `workshopSupportEntries` 同一种结构、同一种理由（**规则只有一份**，加载期与校验器/编辑器读的是同一个函数）：
 * 每一条声明要么给出它落盘时要写的数据，要么给出一条**点名**的拒绝。四条规则：
 *
 *   * `OPERATOR_NO_UNIT` —— 这个包没有同名的 `units[charId]` 记录。没有干员记录的干员进池后是**空槽**：
 *     自选界面画不出名字与职业，一局里也取不到 def。这是唯一一条「写成什么样都不该放过」的错。
 *   * `OPERATOR_NOT_SIX` —— `rarity !== 6`。**不是 6★ 请走工坊棋子注册表**（`content.chess` + `kits/<chessId>.js`）：
 *     自选池这一层是「六星干员的获得方式」，5★ 与以下在这条路上没有商店阶级可落。
 *   * `OPERATOR_BOND_UNKNOWN` —— `bonds` 里某个 id 不在 `data/bonds.json`。**这条必须拒**：盟约 id 写错时那条
 *     盟约条**永远不会出现**（`assets.bonds` 里没有它的图标，`bonds` 表里没有它的阈值），而作者只会以为
 *     「盟约没生效」—— 一次完全静默的失效。
 *   * `OPERATOR_FORM_MISSING` —— `forms` 没覆盖自选槽要的档位。自选槽的普通与精锐两条记录**各自**要求一个档位
 *     （`shared/diy.js checkDiyPick` 同时解析两条），缺一个这个干员就挑不上；更重的是 `tools/golden.mjs` 会给池里
 *     每位配一个精锐场景，所以缺档位会让**语料生成抛异常**，`golden` / `ci` 全线挂。要求的那一组从 `diy.slots`
 *     派生（`requiredUnitForms`），不硬编码。
 *   * `PACK_ID_COLLISION` —— 两个包声明同一个 charId。按包 id 字典序最小者赢（DESIGN §28.3），输的一方得到一条
 *     点名报告；`ownedPool` 因此只会多一个 id，不会出现两条记录抢一个槽。
 *
 * `name` / `rarity` / `profession` / `subProfessionId` **从 `data.backups.units[charId]` 派生**（同一个包的
 * `units` 记录已经由内容文件那一层并进 `data` 了），所以清单里写不出第二份会漂移的真相。
 *
 * @param {Readonly<Record<string, any>>} data 合并后的数据（`units` 记录已就位）
 * @param {Array<{ id: string, operators?: Record<string, { powers?: string[], bonds?: string[] }> }>} packs
 * @returns {{ entries: Array<{ pack: string, id: string, rec: object }>, errors: object[] }}
 */
export function workshopOperatorEntries(data, packs) {
  /** @type {Array<{ pack: string, id: string, rec: object }>} */
  const entries = [];
  /** @type {object[]} */
  const errors = [];
  const list = (Array.isArray(packs) ? packs : []).filter((p) => p && typeof p.id === 'string' && p.id).sort(byPackId);
  const units = isPlainObj(data) && isPlainObj(data.backups) && isPlainObj(data.backups.units) ? data.backups.units : {};
  const bonds = isPlainObj(data) && isPlainObj(data.bonds) ? data.bonds : {};
  /** charId → 已经声明它的包（`byPackId` 顺序下第一个就是赢家）。 */
  const claimed = new Map();
  for (const pack of list) {
    const declared = isPlainObj(pack.operators) ? pack.operators : {};
    for (const charId of Object.keys(declared).sort()) {
      const decl = isPlainObj(declared[charId]) ? declared[charId] : {};
      const unit = isPlainObj(units[charId]) ? units[charId] : null;
      if (!unit) {
        errors.push({
          pack: pack.id, file: 'backups', id: charId, code: 'OPERATOR_NO_UNIT',
          reason: `"${charId}" has no units record in this pack — declare it in units.json (the 自选池 entry derives its name / rarity / profession from that record)`,
        });
        continue;
      }
      if (unit.rarity !== 6) {
        errors.push({
          pack: pack.id, file: 'backups', id: charId, code: 'OPERATOR_NOT_SIX',
          reason: `"${charId}" is rarity ${JSON.stringify(unit.rarity)}, not 6 — the 自选池 is the 6★ path; a 5★ or lower operator goes through the workshop chess registry instead (content.chess + kits/<chessId>.js)`,
        });
        continue;
      }
      const unknown = (Array.isArray(decl.bonds) ? decl.bonds : []).filter((b) => !isPlainObj(bonds[b]));
      if (unknown.length) {
        errors.push({
          pack: pack.id, file: 'backups', id: charId, code: 'OPERATOR_BOND_UNKNOWN',
          reason: `"${charId}" declares the bond(s) ${unknown.map((b) => `"${b}"`).join(', ')}, which data/bonds.json does not have — that bond would simply never appear in a match (a mistyped id fails silently; check data/bonds.json for the exact id, e.g. "egirShip")`,
        });
        continue;
      }
      // 形态齐不齐：自选槽的两条记录（普通 + 精锐）各自要求一个 forms 档位，缺一个这个干员**根本挑不上**
      // （shared/diy.js checkDiyPick 同时解析两条）。而它的后果不止「挑不上」：`tools/golden.mjs` 会给池里每一位
      // 配一个 tier-6 精锐场景，所以一个缺档位的干员进池 = 语料生成抛异常 = `golden` / `ci` 全线挂（2026-10-09 实测：
      // 只有 `2/1/4/0` 与 `2/60/7/1` 两个档位的干员会让 `chess_char_6_diy1_a` 报 `no form for`）。
      // 要求的那一组**从 `diy.slots` 的两条记录派生**（shared/diy.js requiredUnitForms），不硬编码 `2/60/7/3`。
      const forms = isPlainObj(unit.forms) ? unit.forms : {};
      const missing = requiredUnitForms(data).filter((f) => !isPlainObj(forms[f]));
      if (missing.length) {
        errors.push({
          pack: pack.id, file: 'backups', id: charId, code: 'OPERATOR_FORM_MISSING',
          reason: `"${charId}" has no unit form for ${missing.map((f) => `"${f}"`).join(', ')} — the 自选 slots' normal and elite records both need one (data/backups.json diy.slots => chess status), and a pool member without them cannot be picked: \`node tools/golden.mjs\` throws and the golden / ci suites go down with it. Copy the missing form(s) from the operator record you derived this one from`,
        });
        continue;
      }
      const holder = claimed.get(charId);
      if (holder) {
        errors.push({
          pack: pack.id, file: 'backups', id: charId, code: 'PACK_ID_COLLISION', definedBy: holder,
          reason: `"${charId}" is already contributed by pack "${holder}" — the pack with the smaller id keeps it (DESIGN §28.3). Rename this record, or let "${holder}" drop it; an "overrides" entry does not win against another pack`,
        });
        continue;
      }
      claimed.set(charId, pack.id);
      entries.push({
        pack: pack.id,
        id: charId,
        rec: {
          name: unit.name,
          rarity: unit.rarity,
          profession: unit.profession,
          subProfessionId: unit.subProfessionId,
          obtainable: true,
          powers: [...(Array.isArray(decl.powers) ? decl.powers : [])],
          bonds: [...(Array.isArray(decl.bonds) ? decl.bonds : [])],
        },
      });
    }
  }
  return { entries, errors };
}

/**
 * 把包声明的新干员**放进自选池**：`data/backups.json` 的 `diy.ownedPool`（push，去重）与
 * `diy.operators[charId]`（那张自选界面读的名字 / 星级 / 职业 / 盟约表）。
 *
 * 这是「新增一个干员」从**就地补丁**变成**包**的最后一块：在它之前，一个包能带干员记录、能带素材、能带语音，
 * 但它加的新干员在自选界面里**根本不存在**（`diy` 只认生成器写出来的那 86 条）；作者只能手改
 * `data/backups.json`，而那是生成物 —— 下次 `npm run build-data` 会把他的条目整条抹掉。
 *
 * `data/*.json` 依旧一个字节都不改：叠加发生在 `deepFreeze` 之前（docs/WORKSHOP.md §1.3），所以
 * 「作者能加」与「生成器是唯一来源」同时成立 —— 磁盘上的 `ownedPool.length === 71` 那几条生成器契约
 * （`test/backups.test.js`）完全不受影响。
 *
 * 入池顺序只由包 id 排序决定（`workshopOperatorEntries` 内部就是 `byPackId`），不依赖目录扫描顺序。
 * `data.backups` 不存在时报告 `MANIFEST_MISSING`，不凭空造一份（与 art 缺 `assets.json` 同一手法）。
 */
function mergeWorkshopOperators(data, packs, report) {
  const { entries, errors } = workshopOperatorEntries(data, packs);
  for (const e of errors) report.errors.push(e);
  if (!entries.length) return;
  const backups = isPlainObj(data.backups) ? data.backups : null;
  const diy = backups && isPlainObj(backups.diy) ? backups.diy : null;
  if (!diy) {
    const seen = new Set();
    for (const e of entries) {
      if (seen.has(e.pack)) continue;
      seen.add(e.pack);
      report.errors.push({
        pack: e.pack, file: 'backups', id: 'diy', code: 'MANIFEST_MISSING',
        reason: 'this pack declares 自选池 operators, but data/backups.json has no "diy" map — run `npm run build-data` so the 自选 pool has somewhere to publish to',
      });
    }
    return;
  }
  const pool = [...(Array.isArray(diy.ownedPool) ? diy.ownedPool : [])];
  const operators = { ...(isPlainObj(diy.operators) ? diy.operators : {}) };
  /** @type {Record<string, string[]>} */
  const added = {};
  for (const { pack, id, rec } of entries) {
    // 已经在这个池里（一个官方干员、或者……）时不再 push：`ownedPool` 是一份「拥有哪些干员」的集合，
    // 两个条目一个 id 只会让自选界面出现两个一样的格子。
    if (!pool.includes(id)) pool.push(id);
    operators[id] = rec;
    (added[pack] ||= []).push(id);
  }
  for (const list of Object.values(added)) list.sort();
  data.backups = { ...backups, diy: { ...diy, ownedPool: pool, operators } };
  report.operators = added;
}

/**
 * Make newly added STAGES selectable.
 *
 * A stage only enters a match when the mode's `stages` list names it (server/match/waves.js picks among those by
 * `weight`) — and `config` is deliberately NOT a workshop-contributable file, because a pack that could rewrite config
 * could rewrite the economy and the round schedule. So instead of letting a pack ship a config overlay, the loader
 * honours the stage's OWN `modes` list by APPENDING its id to those mode entries. Nothing else in `config` is ever
 * written, and only stages the pack actually added are linked.
 *
 * Mutates `data.config` (a fresh copy) and records each link in `report.linkedStages` so the boot log can show it.
 */
function linkWorkshopStages(data, report) {
  const added = Array.isArray(report.added.stages) ? report.added.stages : [];
  if (!added.length || !isPlainObj(data.stages) || !isPlainObj(data.config) || !isPlainObj(data.config.modes)) return;
  const modes = { ...data.config.modes };
  let touched = false;
  for (const id of added) {
    const stage = data.stages[id];
    const declared = stage && Array.isArray(stage.modes) ? stage.modes : [];
    for (const modeId of declared) {
      const mode = modes[modeId];
      if (!isPlainObj(mode)) continue;
      const list = Array.isArray(mode.stages) ? mode.stages.slice() : [];
      if (list.includes(id)) continue;
      list.push(id);
      modes[modeId] = { ...mode, stages: list };
      touched = true;
      (report.linkedStages ||= []).push(`${id} -> ${modeId}`);
    }
  }
  if (touched) data.config = { ...data.config, modes };
}

/**
 * One-line summary of a merge report for the boot log / `--doctor`.
 * @param {ReturnType<typeof applyWorkshop>['report']} report
 */
export function workshopSummary(report) {
  if (!report || !Array.isArray(report.packs) || !report.packs.length) return 'no workshop packs';
  const parts = report.packs.map((p) => {
    const bits = [];
    const files = Object.entries(p.files).filter(([, n]) => n.added || n.overridden)
      .map(([f, n]) => `${f} +${n.added}${n.overridden ? ` ~${n.overridden}` : ''}`);
    if (files.length) bits.push(files.join(', '));
    const voices = report.voices && report.voices[p.id];
    const langVoices = report.voiceLangs && report.voiceLangs[p.id];
    if (voices || langVoices) {
      // the default dub first, then each extra dub with its own count: `3 voice lines (jp 2, en 1)`
      const perLang = langVoices ? Object.entries(langVoices).map(([l, n]) => `${l} ${n}`).join(', ') : '';
      const head = voices ? `${voices} voice line${voices === 1 ? '' : 's'}` : 'voice lines';
      bits.push(perLang ? `${head} (${perLang})` : head);
    }
    const icons = report.bondIcons && report.bondIcons[p.id];
    if (icons) bits.push(`${icons.length} bond icon${icons.length === 1 ? '' : 's'}`);
    const itemIcons = report.itemIcons && report.itemIcons[p.id];
    if (itemIcons) bits.push(`${itemIcons.length} item icon${itemIcons.length === 1 ? '' : 's'}`);
    const art = report.art && report.art[p.id];
    if (art) bits.push(`${art.length} art entr${art.length === 1 ? 'y' : 'ies'} (${art.join(', ')})`);
    // 时装（`pack.json.skins`）：漏了这一段，一个带来 271 套时装的包在启动日志里就是 "nothing" ——
    // 而「装了但什么都没发生」正是这一层最容易被读错的那种失败（业主实测 skin-catalogue 撞上的就是它）。
    const skins = report.skinsByPack && report.skinsByPack[p.id];
    if (skins) bits.push(`${skins} outfit${skins === 1 ? '' : 's'}`);
    // 扁平表（`assets.skills` / `assets.prof.sub` / `assets.bonds` / `assets.bands`）与上面那条分开数：它们的落点
    // 不是 `assets.<表>`，一条日志里混在一起会让读的人去 assets.chars 里找一个技能图标。
    //
    // **每一张扁平表各占一句 `<表> +N (…)`**，分组规则从 `ART_TABLES[表].target` 推出来，不硬编码表名。
    // 以前这四张表被糊成一句 `N icons`（`art.bonds` 是盟约**图集**，不是图标），读日志的人会去 `assets.skills`
    // 里找一个盟约 id；而「表名 + N」正好是作者能在 `pack.json` 里对照着改的那个名字。
    const flatArt = report.flatArt && report.flatArt[p.id];
    if (flatArt) {
      /** @type {Map<string, string[]>} */
      const byTable = new Map();
      for (const key of flatArt) {
        const table = key.slice(0, key.indexOf('.'));
        if (!byTable.has(table)) byTable.set(table, [key]);
        else /** @type {string[]} */ (byTable.get(table)).push(key);
      }
      for (const table of [...byTable.keys()].sort()) {
        const keys = /** @type {string[]} */ (byTable.get(table));
        bits.push(`${table} +${keys.length} (${keys.join(', ')})`);
      }
    }
    const support = report.support && report.support[p.id];
    if (support) bits.push(`助战 +${support.length}`);
    const operators = report.operators && report.operators[p.id];
    if (operators) bits.push(`自选池 +${operators.length}`);
    // 特质授予的盟约写歪了 / 指向不存在的盟约（`trait.grantsBonds`，DESIGN §28.49）：与「没有模型」分开数 ——
    // 把两件事糊成一句 `N 个干员…`，读日志的人会去 assets.chars 里找一个盟约 id。
    const grantIssues = (report.traitGrants || []).filter((g) => g.pack === p.id).length;
    if (grantIssues) bits.push(`${grantIssues} 处 trait.grantsBonds 无效（启动日志逐条点名）`);
    const looks = (report.looks || []).filter((l) => l.pack === p.id);
    // 干员与怪物分开数：一句话里混着「3 个干员」而其中两个是怪物，读日志的人会去找错对象
    const lookOperators = looks.filter((l) => l.kind !== 'enemy').length;
    const lookEnemies = looks.length - lookOperators;
    if (lookOperators) bits.push(`${lookOperators} 个干员没有模型（会画成贴图）`);
    if (lookEnemies) bits.push(`${lookEnemies} 个怪物没有模型（会画成贴图）`);
    return `${p.name}(${p.id}): ${bits.length ? bits.join(', ') : 'nothing'}`;
  });
  if (report.supportOff) parts.push('助战 pool contributions off (support.json "workshop": false)');
  if (report.errors.length) parts.push(`${report.errors.length} rejected record(s)`);
  return parts.join('; ');
}

/**
 * 管理器合同的**装载期裁决**（DESIGN §28.48）—— 对一份**已加载的包集合**按 `dependencies` / `conflicts`
 * 声明做跨包裁决。形状由 `parseModRefsDecl` 在前面判过；这里判的是**语义**（形状合法、语义照样可以死）。
 *
 * 为什么必须在装载期判而不是校验期：一个包声明了什么，只有在**本机上真的装了哪些包**之后才成立。作者交上来的
 * 是一份 pack.json，他看不到别人的 workshop/ 里有什么。所以「缺依赖」不是他写错了，而是**这台机器上这个组合
 * 不成立** —— 这正是装载期的判断。
 *
 * 五条规则，全部**确定性**（同一份输入永远同一份输出；迭代顺序按包 id 排序，与既有裁决「同 id 抢占按包 id
 * 排序」同一条确定性来源），全部**具名**（拒绝理由点名双方，见 `refused[].reason`）：
 *
 *   * **缺失依赖** —— 声明的 id 不在集合里 ⇒ **依赖方被拒**（`missing dependency "x"`）；
 *   * **版本不合** —— 依赖在、但它的 `version` 不满足声明的 range ⇒ **依赖方被拒**
 *     （`dependency "x" version 1.0.0 does not satisfy ">=2.0.0"`）。依赖包**自己没有写 `version`** 时视为
 *     **满足** —— 它的 version 是「未声明」，不是「不匹配」。机制上：`normalizePackManifest` 把没写 version 的
 *     包归一化成 `0.0.0`，所以这里把 `0.0.0` 当作「未声明」（见 `declaredVersion`）。这一条是 PR 原文的**规则**，
 *     但 PR 自带的那条测试断言的是**相反**的行为 —— 本移植按规则实现，冲突已记进 commit 消息的差异清单；
 *   * **互斥** —— A 声明了对 B 的冲突（B 在集合里、且 B 的 `version` 满足 range）⇒ **包 id 大的那个**被拒
 *     （`conflicts with "alpha" (declared by "alpha")`）。双方都声明时同一条边只裁决一次，结论一样；
 *   * **级联** —— 被拒的依赖让它的依赖方也无法工作 ⇒ 级联拒绝，理由链完整（`depends on "x", which was refused`），
 *     **迭代到不动点**（A 依赖 B、B 依赖 C、C 被拒 ⇒ C、B、A 全拒，一次迭代不够）；
 *   * **循环** —— 幸存集合里的依赖边成环 ⇒ **环上全体被拒**（`dependency cycle: a → b → c → a`）。它与级联
 *     不同：环上每个包自己的依赖都「在」，但这份声明本身是死锁，没有任何一个能先装载。
 *
 * 纯函数：不改输入，不读磁盘，不抛异常。`kept` 就是真正装载的集合，`refused` 由调用方变成具名的启动日志。
 * @param {{ id: string, version?: string, name?: string,
 *           dependencies?: { id: string, range?: string }[],
 *           conflicts?: { id: string, range?: string }[] }[]} packs
 * @returns {{ kept: unknown[], refused: { id: string, reason: string }[] }}
 */
export function adjudicatePackGraph(packs) {
  const list = (Array.isArray(packs) ? packs : []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byId = new Map();
  for (const p of list) if (!byId.has(p.id)) byId.set(p.id, p);
  /** @type {Map<string, string>} 包 id → 拒绝理由 */
  const refused = new Map();
  // 「这个包声明了版本吗」—— `normalizePackManifest` 把**没写** `version` 的包归一化成立面的 `0.0.0`，
  // 所以装载期看到的是一个字符串，分不出「没写」与「写了 0.0.0」。本仓库的口径是**没写 = 未声明**：
  // 所以 `0.0.0` 在这里当作「未声明」处理，任何 range 都算**满足**（与 `range` 缺省 = 任意版本同一条意思）。
  // 这一条是 PR 原文的规则（「依赖包自己没有 version 时视为满足（它的 version 是「未声明」，不是「不匹配」）」）；
  // ⚠️ 注意 PR 自带的那条测试断言的是**相反**的行为（未声明 ⇒ 0.0.0 ⇒ `>=2.0.0` 不合 ⇒ 拒），
  // 与本规则冲突，本移植按规则实现、并把它记进 commit 消息的差异清单。
  const declaredVersion = (p) => (typeof p.version === 'string' && p.version.trim() && p.version.trim() !== '0.0.0' ? p.version.trim() : null);
  const satisfied = (range, target) => {
    if (range === undefined || range === '') return true;
    const v = declaredVersion(target);
    if (v === null) return true; // 未声明版本 ⇒ 视为满足（不是「不匹配」）
    return appVersionMatches(range, v);
  };

  // 第一层：缺失 / 版本不合 / 互斥（互斥按 id 大者败；双方都声明时同一条边只裁决一次）
  for (const p of list) {
    for (const dep of p.dependencies ?? []) {
      const target = byId.get(dep.id);
      if (!target) refused.set(p.id, `missing dependency "${dep.id}"`);
      else if (dep.range !== undefined && !satisfied(dep.range, target)) {
        refused.set(p.id, `dependency "${dep.id}" version ${target.version ?? '(undeclared)'} does not satisfy "${dep.range}"`);
      }
    }
    for (const c of p.conflicts ?? []) {
      const target = byId.get(c.id);
      if (!target || (c.range !== undefined && !satisfied(c.range, target))) continue;
      const loser = p.id > c.id ? p.id : c.id;
      const winner = p.id > c.id ? c.id : p.id;
      if (loser === winner) continue;
      refused.set(loser, `conflicts with "${winner}" (declared by "${p.id}")`);
    }
  }
  // 级联：依赖链上任何一个被拒，依赖方跟着拒（迭代到不动点）
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of list) {
      if (refused.has(p.id)) continue;
      for (const dep of p.dependencies ?? []) {
        if (refused.has(dep.id) && !byId.has(dep.id)) continue; // 缺失依赖已经在第一层点名
        if (refused.has(dep.id)) {
          refused.set(p.id, `depends on "${dep.id}", which was refused`);
          changed = true;
          break;
        }
      }
    }
  }
  // 循环：幸存集合里的依赖边成环 ⇒ 环上全体被拒（与级联不同：环上每个包自己的依赖都「在」，但声明本身是死锁）
  const edges = new Map();
  for (const p of list) {
    if (refused.has(p.id)) continue;
    const targets = (p.dependencies ?? []).map((d) => d.id).filter((id) => byId.has(id) && !refused.has(id));
    edges.set(p.id, targets);
  }
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const t of edges.get(id) ?? []) {
      const s = state.get(t);
      if (s === 1) {
        const cycle = stack.slice(stack.indexOf(t));
        for (const m of cycle) refused.set(m, `dependency cycle: ${cycle.concat(cycle[0]).join(' → ')}`);
        return true;
      }
      if (s === undefined && visit(t)) return true;
    }
    stack.pop();
    state.set(id, 2);
    return false;
  };
  for (const p of list) if (!refused.has(p.id) && !state.has(p.id)) { if (visit(p.id)) break; }

  const kept = list.filter((p) => !refused.has(p.id));
  const refusedList = [...refused.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([id, reason]) => ({ id, reason }));
  return { kept, refused: refusedList };
}
