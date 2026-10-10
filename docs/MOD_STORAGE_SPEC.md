# 卫戍协议（Stronghold Protocol）MOD 统一存储与运行时规范

> 版本：v1.0.0 | 维护规范：石井安全架构与工程标准  
> 适用端：服务端 (Node.js) / PC 网页端 / 手机移动端 (Android WebView & Capacitor) / 离线单人沙盒

---

## 1. 核心设计原则（铁律）

1. **零污染与非侵入（Non-Invasive Overlay）**：
   - **绝对禁止整文件覆盖**官方游戏核心文件（`data/*.json`、`public/assets/*`）。
   - 任何 MOD 均以 **增量数据层（Overlay）** 的形式挂载。MOD 卸载或关闭时，系统 100% 保持官方原版干净状态，无需回滚备份。
2. **双端标准统一的包格式（Standard Mod Package）**：
   - 规范扩展名统一为 `.spmod`（底层为标准 ZIP 归档，直接用 `.zip` 亦可无缝识别）。
   - 无论是 PC 还是手机，均基于同一种解包与校验机制。
3. **平台分层存储策略（Storage Separation）**：
   - 服务端落盘于文件系统 `packs/<packId>/`；
   - 客户端（Web/Android）统一落盘于 **IndexedDB**（突破 localStorage 5MB 容量上限，支持二进制图片与大体积 JSON）。

---

## 2. MOD 标准包结构规格 (.spmod / .zip)

任何合规的 MOD 包解压后必须符合以下平铺或单层根目录结构：

```text
my-mod.spmod (或 .zip)
│
├── pack.json             [必选] MOD 元数据核心清单（格式见下）
├── README.md             [必选] MOD 详细说明文档、特性清单与更新日志（用于 UI 详情展示）
│
├── records.json          [可选] 盟约、装备、词条、BUFF 增量数据
├── chess.json            [可选] 自定义干员、技能、面板、升级属性
├── tokens.json           [可选] 召唤物配置
├── variants.json         [可选] 口径修正、平衡性数值覆盖
├── bands.json            [可选] 战术分队 / 队伍配置
│
└── art/                  [可选] 美术资源目录（PNG / WebP / SVG）
    ├── bond_*.png        盟约徽记图标
    ├── equip_*.png       自制装备图标
    ├── avatar_*.png      干员头像
    └── index.json        [可选] 素材索引与尺寸映射表
```

### `pack.json` 契约定义

```json
{
  "id": "kazdel_covenant",
  "name": "卡兹戴尔盟约扩展包",
  "version": "1.0.0",
  "app": ">=0.2.0",
  "author": "Rhodes Research",
  "credits": "非商业同人作品；《明日方舟》版权归鹰角网络所有。",
  "description": "新增卡兹戴尔与罗德岛核心盟约、8件自造装备与12名专属棋子。",
  "features": [
    "新增【卡兹戴尔】与【罗德岛】两大阵营盟约",
    "加入 8 件独占同人自造装备",
    "扩展 12 名专属干员棋子及定制特质"
  ],
  "files": {
    "records": "records.json",
    "chess": "chess.json",
    "tokens": "tokens.json",
    "variants": "variants.json",
    "art": "art/index.json"
  }
}
```

---

## 3. 多端存储形式与生命周期

### 3.1 服务端 / 联机主机 (Node.js)

| 维度 | 规范标准 |
|---|---|
| **物理路径** | `<server_root>/packs/<packId>/` |
| **持久化方式** | 物理磁盘目录展开（只读扫描） |
| **导入/上传** | POST `/api/packs/upload`（解压、哈希校验、落盘） |
| **运行时加载** | 进程启动或热重载时，通过 `GlobalModManager` 扫描 `packs/` 目录；响应客户端请求时通过 `shared/customContent.js` 的 `mergeCustomContent` 动态合并内存数据流。 |
| **静态资源托管** | 通过静态路由映射：`/packs/<packId>/art/*` |

### 3.2 客户端 / 手机端离线沙盒 (Browser / Android WebView)

由于浏览器端（尤其是手机端 WebView）无直接本地文件写入权限且 `localStorage` 仅有 5MB 限制，客户端采用 **IndexedDB** 作为物理持久化仓储：

- **数据库名**：`sp_mod_storage`（版本：`1`）
- **对象仓库 (Stores)**：
  1. `meta`（主键：`id`）：
     - 存储 MOD 的清单数据（`id`, `name`, `version`, `author`, `description`, `features`, `enabled`, `installTime`, `hash`）。
  2. `blobs`（复合主键：`[packId, path]`）：
     - 存储 MOD 解压出来的所有独立文件内容：
       - JSON 文件存储为 parsed Object 或 UTF-8 文本；
       - 图片/音效存储为原始 `Blob` 二进制对象。
  3. `state`（主键：`key`）：
     - 记录全局配置（如 `activePackIds: string[]`、`loadOrder: string[]`）。

#### 客户端运行时加载流程：
1. 游戏启动（或单人离线模式初始化）时，`modStorage.getActiveOverlays()` 从 IndexedDB 读取所有已激活的 MOD。
2. 将各 MOD 的 JSON 数据（records、chess 等）合并至客户端 `dataStore`。
3. 将美术素材提取为本地 Blob URL（`URL.createObjectURL(blob)`），并注入全局 `artResolver`。

---

## 4. 联机对局与房间同步逻辑

1. **房间策略（Room Policy）**：
   - `STRICT_VANILLA`：强制纯净原版，忽略任何客户端 MOD。
   - `OPTIONAL`（默认）：允许房主指定房间启用的 MOD 清单。
   - `FORCE_ALL`：服务器全局强制激活指定内容包。
2. **数据一致性握手**：
   - 房主创建房间时上报：`requiredPacks: [{ id: "fanpack", hash: "d6a367ccc978" }]`。
   - 其他玩家加入房间时，房间广播该清单。
   - 若客户端未安装该 MOD，客户端弹出轻量下载提示；或由服务端在开局前下发增量战斗数据。

---

## 5. 存储架构对照总表

| 场景 | 存储介质 | 存储内容 | 性能与容量 | 回滚/卸载方式 |
|---|---|---|---|---|
| **服务端联机** | 本地文件系统 `packs/` | 平铺的 JSON + art 文件夹 | 无容量限制，零拷贝 | 直接删除 `packs/<packId>/` 目录 |
| **客户端在线** | 内存 Cache + 服务端 API | 服务端下发的动态合并结果 | 即用即销毁 | 房间关闭即自动重置 |
| **客户端离线/手机**| **IndexedDB** (`sp_mod_storage`) | 完整解包的 JSON + 图片 Blob | 支持 100MB+ 大包，秒级存取 | 调用 `modStorage.uninstall(packId)` 清空对应主键 |
| **轻量状态标记** | `localStorage` | `sp.active_packs` (ID 数组) | < 1KB | 开关切换直接同步 |

---
*本文档为卫戍协议 MOD 系统唯一指定技术规范基线。*
