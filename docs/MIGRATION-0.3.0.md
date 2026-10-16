# 把本仓库（0.2.6 fork）的功能迁移到上游 v0.3.0 底座

> 自动生成自 `git ls-tree 2bed2e7f`（本仓库最后一个提交）与当前工作树：**在本仓库存在、上游没有、且当前无人 import** 的模块。
> 这些就是「合并时取上游实现」导致断线的自有功能，需要重新接线到 0.3.0 的架构上。

## A 远程 mod 拉取 / CDN（边缘 + 服务端 + 客户端）（19）

- `functions/assets/[[path]].js`
- `functions/mods/[[path]].js`
- `functions/workshop/[[path]].js`
- `functions/ws.js`
- `public/js/mods/align.js`
- `public/js/resources/cacheHint.js`
- `public/js/resources/entry.js`
- `public/js/resources/profiles.js`
- `public/js/resources/service.js`
- `public/js/ui/modManagerModal.js`
- `public/resource-sw.js`
- `server/http/customStatic.js`
- `server/http/mods.js`
- `server/modDispatch.js`
- `server/modRegistry.js`
- `server/roomAssets.js`
- `server/roomPack.js`
- `server/workshop-watcher.js`
- `shared/modSurface.js`

## B 皮肤 / 语音（5）

- `public/js/ui/roomVoice.js`
- `public/js/ui/skinPicker.js`
- `public/js/ui/voicePicker.js  [已不存在]`
- `public/voice-widget.js`
- `server/roomVoice.js`

## C 聊天 / 语音房（3）

- `public/chat-widget.js`
- `public/js/ui/chatBox.js`
- `public/js/ui/roomChat.js`

## D 管理端 / 运维（4）

- `public/admin/admin.js`
- `public/js/ui/announcement.js`
- `server/admin.js`
- `server/publicApi.js`

## E 客户端 UI / 资源加载（13）

- `public/fullscreen-guide.js`
- `public/js/battle/aiDanmakuEvents.js`
- `public/js/battle/damageStats.js`
- `public/js/ui/damagePanel.js`
- `public/js/ui/dpsPanel.js`
- `public/js/ui/hubCarousel.js`
- `public/js/ui/hubSections.js`
- `public/js/ui/pickAnyOverlay.js`
- `public/js/ui/preloadModal.js`
- `public/js/ui/screenFit.js`
- `public/js/ui/seatArt.js`
- `public/js/ui/serverPicker.js`
- `public/js/ui/settingsPolish.js`

## F 其他（1）

- `shared/formProjection.js`

---

## 数据层：**不要**用合并后的 `tools/build-data.mjs` 重生成 `data/`（重要）

合并时 `tools/build-data.mjs` 的 6 处冲突取了**上游版**。上游的生成器**产不出本仓库的内容**：

| 文件 | 本仓库提交版 | 上游生成器产出 |
|---|---|---|
| `data/config.json` | 106 KB / 4525 行 | 61 KB / 1 行 |
| `data/tokens.json` | 244 KB / 9900 行 | 119 KB / 1 行 |
| `data/backups.json` | 2.06 MB | 1.60 MB（本仓库的 DIY 人选 `clemnt` 等消失） |

实测后果：跑一次 `node tools/build-data.mjs` 会让 **35 个本仓库内容用例变红**
（`op_clemnt` 25、`kits_layout`、`new-modules-023`、`diy`、`golden` …），并触发 golden 硬规则。

**当前状态**：`data/{config,tokens,chess,backups,bonds}.json` 保持**本仓库内容**；`test/data.test.js` 的 2 个失败是
**本仓库既有的**（提交的数据是手工整理过的，而两版生成器都写紧凑 JSON，`offline rebuild` 那条一直红）。

**要真正修好**：把本仓库 `build-data.mjs` 相对基线新增的 118 行（它比上游版短 689 行、但输出更多字段）
与上游版逐块合并 —— 在两个生成器合并之前，`data/` 只能视为**手工数据**，任何重生成都会破坏内容。
