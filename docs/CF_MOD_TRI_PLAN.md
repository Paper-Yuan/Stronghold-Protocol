# CF MOD 三端分发总施工蓝图（CF_MOD_TRI_PLAN）

> **状态：GLM-5.3 终审通过（approved: true）**。终审附 1 条非阻塞 issue（D2 战斗构造调用图的事实偏差），已按终审消解方向在本文 §2-D2 中直接修补：调用图由「待定位」改为「已定位」，实锚见 §2-D2-0。
>
> 基线：HEAD `975585e1`（分支 `feature/v0.2.1-fusion-master`），基线日 2026-10-10。工作区脏条数按 git-bash 实跑为 124 条（时点记录，随并行会话漂移，**不进任何验收断言**）。
>
> **施工纪律（全文档生效）**：
> ① `文件:行号` 锚点必须实锚——只引用实读过的行；行号一律以 HEAD 975585e1 为准，A2 合并后全部作废、只按字符串存在性断言（grep 路由/导出签名，不断言行号）。
> ② 官方 `data/*.json` 与 `public/assets/**` 一个字节不改（mod 一律 overlay；皮肤补录走专用脚本链）。
> ③ 本期不与 0.2.3 合并（路线 A）抢同一批热文件——`server/sim/Battle.js`、`server/match/Match.js`、`shared/protocol.js`、`server/match/gamedata.js` 四族在 A2 期间冻结；各阶段相对 A2 的边界在每阶段抬头写明。
> ④ shell 口径：每条验收命令二选一——命令块首行标 `# shell: git-bash`，或改写为 Node 单脚本断言（`node tools/assert/*.mjs` / `node -e`）。cmd/PowerShell 下禁止 `wc -l`/`diff -rq`/`findstr /n` 与 GNU 工具混写。
> ⑤ 基线口径：禁止把工作区条数（120/123/124 或未来任何数）写进验收断言；只允许形态断言（「输出为空」「grep 零命中」「exit 0」）。

---

## 0 · 决策定稿

### 0.1 今日拍板（2026-10-10 用户拍板，最终决策，不得偏离）

1. **mod 不分档**：整包 zip 从管理员后台上传、整包 zip 下发；包内可含 kit JS（不分「纯数据/带 kit」两档）。
2. **全量包 + mod 走 CF 静默分发**：双端每次启动从 CF 拉 mod；网页端启动还静默拿全量包 + mod；APK/桌面包不内置 mod（解 D26 矛盾、APK 瘦身）。
3. **mod 上传管线全做**：后台仅管理员上传 zip → 服务器验证（schema 分层校验 / ES2020 闸门 / 确定性检查 / bot 跑一轮 SP_VERIFY 无 mismatch / 客户端渲染冒烟）→ 通过才推 CF 做分发。
4. **服务器不 import 未知 JS 的红线**：上传的 kit 由验证服务器（专用进程）加载与验证，通过后整包进 CF；游戏服务器与客户端从 CF 拿包后同样走加载路径约束（合并进房间时才按需加载 kit）。

**拍板 2 口径澄清（2026-10-10 用户已确认：「mod 是拉清单」）**：「双端每次启动从 CF 拉 mod」= 启动时同步 **mod 目录（catalog：`id/version/sha256/bytes/features` 清单）**，整包 zip 字节**按需拉取**——首次需要该包时（建房选包/加入 mod 房）拉取并缓存，此后启动只按 sha256 判鲜增量更新。**此口径已定稿，D1 按现行设计执行，F 阶段验收标准按此口径书写**（见 §2-D1 与 §5）。

### 0.2 引用既有决策（GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN.md D1–D6 定稿）

- **D1**：全语种语音（+140MB，走 CF 分发与 mod 同一 `?v=` 版本化契约）。
- **D3**：三端 UI 拆分总原则（CSS 三层制：结构层 / `.desktop.css` / `.mobile.css`；特性类 `sp-touch && sp-coarse` 判定，红线不走 UA）。
- **D4**：无尽在线化轨道废弃——`server/records.js`、`/api/endless/*`、leaderboard API **不合并进本蓝图**（无尽转客户端本地模式）。
- **D5**：双端同一实现（手机端交互形态优先、桌面端信息密度优先、逻辑层共用只分叉布局层）。
- 皮肤补录（271→273，酒神/真言）为纯数据管线，脚本链见 SKIN_UPDATE_SIGHTSEER4_GUIDE.md。

### 0.3 全局接口冻结（各阶段共用的唯一事实源）

| 项 | 冻结值 | 依据 |
|---|---|---|
| mod catalog 端点 | **`/mods/index.json`** | `/packs/index.json` 是语言包索引契约（`shared/packs.js:29` 头注释）；CF Function 只兜 `/mods/**` 到 R2，`/packs/**` 维持语言包语义 |
| catalog 唯一文件 | **`shared/modCatalog.js`** | 废止 `shared/modIndex.js` 与 D1 旧稿 `shared/modCatalog.js` 双文件方案；与 D1 共用，谁先落地谁建，另一个 import |
| catalog 条目形状 | `{id,name,version,minApp,sha256,bytes,url,features[]}` | `minApp` 必填；`sha256` 64 位 hex；`bytes` 正整数；`url` 内容寻址 |
| zip URL 版本化 | **zip 对象内容寻址（key 含 sha256）天生不可变，URL 不带 `?v=`**；`?v=<sha256前12>` 只用于 `/mods/index.json` 本身（索引会被原地重写） | `hasFreshPack` 只按 sha256 判鲜，不解析 `?v=` |
| zip R2 key / URL | `mods/<id>/<sha256>.zip` / `/mods/<id>/<sha256>.zip`；`isModZipUrl` 正则拒绝任何带 `?` 的 zip URL | 从代码层面杜绝「zip 加 `?v=`」回流 |
| 上传 body 契约 | **裸 body 直收**：`fetch(url,{method:'POST',body:file})`（File 即 BodyInit），`Content-Type: application/zip`，**不用 FormData/不用 multipart** | 仓库零 multipart 设施（grep `formidable|busboy|multer` 零命中）；E1 的 FormData 形状作废 |
| staging 落点 | **`server/.mod-staging/`**（服务器私有运行时目录，与 data/ 零交集） | `data/mod-staging/` 方案作废（与 `data/endless-records.json`「运行时产物不入 data/」先例矛盾）；`.gitignore` 加一行 |
| 服务器缓存落点 | **`server/.mod-cache/`**：整包 zip + 解出的 sections 目录树 | 服务器反复开局需要，解包一次落盘 |
| 浏览器缓存形态 | IndexedDB 只存**整包 zip Blob + meta**（STORE_BLOBS/STORE_META）；**sections 不落盘**，消费时由 `unpackModZip` 内存解出 | 避免双写不一致；localStorage 轻量索引改 `{packId: sha256}` |
| 合并器接口 | `server/mod/overlay.js` 导出签名冻结：`mergeOverlay(baseData, packSections[], opts?) → { data, snapshotHash }`（data 已 deepFreeze） | C2 gate4 经 `--merger=<path>` 注入消费（默认 `shared/customContent.js`，D2 落地后切默认值）；gate4 内部禁止硬 import 合并器 |
| 语义 | 只加法 + 显式 overrides；fail-closed（冲突即拒绝，不降级） | `mergeCustomContent`（`shared/customContent.js:42-57` 浅合并）只当参考实现与 C2 默认合并器，不进生产路径 |

---

## 1 · 阶段矩阵与依赖图

### 1.1 编号口径（唯一事实源，草稿内部编号一律作废）

| 阶段 | 名称 | 工期 | 相对 A2 边界 | 草稿状态 |
|---|---|---|---|---|
| **A0** | 工作区收编（含暂存 mod 文件处置） | 0.5–1 天 | 合并前 | 已交（v3 返工版） |
| **A1** | 皮肤补录 271→273 | 0.5 天 | 合并前 | 已交 |
| **A2** | 路线 A 合并（0.2.2→0.2.3） | 5.5–6.5 天 | —— | 见 UPSTREAM_023_MERGE_PLAN_V2.md |
| **B1** | pack 契约与索引（data 升 supported 四件套 + modCatalog） | 2–3 天 | 合并后（B1-0 门禁 0 调查可并行） | 已交（v3 返工版） |
| **B2** | CF 底座（R2 + Function 兜 `/mods/**`） | 2–3 天 | 合并后 | **空白** |
| **B3** | 打包不内置 mod（APK/桌面瘦身 + LOCAL_FEATURES） | 1–2 天 | 合并后 | **空白** |
| **C1** | 管理员后台上传（裸 body 直收 → staging） | 2–3 天 | 合并后 | 已交（v2 返工版） |
| **C2** | 五道验证管线（专用验证进程） | 4–5 天 | 合并后（C2-0 npm install 可并行） | 已交（v3 返工版） |
| **C3** | 推 CF 发布 | 1–2 天 | 合并后 | **空白** |
| **C4** | 版本治理（`?v=` 口径、判鲜、下架） | 1 天 | 合并后 | **空白** |
| **D1** | 静默拉取与缓存（双端） | 2.5–3 天 | A2 前可落（不碰 server 热文件） | 已交（v3 返工版） |
| **D2** | 逐房 overlay（含去单例桶化与 Match 侧接线） | 5–6 天 | **合并后**（Match/Battle/spec 全热） | 已交（v3 返工版，含 §2-D2-0 调用图修补） |
| **D3** | （并入 D2，不单独列） | —— | —— | —— |
| **D4** | 房主弹窗与私密房（P7） | 3–4 天 | 合并后（protocol 扩展在 A2 落库后追加） | **空白** |
| **E0** | mod 管理屏设计稿 | 1 天 | 合并前可并行 | **空白** |
| **E1** | mod 管理界面重写 + 图鉴屏小改 | 3–4 天 | S1 可合并前启动；S2–S5 合并后 | 已交（v3 返工版） |
| **E2** | 图鉴屏端差异施工（equipment/alliances 三层制迁移） | 2 天 | 合并后 | **空白** |
| **E3** | 管理员后台 UI（上传→五道验证→发布流水线可视化） | 2 天 | 合并前可启动 | **空白** |
| **E4** | 私密房房内显示（P7 前端） | 1–2 天 | 合并后 | **空白** |
| **F** | 总验收 | 1–2 天 | 合并后 | **空白** |

> 说明：早期草稿把「D3 去单例 Match 侧接线」单列，v3 返工后其内容（support 桶化、newBattle/spec 透传、房级数据装配）已全部并入 D2；「E2–E4」由 uiFocus 焦点 2/3/4 拆出并在本表首次逐一命名，本表即命名事实源。

### 1.2 依赖图

```
A0（收编）──┬──> A1（皮肤，文件零交集，可并行）
            ├──> A2（路线 A 合并，硬前置：工作区干净）
            └──> B1 / C1 / C2 / D1 / E1 的暂存件与测试基线
A1 ──> A2（+14 素材文件合并前落定，避免归因混淆）
A2 ──> B1-1..B1-6 / B2 / B3 / C1 / C2-1..8 / D2 / D4 / E1-S2..S5 / E2 / E4 / F
B1 ──> B2（catalog 契约）──> C3（推 CF）──> D1（真实拉取）
B1 ──> C1（zip 内结构契约）──> C2（五道验证）──> C3（五道全过才推）
C4（版本治理）──> D1（判鲜逻辑）
D1 ──> D2（服务器侧 packCache.loadPackSections / 浏览器侧 unpackModZip 同形状契约）
D2 ──> C2 gate4 回归（overlay 合并器重跑 fanpack，DoD 归 D2）
D2 ──> D4（Room.packs/modData/contentHash 字段就位，D4 只加协议与私密逻辑）
D4 ──> E1-S5 / E4（错误码契约回填、房内显示）
E0（设计稿）──> E1 / E2 / E3 / E4（布局层）
F 启动硬门槛：① 全部空白阶段（B2/B3/C3/C4/D4/E0/E2/E3/E4/F）草稿交付且评审通过；
             ② 拍板 2 口径用户书面确认；③ A2 合并完成且全量分套合并后首跑校准。
```

### 1.3 里程碑

- **M1**：A0+A1 落库，工作区干净、基线可复现（`git status --porcelain` 空 + 分套基线普查记录）。
- **M2**：A2 合并完成，0.2.3 功能落库、golden 两轮翻红归因清零。
- **M3**：B1+C1+C2 落库——管理员可上传 zip、五道验证出报告（gate4/gate5 结论标注「A2 后首跑校准」）。
- **M4**：B2+C3+C4+D1 落库——CF 上有包可拉，双端启动同步 catalog、blob 按需。
- **M5**：D2+D4+E1 落库——私密 mod 房端到端可开，F 总验收通过后发布。

---

## 2 · A–F 各阶段分步清单

> 各阶段清单均吸收自已交付草稿的 v2/v3 返工版（含评审 18 条 issue 与终审 1 条 issue 的消解），锚点均为各草稿会话在 HEAD 975585e1 实读实锚。行号在 A2 后一律重读。

### 2-A0 工作区收编（0.5–1 天，合并前）

**目标**：把 124 条脏状态分类固化，暂存区 8 个 mod 文件逐件落 commit，镜像漂移复原，工作区回到可施工基线。

**前置实证（A0-0）**：与并行会话协调停手窗口。基线只记形态不记条数。`git check-ignore` **禁止使用**——本会话实证 git-for-windows 2.55.0 对 CRLF 空行存在解析 bug（`.gitignore` 全 CRLF，7 个空行被解析为「匹配一切」，`git check-ignore -v nonexistent-xyz-123/` 误报 `.gitignore:57` 命中，exit 0；已在 /tmp/gi-test 干净仓库用 `printf 'x/\r\n\r\n' > .gitignore` 复现）。ignore 自检改用新建 `tools/assert/check-ignore.mjs`（Node 版：读 `.gitignore` → `split(/\r?\n/)` 剥 CR → 过滤空行/注释 → gitignore 语法转正则 → 逐路径判定输出 `IGNORED by L<行号>` 或 `NOT ignored`）。实证基线：`server/.mod-staging/x.zip` 被 `.gitignore:46 *.zip` 忽略（exit 1）；`packs/fanpack/pack.json`、`data/endless-records.json`、`server/.mod-cache/**` 均 NOT ignored。

**步骤**：
1. **A0-1 新建 `tools/assert/check-ignore.mjs`**。验收：`node tools/assert/check-ignore.mjs packs/fanpack/pack.json data/endless-records.json` → 两件均 NOT ignored 且 exit 0；`node tools/assert/check-ignore.mjs server/.mod-staging/x.zip` → IGNORED 且 exit 1。
2. **A0-2 收编 8 个 mod 文件 + packs/fanpack 内容包**（全部不带 `-f`，A0-1 已实证未被忽略）：改造件 `server/packs.js`（113 行，`/api/packs` 探测 + GlobalModManager）、`shared/customContent.js`（57 行；**CUSTOM_SECTIONS :4 实测已含 bands/items/skins**——蓝图 modScope 表「补 bands」一条已过时，不收编改动、修订记入 commit message）、`server/admin/cfStorage.js`（52 行）；重写/迁移件 `public/js/ui/modUploadModal.js`（287 行）、`modZipParser.js`（166 行）、`modStorage.js`（210 行）；图鉴屏 `public/js/screens/equipment.js`/`alliances.js` + 两 css；测试 `test/packs.test.js`/`test/customContent.test.js`；内容包 `packs/`（fanpack：pack.json + records/chess/tokens/variants/art/README，pack.json 实锚 `type:"data"`、files 为 role→单路径形状，**本阶段不改一个字节**）。**不落库**：`fanpack-mod/`（仅 README+manifest 过渡壳，归并 `packs/fanpack/_incoming/` 待 B1 裁决）、`data/endless-records.json`（废弃轨道运行时产物）、全部 `screen*.png`/`scratch_*.js`/`nul`/`.edge_data/`/`cloudflared-*.deb`/`test_ports.py`（删除或 ignore，删除前与并行会话确认）。
3. **A0-3 staging/cache 落点开地**：`.gitignore`（57 行实读，工作区已被并行会话加 `dist/` 一行于 :43）新增两行 `server/.mod-staging/`、`server/.mod-cache/`（Build artifacts 段尾）。**不新增任何 data/ 相关 ignore 行**。验收：`node tools/assert/check-ignore.mjs server/.mod-staging/fanpack/manifest.json server/.mod-cache/fanpack/pack.zip` 两件均 IGNORED 且 exit 1。
4. **A0-4 镜像复原（先 sync → 再量门禁，顺序写死）**：跑 `node tools/sync-static-web.mjs`（`:23 syncStaticWeb`、`:27 shared→public/shared`、`:30 data→public/data`、`:32-41 server/sim→public/sim` 排除 nodedata.js、`:43-51 simdata.js 剥 IS_NODE 块有意改写`）。漂移归因写死进 commit body（**不进门禁例外清单**，属「sync 前历史态」）：① `shared/diy.js`、`shared/packs.js` canonical 已改、public/shared 未刷（ENDLESS_MOD_DUAL_PLATFORM_PLAN.md:110 双漂移实录；packs.js 漂移含 public 侧残留 `||=` ES2021 语法，必须消）；② `shared/customContent.js` public 侧暂缺，sync 补出；③ `data/assets.json`、`data/config.json` canonical 已推进（975585e1 只改 data 侧漏 sync），public/data 未刷。门禁例外恰好两处：`simdata.js`（有意改写）+ `nodeData.js`（server 侧独有）。验收（`# shell: git-bash`）：`diff -rq shared public/shared` → 无输出；`diff -rq data public/data` → 无输出；`diff -rq server/sim public/sim` → 恰好 2 行（`simdata.js differ` + `Only in server/sim: nodeData.js`）。
5. **A0-5 镜像门禁落测试**：`test/client-static.test.js` 上扩（不新建第二处门禁）新 describe 块断言上四条，白名单恰好 2 件（按 basename 过滤，多一个即报错防悄悄扩例外）。
6. **A0-6 分批 commit**（3 个：`.gitignore + 落点开地` / `清理运行时产物与调试垃圾` / `mod 链路收编 + 镜像复原 + 内容包 + 文档`），commit message 含归因段与「CUSTOM_SECTIONS 已含 bands」蓝图修订说明。
7. **A0-7 废弃件登记（不删代码）**：无尽在线化废弃件（`server/records.js`、`/api/endless/leaderboard`（server/index.js:850-872 实锚）、`/api/admin/endless`（:785）、`public/js/ui/leaderboard.js`、`public/css/leaderboard.css`）在 `docs/UPSTREAM_023_MERGE_PLAN_V2.md` 末尾追加「A0 登记的废弃件清单」一节；删除决策留给无尽出服阶段/D5，A0 不越权。
8. **A0-8 基线普查记录**：分套跑 `node --test test/content/ test/sim/ test/data.test.js test/match/ test/render/ test/golden.test.js test/ui/ test/server/ test/packs.test.js test/customContent.test.js test/client-static.test.js`（**不裸跑 `node --test`**——HANDOFF §7 实记会挂），红项数写进 `docs/HANDOFF_NEXT_2026-10-10.md`（记录用，不作门禁）。

**总验收**（`# shell: git-bash`）：
```bash
node --test test/packs.test.js test/customContent.test.js   # 本会话已实证基线 4 pass / 0 fail
node --test test/client-static.test.js                       # 含新镜像门禁 describe，绿
git status --porcelain -- packs/ shared/ server/packs.js server/admin/ public/js/ui/mod*.js test/packs.test.js test/customContent.test.js   # 输出为空（收编范围全净；白名单外并行会话在制品不断言）
node -e "const a=require('./data/assets.json'),b=require('./public/data/assets.json');if(JSON.stringify(a)!==JSON.stringify(b))process.exit(1)"  # exit 0
```

**A0 明确不做**：不改 `packs/fanpack/pack.json` 的 files 形状（B1 四件套）；不动 PACK_TYPES.data planned 状态（B1）；不删 modUploadModal 上传入口（E1）；不改 cfStorage.js 假推 CF（C3）；不跑 `npm run assets`（会剪枝 38 个 DIY token 与中日双语语音分组，b7b06e44 踩过、975585e1 修回）；不跑全量 `node --test`（node_modules 未装全，`node_modules/acorn` 不存在——es2020 闸门依赖它，全量分套归 F）。

---

### 2-A1 皮肤补录 271→273（0.5 天，合并前）

纯数据管线，与 A2 合并零冲突面（不碰 41 个热文件）。唯一手工编辑 = `docs/research/08-skins.json`（研究层）与 `test/skins.test.js`（计数），其余全部脚本链生成。

**步骤**（每步验收命令即施工命令）：
1. **A1-0 冻结基线**：`node -e "const d=require('./docs/research/08-skins.json');const ks=Object.keys(d.skins);let n=0;for(const k of ks)n+=d.skins[k].length;console.log(ks.length,n)"` → `172 271`；`node --test --test-name-pattern "皮肤" test/skins.test.js` → 基线 2 绿。
2. **A1-1 编辑 `docs/research/08-skins.json`**：粘贴 SKIN_UPDATE_SIGHTSEER4_GUIDE.md:66-140 两段条目（`char_1042_phatm2`/`char_4204_mantra`，sightseer#4，全套 URL 已实测 HTTP 200）；`meta.counts` 顺手改 `{operators:174,skins:273}`。验收：node 断言 `173/273` 两键存在。
3. **A1-2 `node tools/build-skins.mjs`** → 预期 stdout `[skins] 173 个干员 / 273 套皮肤 → data\skins.json`。
4. **A1-3 下载素材**：`node tools/fetch-skin-avatars.mjs` + `node tools/fetch-skin-spines.mjs phatm2` + `node tools/fetch-skin-spines.mjs mantra`（断点续传安全）。验收：node 断言 14 个文件（2 头像 + 12 spine）存在且 >1KB → `ALL 14 FILES OK`。
5. **A1-4 `node tools/inject-skins-assets.mjs`**（`:44-46` 仅磁盘有 front skel 才写 spine 字段，故 A1-3 必须先跑；`:86-88` 只更新 `stats.skins/charsWithSkins`，不动 `stats.hash`——既有行为不修）。验收：stdout `✔ 成功向 data/assets.json 注入 173 名干员的共 273 套皮肤资产条目。` + node 断言两干员 skins 含 spine 字段、stats 273/173。
6. **A1-5 `node tools/sync-static-web.mjs`** → node 断言 `public/data/skins.json` 173/273。
7. **A1-6 改 `test/skins.test.js` 三处计数**（`:16` 标题 271→273、`:19` 172→173、`:30` 271→273，断言消息一并改）。
8. **A1-7 测试**：`node --test --test-name-pattern "皮肤" test/skins.test.js` → `pass 2 fail 0`（用 `--test-name-pattern` 不用管道，指南 :200）；`node --test test/client-static.test.js` 绿。
9. **A1-8 人工对局冒烟**（不可自动化，如实标注「需人工跑，不宣称通过」）：酒神「真我自扼」/真言「万籁俱寂」选皮、头像、正背面 spine 换装；列托（`char_194_leto`）不在干员池不做。

**红线**：不跑 `npm run assets`；不动 `data/skins-installed.json`（零消费者，grep 实证）；不下 `skin/{portraitId}b.png` 全身立绘（+435MB）；`data/skins.json`/`data/assets.json`/`public/data/*.json`/`public/assets/**` 一律不手改。

---

### 2-A2 路线 A 合并（5.5–6.5 天）

按 UPSTREAM_023_MERGE_PLAN_V2.md 执行，本蓝图不重复展开。**对本蓝图的影响登记**：
- A2 后 `server/index.js` 行号必漂移——C1 的全部 index.js 锚点（:743-747 AdminService、:763-764 /admin 挂载、:767-807 /api/admin 块、:823-831 /api/packs，均 HEAD 实锚）执行时重读定位；C1 验收**禁止按固定行号断言**，改按路由字符串 grep 断存在。
- A2 后 `server/match/Match.js`、`server/sim/spec.js`、`server/sim/content/support/index.js` 的 D2 锚点（见 §2-D2）同样按字符串重定位。
- 协议扩展（room.create.packs、client.content、snapshotHash 上 spec）一律在 A2 落库后追加。
- A2 完成后全量分套首跑 = C2 gate4「mismatches===0 / 120s」与 D2 全量回归的**校准点**（此前一律标注「未实测，A2 后校准」）。

---

### 2-B1 pack 契约与索引（2–3 天，合并后；B1-0 可并行）

**B1-0 接口冻结（先行节）**：mod catalog 唯一文件 = `shared/modCatalog.js`；端点 = `/mods/index.json`；条目形状 = `{id,name,version,minApp,sha256,bytes,url,features[]}`；zip 不带 `?v=`、`?v=<sha256前12>` 只用于索引；staging/cache 落点 = A0 定案的 `server/.mod-staging/`、`server/.mod-cache/`。路由边界书面化：`/packs/**` 语言包、`/mods/**` mod、`/api/packs`（server/index.js:823-831 实锚）GlobalModManager 探测三边界写进 `shared/packs.js:33` 后注释 + 新建 `tools/assert/mod-routes.mjs` 断言（`PACKS_URL='/packs/'` 未改、`MOD_CATALOG_URL='/mods/index.json'`、`/api/packs` 存在、modCatalog.js 零 `node:*` import）。

**现状实锚（重写会话已核实）**：
- `shared/packs.js:55-62`：`lang` supported + files 角色表（:56-59），`assets`/`data` 均 `status:'planned'` 且**无 files 字段**（:60-61）。
- `shared/packs.js:137` typedef `files: Record<string, string>`（单路径）。
- `shared/packs.js:192-202`：files 校验以 `ctx.folder && kind && kind.files` 为闸门——data 型当前因 `kind.files` 缺失整段跳过；**实证**：`normalizeManifest(fanpack pack.json, {id:'fanpack', folder:true})` 返回 `files:{}` 被静默吞空——这就是「升级前丢条目」实证。
- `shared/packs.js:246-247` `isLocalUrl` 私有；`:256-267 readPackIndex`：:260 按 `status !== 'supported'` 丢条目、:262 逐值 `isLocalUrl(url)` **不识别数组**。
- `packs/fanpack/pack.json`：`type:"data"`，files = records/chess/tokens/variants/art 五角色单路径。
- `test/packs.test.js:1-35` 现存只测 GlobalModManager（import 自 server/packs.js:3），不测 shared/packs.js——扩充 = 新增测试块，不动既有 35 行。

**步骤**：
1. **B1-1 新建 `shared/modCatalog.js`**（约 80-120 行，零 Node builtin）：`MOD_CATALOG_URL='/mods/index.json'`、`MOD_CATALOG_VERSION=1`、`isSha256`/`isModFeatures`、`normalizeModEntry`（id 复用 `isPackId`（packs.js:68）、url 过 `isLocalUrl` 且必须 `startsWith('/mods/')`；或按 CF 公网地址显式放宽 https 绝对 URL 并注释「mod zip 走 CF，语言包维持本地 URL」——二选一在执行时按 B2 的 Function 形态定稿，默认取前者）、`readModCatalog`（坏条目丢弃 + 计 dropped，fail-closed）、`buildModCatalog`（按 id 排序）、`hasFreshPack(entry, localSha256)`（**只按 sha256 判鲜**）、`catalogVersionUrl(base, sha256)`（`` `${base}?v=${sha256.slice(0,12)}` ``，索引专用）、`modZipKey/modZipUrl/isModZipUrl`（正则 `^\/mods\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[0-9a-f]{64}\.zip$`，**任何带 `?` 的 zip URL 过不了断言**）。头注释写死 D1 消费面（readModCatalog/hasFreshPack/catalogVersionUrl/modZipUrl 四个唯一入口，禁止 D1 自写判鲜或手拼查询串）。
2. **B1-2 data 型升级四件套（同一 commit，接口闭合的原子单位）**：
   - **件①** `PACK_TYPES.data` 升 `status:'supported', live:false`，summary 改 per-room overlay 语义（原文「applies at start」与拍板矛盾），files 角色表 = fanpack 五角色 ∪ `CUSTOM_SECTIONS` 七节（records/chess/tokens/variants/bands/items/skins，customContent.js:4 实锚）+ art，全部 ext `['.json']`、均不标 required（fanpack 只有五角色，全标 required 会把 fanpack 打死）。
   - **件②** typedef 改 `Record<string, string[]>`（注释「manifest 原文可写单字符串，normalize 归一为数组」）；:192-202 校验块内对 `given[role]` 先归一（`Array.isArray(rel) ? rel : [rel]`）再逐元素走 isPackPath/ext 校验，`out.files[role] = rels`。
   - **件③** `isLocalUrl` 提为具名导出（modCatalog.js 与 D1 复用）；readPackIndex :262 改「数组元素逐一 isLocalUrl 过滤后归一为数组」；:263 lang 闸门 `!files.ui` 改 `!files.ui?.length`（**本次升级唯一 lang 路径行为变化点**：`files.ui` 空数组也拒）。
   - **件④** `langMetaOf`（:274-291）消费方适配数组形状（`ui` 取 `[0]` 或保持数组并在 jsdoc 注明）；`packIndexEntry`（:214-234）jsdoc 注明「files 值可为 URL 或 URL 数组」，代码零改。实证：`langMetaOf` 在 public/js 零调用方（grep 只命中注释与定义），数组化无现存回归面。
3. **B1-3 fanpack 兼容面**：`packs/fanpack/pack.json` 零字节改；测试断言新 normalize 下 `problems` 为空、`files.records` 深等 `['records.json']`、五角色键集一致。
4. **B1-4 readPackIndex 端到端读取路径测试**（评审红线「不能 only 测 normalizeManifest」）：`test/packs.test.js` 新增块——① data 型条目含单值/数组/坏 URL 混合 files → 读出、单值归一数组、非本地 URL 滤除；② `type:'assets'` 条目仍被丢弃；③ lang 回归 + `files.ui:[]` 拒收；④ normalize 负向（坏 ext/坏路径/未知角色）；⑤ 单文件语言包（_meta 布局）回归；⑥ modCatalog 合格/不合格条目过滤（sha256 非 hex、url 带 `?v=` 整条丢弃——核心回归用例防 D1 口径回流）。
5. **B1-5 自查**：`# shell: git-bash` `git diff --stat 975585e1..HEAD -- data/ public/assets/` 输出为空（staging 落点改 `server/.mod-staging/` 后 .gitignore 两行与 data/ 零交集，本断言天然干净）。

**B1 总验收**（交付时点可达，无「A2 后校准」项）：
```bash
node --check shared/packs.js && node --check shared/modCatalog.js
node --test test/packs.test.js test/customContent.test.js
node tools/assert/mod-routes.mjs
node -e "import('./shared/modCatalog.js').then(m=>{console.log(m.isModZipUrl(m.modZipUrl('fanpack','a'.repeat(64))));console.log(m.isModZipUrl('/mods/fanpack/'+'a'.repeat(64)+'.zip?v=abc'))})"   # true 换行 false
```

**B1 明确不做**：不改 `server/packs.js` 运行时行为（:36 探测根 `process.cwd()/packs`、:78 cfUrl 硬编码留 TODO 指向 D2/C3，B1 只抽 `this.cfBaseUrl` 配置位）；不动 `scripts/pack/*.mjs`（B3）；不补建 `tools/packs.mjs`（不存在，语言包静态索引不在本期）。

---

### 2-B2 CF 底座（2–3 天，合并后；草稿空白——本节为骨架登记，详稿待交）

**范围登记**（F 启动硬门槛①的输入）：① CF 门禁 0 调查（五条书面答案：Pages 构建输出目录、`/assets/*` 现状兜住方——`functions/assets/[[path]].js:7-15` 实锚先 `context.next()` 查 Pages 本地、:20 回落 Render、:44 再回落 jsdelivr，需确认生产部署；Pages 域名；R2 是否开通；隧道域名与 Pages 是否同 zone）落 `docs/CF_GATE0_FACTS.md` + `wrangler.toml`（`pages_build_output_dir` + `[[r2_buckets]] binding = "SP_MODS"`，桶命名建议 `sp-mods` 与素材桶分开）。② 新增 `functions/mods/[[path]].js`：照 assets Function 三层范式，差异 = mod 从 R2 取、`/mods/index.json` → `no-cache`、`/mods/<id>/<sha256>.zip` → `public, max-age=2592000, immutable`、**回落主服一层对 mod fail-closed 回 404**（主服不存 mod 字节，与 assets 的 Render 回落刻意不同，头注释写明）、HEAD 支持（etag/hash 增量失效用）。③ `server/admin/cfStorage.js` 真 R2 化（`@aws-sdk/client-s3` 正式依赖 vs `wrangler r2 object put` CLI 子进程包装，二选一在门禁 0 书面答案里定）；`uploadModPack(packId, zipBuffer, manifest)` 推内容寻址 key + put 后 head 回读校验；`publishModIndex` 推 `/mods/index.json`；本地落盘行为降级为 dry-run 专用并日志明说。④ 新增 `tools/push-mod-pack.mjs`（C3 调的同一入口，B2 先交付并自测 dry-run）。**真实推送验收挂起在门禁 0 五条事实上（本环境无 CF 凭据），代码与本地 dry-run 可写完**。

---

### 2-B3 打包不内置 mod（1–2 天，合并后；草稿空白——骨架登记）

**范围登记**：`scripts/pack/{_lib,index,server,desktop,mobile}.mjs`（A0 已收编）加「MODS 能力位」——新建 `shared/capabilities.js`（本会话确认不存在）定义 LOCAL_FEATURES/MODS 位；三包打包期不拷 `packs/`、不内置 mod 字节；`server.mjs:50-60` 的正则后处理段（删 /api/endless/leaderboard 路由、删 endless-records.json、抠 LeaderboardButton/EndlessCard 标签，A0 实读）留现场，B3 用 LOCAL_FEATURES 替换。验收骨架：`# shell: git-bash` `grep -rn "packs/" scripts/pack/*.mjs tools/bundle-android.mjs | grep -v "^.*//"` 零命中（打包脚本无 packs/ 拷贝行）；APK 体积基线断言 = 621MB + 2.2MB（皮肤）+ 140MB（全语种语音，后续）的归因注释，mod 字节零贡献。

---

### 2-C1 管理员后台上传（2–3 天，合并后）

**契约（先于步骤冻结）**：裸 body 直收（§0.3）；staging 落点 `server/.mod-staging/<uploadId>/`；路由 `POST /api/admin/mods/upload`（在既有 `/api/admin/` 鉴权块内复用 `admin.authenticate`，server/admin.js:78-91 实锚 Bearer/cookie 双通道）；响应 `{ ok:true, uploadId, sha256, bytes, stagedAt }`，失败 `{ok:false,error}` + 401/400/413/415；uploadId = `<sha256前12>-<yyyymmddhhmmss>`；大小上限 `MOD_UPLOAD_MAX_BYTES` 默认 64 MiB（Content-Length 预检 + 流式计数双保险）。**注意 `server/index.js:52-65` 的 `readJsonBody` 是 JSON 专用 64KB 上限，不能复用于 zip**。

**步骤**：
1. **C1-0 前置自检**：`grep -n "api/admin/mods/upload" server/index.js` 零命中（防重复施工；有命中说明并行会话抢先，停工比对）。
2. **C1-1 新建 `server/admin/modUploads.js`**（约 120-180 行，零新 npm 依赖）：`ModUploadManager` 类，构造注入 `{stagingDir, maxBytes, log}`（stagingDir 默认 `path.join(ROOT,'server','.mod-staging')`，ROOT 复用 server/index.js:68 `export const ROOT`）；`receive(req)`：Content-Type 校验（`application/zip`/`application/x-zip-compressed`，否则 415）→ Content-Length 预检 → 临时目录 `incoming-<ts>-<rand>` 边收边算 sha256、超限即中断删目录 → 收完按 `<sha256前12>-<ts>` 重命名、`pack.zip` 落盘、写 `receipt.json`（`{uploadId,sha256,bytes,stagedAt,status:'staged'}`）；幂等：同 sha256 已 staged/verified 直接返回已有 uploadId；`list()/get()/remove()` 供 C2 与后台 UI。
   配套共享 zip 解包器 **新建 `shared/modZip.js`**（约 120 行，双端）：`listZipEntries`（EOCD/中央目录，移植 `public/js/ui/modZipParser.js:22-55` 魔数与偏移）、`readZipEntry`（method 0 切片；method 8 用 `DecompressionStream('deflate-raw')`（浏览器与 Node ≥18 全局）或 Node 侧 `node:zlib` inflateRawSync——shared 层保持浏览器兼容，按环境分派）、`extractZipToMap(buffer, {maxEntries:512, maxUncompBytes:64MB})`（zip 炸弹护栏：条目数/总字节上限、ratio>100 且 >1MB 的条目直接拒绝）、`sanitizeZipPath`（拒 `..`/绝对路径/反斜杠/前导 `/`/`:`）、`unpackModZip(buffer) → {meta, sections, kits, art}`（**内存对象契约**；sections 键 = CUSTOM_SECTIONS 七节、值 = JSON 对象；kits = 源码字符串**不执行**；art 双端类型不同 Blob/Buffer；JSON 坏 fail-closed throw）。`public/js/ui/modZipParser.js` 瘦身为薄壳（:144-149 fanpack 路径硬编码删除）。
3. **C1-2 server/index.js 接线**（按字符串定位，不依赖行号）：import 区（:47 后）加 `import { ModUploadManager } from './admin/modUploads.js';`；实例化（:743-747 AdminService 块后）；路由（:767-807 鉴权块内、:805 的 404 兜底**之前**）加 `POST /api/admin/mods/upload` 分支（裸 body 走 `modUploads.receive(req)`，**不经过 readJsonBody**；前置 Content-Length 检查超限直接 413）；配套 `GET /api/admin/mods/staged`（listStaged）与 `GET /api/admin/mods/:id/status`（读 report.json，E1/E3 轮询用）；return 挂出（:944 对象字面量 `admin,` 后加 `modUploads,`）。
4. **C1-3 .gitignore**：A0-3 已加 `server/.mod-staging/`，本步复核（`node tools/assert/check-ignore.mjs server/.mod-staging/probe.txt` exit 1）。
5. **C1-4 cfStorage.js 落点收敛**：`:32` `path.join(process.cwd(),'packs',packId)` 改 `path.join(ROOT,'server','.mod-staging','cf-pending',packId)`；`:40` cfRemotePath 改 `mods/<packId>/<sha256>.zip`（对齐 §0.3 key 形状，注释「CF key 形状以 B1 catalog 契约为准」）；类与方法签名不动（C3 接真 R2 不破接口）。验收：`grep -n "process.cwd(), 'packs'" server/admin/cfStorage.js` 零命中。
6. **C1-5 测试**：新建 `test/admin/modUploads.test.js`（七用例：合法 zip receipt 字段齐全 / 重复上传幂等 / 超限 413 无残留 / 错 Content-Type 415 / 无鉴权 401 / list-get-remove / 中断连接清孤儿 incoming-*）；新建 `test/admin-mod-upload.test.js`（裸 body 契约的机器凭证：手拼最小合法 zip（zlib deflateRaw，stored+deflate 两种 method）正例 → 202/200 + sha256 与本地重算一致；**multipart 形状负向**（FormData 语义 boundary 包装 → 415，证明服务端没当 multipart 解析）；application/json → 415；非 zip 魔数 → 400；`../x.json` 条目 → 422；pack.json 缺 id → 422；staging 落盘断言；`t.after` 清测试 staging（用独立 env 指向临时目录，绝不污染仓库根）。另建 `test/modZip.test.js`（extractZipToMap 正/负向 + 护栏 + sanitizeZipPath）。

**C1 总验收**（全部存在性/行为断言，无一按固定行号）：
```bash
# shell: git-bash
grep -n "api/admin/mods/upload" server/index.js        # 有命中
grep -n "ModUploadManager" server/index.js             # ≥2 处
grep -c "FormData" public/admin/admin.js               # 0（E1 前端契约的机器凭证，S4 落地后跑）
node --check server/index.js && node --check server/admin/modUploads.js
node --test test/admin/modUploads.test.js test/admin-mod-upload.test.js test/modZip.test.js test/admin.test.js
git diff --name-only -- data/ public/assets/           # 输出为空
```

**C1 明确不做**：五道验证本体（C2）；真 R2 推送（C3）；modUploadModal.js 前端（E1）；`server/packs.js` GlobalModManager（D 阶段）；`data/mod-staging/`（方案作废）。

---

### 2-C2 五道验证管线（4–5 天，合并后；C2-0 npm install 可并行）

**架构前提**：游戏服务器进程（server/index.js）绝不 import 未知 JS——kit 加载只发生在**独立验证子进程**（`server/modverify/`，由上传端点 `child_process.fork` 拉起，崩了不影响主服务器）。输入 = C1 的 `server/.mod-staging/<uploadId>/{pack.zip, extracted/（或按需现解）, receipt.json}`；产出 = `verify-report.json`（五道各自 pass/fail/skip + 明细）。报告形状冻结：`{packId, startedAt, gates:[{gate:1..5, name, status:'pass'|'fail'|'skip'|'not-run', detail, durationMs}], overall, finishedAt}`。**skip ≠ pass**（gate2 无 acorn、gate5 无 CHROME_PATH 时 skip，overall≠pass，C3 据此拦截或管理员手动确认放行——放行策略归 C4 拍板）。

**步骤**：
1. **C2-0 依赖就位（可与 A2 并行）**：`npm install`（package.json:60-61 已声明 `acorn ^8.19.0`、`puppeteer-core ^25.12.0`，本会话实证 node_modules 两者均不存在）。验收：`node -e "import('acorn').then(m=>console.log('acorn ok',!!m.parse))"`、`node --test test/es2020-syntax.test.js` 绿。
2. **C2-1 骨架 `server/modverify/`**：`report.js`（createReport/recordGate/writeReport）、`cli.js`（argv 契约冻结：`node server/modverify/cli.js <stagingDir> [--gate=N] [--merger=<path>] [--timeout-ms=N]`，`--merger` 默认 `shared/customContent.js`，D2 后切 `server/mod/overlay.js`；parseArgs 零新依赖）、`run.js`（主服务器侧 fork 封装，超时 120s 杀进程按 fail；退出码 0=全过/1=有 fail/2=验证器自身崩溃）、`gates/` 五模块占位。验收：`node server/modverify/cli.js server/.mod-staging/__smoke__ --gate=1` 跑通 + 报告写出形状断言。
3. **C2-2 gate1 zip 解包 + schema 分层校验**：unpack 复用 C1 的 `shared/modZip.js`；L1 契约层（pack.json 必填 id/name/version/app/credits/files——B1 落地后按其 data 型四件套校验 files 角色表，B1 未落地前只校验 `id/type/version` 且 `type==='data'`，报告 detail 标注「files 角色表校验待 B1」，**禁止 gate1 自造 files 形状**）；L2 记录层（records/chess/tokens/variants/bands/items/skins 各 JSON 字段形状对照 MOD_UI_ADAPTATION_PLAN.md §4.1-4.7 最小字段集 + CUSTOM_SECTIONS 白名单段名，越界段名报错；官方基线引用完整性白名单化校验——只对「指向官方数据的引用」查存在性，官方数据用 `loadData(dir)` 只读另载，不碰单例）。fanpack 正例 zip 由测试夹具现打（仓库只有解包态目录）。
4. **C2-3 gate2 ES2020 闸门**：包内全部 .js（重点 `kits/**`）逐个 `acorn.parse(code, {ecmaVersion:2020, sourceType:'module'})`（与 `test/es2020-syntax.test.js:40` 同口径）；错误带 `file:line:col`；`try { await import('acorn') } catch { return {status:'skip'} }`。负向用例：`a ??= 1`（ES2021）→ fail 且行号正确；官方 kit 拷入（如 `server/sim/content/kits/ops/chess_char_1_01-inside.js`）→ pass。
5. **C2-4 gate3 确定性检查**：acorn 解析后 walk AST 找 CallExpression——`Math.random`/`Date.now`/`crypto.randomUUID`/`performance.now`/`new Date()` 零参（**不用正则**，防注释/字符串误伤；负向用例含字符串 `'Math.random()'` 不误报）；官方自证：对 `server/sim/content/kits/ops/*.js` 全量跑 → pass（官方 kit 全确定性是基线）。kit 实际加载形状断言在隔离子进程（`server/modverify/kitLoader.js`，`import(dataUrl)`，5s 超时强杀 fail；父进程绝不 import kit）。
6. **C2-5 gate4 bot 局 SP_VERIFY（骨架验收版——本阶段核心降级点）**：流程 = ① 注入合并器（`--merger` 动态 `await import(pathToFileURL(...))`，经 `server/modverify/mergeAdapter.js` 适配统一形状；**gate4 内部禁止硬 import 合并器**，验收含 `grep -c "import.*customContent\|import.*mod/overlay" server/modverify/cli.js` = 0）→ ② `buildMatchData(base, packs, {merger})`（装配器见 §2-D2 接口，C2 阶段以 `--merger` 注入件经同一注入点消费）→ deepFreeze → ③ `makeMatch({mode:'coop', humans:0, bots:4, seed:<固定>, data:mergedData, verify:'all', clientCombat:false, captureFrames:false})`（`data:` 注入点 = `test/match/harness.js:58` 实锚、`verify:` 透传 :78、全 bot 先例 `test/match/feedback1-gaps.test.js:144` 只到 BATTLE_CHECK，**全程全 bot 局仓库无先例**）→ ④ `h.run(() => h.ended != null, {maxSteps:6e6})` → 报告 `{ended, rounds, verifyStats（Match.js:271 实锚 {checked,mismatches,rejected,takeovers}）, durationMs}`。**status 判定冻结**：`ended===true` → `'pass'`（骨架语义：能拉起 harness、跑完、报告写出）；`mismatches>0` 不改 status，detail 记录并加 `warning:'确定性校准待 A2 后首跑'`。**「mismatches===0 且 120s 内跑完」标注「未实测，A2 合并后首跑校准」**——该命令从未跑过，时长无依据；C2 交付时真实跑一遍把实测时长/mismatches 回填报告 detail（记录非断言）。确定性摘要写 `<staging>/golden-mod.json`（另建一族，不进 `test/golden/*.json`，避免与 A2 golden 归因混淆）。
7. **C2-6 gate5 客户端渲染冒烟（骨架验收版）**：复用 `test/render/browser.test.js:23-27` puppeteer-core + `test/e2e/client.mjs:100-135` 服务器起落与 console/pageerror/response 三路收集；CHROME_PATH 未设 → skip（Windows 无默认路径，文档写明义务）；验证进程内起临时静态服务器把合并数据挂 `/data/*.json` 拦截层之上（**最薄桩**，D1/D2 落地后按正式通路重校准，登记为后续回归）；mod records 引用不存在的 `art/*.png` → 报告含 HTTP 404 条目（负向）。
8. **C2-7 测试固化**：`test/modverify.test.js`（fixture 合成小包，不拷 fanpack 全集）+ `test/modverify/` 各 gate 专测。
9. **C2-8 报告与接口落线**：报告 JSON 契约（§2-C2 抬头）供 E3「验证报告可展开卡片」；五道全过后报告路径交 C3，随包元数据推 CF。

**C2 总验收**（交付时点可达）：`node --test test/modverify/ test/packs.test.js test/customContent.test.js` 全绿；`node server/modverify/cli.js <fanpack-staging>` 全五道跑通（gate2/gate5 允许 skip 但报告形状完整）；**明确不含**「fanpack mismatches===0」断言与 120s 时长断言（A2 后校准，归 F）。

**D2 反向接口（登记为 D2 的 DoD，责任归 D2 不归 C2）**：D2 落地后把 cli.js 的 `DEFAULT_MERGER` 常量从 `shared/customContent.js` 切到 `server/mod/overlay.js`，并以 overlay 重跑 fanpack gate4 通过——保证「验证时合并语义 = 运行时合并语义」。配套工具 `tools/assert/overlay-parity.mjs`（C2 交付）：共享夹具（base + 两 pack sections，覆盖加法/撞 id/数组查重/覆盖声明）分别经 server 侧 mergeOverlay 与浏览器侧 `shared/contentSnapshot.js`（D2 交付物）合并，断言 snapshotHash 逐字节一致；`shared/contentSnapshot.js` 不存在时跳过并打印 `SKIP: D2 未落地`（exit 0），D2 落地后自动转实断言。

---

### 2-C3 推 CF 发布（1–2 天，合并后；草稿空白——骨架登记）

**范围登记**：触发条件 = C2 报告 `pass===true`（五道全过；gate2/gate5 的 skip 经管理员手动确认放行——放行策略归 C4）；调 B2 交付的 `tools/push-mod-pack.mjs`（或 `cfStorage.uploadModPack` + `publishModIndex`）：推 `mods/<id>/<sha256>.zip`（内容寻址）→ put 后 head 回读 etag/bytes 校验 → 读现有 `/mods/index.json`、合并新条目（append 或按版本替换，策略归 C4）、推回索引（`no-cache`）→ staging 状态翻 `'published'`、报告与包元数据归档。验收骨架：dry-run 全链路（`--dry-run` 输出将推的 key 与索引 diff）；真实推送挂起项同 B2（无 CF 凭据）。

### 2-C4 版本治理（1 天，合并后；草稿空白——骨架登记）

**范围登记**：① `?v=` 口径守門（zip 不带、索引带，断言进 `tools/assert/mod-routes.mjs`）；② 同 id 多版本策略（staging 多版本并存的晋升/淘汰规则）；③ 下架语义（catalog 移除条目 → D1 标记 `stale:true` 不删除，IndexedDB 有旧版即可开局，E1 显示「已下架·离线可用」）；④ gate2/gate5 skip 的放行策略拍板（建议 = 管理员手动确认）；⑤ mod 整包大小上限复核（64MB 默认值的拍板缺口）；⑥ `minApp` 不兼容条目的客户端行为（判兼容用 `shared/packs.js:123` `appVersionMatches(">="+minApp)`，不新写版本比较器）。

---

### 2-D1 静默拉取与缓存（2.5–3 天，A2 前可落——不碰 server 热文件）

**缓存分层契约（唯一接口真源，凡引用「缓存」必注明侧与形态）**：

| 层 | 浏览器侧 | 服务器侧 |
|---|---|---|
| 持久层 | IndexedDB `sp_mod_storage` v2：STORE_BLOBS（packId → 整包 zip Blob）+ STORE_META（packId → `{id,name,version,sha256,bytes,features,fetchedAt}`）；**sections 不落库**；localStorage `sp.pack_sha` = `{packId: sha256}` | `server/.mod-cache/<packId>/`：`pack.zip` + `sections/<name>.json` 目录树 + `kits/<kitId>.js` + `meta.json`；**sections 落盘** |
| 内存层 | `unpackModZip(blob)` → `{meta, sections, kits, art}`（每次消费现场解） | `loadPackSections(cacheDir, packId)` 读磁盘目录树 → **同形状** |
| 消费接口 | `shared/contentSnapshot.js` 直接吃内存产出 | `server/mod/packCache.js#loadPackSections`（D2 唯一取数口） |

**步骤**：
1. **D1-0 契约冻结**（0.2 天，纯对齐）：catalog 端点 `/mods/index.json`；唯一文件 `shared/modCatalog.js`；store 契约实锚——`public/js/store.js:90` initialState.ui 现状只有 `{pendingJoin, restoring, buildStale}` 三键、顶层无 modCatalog；落地顺序写死 D1-1→D1-2→D1-3→D1-4（import 的文件此前已全部存在，杜绝死引用窗口）。拍板 2 口径确认项挂本节（若改判全量预取，D1-2 返工 +1 天）。
2. **D1-1 新建 `shared/modCatalog.js`**：按 §0.3 冻结形状（若 B1 已先落地则直接 import，禁止双文件）。验收：`node --test test/modCatalog.test.js`（parse 正/负向：坏 sha256 丢条目、https/相对 url 都收、`?v=` 不参与判鲜）。
3. **D1-2 改造 `public/js/ui/modStorage.js` → v2**：DB_VERSION 1→2（:5）；onupgradeneeded（:19-29）删旧 STORE_FILES（v1 数据迁移：META 保留 id/name/version，FILES 散文件全部丢弃——旧 files 本就是断裂链路（`modUploadModal.js:113` saveMod 不传 files 实锚），无可挽救数据）、新建 STORE_BLOBS；**删除** `getActiveOverlays`（:147-170）与 `_getPackJsonFiles`（:172-195）；新 API 族（签名冻结，E1/D2/D4 只按契约调用）：`savePackBlob/getPackBlob/hasFreshPack(packId, sha256)/removePack/ensurePackBlob(entry, {onProgress})/refreshPack(packId)`——ensurePackBlob = 判鲜 → 缺/旧则 `fetch(entry.url)` → WebCrypto sha256 校验 → 通过才写库（**失败不覆盖旧 blob**：IndexedDB 有旧版即可开局的降级红线）；refreshPack = 按 catalog sha256 判鲜后按需重拉单包（E1 调用的就是这个）；localStorage 索引 `sp.pack_sha`（旧 `sp.installed_mods`（modUploadModal.js:6）一次性迁移：读旧 key → 按 catalog sha256 判鲜 → 无匹配则 `removeItem`）。IndexedDB 交互层抽薄壳，纯函数 `planPackFetch(localIndex, catalog) → {toFetch[], stale[]}` 单测（不引 fake-indexeddb 依赖；若执行时决定引入，记 package.json devDependencies）。
4. **D1-3 `store.js` 显式扩 initialState**（只动 :76-91 区间）：顶层加 `modCatalog: { version: null, packs: [], fetchedAt: 0 }`；ui 加 `modSync: { phase: 'idle', done: 0, total: 0, error: null }`（phase ∈ idle/catalog/ready/error）。patch 契约：进度写 `store.patch('ui', {modSync:{...}})`（浅合并嵌套，store.js:52-57 实锚）、目录写 `store.set({modCatalog:{...}})`。
5. **D1-4 新建 `public/js/net/modSync.js` + main.js 接线**：`syncModCatalog({store, fetchImpl})`：patch phase='catalog' → `fetch(MOD_CATALOG_URL + '?v=' + <sha256前12或时间戳破缓存>)`（注释写清「查询串只为破中间缓存，判鲜仍只按条目 sha256」）→ parseModCatalog → `store.set({modCatalog})` → 逐条目 hasFreshPack 判鲜（只读 IndexedDB meta，**不拉 blob**）→ phase='ready'；失败 phase='error' + error message，有旧 catalog 镜像则降级可用；`ensurePacksForRoom(packIds, {onProgress})`：逐包 ensurePackBlob（进度写 done/total），任一失败 phase='error' 明确报错**不降级**；旧 key 一次性迁移。main.js（556 行实锚）：import 区（:36-56 一带）加 `import { syncModCatalog } from './net/modSync.js';`；boot()（:481）内 `:510-517` 的 data.load 批次之后、`:519` connectWhenReady 之前插入 `syncModCatalog({ store }).catch(err => console.warn('[mod] sync failed, using cache', err));`——**fire-and-forget 不阻塞首屏**（与 :513-517 既有 `.catch(()=>{})` 同款容错）；注释更新 preloadModal.js :562-565 的 isAndroid 判定语义（APK/桌面内置全量素材但不内置 mod；网页端两者都静默拉）。**syncMods 无双端分支**（grep 自查 `grep -n "isAndroid" public/js/main.js` = 0）。
6. **D1-5 `shared/modZip.js` 双端化**（若 C1 未先建）：见 §2-C1-1 同一文件，谁先落地谁建。
7. **D1-6 服务器侧 `server/mod/packCache.js`**（新目录）：`ensurePackCached(entry, {fetchImpl})`（下载 → sha256 校验 → 写 pack.zip → unpackModZip → sections/kits/meta.json 落盘，fail-closed 清半成品）、`loadPackSections(cacheDir, packId)`（**D2 唯一取数口**，产出与浏览器侧同形状）、`hasFreshCache`；`.gitignore` 的 `server/.mod-cache/` 行 A0 已加。
8. **D1-7 冒烟与回归**：四件新测试（modCatalog/packCache 或 modStorage 纯函数/modZip/既有两件）全绿；`node tools/assert/modSyncWiring.mjs`（读 main.js 文本断言 syncModCatalog 在 boot 内且 render 之前、store.js 含两新键）；浏览器手测：Network 见 `/mods/index.json` 请求、IndexedDB 无 blob（按需口径成立）、404 时页面不崩（fail-soft）；`grep -rn "getActiveOverlays" public/js server | grep -v node_modules` 零命中。

**D1 明确不做**：CF 真推（B2/C3）；D4 弹窗与缺包引导 UI（D4/E4）；protocol 握手（D4）。

---

### 2-D2 逐房 overlay（5–6 天，**A2 合并完成后落**——Match/Battle/spec/support 全热）

#### D2-0 战斗构造调用图（本会话已实读定格，**含终审 issue 修补**）

> 终审（GLM-5.3）issue：旧蓝图称「`grep -n "new Battle" server/match/Match.js` 零命中、调用图未定位」系过度保守。本会话实跑纠正：字面 `new Battle` 确实零命中（构造写的是 `new this.BattleClass`），但**调用图已定位**，如下：

```
服务器侧两个 Battle 构造点（均已实锚）：
① 常规/联战路径：Match.js:2038-2046 newBattle(opts)
     const full = { data: this.ds, content: this.battleContent, logger: this.log, ...opts };
     return new this.BattleClass(full);            ← :2041 实锚
   （BattleClass = Match.js:257 `opts.BattleClass || Battle`；调用点 :1340/:2065/:2178/:3215）
② headless/takeover/SP_VERIFY 重算路径：Match.js:2265-2273 _specBattle(spec, ...)
     → createBattleFromSpec(spec, this.ds, { BattleClass: this.BattleClass, ... })   ← :2268 实锚
     → spec.js:127-160 createBattleFromSpec：battleOpts 组装在 spec.js:134-152
       （含 data: withUnitLoadouts(toDataSource(dataSource), s.players) :150、content :151，
        当前【无 kits 字段】——kits 透传须在 spec.js battleOpts 组装处补一行 + opts 透传）
kits 消费点：server/sim/content/index.js:59-64 实锚
     const injected = battle.opts && battle.opts.kits;
     pick(injected) ?? pick(KITS) → typeof f === 'function' 则执行，否则 :74 genericKit 兜底
数据注入点：Match.js:249 `this.data = opts.data` → :250 `new GameData(this.data, this.modeId)`
     → :265 `this.ds = dataSourceFor(this.data)`（:224-230 WeakMap 缓存，以 data 对象为 key——
        合并产物是新对象，天然不撞官方缓存）
浏览器侧：runner.js:142 loadBrowserSim（fetch SIM_DATA_FILES :108 → :159 simdata.setSimData(raw)
     → :160 support.setGameData(null) 清缓存 → :161 new simdata.DataSource(raw)）
     → runner.js:651 createBattleFromSpec(msg.spec, sim.ds, {logger})
```

**kits 透传方案（终审消解：已定位，非待办）**：Match 构造器新增 `this.kits = opts.kits ?? null`（插入点 grep `this.battleContent = opts.battleContent` 定位）；`newBattle` 的 `full` 对象补 `...(this.kits ? { kits: this.kits } : null)`（**保持 `...opts` 展开符最后**，调用处显式传 kits 可覆盖，与 content/index.js:64 优先级语义一致）；`_specBattle` 路径在 Match.js:2268 的 `createBattleFromSpec` 调用补 `kits: this.roomKits`（或经 opts），并在 `spec.js:134-152` battleOpts 组装处透传 `kits: opts.kits ?? undefined`——**两条构造路径都要覆盖，否则 SP_VERIFY/headless 重算路径丢 mod kit**（终审明确要求一并确认）。A2 后行号重读。

#### D2-1 `server/mod/overlay.js`（新文件，约 120 行）

签名冻结（§0.3）：`mergeOverlay(baseData, packSections[], opts?) → { data, snapshotHash }`。语义：只加法 + 显式 overrides——id 冲突默认 fail-closed 抛 `{code:'MOD_ID_CONFLICT', packId, section, id}`；包内 `overrides` 段显式声明才允许覆盖；数组型按 id 查重追加（关闭 mergeCustomContent :48 数组追加不查重缝隙）；产出 `deepFreeze`（复用 `server/data.js:38` 导出）；snapshotHash = sha256（键序稳定序列化，自实现不引依赖）——pack 顺序敏感是特性。`stripPackOperators`（customContent.js:12-34）迁入本文件再导出。section 允许集 = `['chess','tokens','enemies','stages','waves','bonds','items','garrisons','bands','effects','choices','config']`（以数据文件名为准，对齐 SIM_DATA_FILES（runner.js:108）∪ {choices,config}；废「records/variants/skins 进 sim 数据面」的旧口径）。配套 `server/mod/sections.js` 的 `validateSections`（白名单/record 为对象/id 键与 record.id 一致）与 `server/mod/packData.js` 的 `buildMatchData(baseData, packs, {merger = mergeOverlay})`（merger 注入点仅测试与 C2 gate4 用，生产缺省走 mergeOverlay）。

#### D2-2 服务器侧注入——双数据面

- **数据面 A（sim DataSource：chess/enemies/tokens/stages/waves/backups）**：新建 `server/mod/roomData.js` 的 `buildRoomData(officialData, packSections[]) → {data, snapshotHash}`，返回的 data 直接作 `new Match({..., data})` 的 opts.data——Match.js:249-250/:265 自动吃到，`dataSourceFor` WeakMap 以新对象为 key 天然隔离，**Match.js 本体此面零改**。
- **数据面 B（support 单例：bonds/items/bands/effects/garrisons）**：`server/sim/content/support/index.js` 桶化改造。实锚：`:37 let DATA = null`、`:39-44 gameData()`、`:46 setGameData(d){ DATA = d ?? null; CORE = null; }`、`:48-53` 六个 *Record、`:81-89` CORE 桶、`:117 topActiveBond`。改法 = 收敛为单桶 `let BUCKET = null`（`{data, core}`）+ 新增 `OVERRIDE` 机制：
  ```js
  export function gameData() {
    if (OVERRIDE) return OVERRIDE;
    if (!BUCKET) { let d; try { d = getData({log:QUIET}) || {}; } catch { d = {}; } BUCKET = { data: d, core: null }; }
    return BUCKET.data;
  }
  export function setGameData(d) { BUCKET = d ? { data: d, core: null } : null; OVERRIDE = null; }
  export function setGameDataOverride(d) { OVERRIDE = d ? deepFreeze(d) : null; if (BUCKET) BUCKET.core = null; }
  ```
  六个 *Record（:48-53）加可选默认参 `data = gameData()` 走 `bucketFor(data)`——**默认参保证 battle 侧调用点签名不变**（battle 经 helper 间接消费单例：bands/battle.js:212,253,258、bonds/core.js:68,78,85,216,634、bonds/addon/battle.js:89、garrisons/battle.js:82,91,163、items/battle.js:111,115,862,924 共 16 处实锚，官方房不传 data ⇒ 落官方桶，逐字节不变）；`:117 topActiveBond(battle, pid)` 改读 `battleData(battle) ?? gameData()`。
  **`setGameData(null)` 等价性证明（交付物必含）**：现状调用点 grep 定格仅 3 处有效（`public/js/battle/runner.js:160`（:150-162 实读：setSimData 后清缓存「re-read through the injected data」）、`test/render/unitedown.browser.test.js:47` 同形、定义行自身与镜像）。改后 `setGameData(null)` = `BUCKET=null; OVERRIDE=null` → 下次 gameData() 同样重走官方源 + CORE 清空——新增的 `OVERRIDE=null` 只清一个原本就为 null 的字段，**逐字节等价**。浏览器侧**不用 override**（合并数据经 setSimData(mergedRaw) 走 public/data.js:3 getSimData() 自然返回，`setGameData(null)` 清缓存后重读即合并数据）；override 只服务器侧用（多房间并存不能动全局）。
  prep 侧：`choices.js:162 choiceCardIds(data = gameData())` 已 data 参数化（实锚），调用方传参路径执行时实读 `server/match/choices.js` 确认；`bands/meta.js:495-501 registerMeta` 闭包只绑 bandId 走单例——**本阶段采用最干净方案：mod 自定义 band/choice 的 prep 注册逻辑归 D4 后续，D2 只交付 setGameDataOverride 机制与测试、不在 Match 接线**（消解「registerMeta 闭包拿不到 battle」风险；mod 新增 band 的 prep handler 本阶段不支持，官方机制兜底）。
- **并发三房验收**：官方房 + 两个不同快照 mod 房同进程并存，各自 match.data 互不污染、官方房 match.data === getData() 单例、`getData().chess` 零 mod id（拍板 4 红线的测试落点）。

#### D2-3 Match/lobby 接线

新建 `server/mod/injectRoomData.js` 的 `async resolveMatchData(roomPackIds, {loadSections})`：空包 → `{data: getData(), snapshotHash: OFFICIAL_HASH}` 零开销直通；否则 `loadPackSections(cacheDir, packId)`（D1 磁盘目录树形态；缺包/坏包 → 建房失败 fail-closed）→ buildRoomData。建房入口（lobby `new Match` 调用点，A2 后 grep `new Match(` 重定位）插入该层。Match 构造器加 `this.kits`（D2-0 方案）、newBattle/_specBattle 两条路径透传 kits。snapshotHash 写入 Match 公开状态（协议外发归 D4）。mod kit 加载器 `server/mod/kitScope.js`：从 `server/.mod-cache/<id>/kits/*.js` 动态 import，**安全前提注释写死**「此路径只允许 C2 五道验证通过的包，import 即信任」，路径白名单校验（`path.resolve` 必须落 cacheDir 子树）；房级 kit 表 `room.kits = new Map([...KITS, ...modKits])`；`KITTED_CHARS`（lobby.js:90 import、:904 checkDiyPicks 实锚）mod 房下并集房级 kit 表 keys。

#### D2-4 客户端镜像

`public/js/battle/runner.js:152-160`：mod 房拉官方文件后应用客户端侧 overlay（D1 的 IndexedDB zip Blob → `shared/contentSnapshot.js` 内存解出 sections → buildSnapshot——与 server 侧 `server/mod/overlay.js` 语义逐字节一致，由 C2 交付的 `tools/assert/overlay-parity.mjs` 强制）→ 再 setSimData/setGameData(null)。浏览器侧**不做 JS kit 加载**（mod chess 走 content/index.js:74 genericKit 兜底，表现差异由 SP_VERIFY 逐房校验覆盖）；端点未命中必须回落静态文件的语义保留（runner.js:155-157 实锚）。握手不一致 fail-closed：computeLocalSnapshot(packIds) 与房主广播 contentHash 比对，不一致拒绝进房**不降级**（协议消息归 D4，本步只备函数）。

#### D2-5 C2 gate4 切换（DoD 归 D2）

`server/modverify/cli.js` 的 `DEFAULT_MERGER` 切到 `../mod/overlay.js`，实跑 `node server/modverify/cli.js <fanpack目录> --gate=4 --merger=server/mod/overlay.js`：交付时点验收 = 能拉起、报告写出、报告注明 merger=overlay；「mismatches===0」结论 **A2 合并后首跑校准，归 F**。另跑 `tools/assert/gate4-merger-diff.mjs`（legacy vs overlay 在同一 fanpack 上的差异清单登记，**不断言两 hash 相等**——已知语义不同，断言相等是自欺）。

#### D2-6 边界声明（本阶段明确不做）

① mod kit JS 的加载仅限上述 cacheDir 白名单路径（拍板 4）；mod 新干员无 kit 时走 generic 兜底。② mod 自定义 band/choice 的 prep 注册归 D4。③ 不解 zip（D1）。④ 协议扩展（snapshotHash 上 spec、packIds 进建房广播）归 D4/A2 后。⑤ 图鉴屏读合并快照归 E1/E2。⑥ `shared/customContent.js` 维持参考实现不进生产路径，`test/customContent.test.js` 现有用例不删（追加「legacy 语义不变」锁定用例防 mergeAdapter 漂移）。

#### D2 总验收

```bash
# 交付时点可达：
node --test test/modOverlay.test.js test/gameDataOverride.test.js test/modRoomData.test.js test/modKits.test.js test/modRoom.test.js
node --test test/packs.test.js test/customContent.test.js        # 回归基线 4 pass 不得弄红
node tools/assert/overlay-parity.mjs                             # SKIP 态 exit 0（contentSnapshot 落地后自动转实断言）
grep -c "import.*customContent\|import.*mod/overlay" server/modverify/cli.js   # = 0
node -e "const{execSync}=require('child_process');const out=execSync('git diff --name-only -- data/ public/assets/').toString().trim();if(out){console.error(out);process.exit(1)}"
# 标注「A2 合并后执行、归 F」：
node --test test/match/ test/golden/ test/lobby.test.js test/sim/
node server/modverify/cli.js <fanpack> --gate=4 --merger=server/mod/overlay.js   # mismatches===0 校准
```

---

### 2-D4 房主弹窗与私密房（3–4 天，合并后；草稿空白——骨架登记，**F 启动硬门槛①必交件**）

**范围登记**（P7 保留件 + 协议扩展，全在 A2 落库后）：① 协议：`shared/protocol.js:297` room.create 加 `packs` $optional（ENDLESS_MOD_DUAL_PLATFORM_PLAN.md:424 实锚落点区间）、`client.content` 握手（{id, hash} 清单，hash = 整包 sha256 前 12；net.js:618-624 的 client.bundle 处理器是现成接线范式）。② 建房六步校验顺序：endless 锁 → mode 门 → 索引 fail-closed → 逐项命中 → client.content 比对 → 写字段；`server/lobby.js` 实锚（create() :496、`new Room(...)` :511、`data: this.safeData()` :1001、四处玩家级校验 :832/861/887/904，蓝图旧稿 :494/:998/:829 等行号有 1–3 行漂移，以实测为准）。③ 私密房：inviteKey/variant 字段、加入者缺包处理（缺失即拒绝带包创房、不降级——ENDLESS_MOD_DUAL_PLATFORM_PLAN.md:262 实锚）。④ **E1 S5 的 MOD_HANDSHAKE_MISMATCH 类错误码契约由本阶段回填**（E1 只预留了渲染分支；E1 验收的解锁条件）。⑤ KITTED_CHARS 并集、checkDiyPicks 对 mod kit 干员放行。⑥ mod 自定义 band/choice 的 prep 注册接线（D2 交付的 setGameDataOverride 机制在此接通）。⑦ UI：createRoomModal 表单内嵌「内容包」多选 chip 段（UI 裁决问 2：正主流程在表单内嵌段，目录浏览器「用于建房」仅作带预选跳转的辅助入口）。

---

### 2-E0 mod 管理屏设计稿（1 天，合并前可并行；草稿空白——骨架登记）

**范围登记**：以 `docs/mockups/`（mod-ui-equipment/alliances 四张成稿，MOD_UI_ADAPTATION_PLAN.md §9）与 §3 UI 裁决六问为输入，出 mod 管理屏（三态 IA）、admin 流水线卡、私密房 PackFetchGate 的正式成稿；只改布局层不动行为层。

### 2-E1 mod 管理界面重写 + 图鉴屏小改（3–4 天；S1 可合并前启动，S2–S5 合并后）

**前置实锚**（本会话已核）：`modUploadModal.js:6` STORAGE_KEY `sp.installed_mods`、`:113` saveMod 不传 files 断裂、`:173-182` 虚线拖拽上传区；消费点 `title.js:26/:335`、`lobby.js:21/:649`（grep 实证）；`modStorage.js:6-7` 两 store、`:44` saveMod、`:147-170` getActiveOverlays、`:197-207` localStorage；`store.js:76-93` initialState、`:90` ui 三键；`equipment.js:24` `const TIERS = [1,2,3,4,5,6]` 硬编码实锚；`alliances.js:157` COUNT_NAMES 现状四键，data/bonds.json countMode 枚举实跑 = BOARD/BOARD_AND_DECK/BOARD_ALL_CHESS（缺口两键坐实）；`equipment.css:59-63` 与 `alliances.css:86-89` 各一块 `@media (max-width:760px)` + 各一块 `(prefers-reduced-motion)`（grep 实跑各 2 处 @media；`min-width:0` 属性值命中是 flex 技巧不算媒体查询）。

**步骤**：
1. **S1 ModBrowserModal 骨架**（新建 `public/js/ui/ModBrowserModal.js` ≈300 行，或在 modUploadModal.js 原位重写保留导出名——**取舍定稿：保留文件名 `modUploadModal.js`、内部重写 + 别名导出 `ModBrowserModal`**，避免 title/lobby 两处 import 变更与并行会话冲突；文件名误导问题接受）：三区 = CF 同步状态条（读 `ui.modSync`，防御回落 `?? {phase:'idle'}`；最后同步时间 + 手动刷新 + 离线降级提示）→ CF 目录卡片列表（名称/版本 chip/sha256 短码/features 前 5/大小/缓存徽标四态：已缓存·待更新·未缓存·校验失败）→ 操作区（`ensurePackBlob`/`refreshPack`/`removePack`，D1 契约族调用）。**删除**：`handleFileChange` 整段、拖拽上传区、localStorage `sp.installed_mods` 持久化、`onImported` prop（grep 实证无消费方）；**本屏零上传请求**（上传只在 admin 后台），`onPickForRoom` 可选 prop 留给 D4。数据源双源降级 `globalThis.SP_MOD_INDEX_URL || '/api/packs'`。房主选包口只留接口不实现容器。
2. **S2 modStorage v2 改造**：见 §2-D1-2（D1 施工，E1 按契约消费；验收含 `grep -n "STORE_FILES\|getActiveOverlays" public/js/ui/modStorage.js` = 0、`DB_VERSION = 2` 命中 1）。
3. **S3 样式三层制**：新建 `public/css/screens/mod-browser.css`（**结构层零 @media**）+ `mod-browser.mobile.css`（`:where(.sp-coarse)` 特性类优先、max-width:720px 媒体查询兜底——GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN.md:189 允许手机层用；44px 命中区 + `env(safe-area-inset-bottom)`）+ `mod-browser.desktop.css`（sp-hover 多列网格 `1fr 320px`）；`public/index.html` link 段静态补三条（红线不搞运行时注入）。**图鉴屏 @media 迁移（按现状盘点结论执行）**：equipment.css 的 :59-63（max-width:760px，端差异）与 :65（prefers-reduced-motion）两整块**剪切**到新建 `equipment.mobile.css`；alliances.css 的 :86-89 与 :91 同法到 `alliances.mobile.css`；迁移后两结构层文件 @media 计数为 0（**这是迁移的结果而非凭空红线**；验收断言用 @media 计数不用裸 grep 空输出——`min-width:0` 属性值命中不算）。375px 视口迁移前后端差异表现逐像素一致（手工冒烟记录）。
4. **S4 equipment.js TIERS 数据派生（施工项，非复核项）**：删 :24 硬编码，组件内 rows 就绪后派生 `const tiers = [...new Set(rows.map(r=>r.base.tier).filter(Number.isFinite))].sort((a,b)=>a-b)`（memo 化）；`EqFilters` props 增 `tiers`、:187 `TIERS.map` 改 `tiers.map`；ROMAN（:23）保留 `ROMAN[t] || t` 回落（tier>6 不崩）。**alliances.js:157 COUNT_NAMES 补两键** `BOARD_AND_DECK`/`BOARD_ALL_CHESS`（文案对照 `public/js/ui/gameLogic/bonds.js:169/:250` 服务端口径定稿）；:226 回落链 `t(COUNT_NAMES[b.countMode]) || b.countMode || t('场上')` 保留。数据源本步不改（D2 落地后 overlay 注入 data 层、本屏零改动自动显示 mod 条目，文件头注释补此句）。
5. **S5 弱网降级 + D4 错误码预留分支（降级交付）**：状态条四态（idle/syncing/error/degraded）；CF 拉取失败且 IndexedDB 有旧缓存 → 「已回退本地缓存，可正常开局」（info 级不阻断）；**预留占位** `{err?.code === 'MOD_HANDSHAKE_MISMATCH' && …}` 注释「契约待 D4 草稿回填」——**本阶段验收明确不含该错误码的端到端断言**。
6. **S6 门禁**：`node --test test/client-static.test.js`（`test/client-static.test.js:23` HTML_PAGES 补 `'admin/index.html'`）+ 新增 `test/modBrowser.test.js`（三态比对矩阵纯函数）+ `test/equipment.test.js` 扩充（tier=7 假行派生含 7 不崩）。

**E1 总验收（交付时点可达，按 X4 不冒充全量）**：
```bash
# shell: git-bash
grep -cn "FormData\|handleFileChange\|mod-file-input" public/js/ui/modUploadModal.js   # = 0
grep -c "@media" public/css/screens/equipment.css public/css/screens/alliances.css public/css/screens/mod-browser.css   # 三文件均 0
grep -c "@media" public/css/screens/equipment.mobile.css public/css/screens/alliances.mobile.css                      # 均 2
grep -rn "userAgent\|ua.match" public/js/ui/modUploadModal.js public/js/screens/room.js public/admin/admin.js         # 空
node --check public/js/ui/modUploadModal.js && node --check shared/modZip.js
node --test test/modBrowser.test.js test/equipment.test.js test/client-static.test.js test/packs.test.js test/customContent.test.js
git status --porcelain -- data/ public/assets/ | wc -l   # 0
```

### 2-E2 图鉴屏端差异施工（2 天，合并后；草稿空白——骨架登记）

**范围登记**：E1-S3 已完成的 @media 迁移基础上，出手机端「筛选收成一行、详情走抽屉」正式形态（MOD_UI_ADAPTATION_PLAN.md:369 方向）；`--t1..--t6` 阶配色写死问题与 tier 数据驱动 chip 色板（MOD_UI_ADAPTATION_PLAN.md:75）；mod 内容标识徽标（§3 问 6 裁决：右上角 16px 角标、mint-700 描边、`_packId` 字段依赖 D2 注入、无字段则降级不显示）；数据源切 D2 合并快照（`shared/contentSnapshot.js` 消费路径）。

### 2-E3 管理员后台 UI（2 天，合并前可启动；草稿空白——骨架登记）

**范围登记**：`public/admin/` 静态站（admin.css 244 行/admin.js 280 行/index.html 132 行实锚；`server/admin/` 只有 cfStorage.js——旧稿「server/admin/ 静态站雏形」表述作废）按 §3 问 1 裁决落「MOD 内容分发」区：上传卡（XHR `upload.onprogress` 真进度，**body 裸 file 禁 FormData**）→ 纵向五步条（桌面 ≥720px 转横向）→ staged 列表 → 报告区（整头 44px 展开/收起、失败行点击滚动定位、ES2020/mismatch 各显 3 条 + 查看全部、pre 等宽 12px `overflow-x:auto`）；五步全绿才出现 CF 徽标、失败包无 CF URL 行（UI 物理表达 fail-closed）；375px 可用（既有验收）；零依赖原生 ES 模块 + 现有 components token；轮询复用 admin.js:134 的 2s 节律（上传异步化：POST 返回 202 → GET status 轮询）。

### 2-E4 私密房房内显示（1–2 天，合并后；草稿空白——骨架登记）

**范围登记**：`room.js:170` 现状「🔒 私密」标签（实锚；旧稿 :164 有 6 行漂移）扩展为「🔒 私密 · {包名}」只读行（room 状态 packs 字段，D4 下发）；邀请链接带 key 分享（桌面复制按钮 clipboard.js 现成、手机 `navigator.share` 特性检测，不走 UA）；**PackFetchGate 全屏遮罩**（§3 问 4 裁决：缺包客户端 join 前无房间态可渲染，「替换 seats 区」物理不存在——Modal `closeOnBackdrop=false`，逐包 pbar×N + 总进度，失败两动作重试/退出，自动重试 3 次 1s/3s/9s → 转手动 ≥5s 间隔 → 连失 5 次追加「可能已下架/链接过期」指引，弱网 <10KB/s 持续 10s pbar 变 amber 不打断）。

---

### 2-F 总验收（1–2 天，合并后；草稿空白——骨架登记）

**启动硬门槛（三条全绿才许启动）**：① 全部空白阶段（B2/B3/C3/C4/D4/E0/E2/E3/E4）草稿交付且评审通过；② 拍板 2 口径用户书面确认；③ A2 合并完成且全量分套合并后首跑校准（C2 gate4 mismatches、D2 全量回归）。

**验收矩阵**：
1. A2 后全量分套：`node --test test/match/ test/golden/ test/lobby.test.js test/sim/ test/content/ test/data.test.js test/ui/ test/server/ test/render/`（分套跑，不裸跑）。
2. C2 gate4 校准：`node server/modverify/cli.js <fanpack> --gate=4 --merger=server/mod/overlay.js` —— mismatches===0 与实测时长回填蓝图（此前所有「未实测」标注在此核销）。
3. 端到端冒烟（按拍板 2 口径分支）：
   - **分支 A（catalog 同步 + blob 按需，默认）**：在线启动 → `ui.modSync.phase==='ready'` → 建房选包触发按需拉 blob → 私密 mod 房双端对局 SP_VERIFY=all 无 mismatch；断网重启 → 离线可开**已缓存包**的房、开**未缓存新包**的房给「需在线拉取」明确报错（不静默失败）。
   - **分支 B（全量预取，用户改判时启用）**：在线启动一次完成全量预取 → 断网重启 → 离线可开 catalog 内**任意**包的房；附 APK 首启流量断言（预取总量 = Σ bytes，记入验收报告）。
4. 静态红线总查：官方 data/ 与 public/assets/ 全蓝图零改动（`git diff --name-only 975585e1..HEAD -- data/ public/assets/` 只含 A1 皮肤脚本链产物）；镜像门禁、ES2020 门禁、mod-routes 断言全绿。
5. 打包验收：`node -e "await import('./scripts/make-windows-bundle.mjs')"` 成功；APK 体积归因（621MB + 2.2MB + 语音增量，mod 零贡献）。
6. CHANGELOG 记行为变更（客户端本地导入 mod 能力移除、上传收归管理员后台）。

里程碑 M1–M5 见 §1.3。

---

## 3 · UI 裁决（六问终裁，双模型讨论 + 裁决人定稿）

> 规则：交互形态手机端优先、信息密度桌面端优先、逻辑层共用只分叉布局层（D5 推广）。端判定全部走 `sp-touch && sp-coarse` 特性类（device.js:82-95 实锚），红线不走 UA。

**问 1 admin `#mod-upload-section` 375px 四块排布 → 两端实质一致，细节取 Kimi**：上传卡 → 纵向五步条 → staged 列表 → 报告区单列堆叠；步骤条手机恒纵向、桌面 ≥720px 横向单行（720 分界对齐既有约定）。**报告展开粒度取整头一行 44px 展开/收起**（不取按阶段行展开——手机端逐行展开切碎命中区；报告头已含「5 项 · ✘2」摘要，急救场景要一眼定位失败包）；步骤条失败行点击 = 滚动定位到报告区并展开（导航动作非折叠树）。ES2020 报错行号/SP_VERIFY mismatch 摘要默认各显 **3 条**（375px 首屏密度优先），「查看全部 N 条」进完整 pre；pre 等宽固定 12px、`overflow-x:auto`、不随四档缩放。**五步全绿才出现 CF 徽标、失败包无 CF URL 行**（UI 物理表达 fail-closed）。token 实证齐全（admin.css:48-58 badge 族、:152-162 adm-pill、:9-11 cyan/orange/red）。

**问 2 mod 目录浏览器四动作与「用于建房」入口 → 混合**：手机（sp-coarse）卡片整行 ≥64px 单命中区进详情，四动作收详情页纵向全宽 44px 行、主行动作置底吸底 + 安全区 inset；44px 命中复用 devices.css:63-71 的 `.sp-coarse .btn::before` 扩展机制（实读存在，零新代码）。桌面（sp-hover）居中 Modal 三列网格、四动作 `btn--sm` 平铺卡面 + hover 浮起 + 键盘 ←/→ 循环导航复用 equipment.js:228-246 范式。**「用于建房」正主流程 = createRoomModal 表单内嵌一步**（多选 chip 列表，44px/chip）——目录里「用于建房」仅保留为**带预选跳转 createRoomModal 的辅助入口**（手机端 sheet 叠 sheet 双层遮罩是硬伤；createRoomModal 本就是 P7 已定落点，协议产出 room.create.packs 的职责在表单内）；title/lobby 入口打开 = 管理模式，不渲染「用于建房」。

**问 3 缓存五态徽标色板 → Kimi 色板 + 灰阶降级语义合成**（token 均实读存在：theme.css:25 `--mint-500`、:38 `--amber`、:45 `--red-premium`、:47-48 `--ice`）：

| 状态 | 文案 | token | 形状 |
|---|---|---|---|
| cached-fresh | ● 已缓存 | `--mint-500` | 圆点 chip |
| cached-stale | ◐ 待更新 | **`--amber #f6a329`**（orange 已被难度「险境」占用，amber 才是与 admin orange 视觉等价的注意色） | 半圆 chip |
| missing | ○ 未缓存 | `--text-lo` 描边无底 | 空圈 chip |
| 已下架·可离线 | ▼ 已下架·离线可用 | **灰阶 `--text-lo` + 斜纹底**（降级语义：不再是正式内容但活着；ice 让位给问 6） | 斜纹 chip |
| 校验失败 | ✕ 校验失败 | `--red-premium` + `--red-a20` 底 | ✕ 前缀 chip |

五态统一「字形+文案」定宽 chip 排卡片首行版本号后（沿用 modUploadModal.js:210-218 首行结构）；颜色不作为唯一编码（●/◐/○/▼/✕ 字形分化，强光/色弱可读）。

**问 4 私密房加入者缺包引导 → 取全屏遮罩 Modal**（替换 seats 区方案否决）：决定性依据是**协议时序**——缺包客户端在 client.content 比对完成前不是房间成员（P7 fail-closed），尚未 join 成功、没有房间态可渲染（seats 区是 `facts.seats.map` 渲染，room.js:320 实读依赖 facts，join 前无 facts），「替换成员列表区」物理不存在；全屏 modal 的退路由 Modal 内「退出房间」按钮解决（清 pendingJoin 回 lobby）。形态：Modal `closeOnBackdrop=false`，桌面居中 480px、手机全屏 sheet 贴底；逐包 pbar×N + 总进度一条；失败 2 动作（重试/退出，无「仍要进入」——fail-closed 红线）；退避：自动重试 3 次（1s/3s/9s）→ 转手动 + ≥5s 间隔倒计时 + 手动连失 5 次追加「可能已下架/链接过期，联系房主重发」指引；弱网 <10KB/s 持续 10s pbar 变 amber 不打断。

**问 5 与 0.2.3 文字四档缝合 → 共同案**：**等宽区（sha256 短码/报告 pre/CF 状态条）固定小字不跟随四档**；阅读文本（包名/features/chip 文案/checkbox 行）跟随四档。四档机制在 0.2.3（本会话复核 grep `sp-fs|font-scale` 于 public/css 与 public/js/ui 零命中，根字号 theme.css:109-113 是视口 clamp 非用户档位）——映射表为**语义映射**，档名挂接点 A2 合并后回填。手机最大档取舍：44px 命中 > 档位可读 > 信息密度；features 列表卡恒显 2 条 +「更多」（与档无关）；可点行高 = max(44px, 字号推导值)。

**问 6 图鉴屏 mod 内容标识 → 混合**：徽标落卡片**右上角 16px 角标、不与阶 chip 同排**（防误读第 7 阶）、不做按包过滤/分组（MOD_UI_ADAPTATION_PLAN.md:308 不成立条件 2 红线）。**色取 `--mint-700` 深 mint 描边小贴**（theme.css:29；ice 经问 3 裁决后已无占用者但仍让位——mint-700 与 fresh 的 mint-500 同族不同明度，语义「包内容也是正式可用内容」更准）。手机详情抽屉包来源 = 可点行（「包名 v1.2.3 ›」44px），点击关闭图鉴 → 打开 mod 浏览器定位该包（scrollIntoView + 描边闪烁）；桌面 hover 出 tooltip（包名/版本/credits/summary 前 80 字）、单击才跳转、键盘 focus 同 tooltip。**数据前提登记为 D2 交付物**：overlay 合并时每条包记录注入 `_packId` 字段；UI 按字段存在与否渲染（无 = 官方内容，天然向后兼容；D2 最终不注入则降级为不显示来源行）。图鉴只加导航跳转、不加数据依赖（MOD_UI_ADAPTATION_PLAN.md:32 红线）。

---

## 4 · 与既有计划的关系（吸收/取代/并行）

| 既有文档 | 关系 | 说明 |
|---|---|---|
| **docs/ENDLESS_MOD_DUAL_PLATFORM_PLAN.md**（P0–P9） | **吸收改造** | P5（pack 索引）落点改 CF、`public/packs/` 之争作废 → B1/B2；P6（逐房合并 deepFreeze/snapshotHash/fail-closed）原样吸收 → D2；P7（房主弹窗私密房）原样保留 → D4/E4；P8（素材 CF）并入 B2/C3；P9（headless）微调 → C2 gate5；P0（收编 + 镜像门禁）→ A0；其 :110-116 的 sync 漂移实录与例外两件（simdata.js/nodeData.js）是 A0 门禁的直接依据 |
| **docs/MOD_STORAGE_SPEC.md** v1.0 | **降级参考，冲突按拍板** | §3.1 服务端 `packs/<id>/` 落盘分发**作废**（存储 = CF）；进程级 mergeCustomContent 合并不进生产路径（只当 C2 默认合并器与参考实现）；保留并沿用：IndexedDB store 思路、`.spmod` 双扩展名、§2 平铺结构（扩 `kits/`）、§4 握手思路；B1/B2/D2 各阶段在其上追加修订节（v1.1 眉批），不整篇重写（重写归 F） |
| **docs/MOD_UI_ADAPTATION_PLAN.md**（448 行） | **并行沿用** | 图鉴屏（equipment/alliances）已接线部分保留；§4 最小字段集 → C2 gate1 L2 校验输入；§5 十九端口清单、§9 四张成稿 → E0/E2 输入；TIERS 派生（:261 记未施工）与 COUNT_NAMES 缺口（:82）→ E1 S4 施工项 |
| **docs/GLOBAL_VOICE_TRI_UI_ENDLESS_PLAN.md**（D1–D6） | **并行沿用** | 三端拆分总原则（CSS 三层制、特性类、44px、静态 link 不运行时注入）→ E1/E2/E3/E4 直接引用；文字四档（#435）缝合 → §3 问 5；modVoicePacks 与语音五档选择器关系归其自身计划 |
| **docs/SKIN_UPDATE_SIGHTSEER4_GUIDE.md** | **沿用** | A1 的唯一操作来源；其「专用增量脚本链」「计数入测试」「sync + 镜像门禁」「`?v=` 版本化」四个范式被 C2/D2/B 阶段复用 |
| **docs/UPSTREAM_023_MERGE_PLAN_V2.md**（路线 A） | **硬前置（A2）** | 其 38,714 行热点清单（Battle/Match/protocol/gamedata）= 本蓝图的热文件避让清单；A0 在其末尾追加「废弃件清单」一节 |
| 无尽在线化三件套（server/records.js、/api/endless/*、leaderboard） | **已裁决废弃，不进蓝图** | A0 登记留现场，删除归无尽出服阶段/D5 |
| `data/mod-staging/` 落点方案 | **废弃** | staging 唯一落点 = `server/.mod-staging/` |
| docs/UPSTREAM_023_MERGE_PLAN.md（V1） | **删除** | V2 为唯一合并计划（A0-7 执行） |

---

## 5 · 风险与未决

### 5.1 待用户确认项（阻塞 F 的启动门槛②）

1. **拍板 2 口径**（唯一 openQuestion）：「双端每次启动从 CF 拉 mod」= 启动同步 catalog、blob 按需（**解释 A，全部草稿与 UI 裁决按此施工**：建房勾选/加入 mod 房时才拉 blob）；还是启动即全量预取（解释 B：离线可开任意 mod 房，APK 首启流量与 IndexedDB 占用显著上升，D1 工期 +1 天、首启流量评估重做）。F 验收按 §2-F 分支 A/B 二选一执行。**请确认。**

### 5.2 已登记的工程假设（不需拍板，按纪律备案）

2. **0.2.3 四档字号的档名/挂接点不在本仓库**（grep 零命中共识）——问 5 映射为语义映射，A2 合并后回填。
3. **图鉴来源行依赖 D2 注入 `_packId`**——已登记为 D2 交付物；不注入则 UI 降级不显示来源行（问 6 裁决内已定降级路径）。

### 5.3 环境性阻塞（如实声明）

4. **CF 凭据/门禁 0 五条事实本环境不可得**（无访问 CF/R2）：B2/C3 的真实推送 curl 级验收**挂起**，代码与 dry-run 可写完；wrangler.toml 具体值（Pages 项目名/桶名/zone）为待确认项。
5. **node_modules 未装全**（本会话实证 33 个包、`acorn`/`puppeteer-core` 不存在）：es2020 闸门与 C2 gate2/gate5 依赖 `npm install`；A0/C2-0 已将其列为前置步骤。
6. **Windows 下 Chrome 探测**：browser.test.js:16 只有 macOS 默认路径，gate5 恒 skip 的风险由「CHROME_PATH 文档义务 + C4 放行策略拍板」缓解。

### 5.4 技术风险（各阶段已含缓解，此处汇总）

7. **并行会话工作区漂移**（124 条为时点快照）：A0 前置停手窗口 + 全部条数类断言改形态断言；git-for-windows 2.55.0 的 CRLF 空行 check-ignore bug 已实证并改用 Node 版 `tools/assert/check-ignore.mjs`。
8. **gate4 时长不可控**：全 bot coop + verify:'all' 无仓库先例（feedback1-gaps 只到 BATTLE_CHECK）；120s 超时可能对大 mod 偏紧——降级为骨架验收、实测值 A2 后回填，不硬编数字。
9. **浅合并与 overlay 的语义缝隙**：mergeCustomContent（同名 id 整记录替换、数组追加不查重）与 overlay（只加法 + 显式 overrides + 查重）不同——由「gate4 `--merger` 注入 + D2 DoD 切换默认值 + overlay-parity.mjs 共享夹具」三件闭环；`tools/assert/gate4-merger-diff.mjs` 登记差异清单（不断言相等）。
10. **D2-3 分桶的隐藏消费点**：battle 侧 16 处已逐点实证，prep 侧 choices.js:162 已参数化、bands/meta.js:495-501 的 registerMeta 闭包风险由「mod 自定义 band/choice 的 prep 注册归 D4」消解；遗留风险靠并发三房测试与 F 端到端兜。
11. **双端 hash 一致性**：键序稳定序列化器是唯一「双端逐字节一致」构件（浮点/Unicode 规范化是已知坑）——overlay-parity 夹具强制 + golden 族隔离（mod 摘要不进 test/golden/）。
12. **runner.js 镜像依赖**：support/index.js 改后必须跑 sync-static-web 否则浏览器拿旧单例版——D2/E1 验收命令均含 sync + client-static 门禁。
13. **A2 行号漂移**：全部锚点标「HEAD 975585e1 实锚，执行时重读」；验收只断言存在性/语义（grep 路由字符串、导出签名、@media 计数），不断言固定行号。
14. **行为变更**：客户端本地导入 mod 能力移除（拍板 1）——E1 状态条文案明示「本机导入已移除，mod 由管理员统一发布」+ F 的 CHANGELOG 记录。
15. **上传上限 64MB 为自定默认值**（拍板未给）：env `MOD_UPLOAD_MAX_BYTES` 可调；默认值拍板归 C4 一并确认。
16. ** IndexedDB blob 配额**：>100MB 整包需 D1 落地时实测 Chromium WebView 配额，超限退路 = files 逐文件存储不落整包 blob（不阻塞本期，记入 D1 注释）。

### 5.5 未跑过的检查（如实声明，全部标注「A2 后校准」并归 F）

- `node server/modverify/cli.js <fanpack> --gate=4` 的 mismatches===0 与 120s 时长：**从未跑过**（C2 gate4 骨架未建、A2 未合并）。
- 全量 `node --test` 分套：只跑过 lobby/packs/customContent/skins/client-static 等子集基线，全量归 F。
- B2/C3 的真实 CF 推送与 curl 验收：无凭据，挂起。
- D1-6 双端分支的 APK/真机冒烟：无设备，归 F。
- gate5 的真实 Chrome 端到端：依赖 CHROME_PATH 与 D1/D2 正式通路，归 F。

---

> **文档封存**：本蓝图 = 定稿蓝图 v2（吸收评审 18 条）+ 各阶段草稿 v2/v3 返工版 + UI 裁决六问 + 终审 1 条 issue 修补（§2-D2-0）。后续变更只走各阶段草稿的下一轮修订与本文 changelog，不静默改字。
>
> **changelog**：v1.0（2026-10-10，基线 HEAD 975585e1）——首版整合落库，GLM-5.3 终审通过。
