# 会话交接文档：卫戍协议（Stronghold Protocol）v0.1.6 阶段维护记录

> **文档创建时间**：2026-10-06 23:40  
> **适用对象**：接替本工程会话的下一位 AI 助手或开发者  
> **当前工程分支**：`0.1.6-pre-skin`  
> **本地工作区路径**：`e:\Workbox\系统`  

---

## 1. 架构与运行环境总览

### 1.1 核心代码库与远端仓库
- **代码仓库**：`Paper-Yuan/Stronghold-Protocol`
- **主要分支**：`0.1.6-pre-skin`（当前核心开发分支，包含皮肤系统扩展与 3D 地图渲染管线优化）
- **本地环境**：Windows 11，Node.js，Git 配置使用本地 Clash/v2ray 代理（`127.0.0.1:7890`）。

### 1.2 阿里云生产/测试服务器
- **公网 IP**：`101.37.150.107`
- **游戏服务端口**：`3000`（Web 客户端及 WebSocket: `http://101.37.150.107:3000/`）
- **操作系统**：Ubuntu 24.04 LTS
- **Node.js 版本**：`v22.23.3`
- **工程目录**：`/opt/stronghold`
- **SSH 访问**：
  - 用户：`root`
  - 密钥路径（本地）：`C:\Users\J1825\Downloads\aaa.pem`
  - 连接命令：`ssh -i C:\Users\J1825\Downloads\aaa.pem -o StrictHostKeyChecking=no root@101.37.150.107`
- **PM2 托管进程**：
  - `id: 0 | name: stronghold`：游戏主服务进程（`server/index.js`）
  - `id: 1 | name: stronghold-sync`：自动同步守护进程（`scripts/auto-sync.mjs`，每 20 秒检测 GitHub 分支并自动 `git pull` + `pm2 reload`）

---

## 2. 关键任务与解决进展

### 2.1 多人联机/观战不同玩家皮肤选择机制
- **需求**：确认多人在同一房间或对局观战时，各自选择不同皮肤是否能正确隔离与渲染。
- **机制与验证结果**：**已完全支持且天然隔离**。
  1. **持久化与上报**：客户端选择存入 `localStorage`，加入房间或切换时发送 `room.skins` 协议，服务端在 `session.skins` 和 `seat.skins` 保存。
  2. **广播与观战同步**：`Match.publicView().players[]` 广播每位玩家的已选皮肤字典；整备期观战其他玩家棋盘时，服务端的 `_notifyPrepScouts` 为目标玩家棋子绑定其专属的 `ps.skins?.[chessId]`。
  3. **战斗期演算**：无论服务端模拟还是客户端演算，战斗实体生成器 `_makeAlly` 严格以该干员归属玩家的 `inp.skin` 初始化单位数据。
  4. **渲染层同屏隔离**：渲染层每个 `UnitView` 和 `SpineActor` 根据实体自身的 `info.skin` 独立从 `assets.js` 寻址骨骼资源。即使两位玩家使用同一干员且各自使用不同皮肤，同屏各自渲染各自选择的皮肤模型与立绘。

---

### 2.2 阿里云服务器 3D 地图无法加载排查与修复
- **历史现象**：在阿里云服务器环境下，进入对局后 3D 地图不显示，或弹出提示：
  > `当前设备无法启用 3D / WebGL 渲染，已切换为简化视图（功能不受影响）`
- **深度排查与多重根因**：
  1. **【关键致命 Bug】JS 变量暂时性死区（TDZ ReferenceError）**：
     - 在 `public/js/render/app.js` 的 `createFieldView` 头部新增帧率控制逻辑时调用了 `updateFpsLimit()`。
     - 其内部闭包访问了 `dragState` 和 `mode`，但这两个变量在函数后方才用 `let` 声明。
     - 导致浏览器在初始化首行时直接抛出：`ReferenceError: Cannot access 'dragState' before initialization`。
     - 外层 `mountFieldView` 捕获该崩溃后，误判定为浏览器不支持 WebGL 渲染引擎，从而退化到 DOM 简化视图（`fallbackField.js`），并弹出了上述 Toast。
     - **修复**：调整变量声明顺序至 FPS 限帧器之前，解除 TDZ 隐患；帧循环完全交由 Pixi 原生 `app.ticker.maxFPS` 调度。
  2. **WebGL2 Caveat 严格检测误拦截**：
     - `public/js/render/board3d/load.js` 的 `webgl2Available` 原先在非强制 3D 时带 `{ failIfMajorPerformanceCaveat: true }`。在大量轻薄本、核显以及移动端 WebView 环境下直接返回 `null`。
     - **修复**：若带 caveat 检测失败，自动降级回退标准 WebGL2 上下文，不再直接拒绝。
  3. **Pixi WebGL 降级容灾**：
     - 在 `createFieldView` 创建 `new P.Application` 时，若 `powerPreference: 'high-performance'` 失败，自动捕获并回退至标准参数创建，杜绝渲染引擎启动崩溃。
  4. **缺少视角切换入口**：
     - 在 `public/js/ui/settings.js` 和 `public/js/ui/gameLogic.js` 增加了 `棋盘视角`（`board: 'auto' | '3d' | '2d'`）切换选项，方便玩家在游戏设置面板中随时强制指定 3D 全景或 2D 俯视。
  5. **网络带宽与握手超时放宽**：
     - 3D 地图资源（贴图+Three.js）体积约 8MB，在公网有限带宽下加载可能耗时较长。
     - `public/js/ui/fieldHost.js` 的超时时间从 12s 调整至 30s。
     - `server/index.js` 将 `.obj` 模型文件纳入 `COMPRESSIBLE` gzip 压缩。
     - `public/index.html` 增加 `three.module.js` 与 `three.core.js` 的 `modulepreload`。
  6. **精准错误透传**：
     - `public/js/ui/fieldHost.js` 导出 `lastMountError`，并在 `public/js/screens/game.js` 的 Toast 提示中注入具体报错信息，方便未来异常秒级定位。

---

## 3. 本次代码修改清单

| 文件路径 | 修改说明 |
|---|---|
| `public/js/render/app.js` | 修复 `dragState`/`mode` 暂时性死区；增加 `P.Application` 上下文降级容灾；移动端 DPR/质量限制 |
| `public/js/render/board3d/load.js` | 增强 `webgl2Available`，允许 caveat 告警回退标准 WebGL2 上下文 |
| `public/js/ui/fieldHost.js` | 导出 `lastMountError`，超时阈值放宽至 30s，透传 `opts.board` 设置 |
| `public/js/screens/game.js` | 接入 `lastMountError`，降级 Toast 显示具体错误原因 |
| `public/js/ui/settings.js` | 增加“棋盘视角: 自动 / 3D 全景 / 2D 俯视”设置项及联机服务器切换输入框 |
| `public/js/ui/gameLogic.js` | `DEFAULT_SETTINGS` 与 `sanitizeSettings` 支持 `board` 属性 |
| `public/index.html` | 预加载 `three.module.js` 与 `three.core.js` 模块 |
| `server/index.js` | 将 `.obj` 格式纳入 gzip 压缩列表 |
| `test/ui/gameLogic.test.js` | 更新单元测试期望以匹配 `board: 'auto'` 属性 |

---

## 4. 常用操作命令手册

### 4.1 本地 Git 提交与推送（带本地代理）
```powershell
# 1. 运行核心单测
node --test test/ui/gameLogic.test.js test/version.test.js

# 2. 提交修改
git add .
git commit -m "fix(render): your commit message"

# 3. 必须带代理和 OpenSSL 推送到 GitHub（Windows 环境常见 SSL 阻断）
git -c http.sslBackend=openssl -c http.proxy=http://127.0.0.1:7890 push origin 0.1.6-pre-skin
```

### 4.2 阿里云服务器维护（SSH）
```powershell
# 快速检查远端 PM2 服务状态与日志
ssh -i C:\Users\J1825\Downloads\aaa.pem -o StrictHostKeyChecking=no root@101.37.150.107 "pm2 list && pm2 logs stronghold --lines 20 --nostream"

# 手动强制拉取最新分支并热重启
ssh -i C:\Users\J1825\Downloads\aaa.pem -o StrictHostKeyChecking=no root@101.37.150.107 "cd /opt/stronghold && git fetch origin 0.1.6-pre-skin && git reset --hard origin/0.1.6-pre-skin && pm2 restart all"
```

---

## 5. 接手建议与后续关注点

1. **客户端测试验证**：
   - 用户使用 Android APK 或移动端 WebView 访问 `http://101.37.150.107:3000` 时，请指导用户重新刷新或重进对局以获取最新包含 TDZ 修复的 `app.js`。
   - 若用户依然反馈未显示 3D，请先确认：
     1) 游戏内“设置 -> 棋盘视角”是否为“自动”或“3D 全景”；
     2) 如果仍有 Toast 提示，此时 Toast 会带括号显示具体的 `lastMountError`（例如 WebGL context lost、网络超时等），根据具体提示定位即可。
2. **Android APK 离线包与 Webview 兼容**：
   - Android APK 内置有 `MainActivity.kt`，若用户开启了“兼容模式”会导致客户端带上 `?render=fallback`。如果用户曾在 Android 端点过“兼容模式重启”，可让其在原生启动器中切回“标准模式/3D 模式”。
