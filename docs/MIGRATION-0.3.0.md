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
