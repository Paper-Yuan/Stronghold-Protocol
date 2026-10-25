# MOD-SURFACE.md — 包能碰的表面清单（Pack-facing ABI）

**面向对象：** 维护者和包作者——这份文档记录了工坊包能依赖的**引擎接口**（ABI），每一格都由测试守卫、实现文件锚定。

**另见：**
- **表面清单源文件**：[shared/modSurface.js](../shared/modSurface.js)
- **守卫测试**：[test/modSurface.test.js](../test/modSurface.test.js)
- **设计规范**：[design/mod-layer.md](design/mod-layer.md)（DESIGN §37）
- **包作者指南**：[WORKSHOP.md](WORKSHOP.md)

---

## 0. 为什么需要这份清单

### 0.1 问题：引擎会被重构改写

引擎代码会被上游移植改写——`server/lobby.js`、`server/match/*`、`public/js/screens/*` 都可能整段换掉。中间层（工坊包契约）**不能靠「没人会动它」活着**：一份没有清单、没有守卫的契约，被一次重构顺手删掉时没有任何测试会红。

### 0.2 解决方案：可断言的表面清单

把「包能依赖的表面」写成一张**可断言的表**：

**表面 = 声明 + 锚点符号 + 实现文件 + 测试文件 + 设计稿小节**

`test/modSurface.test.js` 逐条断言：
- ✓ 锚点符号还在
- ✓ 成员还在
- ✓ 实现文件还在
- ✓ 测试文件还在
- ✓ 设计稿那节还在

并且 `shared/workshop.js` 里**每一个**「包可声明的名单」都被某一条表面引用——于是「引擎里加了一格但没进清单」与「引擎里删了一格而清单还说它在」两种断裂都会当场变红。

### 0.3 版本政策

这张表属于**一个 ABI 世代**（`shared/constants.js MOD_API_VERSION`）。包用 `pack.json.api` 声明它要的世代。

**规则：**
- 世代数字**只在「删除 / 改名 / 改语义」时抬**
- **加一格不抬**——加一格对已发布的包是纯增量，抬数字会让所有写了 `api: "1.x"` 的老包被判 `MOD_API_INCOMPATIBLE`
- `MOD_SURFACE_FROZEN` 是**冻结账本**：每个世代必须仍然全部在场的 id 列表
- 删掉一格而没抬世代 → 守卫红（`surfaceLedgerIssues`）
- 抬世代时，被删的那一格必须同时给出迁移说明（写在本文档）

---

## 1. A 层：内容（Content Layer）

### 1.1 `content` — 数据文件

**声明：** `pack.json.content[] + <file>.json`

**锚点：** `WORKSHOP_CONTENT_FILES`、`PACK_FIELDS.content`

**要求：**
- 记录形状照抄官方（`test/modSurface.test.js` 前半钉的那 14 个键）
- 确定性：数据不是代码，改不了对局结果

**可用文件：**
```javascript
['chess', 'units', 'items', 'enemies', 'stages', 'waves', 
 'tokens', 'bosses', 'factions', 'garrisons', 'bands', 
 'bonds', 'effects', 'choices']
```

**实现文件：**
- `shared/workshop.js`
- `server/workshop.js`
- `server/data.js`

**测试文件：**
- `test/workshop.test.js`
- `test/workshopPack.test.js`

**文档：** DESIGN §28.13

---

### 1.2 `traits.grantsBonds` — 特质授予盟约

**声明：** `<file>.json` 的一条 chess 记录：`trait.grantsBonds = ["<bondId>", …]`

**锚点：** `TRAIT_GRANT_KEY`、`grantedBondsByTrait`、`memberBonds`

**要求：**
- `bondId` 必须是**这台机器上真的有的**盟约 id（`bonds.json`，含别的已装包加进去的）
- 不存在的 id 会被**点名**（启动日志 `report.traitGrants` + `TRAIT_GRANT_UNKNOWN_BOND`），并且**永远进不了计数**
- 形状写歪同样点名：不是数组 / 数组里有非字符串 → `TRAIT_GRANT_BAD_SHAPE`，空数组 → `TRAIT_GRANT_EMPTY`
- **不写这一格 ⇒ 逐字节不变**（特质今天完全不参与计数）
- 判据只有一份：`shared/morph.js` 的 `grantedBondsByTrait`；成员资格的**合并**也只有一份（`memberBonds`）
- `trait` 必须是**记录上的对象**：sim 里读 `def.raw.trait`，**不是** `def.trait`

**实现文件：**
- `shared/morph.js`
- `shared/workshop.js`
- `shared/chessAuthoring.js`
- `server/data.js`
- `server/match/bondsMeta.js`
- `server/sim/content/support/index.js`
- `public/js/ui/gameLogic/bonds.js`

**测试文件：**
- `test/traitGrants.test.js`

**文档：** DESIGN §37.17

---

### 1.3 `overrides` — 明确覆盖官方数据

**声明：** `pack.json.overrides[] = "<文件>:<id>"`

**锚点：** `OVERRIDE_ENTRY_RE`、`PACK_FIELDS.overrides`

**要求：**
- 覆盖官方条目必须显式声明（否则改的是别人的东西）

**实现文件：**
- `shared/workshop.js`
- `server/workshop.js`

**测试文件：**
- `test/overrideMode.test.js`
- `test/workshopValidateOverrides.test.js`

**文档：** DESIGN §28.3

---

### 1.4 `units.operators` — 干员与自选池 / 助战池

**声明：** `pack.json.operators / pack.json.support + units.json`

**锚点：** `UNIT_REQUIRED_FIELDS`、`PACK_FIELDS.operators`、`PACK_FIELDS.support`

**要求：**
- 干员记录必须带 `UNIT_REQUIRED_FIELDS` 那几个键：
  - `charId`（string）
  - `name`（string）
  - `rarity`（integer）
  - `profession`（string）
  - `subProfessionId`（string）
  - `forms`（object）

**实现文件：**
- `shared/workshop.js`
- `server/workshop.js`
- `tools/build-data.mjs`

**测试文件：**
- `test/workshopOperators.test.js`
- `test/workshopSupport.test.js`

**文档：** DESIGN §28.10

---

### 1.5 `media.voices` — 语音文件

**声明：** `pack.json.voices / voiceLangs + voices/<charId>/<槽位>.<ext>`

**锚点：** `WORKSHOP_MEDIA_PREFIX`、`PACK_FIELDS.voices`、`PACK_FIELDS.voiceLangs`

**要求：**
- 只服务声明过的 URL（未登记的路径 404，穿越没有目标）

**实现文件：**
- `shared/workshop.js`
- `server/workshop.js`
- `server/http/static.js`

**测试文件：**
- `test/workshopVoices.test.js`
- `test/voicePack.test.js`

**文档：** DESIGN §28.13

---

### 1.6 `media.icons` — 图标与立绘

**声明：** `pack.json.bondIcons / itemIcons / art`

**锚点：** `ART_TABLES`、`PACK_FIELDS.bondIcons`、`PACK_FIELDS.itemIcons`、`PACK_FIELDS.art`

**要求：**
- 图标路径必须是包内相对路径
- 素材不进 git（`public/assets/` 被忽略）

**实现文件：**
- `shared/workshop.js`
- `server/workshop.js`
- `server/modCatalog.js`

**测试文件：**
- `test/workshopBondIcons.test.js`
- `test/workshopItemIcons.test.js`
- `test/workshopArt.test.js`

**文档：** DESIGN §28.13

---

### 1.7 `skins` — 皮肤声明

**声明：** `pack.json.skins[] = { id, charId, name, series?, desc?, art?, voices? } + 包内素材`

**锚点：** `SKIN_FIELDS`、`PACK_FIELDS.skins`、`SKIN_ID_RE`

**要求：**
- `art` 与 `art.chars` 同形（复用同一套解析器：路径必须包内相对、spine 要齐 skel + atlas）
- 引擎不认识「皮肤」，这里只判形状
- **数据**在包声明里，**行为**（哪一套生效）在一个注册了的外观提供者里（`client.panels[].appearance`）
- 一个进程最多一个外观提供者，且玩家可以用设置里的「工坊外观」把它整个关掉

**实现文件：**
- `shared/workshop.js`
- `server/workshop.js`
- `public/js/ui/portraitChain.js`
- `public/js/ui/extensions.js`

**测试文件：**
- `test/workshopSkins.test.js`
- `test/ui/portraitChain.test.js`
- `test/lobby-appearance.test.js`

**文档：** DESIGN §37.19

---

### 1.8 `notices` — 公告与鸣谢

**声明：** `pack.json.notices = { <栏目>: <文本> }`

**锚点：** `PACK_FIELDS.notices`

**要求：**
- 纯文本，结构化但不执行

**实现文件：**
- `shared/workshop.js`
- `server/notices.js`

**测试文件：**
- `test/packNotices.test.js`
- `test/modNoticesPanel.test.js`

**文档：** DESIGN §28.15

---

### 1.9 `i18n` — 多语言补词条

**声明：** `pack.json.i18n = { <lang>: { <key>: <value> } }`

**锚点：** `PACK_FIELDS.i18n`

**要求：**
- 给**已有语种**补词条（不能新增语种）
- 已有键**绝不覆盖**（官方词条优先）

**实现文件：**
- `shared/workshop.js`
- `server/workshop.js`
- `server/http/workshop.js`

**测试文件：**
- `test/workshopI18n.test.js`

**文档：** DESIGN §37（§1.10）

---

### 1.10 `variants` — 口径声明

**声明：** `pack.json.variants = { <axis>: <option> }`

**锚点：** `VARIANT_AXES`、`PACK_FIELDS.variants`

**要求：**
- 需要 `combat: true`（改对局结果）
- 轴的定义在 `shared/variants.js VARIANT_AXES`（闭枚举）
- **不是**数据文件，是 `pack.json.variants` 声明

**可用轴：**
- `training`（训练等级）
- `deploy`（部署位数）

**实现文件：**
- `shared/variants.js`
- `shared/workshop.js`
- `server/workshop.js`

**测试文件：**
- `test/variants.test.js`
- `test/workshopVariants.test.js`

**文档：** DESIGN §37.9

---

### 1.11 `behaviour` — 行为开关

**声明：** `pack.json.behaviour = { <slot>: <option> }`

**锚点：** `BEHAVIOUR_SWITCHES`、`PACK_FIELDS.behaviour`

**要求：**
- 需要 `combat: true`（改对局结果）
- 与 `variants` 同形，但不同表（`shared/behaviour.js`）

**可用槽位：**
- `shopBias`（商店偏向）
- `prepLoadout`（准备装载）
- `morphPairing`（变形同构体配对规则）
- `unequip`（卸装规则）

**实现文件：**
- `shared/behaviour.js`
- `shared/workshop.js`
- `server/workshop.js`

**测试文件：**
- `test/behaviour.test.js`
- `test/workshopBehaviour.test.js`

**文档：** DESIGN §37.12

---

### 1.12 `forms` — Spine clip 集合

**声明：** `pack.json.forms = { <spineId>: { <form>: { clips } } }`

**锚点：** `PACK_FIELDS.forms`

**要求：**
- 第一方 `FORMS` 冻结不动，包只做增量
- 说的是「这个 spine id 还有哪些形态、每个形态用哪几条 clip」

**实现文件：**
- `shared/workshop.js`
- `server/workshop.js`

**测试文件：**
- `test/workshopForms.test.js`

**文档：** DESIGN §37.5

---

### 1.13 `fx.silentPhases` — 静音相位

**声明：** `pack.json.fx = { silentPhases: ["phase", …] }`

**锚点：** `PACK_FIELDS.fx`

**要求：**
- 第一方 `SILENT_PHASES` 冻结不动，包只做增量
- 说的是「这几个 'phase' 种类模型自己会表示，不要再撒一层通用特效」

**实现文件：**
- `shared/workshop.js`
- `server/workshop.js`

**测试文件：**
- `test/workshopFx.test.js`

**文档：** DESIGN §37.5

---

## 2. B 层：服务端逻辑（Server Layer）

### 2.1 `server.modules` — 服务端模块

**声明：** `pack.json.server.modules[] = "<name>"`

**锚点：** `PACK_FIELDS.server`

**要求：**
- 无 `process` / `require` / `eval`
- 确定性：同样的输入必须产生同样的输出
- 两端一致：服务端和客户端的行为必须一致

**实现文件：**
- `shared/workshop.js`
- `server/modModules.js`

**测试文件：**
- `test/modModules.test.js`

**文档：** DESIGN §37（服务端模块章节）

---

### 2.2 `server.transport` — 启动传输配置

**声明：** `pack.json.server.transport = { … }`

**锚点：** `PACK_FIELDS.server`

**要求：**
- 声明式启动传输配置
- 形状在加载期检查
- 服务器在启动前应用
- 不是代码，不在启动时运行

**实现文件：**
- `shared/workshop.js`
- `server/workshop.js`

**测试文件：**
- `test/workshopTransport.test.js`

**文档：** DESIGN §37.6

---

## 3. C 层：客户端界面（Client Layer）

### 3.1 `client.panels` — 客户端面板

**声明：** `pack.json.client.panels[] = { id, module, … }`

**锚点：** `WORKSHOP_PANEL_PREFIX`、`PACK_FIELDS.client`

**要求：**
- 面板模块必须真的存在
- 只服务声明过的模块路径

**实现文件：**
- `shared/workshop.js`
- `server/workshop.js`
- `server/http/static.js`

**测试文件：**
- `test/workshopPanels.test.js`

**文档：** DESIGN §28.8 / §28.13

---

## 4. 发行与元信息

### 4.1 `dependencies` / `conflicts` — 依赖与冲突

**声明：** `pack.json.dependencies[] = { id, range? }` / `pack.json.conflicts[] = { id }`

**锚点：** `PACK_FIELDS.dependencies`、`PACK_FIELDS.conflicts`

**要求：**
- 使用语义化版本范围（`^1.0.0`、`>=0.3.0 <0.4.0`）
- 装载期判定：缺依赖、版本不符、冲突、级联、循环 → 命名拒绝

**实现文件：**
- `shared/workshop.js`
- `server/workshop.js`

**测试文件：**
- `test/workshopDependencies.test.js`

**文档：** DESIGN §37.16

---

### 4.2 `enabled` — 启用声明

**声明：** `pack.json.enabled = false`

**锚点：** `ENABLED_FIELD_KEY`、`PACK_FIELDS.enabled`

**要求：**
- `false` = 装载期跳过
- 不是贡献项
- 判据只有一份：`shared/enabled.js parseEnabledDecl`

**实现文件：**
- `shared/enabled.js`
- `shared/workshop.js`
- `server/workshop.js`

**测试文件：**
- `test/workshopEnabled.test.js`

**文档：** DESIGN §37.18

---

## 5. 冻结账本（Frozen Ledger）

`MOD_SURFACE_FROZEN` 记录每个世代必须保留的表面 id。删除任何一格时：

1. **抬世代号**（`MOD_API_VERSION`）
2. **从冻结账本移除**
3. **在本文档写明迁移路径**

### 当前账本（API v1）

```javascript
MOD_SURFACE_FROZEN = [
  'content',
  'traits.grantsBonds',
  'overrides',
  'units.operators',
  'media.voices',
  'media.icons',
  'skins',
  'notices',
  'i18n',
  'variants',
  'behaviour',
  'forms',
  'fx.silentPhases',
  'server.modules',
  'server.transport',
  'client.panels',
  'dependencies',
  'conflicts',
  'enabled',
]
```

---

## 6. 迁移记录

### API v1 → v2（未来）

*（当第一次抬世代时，这里会记录删除的表面及其迁移路径）*

**示例格式：**

#### 删除：`deprecated.field`

**原因：** 被 `new.field` 取代

**迁移路径：**
```json
// 旧写法（API v1）
{
  "deprecated.field": "value"
}

// 新写法（API v2）
{
  "new.field": "value"
}
```

**影响：** 使用 `deprecated.field` 的包需要更新清单并升级 `pack.json.api` 到 `2`

---

## 7. 维护指南

### 7.1 加一格表面

**步骤：**
1. 在 `shared/modSurface.js` 的 `MOD_SURFACE` 数组里加一项
2. 补充实现文件（`shared/workshop.js` 等）
3. 写测试文件
4. 在 [design/mod-layer.md](design/mod-layer.md) 补一节文档
5. 更新本文档（添加新表面的说明）
6. **不要抬世代号**（加一格是纯增量）

### 7.2 删除一格表面

**步骤：**
1. **先抬世代号**（`MOD_API_VERSION`）
2. 从 `MOD_SURFACE_FROZEN` 移除该 id
3. 在本文档的「迁移记录」章节写明：
   - 删除原因
   - 迁移路径（代码示例）
   - 影响范围
4. 更新受影响的包示例
5. 在发布说明中标注为 BREAKING CHANGE

### 7.3 改名 / 改语义

与「删除」同样处理：抬世代号 + 写迁移路径。

---

## 8. 参考

### 8.1 核心模块

- `shared/modSurface.js`：表面清单与冻结账本
- `test/modSurface.test.js`：守卫测试
- `shared/workshop.js`：工坊格式与校验
- `shared/constants.js`：`MOD_API_VERSION`

### 8.2 文档

- [design/mod-layer.md](design/mod-layer.md)：DESIGN §37 完整规则
- [WORKSHOP.md](WORKSHOP.md)：包作者指南
- [PLUGINS.md](PLUGINS.md)：插件系统（新格式）

### 8.3 相关测试

- `test/modSurface.test.js`：表面守卫
- `test/workshop*.test.js`：各个表面的功能测试
- `test/golden/*.json`：黄金结果（确保不破坏向后兼容性）

---

**最后更新：** 2026-10-25  
**适用版本：** API v1（0.3.x）  
**当前世代：** `MOD_API_VERSION = 1`
