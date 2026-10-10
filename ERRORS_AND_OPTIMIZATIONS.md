# 卫戍协议：盟约 (Stronghold Protocol)
## 本次会话全量问题排查、根因分析与优化总结报告

> 归档时间：2026-10-07  
> 责任人：石井（ColdBrew 安全研究与工程审计工作流）  
> 涉及端：服务端 (Node.js/PM2)、PC/Web 浏览器端、手机移动端 (Android APK / 移动浏览器)

---

### 目录
1. [总览与审计背景](#一总览与审计背景)
2. [问题一：后台监控台不可用与服务响应异常](#二问题一后台监控台不可用与服务响应异常)
3. [问题二：人多被强制踢出（高并发 / NAT 局域网踢人）](#三问题二人多被强制踢出高并发--nat-局域网踢人)
4. [问题三：服务器端皮肤与语音失效（双端）](#四问题三服务器端皮肤与语音失效双端)
5. [问题四：联机时自选干员（DIY）刷新不到与羁绊失效](#五问题四联机时自选干员diy刷新不到与羁绊失效)
6. [问题五：手机端（Android APK / 移动浏览器）兼容性与离线包同步](#六问题五手机端android-apk--移动浏览器兼容性与离线包同步)
7. [问题六：服务发布易导致现网活跃玩家对局掉线](#七问题六服务发布易导致现网活跃玩家对局掉线)
8. [问题七：上游 0.2.1 合并冲突与专属定制防覆盖保护](#八问题七上游-021-合并冲突与专属定制防覆盖保护)
9. [全量修改文件与关键补丁清单](#九全量修改文件与关键补丁清单)
10. [运维与重载验证标准 SOP](#十运维与重载验证标准-sop)

---

### 一、总览与审计背景

在本次工程交付中，针对服务器线上运行出现的偶发卡顿、监控台失效、多玩家联机频繁被踢、自选干员刷不出、皮肤与语音异常等一系列复杂生产问题进行了端到端全链路排查。

排查跨越了 **网络协议栈、服务端房间调度器、对局状态机、战斗仿真引擎、前端渲染管线、音频系统、Android 原生资源包** 共 7 个技术层级，修复并验证了全部 8 项核心缺陷，并完成了上游 0.2.1 版本合并的完整安全评估。

---

### 二、问题一：后台监控台不可用与服务响应异常

#### 1. 现象描述
- 管理员访问 `http://101.37.150.107:3000/dashboard.html` 显示 404 或白屏无响应。
- 无法直观监控实时在线人数、房间列表、对局状态与资源负载。

#### 2. 根因分析
- **路由端点不一致**：原前端 `dashboard.html` 请求的监控接口与服务端实际暴露的端点不匹配；
- **静态资源未部署**：主服静态托管目录未包含优化后的 `dashboard.html`，静态路由未配置 `no-cache` 与安全响应头。

#### 3. 优化与修复方案
- 重新设计并部署轻量级、零依赖的管理仪表盘 `public/dashboard.html`；
- 对齐后端接口 `/healthz?details=1`，实时拉取并渲染：
  - 系统版本号与 Git Build Tag；
  - 活跃房间总数、对局数、人类玩家数、Spectator 观战者数；
  - 房间详情表格（房间代码、房主、模式、难度、人数、创建时长）；
  - 连接健康度与 PM2 运行状态；
- 配置 HTTP 响应头 `X-Content-Type-Options: nosniff` 与 `Cache-Control: no-cache`。

---

### 三、问题二：人多被强制踢出（高并发 / NAT 局域网踢人）

#### 1. 现象描述
- 晚间高峰期人多时，部分玩家被频繁强制踢回大厅；
- 宿舍、网吧或同一局域网（共享同一个外网 NAT IP）多名玩家联机时，后进房间的玩家会被立即踢出。

#### 2. 根因分析
- **IP 连接数阈值过低**：原 `server/net.js` 中 `maxConnectionsPerAddr` 硬编码仅为 `64`。在多人共享同一出口 NAT IP 时，短时间内累计的连接数触顶，被误判为恶意攻击并触发 `ADDR_LIMIT` 掐断；
- **突发流控桶过窄**：突发容量 `rateBurst` 仅设为 `25`，重连或批量进入房间时突发协议包瞬间触发 `abuseDropsPerSec`（1008 封禁）；
- **心跳判定过于激进**：原心跳 ping/pong 判定为单一布尔值（单次 30s 丢包即判定死亡），手机网络在 WiFi/4G 切换或信号抖动时极易产生单次丢包，导致连接被服务端主动 `ws.terminate()`。

#### 3. 优化与修复方案
- **扩容连接池**：
  - 单 IP 连接上限由 64 扩容至 **512**；
  - 全局并发连接上限由 1024 提高至 **5000**；
  - 突发限流桶容量提高至 **80**，防刷保护速率放宽至 **1000/s**；
- **引入双重容错心跳**：
  - 增加 `missedPings` 失败计数器；
  - 只有在连续 **2 次（60秒）**未收到任何 pong 响应时才执行断开；
  - 收到任何合法 pong 立即将 `missedPings` 清零并更新 `lastSeen` 时间戳。

---

### 四、问题三：服务器端皮肤与语音失效（双端）

#### 1. 现象描述
- 局外选择的干员皮肤在联机对局中不生效，棋盘小人退回默认原皮/白模；
- 干员部署和攻击时无语音，尤其在手机端（Android/移动浏览器）进游戏全场静音。

#### 2. 根因分析
- **服务端皮肤槽位拦截**：`server/lobby.js` 的 `freezeSkins` 和 `server/match/PlayerState.js` 的 `setSkins` 原先只校验官方静态干员 ID，将包含 `diy_` 槽位或自定义自选干员的皮肤当做非法输入直接剥除；
- **战斗输入透传链路丢失**：`PlayerState.battleInput()` 与 `Battle.js` 的 `_createAllyFromInput` 未将玩家配置的 `skin` 字段注入战场单位 `unit.skin`；
- **前端小人重绘未监听**：`public/js/render/app/info.js` 中的 `renderInfo(u)` 漏传了 `skin`，备战区重绘计算签名 `sig` 未纳入皮肤，导致模型不刷新；
- **语音键解析缺失回退**：`public/js/audio.js` 仅使用 `piece.charId` 寻找音频文件，对于替代干员（stand-in）或自选干员（DIY），没有提取背后的底层真实干员 ID；
- **移动端音频策略限制**：手机浏览器限制未经用户显式交互的音频播放，Web AudioContext 处于 `suspended` 挂起状态未被自动唤醒。

#### 3. 优化与修复方案
- **服务端全链路放行与透传**：
  - `lobby.js` 放行 `chess_char_5_diy`、`chess_char_6_diy` 及 `diy_` 皮肤槽位；
  - `PlayerState.battleInput()` 注入 `skin: u.skin`；
  - `Battle.js` 确保单位实体持有 `u.skin`；
- **前端模型即时响应**：
  - `info.js` 补齐 `skin` 属性传递；
  - 备战区维护 `ownSkins`，`sig` 加入 `info.skin` 触发即时 Spine/Pixi 纹理重绘；
- **语音检索多级回溯与自动唤醒**：
  - `audio.js` 增强解析：优先级为 `x.standInFor || x.charId || x.diy?.charId`，确保自选干员完美匹配官方语音包；
  - 兼容平铺目录与语言子目录结构；
  - 在触摸手势与每次调用播放时，增加 `audioCtx.resume()` 自动唤醒机制。

---

### 五、问题四：联机时自选干员（DIY）刷新不到与羁绊失效

#### 1. 现象描述
- 玩家在房间配置了自选干员（DIY Picks），但在对局商店中刷空整个卡池也刷不出自选干员；
- 自选干员上阵后无法激活阵营羁绊，战斗中技能/天赋表现异常。

#### 2. 根因分析
- **抽卡候选池未注入**：服务端的抽卡方法 `_rollChessSlot` 与合成奖励 `pushRewardOffer` 仅遍历静态配置 `chess.json`，没有读取玩家席位的 `seat.diy`；
- **羁绊计算缺漏**：`server/match/bondsMeta.js` 计算阵营羁绊时，未关联查询 `backups.diy.operators[charId].bonds`；
- **战斗模型缺乏动态定义**：`server/sim/simdata.js` 与 `Battle.js` 缺乏对局内 `u.diy` 的动态实例化，导致战斗引擎无法获取该自选干员的攻击范围、专有技能与天赋 Kit。

#### 3. 优化与修复方案
- **重构抽卡算法 `_rollChessId`**：
  - 在玩家进行 5 阶或 6 阶抽卡、以及获取升阶奖励时，动态将玩家所选的 DIY 槽位注入候选卡池；
  - 概率权重与同阶常规干员完全对齐，并按持有数动态扣减库存；
- **完善动态羁绊关联**：
  - `bondsMeta.js` 增加对自选干员的识别，动态获取所属主阵营与子阵营羁绊，正确计入团队羁绊统计；
- **战斗引擎动态实例化**：
  - `simdata.js` 引入 `diyRecordOf`，基于玩家自选的技能与模组生成 `NormalizedDef`；
  - `content/index.js` 优先使用 `def.charId` 匹配干员专有技能与天赋 Kit。

---

### 六、问题五：手机端（Android APK / 移动浏览器）兼容性与离线包同步

#### 1. 现象描述
- 手机端网页与 Android APK 表现不同步；
- APK 离线包内旧资源残留，未同步最新的皮肤、语音和自选干员元数据。

#### 2. 根因分析
- 之前的优化仅改动了本地工作区代码，未执行 Android 离线资产打包脚本；
- Android 客户端采用离线资源包拦截机制（`WebViewClient` 资源劫持），若 `app_bundle.zip` 未更新，APK 仍将运行旧版前端代码。

#### 3. 优化与修复方案
- 执行离线资源流水线：`node tools/bundle-android.mjs`；
- 重新生成 `android/app/src/main/assets/app_bundle.zip`（体积 517.04 MB）；
- 校验 sha256 签名与文件清单完整性（通过 `check-assets.mjs` 门禁验证）；
- 移动浏览器端通过服务端静态热更新无缝同步生效。

---

### 七、问题六：服务发布易导致现网活跃玩家对局掉线

#### 1. 现象描述
- 服务器每次更新代码或重启，线上正在对局的玩家全员掉线，体验极差。

#### 2. 根因分析
- 原部署方式直接执行 `kill` 杀死 Node.js 进程；
- 服务端 `server/index.js` 捕获到终止信号（SIGINT/SIGTERM）后，会广播 `room.closed{reason:'shutdown'}` 并断开所有 WebSocket。

#### 3. 优化与修复方案
- **建立两阶段发布流程**：
  1. **静态资源先行热替换**：将 `public/` 和 `data/` 直接解压覆盖，浏览器刷新即刻获取新版代码，无需重启 Node 进程，对局中的玩家零感知；
  2. **沙箱隔离验证**：在 3002 端口沙箱环境（`stronghold-green`）先行部署测试，验证端口响应、新旧协议兼容性；
  3. **空闲期平滑热切**：通过监控脚本监测 3000 主服当前活跃对局，在对局结算空闲期或通过 PM2 优雅重载更新常驻服务。

---

### 八、问题七：上游 0.2.1 合并冲突与专属定制防覆盖保护

#### 1. 现象描述
- 用户提出合并官方上游 `v0.2.1`（commit `c2a2ef77`）。
- 上游 0.2.1 引入了全员满潜能（潜能6）、重构了自选系统（`PlayerDiy` / `diyStock`）、模块化拆分了服务端架构，但**完全没有内置皮肤系统**，且网络限流较严格。

#### 2. 潜在风险与冲突点
- 如果直接盲目 `git merge v0.2.1`，会导致：
  - 本项目自主实装的 174/271 款干员皮肤元数据与渲染逻辑被完全抹除；
  - 本项目优化过的抗踢出网络参数（5000连接、512单IP、双重容错心跳）被覆盖回默认的严苛限制；
  - `public/dashboard.html` 监控台被删除或丢失；
  - 手机端 AudioContext 唤醒与语音多级回溯丢失。

#### 3. 优化与合并策略（裁决矩阵）
- **必须吸收的上游 0.2.1 能力**：
  - 全员潜能拉满（潜能6数值体系与数据文件 `data/chess.json` 等）；
  - 官方标准 `server/match/player/diy.js` 调度机制与自选面板 Esc 关闭；
  - 服务端与战斗模块化分层；
- **必须绝对锁定的专属定制**：
  - `server/net.js` 保留 `maxConnections: 5000`, `maxConnectionsPerAddr: 512`, `rateBurst: 80`, `missedPings >= 2`；
  - `server/lobby.js` 保留 `freezeSkins` 皮肤校验豁免；
  - `PlayerState.js` 保留 `battleInput` 中的 `skin: u.skin` 透传；
  - 保留 `data/skins.json`、`data/skins-installed.json` 及全套皮肤元数据；
  - 保留 `public/dashboard.html` 与 Android 离线打包脚本。

---

### 九、全量修改文件与关键补丁清单

| 文件路径 | 修改类型 | 解决的问题 |
|---|---|---|
| `server/net.js` | 核心优化 | 扩容并发/单IP上限至5000/512，实现连续两次心跳容错，解决人多与NAT误踢 |
| `server/lobby.js` | 核心优化 | 放行 DIY 槽位皮肤与自选协议透传 |
| `server/match/Match.js` | 核心优化 | 支持动态设置与同步玩家自选配置 |
| `server/match/PlayerState.js` | 核心优化 | 抽卡池公平注入自选干员，战斗实体全程透传皮肤 |
| `server/match/bondsMeta.js` | 核心优化 | 关联自选干员的阵营羁绊属性计算 |
| `server/sim/Battle.js` | 核心优化 | 战斗单位实例化接收 `diy` 与 `skin` 数据 |
| `server/sim/simdata.js` | 核心优化 | 动态构造 DIY 干员属性、技能与模组定义 |
| `server/sim/content/index.js` | 核心优化 | 优先按 `charId` 挂载干员专有技能与天赋 Kit |
| `public/js/render/app.js` | 前端修复 | 备战区小人绑定皮肤签名并监听即时重绘 |
| `public/js/render/app/info.js` | 前端修复 | 单位面板与实体渲染透传 `skin` |
| `public/js/audio.js` | 前端修复 | 多级回退解析自选语音，移动端 AudioContext 自动解锁唤醒 |
| `public/dashboard.html` | 新增/修复 | 后台实时监控控制台（端口 3000） |
| `android/.../app_bundle.zip` | 资源打包 | 生成 517MB 手机端完整离线资源包，三端对齐 |

---

### 十、运维与重载验证标准 SOP

#### 1. 本地自动化测试验证
```powershell
node --test test/skins.test.js test/ui/diy-ui.test.js test/match/*.test.js
```
*标准：测试全绿，0 报错。*

#### 2. 沙箱环境先行验证 (端口 3002)
```bash
curl -s http://127.0.0.1:3002/healthz?details=1 | jq '{ok, version, build, matches}'
```
*标准：返回 `ok: true`，且新版本号正常展示。*

#### 3. 生产环境重载 (端口 3000)
```bash
# 确认当前对局空闲期后执行彻底重载
pm2 restart stronghold
pm2 save
```

#### 4. 外部联通性与控制台验收
```powershell
# 1. 验证控制台正常响应 (返回 HTTP 200)
curl.exe -I http://101.37.150.107:3000/dashboard.html

# 2. 验证接口健康状态
curl.exe -s http://101.37.150.107:3000/healthz?details=1
```

---
*文档生成完毕并保存在项目根目录：`ERRORS_AND_OPTIMIZATIONS.md`*
