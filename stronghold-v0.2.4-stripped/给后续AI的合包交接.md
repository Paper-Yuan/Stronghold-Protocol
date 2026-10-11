# 交接：2026-10-11 本地 v0.2.4 / 无限火力融合

目标：C:/Users/Administrator/Desktop/stronghold-v0.2.1-fusion-server-release。
来源：当前服务器 v0.2.4 适配候选 + Downloads/Stronghold-Protocol-Windows/app 的最新模式。
上游基线 bc50cac01ff447eff3ab6c35f69d934bbc23b48f。浏览器构建 fp100-upstream024-20261011；资源 f3216bd82a48。

## 架构接入

v0.2.4 已把 Match、PlayerState、Battle 拆分为子模块。新模式逻辑已逐项接入 server/match/match、server/match/player、server/sim/battle；不要重新覆盖下载包的旧版同名大文件。
BudgetManager 在 server/match/budget.js；共享 BUDGET/variantRounds 等在 shared/randomMode.js；技能与战斗数据经 BattleSpec 的 rm 标志进入 sim。
server/sim/budgetPower.js 提供确定性的分数幂；server/sim 与 public/sim 同步，simdata.js 的浏览器 Node Loader 移除属于有意差异，nodeData.js 不应下发。
模式差异包括 marathon=18、输出预算、单击上限、护盾与复活标记、盲盒阵营选择、资金攻击加成、14 格手牌、金色装备不替换。

## 本轮兼容修正

- server/match/gamedata.js：marathon R14–R17 复用普通 R13，最后一轮用 R14；单人模式补齐同难度 multi 的最终行，13/18 回合的 R9 用 multi 普通行避免中途最终 BOSS。客户端 public/js/ui/gameLogic/shared.js 保持相同映射。
- server/match/audit.js：final budget boss HP 及失败座位/团队 LP 的期望与真实模式逻辑一致，修正审计误报。
- public/js/render/units.js：构造函数 modelKY=1，避免 direct Spine 缩放 NaN，盟友/敌人均覆盖。
- 旧 tier1–6 monolith 和旧 chatBox/chatInputBar 未被新版导入，已移出发行目录。不要把这些无效旧文件恢复。
- test/client-static.test.js：WS 期望 URL 包含既有 build 参数。

## 验证记录

目标目录验证-*.log / 验证-资源与同步.json 保存结果。test/match/random-stock-024.test.js 覆盖 solo/coop 三变体配置一致、赠品库存/最终回合保护；test/render/model-scale.test.js 覆盖 ally/enemy 两种渲染路径；test/sim/budget-power.test.js 验证分数幂误差。
工作目录：Documents/Codex/2026-10-09/c-users-administrator-desktop-stronghold-protocol/work/local-fusion-024-20261011。
实际浏览器测试脚本在邻目录 upstream-adaptation-024-20261011/local-fusion-browser.mjs，结果 local-fusion-browser-smoke.json。

## 线上与本地分界

当前线上双服大厅空列表已修复：香港1 /_v024/alliance/rooms 转发 HTTPS 的默认校验深度不足，Nginx 日志显示 certificate chain too long。补齐 proxy_ssl_verify_depth 8 并保留 TLS 验证；旧跨服 HTTPS 转发的深度也改为8。备份路径与哈希见 upstream-adaptation-024-20261011/lobby-tls-hotfix.json。
两入口真实浏览器调用 federation.rooms() 均能看到两个健康节点和公开房间，见 live-lobby-verified.json。只平滑 reload Nginx，无游戏核心/relay 重启。
本地最新模式未发布线上。本地上线必须重新适配 /_v024/ 模块隔离、资源冻结配置和独立服务，不得覆盖旧页模块树，不得踢活跃对局，不得强制刷新。
服务器列表首页、WorkBuddy 均未修改。发行目录不保存生产账户/密码/公告私密状态。

## 准备阶段皮肤补丁

2026-10-11：服务端 PlayerViews.pieceView 已下发 skin，战斗 renderInfo 也保留 skin；准备阶段 public/js/render/app.js 的 pieceInfo 遗漏此字段，导致战斗开始才换装。现补上 skin: piece.skin || null；自己的手牌/临时区/部署模型以及只读备战单位的缓存签名均包含 skin，切换时重建模型。此次只修改本地合包，不上传服务器。

验证：test/render/prep-skins.test.js 执行实际准备阶段函数，使用轻量 View 替身；修复前失败，修复后通过。与 model-scale.test.js 合跑 5 项均通过，见 验证-皮肤回归.log。app.js 代码检查 0 错误、1 条既有警告。
实际浏览器测试尝试因本机虚拟内存不足（剩余约 0.3–0.8GB）发生 Node 内存不足或 Edge 无法创建 renderer，尚未完成，不应声称视觉 QA 已通过。可在释放内存后运行 node test/render/prep-skins.browser.mjs；完整对局测试脚本另在工作目录 local-fusion-browser.mjs --skin-test。
