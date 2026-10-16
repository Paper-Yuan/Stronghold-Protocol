// shared/modSurface.js — 包能碰的**表面清单**（pack-facing ABI）与冻结账本。
// (i18n-ignore-file: 这是给维护者与 AI 读的接口清单与拒绝理由，不是客户端界面文案)
//
// WHY THIS FILE EXISTS (owner's question of 2026-10-10: 「如果改动引擎，我们的中间层可能又被覆盖，那怎么办呢」)
//
// 引擎会被上游移植改写 —— `server/lobby.js`、`server/match/*`、`public/js/screens/*` 都会整段换掉。中间层
// （工坊包这一整套契约）**不能靠「没人会动它」活着**：一份没有清单、没有守卫的契约，被一次重构顺手删掉时
// 没有任何测试会红。所以这里把「包能依赖的表面」写成一张**可断言的表**：
//
//   表面 = 一条声明 + 一个承载它的符号 + 一组实现文件 + 一份钉死它的测试 + 一节设计稿。
//
// `test/modSurface.test.js` 逐条断言这张表：锚点符号还在、成员还在、实现文件还在、测试文件还在、设计稿那节还在，
// 并且 `shared/workshop.js` 里**每一个**「包可声明的名单」都被某一条表面引用 —— 于是「引擎里加了一格但没进清单」
// 与「引擎里删了一格而清单还说它在」两种断裂都会当场变红。这是移植时的唯一防线，比任何注释都硬。
//
// 与 `test/modSurface.test.js` 前半部分的分工：那一半钉的是**就地补丁式**社区 mod 依赖的通用名
// （`data/backups.json` 的记录形状、`kits/shared/tier1.js` 的具名导出、`battle.refreshRange`）—— 那些 mod 不经过
// 我们的校验器；这一半钉的是**工坊包**依赖的声明层 ABI —— 它经过校验器，但校验器只能保证「今天判得过」，
// 保证不了「明天这一格还在」。
//
// 版本政策（与 docs/design/mod-layer.md §28.5 的三档判定配套）：
//   * 这一张表属于**一个 ABI 世代**（`shared/constants.js MOD_API_VERSION`）。包用 `pack.json.api` 声明它要的世代。
//   * 世代的数字**只在「删除 / 改名 / 改语义」时抬**；**加一格不抬** —— 加一格对已发布的包是纯增量，
//     抬数字会让所有写了 `api: "1.x"` 的老包被判 `MOD_API_INCOMPATIBLE` 而拒绝加载，那是在惩罚老包。
//   * `MOD_SURFACE_FROZEN` 是**冻结账本**：每个世代必须仍然全部在场的 id 列表。删掉一格而没抬世代 =
//     守卫红（`surfaceLedgerIssues`）。抬世代时，被删的那一格必须同时给出迁移说明，写在 docs/MOD-SURFACE.md。

/**
 * 一张表面的形状。字段的用法都是断言用的，不是装饰：
 * @typedef {object} ModSurface
 * @property {string} id            稳定标识（也是 docs/MOD-SURFACE.md 里的那一行）
 * @property {'A'|'B'|'C'} layer    A 内容 / B 服务端逻辑 / C 客户端界面（DESIGN §28.1 的三层）
 * @property {string} decl          `pack.json` 里的声明路径 —— 作者写的那一行
 * @property {Array<{symbol: string, members?: string[]}>} anchors
 *   承载它的**导出符号**（`shared/workshop.js` 的名单常量等）。守卫会 import 真模块并断言符号存在、`members` 仍在。
 * @property {string[]} requires    用它还必须满足什么（硬闸门、确定性、两端一致…）—— 「这一格不是白给的」
 * @property {string[]} files       实现它的引擎文件（改了这些文件就要回头看这一格）
 * @property {string[]} tests       钉死它的测试文件
 * @property {string} spec          定义它的设计稿小节（`docs/design/mod-layer.md`）
 */

/** 包能碰的全部表面。**顺序即阅读顺序**：A 内容 → B 服务端 → C 客户端 → 发行。 */
export const MOD_SURFACE = Object.freeze([
  // ------------------------------------------------------------------ A 层：内容
  {
    id: 'content',
    layer: 'A',
    decl: 'pack.json.content[] + <file>.json',
    anchors: [{ symbol: 'WORKSHOP_CONTENT_FILES' }, { symbol: 'PACK_FIELDS', members: ['content'] }],
    requires: ['记录形状照抄官方（test/modSurface.test.js 前半钉的那 14 个键）', '确定性：数据不是代码，改不了对局结果'],
    files: ['shared/workshop.js', 'server/workshop.js', 'server/data.js'],
    tests: ['test/workshop.test.js', 'test/workshopPack.test.js'],
    spec: '§28.13',
  },
  {
    id: 'traits.grantsBonds',
    layer: 'A',
    // 一格「记录里的字段」（与 `content` / `overrides` 同一层，但不是一条新的 `pack.json` 声明）：一条 chess 记录
    // 的 `trait.grantsBonds` 写什么，谁算哪个盟约的成员就跟着变 —— 而成员资格决定 count / tier / 层数，
    // 所以这一格**改对局结果**，必须像 `behaviour` 那样有具名读取点、锚点、测试与一节文档。
    decl: '<file>.json 的一条 chess 记录：`trait.grantsBonds = ["<bondId>", …]`',
    // 三个锚点各钉一半：**键名**（`TRAIT_GRANT_KEY`）、**这一格唯一的判据**（`grantedBondsByTrait`）、以及
    // **成员资格的合并本体**（`memberBonds`）。三处读取点调的是后两个，改名 = 打断所有声明这一格的包。
    anchors: [
      { symbol: 'TRAIT_GRANT_KEY', module: 'morph' },
      { symbol: 'grantedBondsByTrait', module: 'morph' },
      { symbol: 'memberBonds', module: 'morph' },
    ],
    requires: [
      '`bondId` 必须是**这台机器上真的有的**盟约 id（`bonds.json`，含别的已装包加进去的）：不存在的 id 会被**点名**（启动日志 `report.traitGrants` + `npm run workshop:validate` 的 `TRAIT_GRANT_UNKNOWN_BOND`），并且**永远进不了计数**（读取点的 `hasBond` 挡掉）；引擎**不拒包**',
      '形状写歪同样点名，一个都不许静默：不是数组 / 数组里有非空字符串以外的东西 ⇒ `TRAIT_GRANT_BAD_SHAPE`，空数组 ⇒ `TRAIT_GRANT_EMPTY`（静默降级正是这一格要修的老毛病）',
      '**不写这一格 ⇒ 逐字节不变**（特质今天完全不参与计数）：官方 266 条记录一条都没有它，`test/golden/*.json` 不需要 `golden:update`',
      '判据只有一份：`shared/morph.js` 的 `grantedBondsByTrait`；成员资格的**合并**也只有一份（`memberBonds`）—— prep 的 `bondsMeta.pieceBonds`、战斗的 `support/index.js unitBonds`、客户端的 `gameLogic/bonds.js`（`pieceBondIds` 与 `bondMembers` 两处读者）都调它',
      '`trait` 必须是**记录上的对象**：sim 里读 `def.raw.trait`，**不是** `def.trait`（那是投影出来的文本字符串，没有子键）',
    ],
    files: [
      'shared/morph.js', 'shared/workshop.js', 'shared/chessAuthoring.js', 'server/data.js',
      'server/match/bondsMeta.js', 'server/sim/content/support/index.js', 'public/js/ui/gameLogic/bonds.js',
    ],
    tests: ['test/traitGrants.test.js'],
    spec: '§28.49',
  },
  {
    id: 'overrides',
    layer: 'A',
    decl: 'pack.json.overrides[] = "<文件>:<id>"',
    anchors: [{ symbol: 'OVERRIDE_ENTRY_RE' }, { symbol: 'PACK_FIELDS', members: ['overrides'] }],
    requires: ['覆盖官方条目必须显式声明（否则改的是别人的东西）'],
    files: ['shared/workshop.js', 'server/workshop.js'],
    tests: ['test/overrideMode.test.js', 'test/workshopValidateOverrides.test.js'],
    spec: '§28.3',
  },
  {
    id: 'units.operators',
    layer: 'A',
    decl: 'pack.json.operators / pack.json.support + units.json',
    anchors: [{ symbol: 'UNIT_REQUIRED_FIELDS' }, { symbol: 'PACK_FIELDS', members: ['operators', 'support'] }],
    requires: ['干员记录必须带 UNIT_REQUIRED_FIELDS 那几个键'],
    files: ['shared/workshop.js', 'server/workshop.js', 'tools/build-data.mjs'],
    tests: ['test/workshopOperators.test.js', 'test/workshopSupport.test.js'],
    spec: '§28.10',
  },
  {
    id: 'media.voices',
    layer: 'A',
    decl: 'pack.json.voices / voiceLangs + voices/<charId>/<槽位>.<ext>',
    anchors: [{ symbol: 'WORKSHOP_MEDIA_PREFIX' }, { symbol: 'PACK_FIELDS', members: ['voices', 'voiceLangs'] }],
    requires: ['只服务声明过的 URL（未登记的路径 404，穿越没有目标）'],
    files: ['shared/workshop.js', 'server/workshop.js', 'server/http/static.js'],
    tests: ['test/workshopVoices.test.js', 'test/voicePack.test.js'],
    spec: '§28.13',
  },
  {
    id: 'media.icons',
    layer: 'A',
    decl: 'pack.json.bondIcons / itemIcons / art',
    anchors: [{ symbol: 'ART_TABLES' }, { symbol: 'PACK_FIELDS', members: ['bondIcons', 'itemIcons', 'art'] }],
    requires: ['图标路径必须是包内相对路径', '素材不进 git（public/assets/ 被忽略）'],
    files: ['shared/workshop.js', 'server/workshop.js', 'server/modCatalog.js'],
    tests: ['test/workshopBondIcons.test.js', 'test/workshopItemIcons.test.js', 'test/workshopArt.test.js'],
    spec: '§28.13',
  },
  {
    id: 'skins',
    layer: 'A',
    decl: 'pack.json.skins[] = { id, charId, name, series?, desc?, art?, voices? } + 包内素材',
    // 三处锚点各钉一半：**字段闭集**（写错的名字点名拒绝，SKIN_FIELDS）、**顶层声明**（PACK_FIELDS 里有
    // `skins`，否则这个键会被 PACK_UNKNOWN_FIELD 拒掉）、以及**落点**（合并进 `assets.skins` 的那一条）。
    anchors: [{ symbol: 'SKIN_FIELDS' }, { symbol: 'PACK_FIELDS', members: ['skins'] }, { symbol: 'SKIN_ID_RE' }],
    requires: [
      '`art` 与 `art.chars` 同形（复用同一套解析器：路径必须包内相对、spine 要齐 skel + atlas）—— 引擎不认识「皮肤」，这里只判形状',
      '**数据**在包声明里，**行为**（哪一套生效）在一个注册了的外观提供者里（`client.panels[].appearance`）',
      '一个进程最多一个外观提供者，且玩家可以用设置里的「工坊外观」把它整个关掉 ⇒ 关掉时解析链与不装包逐字相同',
    ],
    files: ['shared/workshop.js', 'server/workshop.js', 'public/js/ui/portraitChain.js', 'public/js/ui/extensions.js'],
    tests: ['test/workshopSkins.test.js', 'test/ui/portraitChain.test.js', 'test/lobby-appearance.test.js'],
    spec: '§28.28',
  },
  {
    id: 'notices',
    layer: 'A',
    decl: 'pack.json.notices = { <栏目>: <文本> }',
    anchors: [{ symbol: 'PACK_FIELDS', members: ['notices'] }],
    requires: ['纯文本，结构化但不执行'],
    files: ['shared/workshop.js', 'server/notices.js'],
    tests: ['test/packNotices.test.js', 'test/modNoticesPanel.test.js'],
    spec: '§28.15',
  },
  {
    id: 'i18n',
    layer: 'A',
    decl: 'pack.json.i18n = { <code>: <包内 .json> }',
    anchors: [{ symbol: 'PACK_FIELDS', members: ['i18n'] }],
    requires: ['语言文件名必须是语言码（`/i18n/<code>.json` 就是这条声明的 URL）'],
    files: ['shared/workshop.js', 'server/http/static.js'],
    tests: ['test/modI18n.test.js'],
    spec: '§28.13',
  },
  // ------------------------------------------------------------------ B 层：服务端逻辑
  {
    id: 'server.preDispatch',
    layer: 'B',
    decl: 'pack.json.server.preDispatch = { module, policy, intercepts }',
    anchors: [{ symbol: 'SERVER_MEMBERS', members: ['preDispatch'] }],
    requires: ['intercepts 必须是 shared/protocol.js C2S 里的类型名（总线不会送一个没人发的名字）'],
    files: ['shared/workshop.js', 'server/modDispatch.js', 'server/http/websocket.js'],
    tests: ['test/modPreDispatch.test.js'],
    spec: '§28.13',
  },
  {
    id: 'server.meta',
    layer: 'B',
    decl: 'pack.json.server.meta = { module, registers }',
    anchors: [{ symbol: 'SERVER_MEMBERS', members: ['meta'] }, { symbol: 'META_KEY_CLASSES' }],
    requires: ['registers 的每一类都要有对应键（否则那条声明永远不生效）'],
    files: ['shared/workshop.js', 'server/match/metaPack.js', 'server/match/Match.js'],
    tests: ['test/packMeta.test.js', 'test/packMetaWiring.test.js'],
    spec: '§28.13',
  },
  {
    id: 'server.modules',
    layer: 'B',
    decl: 'pack.json.server.modules = { module, uses[], channels? }',
    anchors: [
      { symbol: 'SERVER_MEMBERS', members: ['modules'] },
      { symbol: 'SERVER_MODULE_USES' },
      { symbol: 'MAX_SERVER_MODULE_CHANNELS' },
    ],
    requires: [
      '只允许 uses 里那几个生命周期钩子（闭枚举；加一格不抬世代）',
      '源码过静态确定性扫描（无 process / require / eval）—— **这一条从 2026-10-11 起真的实现了**：' +
        '`server/modModules.js serverModuleSourceIssues` 在 `import()` **之前**跑 `stripComments` + `mentionsIdentifier`，' +
        '取 `SERVER_CODE_FORBIDDEN_GLOBALS`（与 server.meta / battle / room 三处**同一张共享表**）**去掉 `globalThis` 一格**：' +
        '承诺逐字是那三个名字，而仓库里有一个能用的 server.modules 模块用 `globalThis` 与同进程测试通信（判死它就会裁掉那个合法包）。' +
        'kit 那一段（时钟 / 随机 / DOM / 计时器）**刻意不取**：这一层的挂载点都在对局之外跑，要读进程信息请用 host.metrics',
      // 这一格唯一的**网络触发点**：`uses` 含 `matchClass`（⇒ 必须 `combat: true`）的包，其 MatchClass 子类上的
      // `handlePackMsg(playerId, msg)` 会在 `pack.msg` 限流之后、转发之前被调到一次；返回 `true` /
      // `{ consumed: true }` = 已消费（不再转发），其余返回值与抛错都按未消费继续转发。
      '`matchClass` 子类上的 `handlePackMsg(playerId, msg)` 是唯一一条由消息驱动的调用点（见 DESIGN §28.14）',
      // 接收通道声明面（DESIGN §28.23）：`channels` 是**可选**的模块字段，但一旦声明就有四条硬判据 ——
      // 名字与面板那半边**共用一份判据**（`PACK_CHANNEL_RE`）、每条还必须被本包某个面板的 `messages` 声明过
      //（`MODULES_UNKNOWN_CHANNEL`，否则客户端根本发不出来），且该模块必须挂 `matchClass`（没有接收人就不许声明）。
      '`channels`（接收通道，§28.23）的每个名字要同时被本包的 `client.panels[].messages` 声明过，且该模块必须挂 `matchClass` —— 投递进对局 = 改得了结果，所以整包仍须 `combat: true`；发送者身份由平台从会话与座位解析（客户端载荷里自称的 from / seat 不作数）',
      '`uses` 里含 `metrics` / `route` 的两格改不了对局（一个是只读标量快照，一个是只读 GET），所以都**不**要求 `combat: true`（§28.34 / §28.35）',
      '`healthz` 与 `onBoot` 的读数口径见 §28.37：`/healthz` 的 `ok` 恒 true、恒 200（「不 ok 时 503」做不到，如实写在那一节）',
    ],
    files: ['shared/workshop.js', 'server/modModules.js', 'server/hostMetrics.js', 'server/http/routeMount.js', 'server/lobby.js', 'shared/kitAuthoring.js'],
    tests: ['test/packServerModules.test.js', 'test/packServerModulesWire.test.js', 'test/packMatchMsg.test.js', 'test/packServerSurface.test.js', 'test/modMatchChannels.test.mjs'],
    spec: '§28.14',
  },
  {
    id: 'server.transport',
    layer: 'B',
    decl: 'pack.json.server.transport = { deflate, threshold?, level?, memLevel?, concurrencyLimit?, … }',
    anchors: [{ symbol: 'TRANSPORT_FIELDS' }, { symbol: 'SERVER_MEMBERS', members: ['transport'] }],
    requires: [
      '**只是声明**：包永远不能注入服务端代码去改 `wss`（业主裁决「声明式足够就不做」）—— 那是进程启动选项写权限',
      '`deflate` 必填（没有开关的块什么都没说）；其余字段是闭集 + 上下界（`TRANSPORT_BOUNDS`）',
      '进程级：`perMessageDeflate` 是 `WebSocketServer` 的构造选项。多包声明时包 id 小的赢，其余点名；生效值进启动日志',
      '`welcome.transport` 报的是**生效值**（`{ deflate, params, maxPayload, threshold }`），不是声明值；`MOD_API_VERSION` 不动（加法）',
    ],
    files: ['shared/workshop.js', 'server/index.js', 'server/http/websocket.js', 'server/lobby.js'],
    tests: ['test/packServerSurface.test.js'],
    spec: '§28.33',
  },
  {
    id: 'server.modules.metrics',
    layer: 'B',
    decl: 'server.modules[].uses 含 "metrics" ⇒ `host.metrics()`',
    anchors: [{ symbol: 'HOST_METRICS_FIELDS', module: 'hostMetrics' }, { symbol: 'BOOT_CONFIG_ENV_KEYS', module: 'modModules' }],
    requires: [
      '**是值不是句柄**：深冻结的标量对象（`uptimeSec` / `rss` / `heapUsed` / `elu` / `loopP*` / `sampleAgeMs` / `state`），没有 `process`、没有直方图、没有定时器、没有函数',
      '惰性启用：直方图与采样定时器只在真有包声明 `metrics` 时才建（没装的进程开销为零）',
      '样本过期 ⇒ `loopP*` 一律 `null` + `state: "stale"` + 点名 warn 一次（既不静默空白，也不报旧值）',
      '`onBoot` 的回调收到一份**深冻结只读配置快照** `{ port, host, stateDir, env }`；`env` 只带 `BOOT_CONFIG_ENV_KEYS` 白名单。**包只能观察不能设值**，也永远不能**声明**启动变量',
      '没声明就抛 `MODULE_USE_UNDECLARED`（不是 `undefined`）',
    ],
    files: ['server/hostMetrics.js', 'server/modModules.js', 'server/index.js'],
    tests: ['test/packServerSurface.test.js'],
    spec: '§28.34',
  },
  {
    id: 'server.modules.route',
    layer: 'B',
    decl: 'server.modules[].uses 含 "route" ⇒ `host.route(path, fn, { cache? }?)`',
    anchors: [{ symbol: 'RESERVED_ROUTE_PREFIXES', module: 'routeMount' }, { symbol: 'DYNAMIC_ROUTE_CACHE_POLICIES', module: 'routeMount' }],
    requires: [
      '路径必须在 `/mod/<包id>/…` 里（命名空间里有包 id ⇒ 冲突与顶掉核心路径在结构上不可能），并且再判一遍核心保留路径表',
      '只有 GET / HEAD；缓存只有 `no-store` / `no-cache`（没有 `public`）；响应体有上限（64 KB）',
      '回调必须**同步**返回 JSON 可序列化的值（`Promise` 点名拒绝并回 500 —— 单进程事件循环，这一格不做每请求隔离）',
      '认证口径与引擎其余 HTTP 面逐字一致：**没有认证**，所以 `host.route` 不是私有通道（要私有数据落 `host.io`）',
      '静态 `pack.json.routes` 通道仍然按「声明过的路径就是声明过的路径」行事；保留路径表本批只施加在动态通道上（§28.35 记了这条不对称）',
    ],
    files: ['server/http/routeMount.js', 'server/http/static.js', 'server/modModules.js', 'server/index.js'],
    tests: ['test/packServerSurface.test.js'],
    spec: '§28.35',
  },
  {
    id: 'media.voices.cdn',
    layer: 'A',
    decl: 'pack.json.voices / voiceLangs 里的 `{ url, sha256, file }` 条目（作者自备 CDN）',
    anchors: [{ symbol: 'VOICE_CDN_FIELDS' }, { symbol: 'VOICE_CDN_AUDIO_EXTS' }],
    requires: [
      '**协议只认 `https:`**（`http:` / `data:` / `file:` / 协议相对 / URL 里带凭据一律拒）',
      '`sha256` 是作者声明的内容摘要：取回来的字节必须对上，对不上就**不落盘、不服务**',
      '**绝不内置任何官方语音地址、也绝不新增下载路由**：主机名只来自 `pack.json`，取回来的字节由**既有**的 `/workshop-assets/` 送出',
      '**不放宽 `VOICE_LANG_*`**，也不加任何便于拿官方语音的通道',
      '失败要响亮：逐条点名 warn + 那条台词从客户端读的语音表里摘掉（回落默认配音，而不是留一条永远 404 的静音）',
      '声明了 CDN 条目就必须写 `license`；CDN 条目不需要 `assets/` 文件夹，包内路径的既有规则一字未动',
    ],
    files: ['shared/workshop.js', 'server/voiceCdn.js', 'server/http/static.js', 'server/index.js'],
    tests: ['test/packServerSurface.test.js'],
    spec: '§28.36',
  },
  {
    id: 'server.battle',
    layer: 'B',
    decl: 'pack.json.server.battle = { module }',
    anchors: [{ symbol: 'SERVER_MEMBERS', members: ['battle'] }, { symbol: 'BATTLE_IMPORT_PREFIXES', module: 'kitImports' }],
    requires: ['combat: true（硬闸门：它改得了对局结果）', '两端跑同一段字节', 'import 只能走 @battle/ 与 @sim/'],
    files: ['shared/workshop.js', 'shared/kitImports.js', 'server/workshop.js', 'server/battlePack.js', 'server/sim/content/index.js'],
    tests: ['test/packBattle.test.js'],
    spec: '§28.17',
  },
  {
    id: 'server.room',
    layer: 'B',
    decl: 'pack.json.server.room = { module }',
    anchors: [{ symbol: 'SERVER_MEMBERS', members: ['room'] }, { symbol: 'ROOM_IMPORT_PREFIXES', module: 'kitImports' }],
    requires: [
      '**不**是 combat 闸门：它拿到的是只读观察面（快照/访问器/订阅），返回值一律忽略 ⇒ 改不了谁在玩、装了什么、这一局的结果',
      'import 只能走 @sim/（刻意不新开 @room/：白名单是两端共用的一张表，而这一层只在服务端跑）',
      'W-B：房间声明了集合时只有它点名的包的钩子装上',
    ],
    files: ['shared/workshop.js', 'shared/kitImports.js', 'server/roomPack.js', 'server/workshop.js', 'server/lobby.js'],
    tests: ['test/packRoom.test.js'],
    spec: '§28.20',
  },
  {
    id: 'routes',
    layer: 'B',
    decl: 'pack.json.routes = [{ path, cache }]',
    anchors: [{ symbol: 'ROUTE_CACHE_POLICIES' }, { symbol: 'PACK_FIELDS', members: ['routes'] }],
    requires: [
      '路径与缓存策略都要在允许集合内（没有「包自己发明的缓存语义」）',
      '撞核心只丢**那一条声明**、不拒包，并响亮点名；判据是 `coreRouteShadow`（真文件 / 常量端点才算撞），'
        + '作者侧 `tools/workshop-validate.mjs` 读同一张表（撞 ⇒ error，落在命名空间但今天没文件 ⇒ warning），不许另抄一份',
    ],
    files: ['shared/workshop.js', 'server/http/routes.js', 'server/http/mods.js', 'server/http/workshop.js',
      'server/http/routeMount.js', 'tools/workshop-validate.mjs'],
    tests: ['test/modRoutes.test.js', 'test/workshopValidateRoutes.test.js'],
    spec: '§28.13',
  },
  {
    id: 'assets',
    layer: 'B',
    decl: 'pack.json.assets = { container, manifest, serverPolicy?, verify?, mirrors? }',
    anchors: [
      { symbol: 'ASSETS_SERVER_POLICIES' }, { symbol: 'ASSETS_VERIFY_ALGORITHMS' },
      // 作者自备 CDN 的镜像（§28.40）：字段闭集与两条形态判据。与 `VOICE_CDN_FIELDS` 同一类 —— 它们是「一个包
      // 可以写哪几个键」的那张表，写错的名字被点名拒绝（`ASSETS_MIRROR_UNKNOWN_FIELD`），所以必须被锚住。
      { symbol: 'ASSETS_MIRROR_FIELDS' }, { symbol: 'ASSETS_MIRROR_MAX' }, { symbol: 'ASSETS_MIRROR_ID_RE' },
    ],
    requires: [
      '装载期核对声明的摘要（对不上就不服务）',
      'server: serve | cache-only 二选一',
      '`mirrors[]` **只镜像本包自己的容器**：`base` 必须是绝对 https、`sha256` 必须等于装载期从包内文件算出的容器摘要，对不上的那条**停用**并点名（不拒包）—— 服务端不为这条通道发一次网络请求',
    ],
    files: ['shared/workshop.js', 'server/workshop.js', 'server/http/static.js', 'server/http/workshop.js', 'public/js/resources/host.js'],
    tests: ['test/modAssets.test.js', 'test/packAssets.test.js', 'test/workshopAssets.test.js', 'test/modAssetsMirrors.test.js'],
    spec: '§28.13',
  },
  {
    id: 'behaviour',
    layer: 'B',
    // 与 `variants`（§28.39）是**同一形状、不同一张表**：包声明的是「哪一格开关、哪一档」，不是「改成几」、
    // 更不是「改哪个文件」。第 4 刀落这一格时表是**空的**（通道 + 守卫本身）；第 8 刀起表里有实现好的格
    // （`shopBias` / `prepLoadout` / `morphPairing`），随后 `unequip` 也带着自己的读取点落了进来 —— 今天
    // **4 格**，每一格都带**引擎侧的读取点** —— 所以这里锚的是**表、顶层键，以及这四格的读取点**：
    // 表里加一格必须同时进本清单、进 docs/MOD-SURFACE.md，并补一节文档。
    decl: 'pack.json.behaviour = [{ switch, option?, name?, desc? }]',
    anchors: [
      { symbol: 'BEHAVIOUR_SWITCHES', module: 'behaviour' },
      { symbol: 'PACK_FIELDS', members: ['behaviour'] },
      // 表里每一格的引擎侧读取点（第 8 刀起；表里再加一格 ⇒ 照这个形状再加一个可锚的符号）
      { symbol: 'bondBiasPreference', module: 'pool' },
      { symbol: 'bondBiasBonds', module: 'economy' },
      { symbol: 'LOADOUT_PHASES', module: 'platform' },
      { symbol: 'loadoutPhasesFor', module: 'platform' },
      { symbol: 'MORPH_PAIRING_OPTIONS', module: 'morph' },
      { symbol: 'grantedBondsByMorph', module: 'morph' },
      // 第 7 段：`morphPairing` 的**装备位语义**那半条（同一格开关）。判据收成一个策略对象，六个读取点都读它：
      // 服务端 `player/items.js` / `player/acquire.js` / `bot.js` / `invariants.js`，客户端
      // `ui/detailPanel.js` 与 `ui/gameLogic/placement.js`。这四个符号是那一格的可锚面。
      { symbol: 'morphSlotPolicy', module: 'morph' },
      { symbol: 'matchSlotPolicy', module: 'morph' },
      { symbol: 'OFFICIAL_SLOT_POLICY', module: 'morph' },
      { symbol: 'PLUS_SLOT_POLICY', module: 'morph' },
      { symbol: 'equipSlotsUsed', module: 'morph' },
      { symbol: 'unequipAllowed', module: 'items' },
    ],
    requires: [
      '闭枚举：开关名与选项名都只许取 `BEHAVIOUR_SWITCHES` 里有的（`BEHAVIOUR_UNKNOWN_SWITCH` / `BEHAVIOUR_UNKNOWN_OPTION`，整包拒，不是忽略）',
      '**包里没有数值、也没有路径**：动作（`{ kind, value }`）由引擎构造，`value` 只来自那一格或引擎常量 —— 这一格**永远**不是一条数值 / 文件覆盖通道（那是安装器，`docs/WORKSHOP.md` §1.1）',
      '**不是贡献项**：一个只带 `behaviour` 的包照旧 `EMPTY_PACK`（与 `variants` / `support` / `playtest` 同一条）',
      '必须 `combat: true`（第五条硬闸门 `BEHAVIOUR_NEEDS_COMBAT`）：一格的入场券本就是「它改一条规则」⇒ 必须进房间摘要闸门与 golden 语料',
      '不声明 ⇒ 归一化清单里**不长出这个键**（无条件写 `behaviour: []` 会让所有已发布包的内容哈希改变，§28.2）；**必须**进包身份哈希（`server/workshop.js` 的 `canonicalJson(pack)`），**不进** `modDigest`（只哈希 `[id, hash]`）',
      '加一格的门槛：**那一格必须已经在引擎里有实现点**（比 `VARIANT_AXES` 的加轴纪律更严）—— 本版那 4 格就是按这条落的，每一格都有一处具名读取点与一个测试文件',
    ],
    files: ['shared/workshop.js', 'shared/behaviour.js', 'shared/morph.js', 'server/index.js', 'server/match/pool.js', 'server/match/player/economy.js', 'server/match/match/platform.js', 'server/match/player/items.js'],
    tests: ['test/packBehaviour.test.js', 'test/shopBias.test.js', 'test/prepLoadout.test.js', 'test/morphPairing.test.js', 'test/unequip.test.js'],
    spec: '§28.43',
  },
  {
    id: 'target',
    layer: 'A',
    // 与 `content` / `notices` 同一类：一个**清单字段**，不是执行面。它的特殊性在值指向**另一个宿主**：
    // `stardust` 的包本引擎只认识、不装载（`server/workshop.js` 的 `foreign`），所以它既不是贡献项，也不进
    // 数据叠加层。这一格的判据是「闭枚举 + 闭集例外」—— `PACK_TARGETS` 与 `STARDUST_TARGET_FIELDS` 各是一条名单，
    // 加一格必须同时进本清单与 docs/MOD-SURFACE.md。
    decl: 'pack.json.target = "forge" | "stardust"',
    anchors: [
      { symbol: 'PACK_TARGETS' },
      { symbol: 'STARDUST_TARGET_FIELDS' },
      { symbol: 'PACK_FIELDS', members: ['target'] },
    ],
    requires: [
      '闭枚举：只许 `PACK_TARGETS` 里有的（`PACK_TARGET_UNKNOWN`，整包拒，不是忽略）',
      '缺省 `forge`；不写 ⇒ 归一化清单里**不长出这个键**（无条件写会让所有已发布包的内容哈希改变，§28.2）',
      '`stardust` 是**声明型包**：本引擎认识、不装载、不进数据叠加层，启动日志一行具名（`server/workshop.js` 的 `foreign`）',
      '`stardust` 目标额外放行 `STARDUST_TARGET_FIELDS`，以及**声明过的能力自己认领的字段**（`STARDUST_CAPABILITY_FIELDS`）；`forge` 一个都不放行',
      '`stardust` 的包不受 `EMPTY_PACK` 约束（它没有 Forge 贡献项是正常形态）',
    ],
    files: ['shared/workshop.js', 'server/workshop.js'],
    tests: ['test/modTarget.test.mjs'],
    spec: '§28.46',
  },
  {
    id: 'dependencies',
    layer: 'A',
    // 与 `content` / `notices` 同一类：一个**清单字段**（形状在 `shared/workshop.js` 判）。它的特殊性在
    // **语义只在装载期成立** —— 「缺不缺这个依赖」要等本机真的装了哪些包才知道，所以这一格的判据分两半：
    // 形状在这一层（`parseModRefsDecl`），跨包裁决在加载器那一步（`adjudicatePackGraph`，§28.48）。
    decl: 'pack.json.dependencies[] = { id, range? }',
    anchors: [{ symbol: 'PACK_FIELDS', members: ['dependencies'] }],
    requires: [
      '`id` 必须是**另一个工坊包**的 id（`PACK_ID_RE` 同一套字符集；`DEPENDENCIES_BAD_ID` 整包拒，绝不留到装载期拼路径）',
      '`range` 是那个包 `version` 的区间（`shared/packs.js` 的同一套语法，缺省 = 任意版本；`DEPENDENCIES_BAD_RANGE`）',
      '逐字重复的条目去重并按 (id, range) 排序；同一个 id 配两个 range ⇒ `DEPENDENCIES_CONFLICTING_RANGES` 整包拒（不许猜作者的意思）',
      '**语义在装载期裁决**（`adjudicatePackGraph`）：缺失 / 版本不合 / 级联 / 循环 ⇒ 依赖方被拒，全部具名（`server/index.js` 一行启动日志）',
      '**不是贡献项**：只声明依赖的包照旧 `EMPTY_PACK`（`notContributions` 逐字点名它）',
      '不声明 ⇒ 归一化清单里不长这个键（无条件写会让所有已发布包的内容哈希改变，§28.2）',
    ],
    files: ['shared/workshop.js', 'server/workshop.js', 'server/index.js'],
    tests: ['test/modDependencies.test.mjs'],
    spec: '§28.48',
  },
  {
    id: 'conflicts',
    layer: 'A',
    // 与 `dependencies` 同一条通道的**反向**声明：不是「我要谁」，而是「我不要谁」。两者共用同一个形状解析器、
    // 同一个装载期裁决，差别只在裁决方向（互斥时 **id 大的那个**被拒）。
    decl: 'pack.json.conflicts[] = { id, range? }',
    anchors: [{ symbol: 'PACK_FIELDS', members: ['conflicts'] }],
    requires: [
      '形状与错误码同 `dependencies`（`CONFLICTS_` 前缀：`BAD_SHAPE` / `BAD_ENTRY` / `UNKNOWN_FIELD` / `BAD_ID` / `BAD_RANGE` / `CONFLICTING_RANGES`）',
      '**包 id 大的那个被拒**（与既有裁决「同 id 抢占按包 id 排序」同一条确定性来源）；双方都声明时同一条边只裁决一次',
      '带 `range` 时只有**区间匹配**才互斥（依赖包没写 `version` 时视为满足，见 §28.48）',
      '**不是贡献项**：只声明互斥的包照旧 `EMPTY_PACK`',
      '不声明 ⇒ 归一化清单里不长这个键（§28.2）',
    ],
    files: ['shared/workshop.js', 'server/workshop.js', 'server/index.js'],
    tests: ['test/modDependencies.test.mjs'],
    spec: '§28.48',
  },
  {
    id: 'enabled',
    layer: 'B',
    // 装好 ≠ 生效（§28.50）。与 `variants` / `behaviour` 同一形状：包声明的是**一个布尔**，不是数值、不是路径。
    // 补的缺口是「留着这个包、但现在不要它生效」在今天没有表达方式 —— 只能删目录，而删目录与停用是两件事。
    decl: 'pack.json.enabled = true | false',
    anchors: [
      { symbol: 'PACK_FIELDS', members: ['enabled'] },
      { symbol: 'ENABLED_BAD_SHAPE', module: 'enabled' },
    ],
    requires: [
      '**只有布尔**：`"false"` / `0` / `null` 一律 `ENABLED_BAD_SHAPE` 整包拒 —— 一个被 JS 真值表放行的假布尔是静默失效',
      '**缺省 = 引擎今天的行为**：不写 `enabled` 的包与今天逐字相同；写了 `true` 同样逐字相同',
      '**不是贡献项**：只带 `"enabled": true` 的包照旧 `EMPTY_PACK`（与 `variants` / `playtest` 同一条）',
      '`false` 的包**不进入**已加载集合，进 `loadWorkshop` 的 `errors`（`ENABLED_FALSE`）—— 跳过必须响亮，一个静默消失的包更难查',
      '不声明 / 写 `true` ⇒ 归一化清单里**不长出这个键**（否则所有已发布包的内容哈希改变，§28.2）；写 `false` **必须**进包身份哈希（它做的与缺席不是同一件事）',
      '**不是热更新**：装载期读一次，改它要重启（DESIGN §28.4 的「No hot reload」不受影响）',
    ],
    files: ['shared/workshop.js', 'shared/enabled.js', 'server/workshop.js'],
    tests: ['test/packEnabled.test.js'],
    spec: '§28.50',
  },
  // ------------------------------------------------------------------ C 层：客户端界面
  {
    id: 'client.panels',
    layer: 'C',
    decl: 'pack.json.client.panels[] = { id, slot, module, order, gate }',
    anchors: [{ symbol: 'CLIENT_PANEL_SLOTS' }, { symbol: 'CLIENT_PANEL_REPEATABLE' }],
    requires: ['slot 必须是引擎渲染得出的宿主（九个之一）', '一个声明用不了就点名丢掉整个面板，不挂半个'],
    files: ['shared/workshop.js', 'server/workshop.js', 'server/http/workshop.js', 'public/js/ui/extensions.js'],
    tests: ['test/modClientPanels.test.js', 'test/modClientHosts.test.js'],
    spec: '§28.8',
  },
  {
    id: 'client.panels.me',
    layer: 'C',
    decl: '（无声明：`ctx.me` 是引擎**总是**给的那一格只读会话态）',
    // 这一格没有 schema 符号（它不是 pack.json 里的一条声明，而是引擎**总是**注入的读数），所以锚在
    // **引擎自己那一端的真相**上：客户端的面板契约表（`public/js/ui/extensions.js` 的 `MOD_PANEL_SLOTS`
    // 与 `MOD_PANEL_REPEATABLE`）。宿主键那一半（`hostKey`）就是同一份契约里的概念。
    anchors: [{ symbol: 'MOD_PANEL_SLOTS', module: 'extensions' }, { symbol: 'SLOT_KEY_ATTR', module: 'extensions' }],
    requires: [
      '只读：`playerId` / `name` / `room`（展示面快照）+ `snapshot()` 一次取全；每次读取当前值（面板挂上不重挂）',
      '**没有** store 句柄、match / battle 对象、battleRunner、audio —— 边界仍由「不传什么」保证',
      '**不含** `search`（野排匹配态活在房间屏自己的 useState 里，store 没有；提升它是另一件事）',
      '宿主键（`ctx.hostKey`）来自容器的 `data-mod-slot-key`：可重复宿主每张卡一个，`screen.loadout.detail` 也给',
    ],
    files: ['public/js/ui/extensions.js', 'public/js/ui/detailPanel.js'],
    tests: ['test/modClientPanels.test.js'],
    spec: '§28.22',
  },
  {
    id: 'client.panels.wraps',
    layer: 'C',
    decl: 'pack.json.client.panels[].wraps[] = { component, mode }',
    anchors: [{ symbol: 'CLIENT_WRAP_COMPONENTS' }, { symbol: 'CLIENT_WRAP_MODES' }],
    requires: [
      'component 必须是引擎注册表里的具名组件；mode 是 wrap | replace',
      'wrap 每帧调用一次，拿到的是 vnode；replace 拿到的 orig 是 null（下方整段不渲染由引擎保证）',
      '面板除了今天那份冻结注入面，只多 component 与 props（只读深拷贝）——没有 store、没有 engine、没有 match',
      '任一环抛错或返回空：退回**它下面那一份**并点名一次（CLIENT_WRAP_THREW / CLIENT_WRAP_NO_RENDER），屏幕照旧',
    ],
    files: ['shared/workshop.js', 'public/js/ui/extensions.js', 'public/js/ui/modComponents.js', 'server/workshop.js'],
    tests: ['test/modPanelWraps.test.js'],
    spec: '§28.19',
  },
  {
    id: 'kits.relativeImports',
    layer: 'B',
    decl: 'kits/<id>.js 里的 ./… 相对 import（含 kits/_shared.js 之类的辅助文件）',
    anchors: [{ symbol: 'KIT_IMPORT_PREFIXES', module: 'kitImports' }, { symbol: 'KIT_IMPORT_FILES', module: 'kitImports' }],
    requires: [
      '只允许**向下**相对：`..`、绝对路径、`%`、反斜杠、非 .js、空段一律仍拒（URL 里没有 kits/ 段，`..` 两端走不出同样层数）',
      '按**出现 import 的那个文件**自己的目录解析，服务端重写成 file: URL，浏览器按模块自己的 URL 原生解析 —— 两端同一个文件',
      '/workshop-kits/<包>/<rel> 只服务已装载包 kits/ 子树里的 .js（一次解码、path.relative 判界、非 .js 与穿越同一个 404）',
      '辅助文件的字节进身份哈希（kits/**/*.js 递归），因为改它就能改战果，而摘要正是 W-D 对齐比较的对象',
      '顶层非 `_` 的 .js 才算 kit；子目录与 `_` 前缀是辅助文件',
      '作者侧的提示必须与这条判据同步 —— 但那只是**镜像**，不是实现依赖：shared 与服务端代码一律不引用编辑器的路径',
    ],
    files: ['shared/kitImports.js', 'server/workshop.js', 'server/http/static.js', 'server/http/workshop.js'],
    tests: ['test/packRelativeImports.test.js', 'test/kitImports.test.js'],
    spec: '§28.18',
  },
  {
    id: 'client.panels.styles',
    layer: 'C',
    decl: 'pack.json.client.panels[].styles[] = "<包内 .css>"',
    anchors: [{ symbol: 'WORKSHOP_PANEL_PREFIX' }],
    requires: ['只服务登记过的 URL', '样式是加法：挂载时注入 <link>，dispose 时移除'],
    files: ['shared/workshop.js', 'server/http/workshop.js', 'public/js/ui/extensions.js'],
    tests: ['test/modClientStyles.test.js'],
    spec: '§28.8',
  },
  {
    id: 'client.theme',
    layer: 'C',
    decl: 'pack.json.client.theme.vars = { --x: <值> }',
    anchors: [{ symbol: 'CLIENT_REQUIRES' }],
    requires: ['变量名必须 -- 开头（不叫 --x 的键写进去等于什么都没发生）', '值里不许有 ; { } < > 换行'],
    files: ['shared/workshop.js', 'public/js/ui/extensions.js'],
    tests: ['test/modClientStyles.test.js'],
    spec: '§28.8',
  },
  {
    id: 'client.panels.data',
    layer: 'C',
    decl: 'pack.json.client.panels[].data[] = "<表名>"',
    anchors: [{ symbol: 'CLIENT_PANEL_DATA_TABLES' }],
    requires: ['表必须在 CLIENT_PANEL_DATA_TABLES 里（浏览器本来就抓得到的那几张）', '读到的是只读快照，不是引擎的缓存本体'],
    files: ['shared/workshop.js', 'public/js/ui/extensions.js', 'public/js/data.js'],
    tests: ['test/modClientData.test.js', 'test/modClientHosts.test.js'],
    spec: '§28.8',
  },
  {
    id: 'client.panels.messages',
    layer: 'C',
    decl: 'pack.json.client.panels[].messages[] = "<通道名>"',
    anchors: [{ symbol: 'CLIENT_PANEL_SLOTS' }],
    requires: ['线上类型名由引擎定（pack.msg），通道名由包定', '每会话令牌桶限流，data ≤ 4096 字节'],
    files: ['shared/workshop.js', 'shared/protocol.js', 'server/net.js', 'public/js/ui/extensions.js'],
    tests: ['test/modClientMessages.test.js'],
    spec: '§28.8',
  },
  {
    id: 'client.requires',
    layer: 'C',
    decl: 'pack.json.client.requires[] = serviceWorker | cacheStorage | webCrypto',
    anchors: [{ symbol: 'CLIENT_REQUIRES' }],
    requires: ['缺一即「这个浏览器不支持」，不是「装了但静默不工作」'],
    files: ['shared/workshop.js', 'public/js/ui/extensions.js'],
    tests: ['test/modClientHosts.test.js'],
    spec: '§28.13',
  },
  {
    id: 'client.sources',
    layer: 'C',
    decl: '（无声明：面板模块导出 `sources(ctx)`；地址只在 `pack.json.assets.mirrors[]`）',
    // 与 `client.panels.me` 同一条做法：这一格**不是** `pack.json` 里的一条声明（它是模块的一个导出，与
    // `appearance(ctx)` 同族），所以锚在**引擎自己那一端的真相**上 —— 排序面那个模块的具名导出。
    anchors: [
      { symbol: 'orderDeclared', module: 'sources' },
      { symbol: 'setSourceOrder', module: 'sources' },
      { symbol: 'setSourcesEnabled', module: 'sources' },
    ],
    requires: [
      '**结构上不可能引入主机名**：`sources(ctx)` 只回**已声明 id 的排列/子集**，喂主机名 / URL ⇒ `CLIENT_SOURCES_BAD_ORDER`，整条顺序作废、回落声明顺序',
      '进程内最多一个提供者（`CLIENT_SOURCES_TAKEN`）；一个只导出 `sources` 而不 `mount` 的面板不是错',
      '玩家设置里的「工坊素材源」关掉 ⇒ 导入路径与「没有这一格」逐字相同（这是那个包把加载源改坏时的一键回退）',
      '导入次序是硬性的：**先核整包 sha256**（必须 `checked && ok`）⇒ 再走既有逐文件 SHA-1[0:12]；任何一步不过就换下一条，全都不行则回落包内那条 `/workshop-resources/…` URL 并**点名**（不静默、不空白）',
    ],
    files: ['public/js/resources/sources.js', 'public/js/resources/host.js', 'public/js/ui/extensions.js', 'public/js/ui/settings.js'],
    tests: ['test/modAssetsMirrors.test.js', 'test/modClientPanels.test.js'],
    spec: '§28.40',
  },
  {
    id: 'forms',
    layer: 'C',
    decl: 'pack.json.forms = { chars|enemies|tokens: { "<spine id>": { "<形态名>": { change?, end?, leave?, next?, roles } } } }',
    anchors: [
      // 锚点住在 `shared/packForms.js`（形态通道的统一入口），不是 `schema` —— 三张名单都在那里，
      // 所以 `module` 必须写出来，否则守卫会去 `shared/workshop.js` 找一个不存在的导出。
      { symbol: 'FORM_TABLES', module: 'packForms' },
      { symbol: 'FORM_KIND_RE', module: 'packForms' },
      { symbol: 'FORM_ROLE_KEYS', module: 'packForms' },
      { symbol: 'PACK_FIELDS', members: ['forms'] },
    ],
    requires: [
      '第一方 `FORMS` 优先：与第一方同名的形态在形状层就被 `FORMS_FIRST_PARTY_OVERLAP` 拒掉（宁可拒绝，不要静默丢掉）',
      '`roles` 的键必须是 `FORM_ROLE_KEYS` 里的，clip 名必须是非空字符串（或 `{ begin, loop, end }`）',
      '`next` 必须指向同一个 spine id 上已声明的形态（第一方或本包），否则 `FORMS_NEXT_UNKNOWN`',
      '包只做增量：合并结果里第一方的条目一个字节不变（`shared/packForms.js formsFor`）',
    ],
    files: ['shared/workshop.js', 'shared/packForms.js', 'shared/formNames.js', 'public/js/render/units.js', 'public/js/render/app.js', 'public/js/assets.js'],
    tests: ['test/packForms.test.js'],
    spec: '§28.29',
  },
  {
    id: 'fx.silentPhases',
    layer: 'C',
    decl: 'pack.json.fx = { silentPhases: ["<phase kind>", …] }',
    anchors: [{ symbol: 'PACK_FIELDS', members: ['fx'] }],
    requires: [
      '并集：第一方那两个（`bombed` / `warning`）永远静默，包只能**加**，取消不了',
      '每一项必须是非空字符串（`FX_BAD_SILENT_PHASE`）；未知字段点名拒绝（`FX_UNKNOWN_FIELD`）',
      '落点是 `assets.silentPhases`，`fxSpec` 在每一个特效上同步查它',
    ],
    files: ['shared/workshop.js', 'public/js/assets.js', 'public/js/render/fx/kinds.js'],
    tests: ['test/packForms.test.js'],
    spec: '§28.29',
  },
  // ------------------------------------------------------------------ 发行：房间集合与对齐
  {
    id: 'mods.catalog',
    layer: 'C',
    decl: '客户端 mod 目录与房间声明（welcome.modPanels / room modIds）',
    anchors: [{ symbol: 'PACK_ID_RE' }],
    requires: ['房间声明了 modIds 时，只有它点名的包参与（W-B）', '两端的字节要能对齐（W-D：摘要一致才开局）'],
    // `server/packFiles.js` 加进来是业主裁决 B（§28.2）的直接后果：**一个枚举器**同时产出身份哈希的文件清单与
    // 客户端下载清单，两份清单漂移 = 干净客户端下不到「被声明模块 import 的那个文件」。所以它也是这一格的一部分
    // —— 改名或挪走就是打断「摘要 = 下载清单 = 会被执行/读到的文件」这条契约。
    files: ['server/modCatalog.js', 'server/packFiles.js', 'server/roomAssets.js', 'public/js/mods/store.js', 'public/js/mods/align.js', 'public/js/mods/sync.js'],
    tests: ['test/modCatalog.test.js', 'test/packFileSet.test.js', 'test/modAlign.test.js', 'test/roomModSet.test.js'],
    spec: '§28.16',
  },
]);

/** id → 表面。 */
export const MOD_SURFACE_BY_ID = Object.freeze(new Map(MOD_SURFACE.map((s) => [s.id, s])));

/** 全部 id，按表的顺序。 */
export const MOD_SURFACE_IDS = Object.freeze(MOD_SURFACE.map((s) => s.id));

/**
 * 冻结账本：**世代 → 该世代里必须仍然全部在场的 id**。
 *
 * 加一格不改这里（增量不需要新世代）；删一格而世代数字没抬，就是这里红。抬世代时把当世代那份抄下来、写成新的
 * 键，并在 docs/MOD-SURFACE.md 写明「哪一格被谁取代、老包怎么迁移」。
 *
 * **这个列表是逐字抄下来的字面量，不是 `MOD_SURFACE.map(...)` 的别名** —— 这一点是这个守卫存在的全部理由。
 * 曾经它写的是 `1: MOD_SURFACE_IDS`，而那是一个**恒真的守卫**：`MOD_SURFACE_IDS` 就是 `MOD_SURFACE` 自己派生的
 * 数组，所以账本与被检查的今天那份表**永远是同一个对象**（`MOD_SURFACE_FROZEN[1] === MOD_SURFACE_IDS` 为
 * `true`），`surfaceLedgerIssues` 里的 `have.has(id)` 也就永远成立 —— 从表里删掉一格时，账本跟着一起少一格，
 * 守卫一声不响。失败分支只被 `test/modSurface.test.js` 的**合成输入**覆盖过，真实代码路径从来没有红过。
 * 装饰性守卫比没有守卫更坏：它让人以为有保护。所以这里改成字面量（第二个真相，代价是抬世代时要手抄一遍，
 * 而那正是「冻结」两个字的含义）。
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const MOD_SURFACE_FROZEN = Object.freeze({
  1: Object.freeze([
    'content', 'overrides', 'units.operators', 'media.voices', 'media.icons', 'skins', 'notices', 'i18n',
    'server.preDispatch', 'server.meta', 'server.modules', 'server.battle', 'server.room', 'routes', 'assets',
    'client.panels', 'client.panels.me', 'client.panels.wraps', 'kits.relativeImports', 'client.panels.styles',
    'client.theme', 'client.panels.data', 'client.panels.messages', 'client.requires',
    'forms', 'fx.silentPhases', 'mods.catalog',
  ]),
});

/**
 * 账本的判据本身（**纯函数**，所以它自己可以被测：喂一份「少了一格」的列表进去必须报出来 —— 一条只在今天的数据
 * 上成立、从来没有验过失败分支的守卫，和没有守卫是一回事）。
 * @param {readonly string[]} ids 今天表里的 id
 * @param {number|string} generation 今天的 ABI 世代（`shared/constants.js MOD_API_VERSION`）
 * @returns {string[]} 人话说明；空数组 = 账本对得上
 */
export function surfaceLedgerIssues(ids, generation) {
  const out = [];
  const key = String(generation);
  const frozen = MOD_SURFACE_FROZEN[key];
  if (!frozen) {
    out.push(`没有世代 ${key} 的冻结账本：加了新世代就把它那一份 id 抄进 MOD_SURFACE_FROZEN["${key}"]，否则这一代没有任何防删保护`);
    return out;
  }
  const have = new Set(ids || []);
  for (const id of frozen) {
    if (!have.has(id)) {
      out.push(`表面 "${id}" 在世代 ${key} 的冻结账本里，但今天的表里没有了：删/改名/改语义都要抬 MOD_API_VERSION 并写明迁移，不能在一个世代里悄悄拿掉`);
    }
  }
  return out;
}

/**
 * 表里出现的全部锚点，写成 `"<模块>:<符号>"`（模块省略时是 `schema`，即 `shared/workshop.js`）—— 给守卫用：
 * 守卫不去猜，它 import 那几个模块再逐条查，所以「锚点写错名字」和「符号被挪走」都会红。
 * @returns {string[]}
 */
export function modSurfaceAnchorSymbols() {
  return [...new Set(MOD_SURFACE.flatMap((s) => s.anchors.map((a) => `${a.module || 'schema'}:${a.symbol}`)))].sort();
}
