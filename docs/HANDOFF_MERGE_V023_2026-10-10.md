# 交接：上游 v0.2.3 合并与收口（2026-10-10 会话产出）

> 给下一个会话。**先读这一页，再动手。** 详细调研见同目录 `upstream-merge/` 下的四份文档 + 两张图。

---

## 一、现在在哪

| 项 | 值 |
|---|---|
| 合并工作树 | **`E:/Workbox/sp-upgrade-merge`**（分支 **`merge/v0.2.3`**，7 个 commit） |
| 合并节点 | `7b02d1d2`（801 文件，+109,925/−17,241）→ 收口 `e530fcb5` `146add5f` `f934b1cb` `45ed8f79` `bc43928c` `d872ddff` |
| 主线 | `E:/Workbox/sp-upgrade-2.1`（分支 `feature/v0.2.1-fusion-master`）——**全程未动**，合并结果尚未合回 |
| node_modules | 合并工作树里是指向主工作树的**目录 junction**（`mklink /J`），可直接跑测试 |
| 上游 ref | `v0.2.3` = `1db8e510`（2026-10-10 03:19 打的 tag）；merge-base = `9f93096e` |

**纪律（用户明令，必须遵守）**：
1. **PR #149 永久排除**（`.agents/rules/upstream-sync.md`）：`.bonds-toggle` / `.gm__bond-list` / `bondsCollapsed` /
   `test/ui/bond-collapse.e2e.test.js`。已排除，全仓零黑名单特征。
2. **不部署、不 push 任何远端**（阿里云线上红线）。
3. **合并以我（融合线）为主**；**上游 UI 组件不整份搬入**——双端特异性适配是硬要求
   （`device.js` 特性类 / `sp-coarse`·`sp-hover` / 44px 命中区 / 手机端底部弹出 / CSS 三层制，**绝不用 UA 或宽度**）。
   要上游的 UI 功能就按我们的做法重写 + 双端截图比对。

## 二、做了什么（合并 + 三轮收口）

**合并策略**：陈旧上游快照 112 个取上游（判据 = `HEAD 的 blob 是否存在于 v0.2.3 历史`）；
双方都改过的 109 个取我们侧，上游版本归档 `docs/upstream-merge/v0.2.3-conflicted/`（70 个 UU，4.2MB）；
`kits/tier{1,4,5,6}.js` 按上游删除（内容搬 `kits/shared/`），我们的版本归档 `our-deleted-by-upstream/`；
自动合并 906 个；版本全线升 `0.2.3-fusion`。

**收口三轮**（把「取我们侧」造成的结构不自洽清干净）：
- 删 C 类（上游与本地平行演化的子系统）：`ui/lang.js`+`public/i18n/**`（i18n）、`ui/operatorVoice.js`（每干员语音 UI）、
  `screens/cultivation.js`（培养屏）、`render/app/**`(6)+`render/fx/**`(15)（上游渲染模块化）、`server/http/**`(9)（上游目录重构）。
- 补齐上游缺失导出 11 个：`DEV_BUILD`、`checkLoadoutOps`、`bossPoolShareOf`、`sanitizeOps`、`parseStoredOps`、
  `champagneHold`、`CHAMPAGNE_TRIGGER`、`quickSkillTags`、`opsOf`、`voiceLine`、`TEXT_SIZES`、`cultivationCharIds`。
- `chess_char_5_01-excu2.js` 取上游版（上游把 `crowdAspd` 从 `kits/shared/tier5.js` 删除、改用引擎级
  `traitMods.js` 规则；我们旧版仍导入它 ⇒ 一条 import 链曾挂 27 个测试）。
- 恢复 `public/js/render/app/info.js`（**它在我们 HEAD 里也有**，第一轮误删）。
- 删上游专属测试共 ~25 个（测已删子系统或未整合的上游 UI 组件）。
- 更新 3 处「上游加法字段」的期望：`snapHud.resolved`、`room.loadout.ops`（潜能/练度）、`matchInfoModel` 的 `diyData`（自选）。

**当前测试状态（在 merge/v0.2.3 工作树实跑）**：

| 套件 | 结果 |
|---|---|
| `test/ui/*` | **571 测试 / 563 通过 / 0 失败**（收口起点 162/81） |
| `test/client-static.test.js`（静态 import 图） | **329 全绿**（起点 384/10） |
| mod 链 + admin + 门禁（es2020/version/capabilities 等） | **395 测试 / 393 通过 / 0 失败** |
| `test/data.test.js` + `test/golden.test.js` | **11 项红**（引擎变了，golden 必须重生成） |

## 三、下一步（按依赖顺序，别跳步）

1. **golden 重生成**（唯一剩下的红）。重录后人工抽查 3 个场景与上游 CHANGELOG 描述一致；mod 内容另建一族摘要，
   不进 `test/golden/*.json`。
2. **把 `merge/v0.2.3` 合回 `feature/v0.2.1-fusion-master`**（建议 `--no-ff`）。
   ⚠️ **这一步要写主线，必须先确认并行会话已停手**（`git status` 清零 + `find . -newermt` 无活跃写入）。
   我无法与并行会话沟通，需要用户协调。
3. **然后才是 D2 逐房 overlay**——mod 真正「加载并正常显示」的那一步。当前缺失：
   `shared/contentSnapshot.js`、`server/mod/overlay.js`、`server/mod/roomData.js`、`server/mod/injectRoomData.js`
   全都不存在，且没有任何游戏侧代码调用 `mergeOverlay`/`contentSnapshot`（唯一引用在 `server/modverify/cli.js`，
   那是验证用的）。D2 动的全是热文件（`Match.js`/`Battle.js`/`spec.js`/`support`），所以必须在合并收口**之后**做。
4. 之后：D4 房主弹窗与私密房 → E1/E2/E4 界面 → F 总验收（含真实 CDN 推送、三端打包冒烟）。

## 四、mod 分发管线现状（与合并并行的另一条线，已完成的部分）

**已落地且有测试**（主线 `feature/v0.2.1-fusion-master` 上，commit `df1ad8a8` `581dc29f` `d038885b`
`2163e07b` `298ac5a8` `55de973e` `166141c0` 等）：
上传（C1 裸 body 直收 + 幂等 + staging）→ 五道验证（C2 独立 fork 子进程 + 合并器注入 + skip≠pass）→
发布（C3 验证后拆分：素材上第三方 CDN、数据/kit 留瘦身 zip、catalog 聚合）→ 客户端启动拉清单 + 按需缓存（D1）→
后台 MOD 流水线界面（E3）。承载 = **第三方静态托管池**（`downcdn.jiangjiangze.icu` 管理端 /
`weishucd.jiangjiangze.icu` 公共端，自动 sha256 查重，拒收 `.js`），catalog = 游戏服务器 `/mods/index.json` 聚合。

**没做的**：D2（上面第 3 条）。所以现在**能上传/验证/发布 mod，但 mod 内容进不了对局**。

**四个上游新功能的服务端开销（已查）**：`botEmotes` 有服务端实现且**默认开**
（`SP_BOT_EMOTES=0` 可关；三入口都有 `hasHumans(m)` 守卫，全 bot 房零开销，每轮最多 1 条广播）；
`setupVote` 随阶段机推进；`resumeMatch`/`setupReroll` 在 server/shared **零引用**（纯客户端且未接线，是死代码）。

## 五、踩过的坑（省你时间）

1. **`git cat-file -e <ref>:<path>` 的路径必须用 `/`**——Windows 的 `\` 会让它永远查不到，导致「是否存在于 HEAD」的
   分类全部反过来（我因此误判过一轮，也误删过 5 个我们自己的测试，已全部恢复）。
2. **`git stash pop` 不带参数在这个仓库很危险**：`git stash list` 里有 3 条**其他分支的旧 stash**（`stash@{0}` 是
   304 文件的大 stash），误弹会污染工作区。恢复 = `git reset --hard HEAD`（前提：弹之前跟踪文件是干净的）。
3. **从上游按符号名提代码块的脚本**：用 `indexOf` 找声明 + 按大括号配平到「深度归零」为止。
   函数体**没有尾随 `;`**，用「找下一个 `;`」会吞掉后续声明；`Object.freeze([...])` **没有大括号**，要走 `;` 回退。
   本会话为此写坏过 3 个文件（已回退重做）。
4. **`export function*`（生成器）与 vendor 的 re-export 形式**会让朴素的「导出名扫描」**误报**
   （`botPrep*`、`public/vendor/*` 都是误报）。
5. **删「上游文件」前先确认它不在我们 HEAD 里**——AA 冲突（双方都新增）的文件我们也有份。
6. 分套跑测试，别裸跑 `node --test`；`node --test test/ui/*.test.js` 这种 glob 可用，**目录形式不行**。
7. 视觉验收代理（visual-judge）**不可用**（provider-not-found）——渲染结果自己核（本会话的两张图都做了程序化自检）。

## 六、产出的文档与图（都在 `docs/upstream-merge/`，主工作区与合并工作树各一份）

| 文件 | 内容 |
|---|---|
| `MERGE_V023_STATUS.md` | 合并状态与两条出路（逐文件整合 / 窄合并）——已按「窄合并」执行 |
| `MERGEABLE_CONTENT_RESEARCH.md` | 可合并内容调研：A 可直接用 / B 保我们 / C 需整合或排除 / D 黑名单 + 皮肤链逐文件实测 |
| `merge-classification.png` | 上面的分类图（1600×1094） |
| `merge-3way-comparison.png` | **三方比较图**：上游 / 我们 / 融合裁决（1780×1321） |
| `v0.2.3-conflicted/` | 70 个双方都改过的文件的上游版本（逐 hunk 复核的输入） |
| `our-deleted-by-upstream/` | `kits/tier{1,4,5,6}.js` 我们改过的版本（归档备查） |

## 七、记忆索引（跨会话）

`upstream-023-merge-executed-state`（本合并的全过程与状态）、`upstream-ui-needs-dual-platform-adaptation`
（用户的 UI 约束）、`cf-mod-pipeline-progress`（mod 管线进度）、`git-stash-pop-hazard-this-repo`（stash 陷阱）、
`sp-upgrade-concurrent-session-hazard`（并行会话纪律）、`sp-upgrade-dual-platform-axes`（双端三轴判定）、
`global-voice-tri-ui-endless-plan`（全语种语音×三端 UI×无尽出服的 P0–P9 计划，合并后才好做）。
