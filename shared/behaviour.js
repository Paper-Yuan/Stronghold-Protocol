// shared/behaviour.js — 行为开关层 (the 行为 a pack may declare, DESIGN §28.43).
// (i18n-ignore-file: 工坊作者层的校验与推导文本 —— 给作者、编辑器与 AI 读的规则说明（编辑器有自己的中英词典，见 docs/EDITOR.md），不是客户端界面文案)
//
// 这一层要解决的那面墙，逐字记在 `docs/WORKSHOP.md` §1.1 与 `shared/workshop.js` 的 `PACK_FIELDS` 注释里：
// 一份真实投稿（`ac8c9821f5ba`）把「改一条规则」做成了**安装器** —— `install.mjs` 整份覆盖 `data/*.json`、
// `server/sim/**` 与整屏 UI（它的 `files.json` 自述：「Nothing is trimmed: a target that gets the whole file gets
// the whole feature」）。`docs/WORKSHOP.md` §1.1 对 `official` / `config` / `meta` / `shared` / `theme` /
// `serverModules` 那六格「刻意没有通道」的判断逐字成立，**本文件不推翻它**：一个能指定任意文件覆盖、或让包
// 直接写数值的包格式**就是安装器**（`docs/design/mod-layer.md` §28.39）。
//
// 所以这一层与 `shared/variants.js` 是**同一个形状、不同的一张表**：
//   1. **闭枚举**。一个包只能声明**这张表里有的开关**，每个开关只能取**这个开关列出的选项名**。开关名不认识 ⇒
//      `BEHAVIOUR_UNKNOWN_SWITCH`；选项名不认识 ⇒ `BEHAVIOUR_UNKNOWN_OPTION`。两者都是**整包拒绝**，不是忽略。
//   2. **包里没有数值，也没有路径**。包声明的是「哪一格开关、哪一档」，不是「改成几」、更不是「改哪个文件」。
//      动作（`{ kind, value }`）**由引擎构造**：`value` 只能来自这张表或引擎自己的常量。
//   3. **缺省 = 引擎今天的行为**。不声明 `behaviour` 的包一个字节都不受影响；声明了但选了缺省选项的包，与
//      没声明在**数据上**等价。
//
// 与 `VARIANT_AXES`（口径）的分工 —— 两张表**不合并**，理由是判据不同：
//   * 口径（`variants`）是「同一份数据的另一套表现」：每条轴**必有**「官方那一档」，缺省＝引擎今天的行为，落点
//     是引擎**已经实现**的那套开关（`shared/variants.js`）。
//   * 行为开关（本文件）是「引擎里本来没有、现在由维护者实现的规则」：它**不要求**有「官方那一档」，它的入场券是
//     「**引擎先有实现点**，包只是声明」—— `docs/WORKSHOP.md` §1.1 对 `giveBondBiasOnly` 那句「真要这条特性，
//     正确做法是维护者在引擎里做成一个开关 … 然后**任何**包都能用」，本文件就是那句话的落点。
//
// **判据一律写成「表是入参」的纯函数**（`behaviourSwitchIssues(table)` / `parseBehaviourDecl(raw, table)` …）：
// 与 `shared/modSurface.js` 的 `surfaceLedgerIssues(ids, generation)` 同一条理由 —— 本刀那张表是**空的**，
// 若判据把它写死在模块里，那么「选项名不认识」「同一个开关写两遍」「缺省写错」这些分支**任何测试都碰不到**，
// 而一条只在今天的数据上成立、从来没验过失败分支的守卫，和没有守卫是一回事。表是入参之后，测试可以喂一份
// **合成的**表把失败分支逐条走一遍，生产路径仍然只读真的那一份（`BEHAVIOUR_SWITCHES`）。
//
// 这一份是**纯**的（`shared/` 的纪律）：没有 `process`、没有状态、没有文件系统，服务端与浏览器读到同一个判决。

/**
 * 一条判罚。形状与 `shared/workshop.js` 的 `fail` 逐字相同（那个是模块私有的，这里不跨模块借一个内部函数）。
 * 显式标注返回类型是给 `npm run typecheck` 用的：推断出的 `{ ok: boolean }` 落不进下面那些 `ok: false` 的联合。
 * @param {string} error @param {string} detail
 * @returns {{ ok: false, error: string, detail: string }}
 */
const fail = (error, detail) => ({ ok: false, error, detail });
const isPlainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** 一个开关名 / 选项名 / 文案的长度上限（一个手写坏掉的 pack.json 可以有几万字符）。 */
const MAX_NAME = 40;
const MAX_TEXT = 160;

/** 表里的一格（见下面 `BEHAVIOUR_SWITCHES` 的注释）。@typedef {object} BehaviourSwitch */
/** @typedef {Readonly<Record<string, any>>} BehaviourTable */

/**
 * 行为开关表 —— 这份格式认识的**每一个**开关与每一个选项名，一个不多一个不少。
 *
 * **本刀是空表，这是刻意的**（业主裁决）：第 4 刀的交付物是「**通道 + 守卫**」本身 —— 通道真的通、且响
 * （任何声明都被点名拒），而在引擎里**还没有**一格实现好的规则开关之前，没有一格可以声明。首格与它的
 * **引擎实现点**一起落，由业主点名。
 *
 * 每一条的形状（与 `VARIANT_AXES` 逐字同形，读起来是同一套东西）：
 *   * `label`       给作者与界面读的一句话（中文，照 `VARIANT_AXES` 的现状）；
 *   * `options`     闭枚举的选项名；
 *   * `default`     **不声明这一格**时引擎的表现（= 引擎今天的行为）；
 *   * `optionLabels` 选项名 → 一句话（中文）；
 *   * `effect`      选项名 → 这条选项到底动了什么（英文，照 `VARIANT_AXES` 的现状）。它是一句**声明**，
 *                   不是可执行的东西：包读不到它、也驱动不了它；
 *   * `actions`     选项名 → 引擎构造的动作数组（`{ kind, value }`）。**这是这一格唯一的执行点**，值只能来自
 *                   引擎自己的常量 —— 包给不出数字，也给不出键路径。
 *
 * `behaviourSwitchIssues` 把上面这张形状写成**可断言**的判据（纯函数，所以喂一份合成的表进去也能测）：
 * 一格少了 `actions` / `options` / `default` / `effect`，或者 `default` 不在 `options` 里，都会当场报出来 ——
 * 一份没有守卫的表，加第一格时最容易出的事就是「声明了、装上了、什么都没发生」。
 *
 * @type {BehaviourTable}
 */
export const BEHAVIOUR_SWITCHES = Object.freeze({
  /**
   * 商店出货偏向（投稿 `b293e061b38f`，商店刷新盟约装备几率提升）。**改结果** ⇒ 声明它必须 `combat: true`。
   *
   * 引擎侧的读取点**不是** `behaviourActions`：那一格是一条**具名规则读取**（与 `variants` 的 `variantValue` 同一个
   * 分工 —— 动作数组是这一格的**声明**，读取点问的是「哪一档」）。第三格（`morphPairing`）同理，读取点在它的三处
   * 实现点上。
   *
   * `official` = 引擎今天的行为（`SharedPool.rollItem`：装备槽按棋子阶级份额抽一个阶级，同阶级**等概率**）；
   * `bondBias` = 装备槽只在这个玩家**已激活**盟约对应的装备里抽（**只偏置、不授予** —— 授予盟约是 `giveBondId`
   * 本来的语义，由装备自己的规则管）。
   *
   * **未实现、也不假装实现的三条**（原件 `files.json._doc` 与其 `payload/data/items.json` 提到）：
   * ①「已激活**核心**盟约优先于已激活附加盟约」；②「骑士戒律也接入这套偏向」；③原件的 `data/items.json` 里
   * 有 `giveBondBiasOnly` 115 处 / `canGiveBond` 115 处（`giveBondId` 119 处）—— **这两个字段我们的
   * `data/items.json` 里都是 0 处**。三条的**源件都不在我们手上**，按业主的「缺源件就不做假实现」：这一格
   * **只读 `giveBondId`**，**绝不读** `giveBondBiasOnly` / `canGiveBond`（读一个数据里不存在的字段＝一条永远为假
   * 的判据，也就是一个假实现）。`test/shopBias.test.js` 有断言钉住这三条**没做**、且那两个字段**没被读**。
   */
  shopBias: {
    label: '商店出货偏向',
    options: Object.freeze(['official', 'bondBias']),
    default: 'official',
    optionLabels: Object.freeze({
      official: '官方出货（装备槽不问盟约）',
      bondBias: '装备槽偏向已激活盟约的装备（只偏置、不授予）',
    }),
    effect: Object.freeze({
      official: "the official shop draw: the item slot picks a tier by the chess tier shares, then a uniform shop-eligible item of that tier",
      bondBias: "the item slot prefers shop-eligible items whose giveBondId is one of this player's ACTIVE bonds, and grants nothing by itself; the tier stays the chess tier shares, and a tier with no such item falls back to the official draw",
    }),
    actions: (option) => (option === 'bondBias' ? [{ kind: 'shop.biasActiveBonds', value: true }] : []),
  },
  /**
   * 休整期可更换技能与模组（投稿 `8b4e5da55c58`）。**改结果** ⇒ 声明它必须 `combat: true`：技能与模组决定战斗里
   * 打出来的是什么。**不新增协议消息** —— 走的就是既有那条 `room.loadout { entries, ops? }`（投稿原件也是复用
   * 既有意图，我们连它自己那个 `g.loadout` 都不需要）。
   *
   * `locked` = 引擎今天的行为（`Match.setLoadout` 只收 `INFO_CHECK`：briefing 的干员调配，之后锁死）；
   * `prep` = 休整期（`PHASE.PREP`）里、且**这个座位还没准备**时也收一次。合并语义：这一次提交**只覆盖它写了的
   * 那些干员**，没写的保留当前配发（否则一个只带一名干员的面板提交会把整份配发抹掉）。
   */
  prepLoadout: {
    label: '休整期可更换技能与模组',
    options: Object.freeze(['locked', 'prep']),
    default: 'locked',
    optionLabels: Object.freeze({
      locked: '官方：干员调配锁定后不再可改',
      prep: '休整期也能改（本座位未准备时）',
    }),
    effect: Object.freeze({
      locked: 'the official rule: room.loadout is accepted only during INFO_CHECK (the briefing\'s 干员调配) and the loadout is frozen afterwards',
      prep: 'room.loadout is accepted during PREP as well, while this seat has not readied up; the submission merges into the current loadout (operators it does not mention keep theirs), and nothing else about the loadout changes',
    }),
    actions: (option) => (option === 'prep' ? [{ kind: 'loadout.allowDuringPrep', value: true }] : []),
  },
  /**
   * 变形同构体的配对规则（投稿 `19ea65909cf6`，其原件整份覆盖 `shared/morph.js` 与三处读取点）。**改结果**
   * ⇒ 声明它必须 `combat: true`：配对出的盟约决定谁算成员、层数与战斗里的加成。
   *
   * 两档的**判据只有一份**（`shared/morph.js` 的 `grantedBondsByMorph`），三处读取点调的是同一个函数：
   * prep 的 `bondsMeta.pieceBonds`、战斗的 `support/index.unitBonds`、客户端的 `gameLogic/bonds.grantedBonds`。
   *
   * `official` = **引擎今天的行为**：变形同构体**占一个装备位**（少于两件装备就不配对），并与**每一件**
   * `giveBondId` 装备配对（全部授予）。`plus` = 投稿那一套：**不占装备位**（一件也能配对）、每名干员**只能装
   * 一件**（多的由 `morphCarrierIndexes` 暴露给调用方）、只取装备行里**最左边**能授予盟约的那一件。
   *
   * **槽位语义（第 7 段补上的那半条）**：判据是同一份 `shared/morph.js` 的 **`morphSlotPolicy`** ——
   * `official` 拿到 `OFFICIAL_SLOT_POLICY`（共享冻结单例，逐字是引擎今天那条算术），`plus` 拿到
   * `PLUS_SLOT_POLICY`（不占位 / 每名干员一件 / 顶替只挑真正占格的那一件）。六处读取点同判：
   * `player/items.js` · `player/acquire.js` · `bot.js` · `invariants.js` · `ui/detailPanel.js` ·
   * `ui/gameLogic/placement.js`。`equipPerChess` 本身一字未动。
   */
  morphPairing: {
    label: '变形同构体的配对规则',
    options: Object.freeze(['official', 'plus']),
    default: 'official',
    optionLabels: Object.freeze({
      official: '官方读数：占一个装备位，配上的都授予',
      plus: '加强：不占装备位，只取最左边那一件',
    }),
    effect: Object.freeze({
      official: 'the reading this engine has always had: fewer than two carried items pair with nothing (the 变形同构体 takes one of the two equipment slots), and EVERY giveBondId item it is worn with grants its bond',
      plus: 'the submission\'s GRANT rule and SLOT rule together: one carried item is enough for the pairing to count (no two-item precondition) and ONLY the leftmost giveBondId item in the equipment row grants its bond; the 变形同构体 occupies NO equipment slot (it attaches with both real slots used, and a carrier holds at most one of it), and a third real item always displaces a real slotted item — never the 变形同构体. equipPerChess itself is untouched: the official two real slots stay two',
    }),
    actions: (option) => (option === 'plus' ? [{ kind: 'morph.pairingPlus', value: true }] : []),
  },
  /**
   * 装备拆卸（投稿 `79de9ff03518`，「装备拆卸mod」）。**改结果** ⇒ 声明它必须 `combat: true`：装备离开干员会改
   * 盟约人数（`bondsMeta.pieceBonds` 读装备行）与战斗里的数值，所以它进房间摘要闸门与 golden 语料。
   *
   * `official` = **引擎今天的行为**：装备装上之后只能靠精英化 / 合成 / 卖出离开（`g.destroy` 对已装备品回
   * `'equipped items are locked'`）。`allow` = 休整期可以用 `g.unequip {itemUid}` 把一件已装备的装备取下，退回
   * **手牌**（右→左优先），手牌满则进**临时整备区**；两者都满 ⇒ 整件事**原子拒绝**（`HAND_FULL`），装备留在原处。
   *
   * 缺省档下 `g.unequip` 回的就是 `g.destroy` 今天那句 `'equipped items are locked'` ⇒ **缺省逐字节不变**
   * （不需要 `golden:update`）。
   */
  unequip: {
    label: '装备拆卸',
    options: Object.freeze(['official', 'allow']),
    default: 'official',
    optionLabels: Object.freeze({
      official: '官方：装上后只能靠精英化 / 合成 / 卖出离开',
      allow: '休整期可以把装备卸下（退回手牌 / 临时区）',
    }),
    effect: Object.freeze({
      official: 'the official rule: an equipped item leaves its operator only on promotion, merge or sale — g.destroy refuses equipped items with "equipped items are locked"',
      allow: 'g.unequip takes one equipped item off its operator during prep and stows it (the hand right-to-left first, then the temporary slots); if neither has room the whole action is refused with HAND_FULL and nothing moves',
    }),
    actions: (option) => (option === 'allow' ? [{ kind: 'items.allowUnequip', value: true }] : []),
  },
});

/** 开关名，按声明顺序（界面 / 错误文案按它排）。 */
export const BEHAVIOUR_SWITCH_NAMES = Object.freeze(Object.keys(BEHAVIOUR_SWITCHES));

/**
 * 一个开关名是不是这份格式认识的开关。
 * @param {unknown} name @param {BehaviourTable} [table]
 */
export const isBehaviourSwitch = (name, table = BEHAVIOUR_SWITCHES) => typeof name === 'string' && Object.hasOwn(table, name);

/**
 * 一个选项名在这个开关上合不合法。
 * @param {string} sw @param {unknown} option @param {BehaviourTable} [table]
 */
export const isBehaviourOption = (sw, option, table = BEHAVIOUR_SWITCHES) => isBehaviourSwitch(sw, table)
  && /** @type {string[]} */ (table[sw].options).includes(/** @type {string} */ (option));

/** 这个表里有哪些开关（错误文案那一半）；空表时也要说清楚「一个都没有，因为没有实现点」。 */
const switchList = (table) => (Object.keys(table).length
  ? Object.keys(table).map((s) => `"${s}"`).join(', ')
  : 'none yet — this build declares no behaviour switch at all, because a switch is only added together with its engine-side implementation point');

/** 一个名字在文案里最多显示多少字符（一个手写坏掉的 pack.json 可以有几万字符的开关名）。 */
const clip = (s) => (typeof s === 'string' && s.length > MAX_NAME ? `${s.slice(0, MAX_NAME)}…` : s);

/**
 * 解析 `pack.json.behaviour` 的形状（**只有形状与闭枚举**，与 `shared/variants.js` 的 `parseVariantsDecl` 同一条
 * 分工：判据只有这一份，装载器与校验器都调它）。
 *
 * 收的形状：`[{ switch, option?, name?, desc? }]`，`switch` 必须是 `table` 的键，`option` 必须是那个开关
 * `options` 里的一个。允许**只声明开关、不写 `option`**（那时用这一格的 `default`）。
 *
 * 拒绝码（每一条都点名，绝不静默丢）：
 *   * `BEHAVIOUR_BAD_SHAPE`     — 不是数组 / 一条不是对象 / `switch` 不是非空字符串 / `option` 类型不对 /
 *                                 `name` / `desc` 不是字符串 / **出现未知字段**（`module`、`entry`、`file`、`path`、
 *                                 `value`、`key` 这类「想改文件 / 想给数值」的键都在这里被拒）；
 *   * `BEHAVIOUR_UNKNOWN_SWITCH`— `switch` 不在表里（文案里列出全部合法开关）；
 *   * `BEHAVIOUR_UNKNOWN_OPTION`— `option` 不在那个开关的 `options` 里（文案里列出这一格的全部选项）；
 *   * `BEHAVIOUR_BAD_OPTION`    — `option` 显式写成 `null` / `false` / 数字这类「不是选项名」的东西
 *                                 （与 `VARIANTS_BAD_DEFAULT` 同一条理由：非字符串会被读成「用了这一格的缺省」，
 *                                 即**静默不是作者写的那个**）；
 *   * `BEHAVIOUR_DUPLICATE_SWITCH` — 同一个开关声明了两次（一格开关只有一个值，写两遍是作者的真实错误）。
 *
 * 归一化结果**按开关名排序**：键序是清单字节的一部分（`identifyPack` 把归一化清单哈希进去），所以它绝不能随作者
 * 书写顺序变。`option` 与这一格的 `default` 相同时**仍然写出来** —— 作者写了什么就回什么，而「选缺省」与「没声明」
 * 在数据上等价这条由 `behaviourIsDefault` 承担，不是靠丢掉一个键。
 *
 * @param {any} raw `pack.json.behaviour`
 * @param {BehaviourTable} [table] 判据读的表。默认就是真的那一份；**入参**是为了让上面五条失败分支今天就能被
 *   `test/packBehaviour.test.js` 用一份合成表逐条走一遍（见文件头那段「表是入参」）。
 * @returns {{ ok: true, decl: Array<{ switch: string, option: string, name: string|null, desc: string|null }> }
 *          | { ok: false, error: string, detail: string }}
 */
export function parseBehaviourDecl(raw, table = BEHAVIOUR_SWITCHES) {
  if (!Array.isArray(raw)) {
    return fail('BEHAVIOUR_BAD_SHAPE', `"behaviour" must be an array of { switch, option? } entries — one per rule switch this pack pins. Known switches: ${switchList(table)}`);
  }
  /** @type {Array<{ switch: string, option: string, name: string|null, desc: string|null }>} */
  const out = [];
  const seen = new Set();
  for (const [i, entry] of raw.entries()) {
    const where = `behaviour[${i}]`;
    if (!isPlainObj(entry)) return fail('BEHAVIOUR_BAD_SHAPE', `${where} must be an object of { switch, option? } — got ${Array.isArray(entry) ? 'an array' : typeof entry}`);
    for (const key of Object.keys(entry)) {
      // 闭字段集：一个我们不认识的键如果只是被读过去，作者看到的是「包合法、加载了、可我写的那件事没发生」。
      // 而 `module` / `entry` / `file` / `path` / `value` 这几个具体的名字更要在**这里**就死掉 —— 它们是
      // 「安装器」那半张脸的形状（本文件头那条红线），不是这一层将来可能加的东西。
      if (key !== 'switch' && key !== 'option' && key !== 'name' && key !== 'desc') {
        return fail('BEHAVIOUR_BAD_SHAPE', `${where}: "${clip(key)}" is not a declared field (switch, option, name, desc). A behaviour declaration names a switch and one of its options — it never carries a module, a file, a path or a number (DESIGN §28.43)`);
      }
    }
    if (typeof entry.switch !== 'string' || !entry.switch) {
      return fail('BEHAVIOUR_BAD_SHAPE', `${where}.switch must be a non-empty string (one of: ${switchList(table)})`);
    }
    const name = entry.switch;
    if (!isBehaviourSwitch(name, table)) {
      return fail('BEHAVIOUR_UNKNOWN_SWITCH', `${where}.switch "${clip(name)}" is not a switch of this 行为 format. Known switches: ${switchList(table)} — a declaration the loader does not know is never applied, so it is refused instead of ignored`);
    }
    if (seen.has(name)) {
      return fail('BEHAVIOUR_DUPLICATE_SWITCH', `${where}.switch "${name}" is declared twice — one switch has exactly one option per pack`);
    }
    seen.add(name);
    const spec = table[name];
    const options = /** @type {string[]} */ (spec.options);
    let chosen = spec.default;
    if (entry.option !== undefined) {
      if (typeof entry.option !== 'string' || !entry.option) {
        return fail('BEHAVIOUR_BAD_OPTION', `${where}.option must be one of the option names of "${name}" (${options.map((o) => `"${o}"`).join(', ')}), got ${entry.option === null ? 'null' : typeof entry.option} — a non-string option would be read as "the switch default", i.e. silently not what the author wrote`);
      }
      if (!options.includes(entry.option)) {
        return fail('BEHAVIOUR_UNKNOWN_OPTION', `${where}.option "${clip(entry.option)}" is not an option of "${name}". Its options are: ${options.map((o) => `"${o}"`).join(', ')} (${spec.label})`);
      }
      chosen = entry.option;
    }
    /** @type {string|null} */
    let label = null;
    /** @type {string|null} */
    let desc = null;
    for (const [key, max] of /** @type {Array<[string, number]>} */ ([['name', MAX_NAME], ['desc', MAX_TEXT]])) {
      const v = entry[key];
      if (v === undefined || v === null) continue;
      if (typeof v !== 'string' || !v.trim()) {
        return fail('BEHAVIOUR_BAD_SHAPE', `${where}.${key} must be a non-empty string when present`);
      }
      if (v.length > max) return fail('BEHAVIOUR_BAD_SHAPE', `${where}.${key} is longer than ${max} characters`);
      if (key === 'name') label = v; else desc = v;
    }
    out.push({ switch: name, option: chosen, name: label, desc });
  }
  if (!out.length) {
    return fail('BEHAVIOUR_BAD_SHAPE', '"behaviour" must declare at least one switch — an empty array is a declaration that does nothing, which is exactly the failure mode this field exists to prevent');
  }
  // 键序 = 清单字节（`identifyPack`）：按开关名排序，不随作者书写顺序变。
  out.sort((a, b) => (a.switch < b.switch ? -1 : a.switch > b.switch ? 1 : 0));
  return { ok: true, decl: out };
}

/**
 * 归一化的 `behaviour` 声明里，一个开关的取值（没声明这一格 ⇒ null）。
 * @param {Array<{ switch: string, option: string }>|null|undefined} decl @param {string} sw
 * @param {BehaviourTable} [table]
 * @returns {string|null}
 */
export function behaviourValue(decl, sw, table = BEHAVIOUR_SWITCHES) {
  if (!Array.isArray(decl)) return null;
  const hit = decl.find((e) => e && e.switch === sw);
  return hit && typeof hit.option === 'string' ? hit.option : null;
}

/** 这一格的取值是不是「引擎今天的行为」（即不动任何东西）。没声明这一格也算。 */
export function behaviourIsDefault(decl, sw, table = BEHAVIOUR_SWITCHES) {
  const v = behaviourValue(decl, sw, table);
  return v === null || (isBehaviourSwitch(sw, table) && v === table[sw].default);
}

/**
 * 表自身的守卫：一格开关少了 `actions` / `options` / `default` / `optionLabels` / `effect`，或者 `default` 不在
 * `options` 里、`options` 是空的、某个选项缺 `effect` / `optionLabels`，都在这里逐条报出来。
 *
 * **为什么是纯函数**：一份只在今天的数据上成立、从来没验过失败分支的守卫，和没有守卫是一回事
 * （`shared/modSurface.js` 的 `surfaceLedgerIssues` 逐字同一条理由）。所以它可以被喂一份**合成的**表来测
 * 失败分支 —— `test/packBehaviour.test.js` 两半都钉（今天的空表 + 一份故意做坏的表）。
 *
 * @param {BehaviourTable} table
 * @returns {string[]} 人话说明；空数组 = 表自己对得上
 */
export function behaviourSwitchIssues(table) {
  const out = [];
  for (const [name, spec] of Object.entries(table || {})) {
    const at = `BEHAVIOUR_SWITCHES["${name}"]`;
    if (!spec || typeof spec !== 'object') { out.push(`${at} 不是一条声明`); continue; }
    for (const key of ['label', 'effect', 'optionLabels', 'actions']) {
      const v = spec[key];
      const ok = key === 'actions' ? typeof v === 'function' : key === 'label' ? typeof v === 'string' && !!v : isPlainObj(v);
      if (!ok) out.push(`${at}.${key} 缺失或类型不对 —— 少了 ${key} 的开关加进来就是「声明了、装上了、什么都没发生」`);
    }
    if (!Array.isArray(spec.options) || !spec.options.length) { out.push(`${at}.options 必须是非空数组`); continue; }
    if (typeof spec.default !== 'string' || !spec.options.includes(spec.default)) {
      out.push(`${at}.default 必须是 options 里的一个（缺省＝引擎今天的行为，缺省写错就是悄悄改默认游戏行为）`);
    }
    for (const opt of spec.options) {
      if (!spec.effect || typeof spec.effect[opt] !== 'string') out.push(`${at}.effect["${opt}"] 缺失 —— 一格开关必须说清每个选项动了什么`);
      if (!spec.optionLabels || typeof spec.optionLabels[opt] !== 'string') out.push(`${at}.optionLabels["${opt}"] 缺失`);
    }
  }
  return out;
}

/**
 * **行为开关 → 引擎动作**：这一层的执行点，也是「包里没有数值、没有路径」这条纪律的落点。
 *
 * 每一个动作都是 `{ kind, value }`：`kind` 是引擎自己的具名动作，`value` 只能来自 `table` 的这一格或引擎常量。
 * **包永远给不出 `value`** —— 这就是为什么这一层不必（也不能）是一个通用 patch 分发器。
 *
 * 表空 ⇒ 返回空数组（今天没有任何一格可以声明，所以也**没有**任何一条动作）。传进来一条**未经归一化**的声明
 * （开关名不在表里）时，这里也照旧点名拒 —— 判据只有一份，而执行点不假设调用方一定先归一化过。
 *
 * @param {Array<{ switch: string, option: string }>|null|undefined} decl 一个**已归一化**的包声明列表（多包先合并）
 * @param {BehaviourTable} [table]
 * @returns {{ ok: true, actions: Array<{ kind: string, value: unknown }> } | { ok: false, error: string, detail: string }}
 */
export function behaviourActions(decl, table = BEHAVIOUR_SWITCHES) {
  /** @type {Array<{ kind: string, value: unknown }>} */
  const actions = [];
  for (const entry of Array.isArray(decl) ? decl : []) {
    if (!entry || !isBehaviourSwitch(entry.switch, table)) {
      return fail('BEHAVIOUR_UNKNOWN_SWITCH', `"${clip(entry && entry.switch)}" is not a switch of this 行为 format. Known switches: ${switchList(table)}`);
    }
    const spec = table[entry.switch];
    const options = /** @type {string[]} */ (spec.options);
    const option = typeof entry.option === 'string' && options.includes(entry.option) ? entry.option : spec.default;
    actions.push(...spec.actions(option));
  }
  return { ok: true, actions };
}

/**
 * 多包的开关合成（DESIGN §28.3 的既有规则：**包 id 字典序小的赢**，与数据记录、kit、图标、口径逐字同一条）。
 *
 * 一格开关只能有一个值，而两个包可以对同一格声明不同的选项。判据不是「谁后加载」（那会让结果依赖扫描顺序），
 * 而是这一层已有的那一条：按包 id 排序后的**第一个**声明赢，输的一方由调用方点名报告（`行为开关被 X 覆盖`）。
 *
 * @param {Array<{ id?: string, behaviour?: Array<{ switch: string, option: string }> }>} packs
 * @param {BehaviourTable} [table]
 * @returns {{ decl: Array<{ switch: string, option: string, by: string }>, overridden: Array<{ switch: string, by: string, lostTo: string, value: string }> }}
 */
export function mergeBehaviourDecls(packs, table = BEHAVIOUR_SWITCHES) {
  const sorted = (Array.isArray(packs) ? packs : [])
    .filter((p) => p && typeof p === 'object' && typeof p.id === 'string' && p.id)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  /** @type {Map<string, { switch: string, option: string, by: string }>} */
  const won = new Map();
  const overridden = [];
  for (const pack of sorted) {
    if (!Array.isArray(pack.behaviour)) continue;
    for (const entry of pack.behaviour) {
      if (!entry || !isBehaviourSwitch(entry.switch, table)) continue;
      const held = won.get(entry.switch);
      if (!held) {
        won.set(entry.switch, { switch: entry.switch, option: entry.option, by: pack.id });
        continue;
      }
      if (held.option !== entry.option) {
        overridden.push({ switch: entry.switch, by: pack.id, lostTo: held.by, value: entry.option });
      }
    }
  }
  const decl = [...won.values()].sort((a, b) => (a.switch < b.switch ? -1 : a.switch > b.switch ? 1 : 0));
  return { decl, overridden };
}
