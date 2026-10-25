# WORKSHOP.md — 创意工坊包作者指南

**面向对象：** 工坊包（workshop pack）作者——在 `workshop/` 目录下放置自己的内容包，为游戏添加新干员、敌人、关卡、数值调整或行为扩展。

**另见：**
- **插件系统**（`plugins/`）：[PLUGINS.md](PLUGINS.md)、[PLUGIN-GUIDE.md](PLUGIN-GUIDE.md)（中文新手指南）、`plugins/AGENTS.md`（AI 代理指南）
- **设计规范**：[design/mod-layer.md](design/mod-layer.md)（DESIGN §37：工坊层的完整规则）
- **命令行工具**：`node tools/plugin.mjs`（检查、打包、安装插件）

---

## 0. 核心原则

### 0.1 什么是工坊包

工坊包（workshop pack）是放在 `workshop/<packId>/` 目录下的**纯数据扩展**：
- 一个 `pack.json` 清单文件
- 若干数据文件（`chess.json`、`units.json` 等）
- 可选的素材（语音、立绘、图标）
- 可选的行为层代码（`kits/*.js`）

### 0.2 工坊包 vs 插件

| 维度 | 工坊包（workshop pack） | 插件（plugin） |
|---|---|---|
| 目录 | `workshop/` | `plugins/` |
| 清单文件 | `pack.json` | `plugin.json`（manifest 2） |
| 定位 | 服务器管理员安装的扩展 | 服务器 + 客户端双向支持 |
| 用途 | 数据、玩法、行为 | 外观、语言、界面、脚本 |
| 版本 | 旧格式（0.2.x 开始） | 新格式（0.3.0 开始） |

**注意：** 本文档描述的是 `workshop/` 目录下的 **pack 格式**，不是 `plugins/` 目录下的 plugin 格式。如果你要做外观插件（换立绘、换模型）、界面插件或脚本插件，请阅读 [PLUGINS.md](PLUGINS.md)。

---

## 1. 包清单与字段

### 1.1 最小清单示例

```json
{
  "id": "my-pack",
  "name": { "zh": "我的包", "en": "My Pack" },
  "version": "1.0.0",
  "author": "Your Name",
  "license": "CC-BY-4.0",
  "gameVersion": ">=0.3.0 <0.4.0",
  "content": ["chess"]
}
```

### 1.2 字段规则（`PACK_FIELDS`）

`pack.json` 的**顶层键是闭集**：引擎只认识下面列出的字段。任何不在这张表里的字段都会导致**整包被拒绝**（拒绝码 `PACK_UNKNOWN_FIELD`），理由会列出所有合法字段。

**为什么这么严格？** 三个社区 mod 都撞上过同一面墙：
- `variants`（口径/变体）—— 作者写了，但引擎从没读过它，包"合法"加载了，功能却没生效
- `skins`（皮肤）—— 同上，静默丢弃
- `i18n`（多语言）—— 归一化结果里根本没有这个键

这三者都是「写了等于没写」，而且失败的方向是**静默**。所以这一层的判据是：**宁可当场说「这张表没有通道」，也不要收下一份没人读的声明**。

#### 身份与元信息

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `id` | string | ✓ | 包的唯一标识，2–32 个小写字母/数字/`-`，字典序最小者赢（冲突时） |
| `name` | object | ✓ | `{ zh, en }` 包名 |
| `version` | string | ✓ | 语义化版本号（`1.0.0`） |
| `author` | string/array |  | 作者名 |
| `license` | string |  | 许可证（`CC-BY-4.0`、`MIT` 等） |
| `description` | object |  | `{ zh, en }` 简介 |
| `gameVersion` | string |  | 兼容的游戏版本范围（`>=0.3.0 <0.4.0`） |
| `game` | string |  | 目标游戏标识符（默认 `arknights`） |
| `api` | number |  | API 版本（默认 1） |
| `layer` | string |  | 层标识（`data`、`behaviour`、`meta` 等） |
| `combat` | boolean |  | 是否影响对局结果（需要 `true` 才能声明 `variants`/`behaviour`/`form`） |

#### 内容与覆盖

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `content` | array | * | 要加载的数据文件列表（见 §1.3） |
| `overrides` | array |  | 明确覆盖官方数据的 `"<file>:<id>"` 列表 |

**贡献项（至少需要一项）：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `voices` | object | 语音文件：`{ <charId>: { <slot>: ["path", …] } }` |
| `voiceLangs` | array | 语音语种：`["zh", "en", "ja"]` |
| `bondIcons` | object | 盟约图标：`{ <bondId>: "path" }` |
| `itemIcons` | object | 道具图标：`{ <itemId>: "path" }` |
| `art` | object | 立绘/头像/模型（见 §5） |
| `skins` | array | 皮肤声明：`[{ id, charId, name, art?, voices? }]` |
| `support` | array | 助战池贡献（见 §2） |
| `operators` | array | 自选池贡献（见 §1.2） |
| `i18n` | object | 给已有语种补词条（§1.10） |

#### 行为与声明

| 字段 | 类型 | 说明 |
|---|---|---|
| `forms` | object | Spine clip 集合：`{ <spineId>: { <form>: { clips } } }` |
| `fx` | object | 特效配置：`{ silentPhases: ["phase", …] }` |
| `notices` | object | 公告/鸣谢文本 |
| `variants` | object | 口径声明（需要 `combat: true`，§37.9） |
| `behaviour` | object | 行为开关（需要 `combat: true`，§37.12） |
| `playtest` | boolean | 测试模式开关 |
| `enabled` | boolean | 是否启用（`false` = 装载期跳过） |

### 1.3 内容文件（`WORKSHOP_CONTENT_FILES`）

`content` 字段列出的文件**必须是下面列表中的一个**：

```javascript
['chess', 'units', 'items', 'enemies', 'stages', 'waves', 
 'tokens', 'bosses', 'factions', 'garrisons', 'bands', 
 'bonds', 'effects', 'choices']
```

**不在列表里的文件** → `PACK_UNKNOWN_CONTENT_FILE` 拒绝，理由：
- `variants` 和 `config` **没有内容通道**（见 §1.1）
- `variants` 是 `pack.json.variants` 声明，不是数据文件
- `config` 故意排除（它改的是规则，不是内容）

**为什么 `variants` 不是数据文件？**  
如果 `variants` 是一张 `{ id: record }` 文件，就等于开一条「包可以覆盖任意数值」的通道——那就是把**安装器**做进引擎。口径（训练等级、部署位）是**闭枚举的选项名**（`shared/variants.js` 的 `VARIANT_AXES`），值由引擎自己给，所以走 `pack.json.variants` 这一格。

### 1.4 干员记录必需字段（`UNIT_REQUIRED_FIELDS`）

`units.json` 的每一条干员记录**必须有**这几个字段：

| 字段 | 类型 | 缺了会怎样 | 拒绝码 |
|---|---|---|---|
| `charId` | string | 客户端无法请求这个干员的数据 | `UNIT_MISSING_CHAR_ID` |
| `name` | string | 干员显示为无名 | `UNIT_MISSING_NAME` |
| `rarity` | integer | 自选池界面画不出星级 | `UNIT_BAD_RARITY` |
| `profession` | string | 缺少职业标识 | `UNIT_MISSING_PROFESSION` |
| `subProfessionId` | string | 缺少分支标识（图标来自 `assets.prof.sub`） | `UNIT_MISSING_SUB_PROFESSION` |
| `forms` | object | 干员没有数值（精英/等级/技能/模组） | `UNIT_BAD_FORMS` |

**为什么只查这几个？** 这条记录的形状由**上游官方数据**决定（14 个顶层键），我们**不复制官方 schema**——复刻一份就是给自己加一个会漂移的第二真相，官方每次加字段我们都要跟一次。下游（`server/sim`、`server/match`）真正读的也只是这几个键。

---

## 2. 自选池与助战池

### 2.1 自选池贡献（`pack.json.operators`）

声明这个包的干员**可以进入自选池**：

```json
{
  "operators": ["my-pack_operator-001", "my-pack_operator-002"]
}
```

**规则：**
- 干员必须在本包的 `units.json` 里
- `charId` 必须以 `<包id>_` 开头（命名空间隔离）
- 不能声明官方干员或其他包的干员

### 2.2 助战池贡献（`pack.json.support`）

声明这个包的干员**可以作为助战**：

```json
{
  "support": [
    { "charId": "my-pack_operator-001", "tier": 1 },
    { "charId": "my-pack_operator-002", "tier": 2 }
  ]
}
```

**tier（档位）：** 1–3，影响出现概率（见 §37 文档）。

---

## 3. 叠加规则（overlay）

### 3.1 加法优先，覆盖需声明

`data/*.json` **不会被修改**——加载器在 `deepFreeze` 之前应用一层叠加（overlay）：
- **默认行为：** 官方数据已有的 id **不会被替换**
- **明确覆盖：** 在 `pack.json.overrides` 里列出 `"<file>:<id>"`

```json
{
  "content": ["chess"],
  "overrides": ["chess:chess_char_1_01-texas"]
}
```

### 3.2 谁赢？（冲突规则）

两个包声明同一个 id 时，**包 id 字典序最小者赢**，输的一方拿到一条 `PACK_CONFLICT_ID` 警告。

### 3.3 空包拒绝

包必须至少声明以下之一：
- `content` 里至少一个文件
- `voices` / `voiceLangs` / `bondIcons` / `itemIcons` / `art` / `skins` / `operators` / `support` / `i18n`

否则 → `EMPTY_PACK` 拒绝。

---

## 4. 行为层（kits）

### 4.1 什么是 kit

Kit 是 `workshop/<packId>/kits/<chessId>.js` 文件，一个文件对应一个棋子（干员/敌人/召唤物）。它是**服务器与浏览器都会加载**的纯逻辑代码，挂在 `battle.on(...)` 钩子总线上。

**两份加载路径：**
- 服务器：`server/workshop.js loadWorkshopKits`（真实路径）
- 浏览器：`public/js/battle/runner.js loadSpecKits`（URL）

### 4.2 导入白名单（§37.1）

Kit 只能从以下几个前缀导入：
- `@kit/...`（kit SDK）
- `@sim/...`（纯引擎 helper）
- `./lib/util.js`（同级兄弟文件，向下）

**禁止 `..` 上级引用**——浏览器 URL 的 `kits/` 段被去掉后，`..` 无法对齐两端的路径。

白名单由 `shared/kitImports.js KIT_IMPORT_FILES` 统一管理，服务器重写、浏览器 import map 和编辑器检查都读同一张表。

### 4.3 钩子（hooks）

Kit 通过 `battle.on(event, handler)` 订阅事件：

```javascript
export function setup(battle) {
  battle.on('spawn', ({ piece }) => {
    if (piece.chessId === 'my-pack_my-char') {
      // 初始化逻辑
    }
  });
}
```

**可用钩子：** 见 `shared/kitAuthoring.js HOOK_EVENTS`。

---

## 5. 素材与资源

### 5.1 语音（`pack.json.voices`）

```json
{
  "voices": {
    "my-pack_operator-001": {
      "battle-start": ["assets/voice/op001/start.mp3"],
      "skill-1": ["assets/voice/op001/skill1.mp3"]
    }
  },
  "voiceLangs": ["zh", "en"]
}
```

路径是**包内相对路径**（`workshop/<packId>/assets/voice/...`），服务器在 `/workshop-assets/<packId>/assets/voice/...` 发出。

### 5.2 立绘与头像（`pack.json.art`）

```json
{
  "art": {
    "chars": {
      "my-pack_operator-001": {
        "portrait": "assets/art/op001/portrait.png",
        "avatar": "assets/art/op001/avatar.png"
      }
    }
  }
}
```

### 5.3 图标

```json
{
  "bondIcons": {
    "my-pack_bond-001": "assets/icons/bond001.png"
  },
  "itemIcons": {
    "my-pack_item-001": "assets/icons/item001.png"
  }
}
```

---

## 6. 口径与行为开关

### 6.1 口径（`variants`，§37.9）

口径是**闭枚举的选项名**，不是数据文件。轴的定义在 `shared/variants.js VARIANT_AXES`。

```json
{
  "combat": true,
  "variants": {
    "training": "max",
    "deploy": "12"
  }
}
```

**需要 `combat: true`**，因为它改变对局结果。

### 6.2 行为开关（`behaviour`，§37.12）

与 `variants` 同一形状，但不同一张表（`shared/behaviour.js`）。

```json
{
  "combat": true,
  "behaviour": {
    "shopBias": "giveBondOnly",
    "morphPairing": "plus"
  }
}
```

今天的表有四格：`shopBias`、`prepLoadout`、`morphPairing`、`unequip`。

---

## 7. 多语言（i18n）

### 7.1 补词条（§37 / §1.10）

给**已有语种**补词条（不能新增语种）：

```json
{
  "i18n": {
    "zh": {
      "my-pack.operator.001.name": "我的干员"
    },
    "en": {
      "my-pack.operator.001.name": "My Operator"
    }
  }
}
```

**规则：**
- 已有键**绝不覆盖**（官方词条优先）
- 路径是 `/i18n/<code>.json`，返回合并体

---

## 8. 依赖与冲突

### 8.1 依赖（`dependencies`）

```json
{
  "dependencies": [
    { "id": "base-pack", "range": "^1.0.0" }
  ]
}
```

### 8.2 冲突（`conflicts`）

```json
{
  "conflicts": [
    { "id": "incompatible-pack" }
  ]
}
```

**装载期判定：** 缺依赖、版本不符、冲突、级联、循环 → 每种都是一个命名拒绝。

---

## 9. 皮肤（skins，§37.19）

### 9.1 声明格式

```json
{
  "skins": [
    {
      "id": "my-pack_skin-001",
      "charId": "char_102_texas",
      "name": { "zh": "夏日", "en": "Summer" },
      "series": "summer-2024",
      "desc": { "zh": "夏日限定", "en": "Summer Limited" },
      "art": {
        "portrait": "assets/skins/001/portrait.png"
      },
      "voices": {
        "battle-start": ["assets/skins/001/voice/start.mp3"]
      }
    }
  ]
}
```

### 9.2 字段闭集（`SKIN_FIELDS`）

`skins[]` 的每一项只能有这些字段：`id`、`charId`、`name`、`series`、`desc`、`art`、`voices`。

拼错的键 → 点名拒绝。

### 9.3 外观提供器（appearance provider）

引擎不理解「一个皮肤」——只判形状。哪套皮肤生效由**外观提供器**决定（`client.panels[].appearance`）。

---

## 10. 常见错误

### 10.1 写了 `variants` / `config` 到 `content`

**错误：**
```json
{
  "content": ["chess", "variants"]
}
```

**原因：** `variants` 不是数据文件，是 `pack.json.variants` 声明。

**正确：**
```json
{
  "content": ["chess"],
  "variants": {
    "training": "max"
  }
}
```

### 10.2 没有 `combat: true`

**错误：**
```json
{
  "variants": { "training": "max" }
}
```

**原因：** `variants` / `behaviour` / `form` 需要 `combat: true`。

**正确：**
```json
{
  "combat": true,
  "variants": { "training": "max" }
}
```

### 10.3 路径用了 `..` 或绝对路径

**错误：**
```json
{
  "art": {
    "chars": {
      "my-char": {
        "portrait": "../other-pack/art.png"
      }
    }
  }
}
```

**原因：** 路径必须在包内（无 `..`、无 `/` 开头、无 URL、无隐藏部分）。

**正确：**
```json
{
  "art": {
    "chars": {
      "my-char": {
        "portrait": "assets/art/my-char/portrait.png"
      }
    }
  }
}
```

### 10.4 干员缺少必需字段

**错误：**
```json
{
  "my-pack_operator-001": {
    "name": "My Operator"
  }
}
```

**原因：** 缺 `charId`、`rarity`、`profession`、`subProfessionId`、`forms`。

**正确：** 见 §1.4。

---

## 11. 检查与调试

### 11.1 服务器启动日志

```
[workshop] loaded 3 packs: my-pack (1.0.0), base-pack (2.0.0), extra-pack (1.5.0)
[workshop] skipped 1: broken-pack (PACK_UNKNOWN_FIELD: "config" is not a field)
```

### 11.2 包的装载状态

```javascript
// server/workshop.js
const { packs, skipped } = loadWorkshop(dirs);
```

每个 `pack` 有：
- `id`、`name`、`version`、`author`
- `content`：归一化后的文件列表
- `overrides`：覆盖清单
- `operators`、`support`：贡献项

每个 `skipped` 有：
- `where`：路径
- `problems`：拒绝原因列表

### 11.3 命令行工具

虽然工坊包不是插件，但可以用类似命令检查：

```bash
# 列出所有包
node tools/plugin.mjs list

# 检查包（如果它遵循 plugin 格式）
node tools/plugin.mjs check <dir>
```

---

## 12. 迁移指南：从旧包到插件

如果你想把旧的 `workshop/` 包迁移到新的 `plugins/` 格式：

### 12.1 外观内容 → `cosmetic` 插件

**旧包：**
```
workshop/my-pack/
  pack.json
  art/...
```

**新插件：**
```
plugins/my-cosmetic/
  plugin.json (class: "cosmetic")
  art/...
```

### 12.2 数据内容 → `content` 插件

**旧包：**
```
workshop/my-pack/
  pack.json
  chess.json
  units.json
```

**新插件：**
```
plugins/my-content/
  plugin.json (class: "content")
  data/chess.json
  data/units.json
```

### 12.3 行为代码 → `script` 插件

**旧包：**
```
workshop/my-pack/
  pack.json
  kits/my-char.js
```

**新插件：**
```
plugins/my-script/
  plugin.json (class: "script")
  sim/my-char.js
```

**注意：** Script 插件需要 `SP_PLUGIN_SCRIPTS=sandbox` 或 trusted 模式。

---

## 13. 参考

### 13.1 核心模块

- `shared/workshop.js`：格式、叠加、校验
- `server/workshop.js`：装载、注册
- `server/data.js loadData`：应用叠加
- `shared/variants.js`：口径轴
- `shared/behaviour.js`：行为开关
- `shared/kitImports.js`：kit 导入白名单

### 13.2 文档

- [DESIGN §37](design/mod-layer.md)：工坊层完整规则
- [PLUGINS.md](PLUGINS.md)：插件系统（新格式）
- [PLUGIN-GUIDE.md](PLUGIN-GUIDE.md)：插件新手指南（中文）
- `plugins/AGENTS.md`：AI 代理指南

### 13.3 测试

- `test/modSurface.test.js`：包能力面测试
- `test/workshop.test.js`：工坊装载测试
- `test/data.test.js`：数据完整性测试

---

## 附录 A：字段速查表

| 字段 | 类型 | 必需 | 用途 |
|---|---|---|---|
| `id` | string | ✓ | 包标识 |
| `name` | object | ✓ | `{ zh, en }` 包名 |
| `version` | string | ✓ | 版本号 |
| `content` | array | * | 数据文件列表 |
| `combat` | boolean |  | 影响对局结果（需 `true` 才能用 `variants`/`behaviour`） |
| `variants` | object |  | 口径声明 |
| `behaviour` | object |  | 行为开关 |
| `operators` | array |  | 自选池贡献 |
| `support` | array |  | 助战池贡献 |
| `voices` | object |  | 语音文件 |
| `art` | object |  | 立绘/头像 |
| `skins` | array |  | 皮肤声明 |
| `i18n` | object |  | 多语言补词条 |
| `overrides` | array |  | 明确覆盖官方数据 |

*`*` = 至少需要一项贡献项

---

**最后更新：** 2026-10-25  
**适用版本：** 0.3.x
