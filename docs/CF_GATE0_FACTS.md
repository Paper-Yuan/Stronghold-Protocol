# CF Gate 0 五条事实（B1-0 调查输出，2026-10-10 汇总）

> 调查依据：`E:/Workbox/系统/docs/CLOUDFLARE_ASSETS.md`（架构指南）+ 本仓库 `functions/` 实读。
> 凡「仓库内可见」项已实地核实；凡「Cloudflare 后台可见」项列为**待用户提供凭据后现场核实**。

## 五条书面答案

| # | 问题 | 现状答案 | 证据 |
|---|---|---|---|
| 1 | Pages 构建输出目录 | **`public/`**（sync-static-web 后自包含） | CLOUDFLARE_ASSETS.md §二.4「本地静态素材存放与同步脚本」、`npx wrangler pages dev public` |
| 2 | `/assets/*` 现状由谁兜住 | **三层**：① Pages 本地静态（`context.next()`）→ ② Render 后端（`stronghold-protocol-see7.onrender.com`）→ ③ jsDelivr（皮肤 Spine 正则） | `functions/assets/[[path]].js:7-15`（L1 本地）、`:20`（L2 Render）、`:44`（L3 jsDelivr）；指南 §一 mermaid 图 |
| 3 | Pages 域名 | **`*.pages.dev` 通用识别已写进客户端**（`public/js/net.js` 的 `defaultWsUrl` 对 `.pages.dev` 自动改 WSS 网关）；**生产具体域名待核实** | 指南 §二.3；`public/js/net.js:78` 一带 |
| 4 | R2 是否开通 | **仓库内零痕迹**：无 `wrangler.toml`、无 `[[r2_buckets]]` binding、`functions/` 只有 `assets/` + `ws.js`、无 `functions/mods/`。**Cloudflare 后台的 R2 开通状态需凭据核实**；`server/admin/cfStorage.js:10` 的 `CF_R2_ENDPOINT` env 已预留 | 本仓库实读（`ls functions/`、`grep r2_bucket` 零命中、`ls wrangler.toml` 不存在） |
| 5 | 隧道域名与 Pages 是否同 zone | **生产隧道域名 = `game.jyuanblog.cc.cd`**（经 Cloudflare Tunnel 穿透到阿里云 2+2G 主机）；**zone 归属（该 cc.cd 域名是否与 Pages 项目同 zone）需 Cloudflare 后台核实** | `E:/Workbox/系统/docs/OPTIMIZATION_AND_PR_PLAN.md` §1（「公网出口经由 Cloudflare Tunnel 穿透（https://game.jyuanblog.cc.cd）」） |

## 对 B2 的裁决输入（已按蓝图 §2-B2 落位）

1. **mod 桶命名**：建议 `sp-mods`（与素材桶分开），`[[r2_buckets]] binding = "SP_MODS"`。
2. **mod Function 三层**：`functions/mods/[[path]].js` 照 assets Function 三层范式，**但回落层刻意不同**——
   - `/mods/index.json` → R2 直出 + `no-cache`；
   - `/mods/<id>/<sha256>.zip` → R2 直出 + `public, max-age=2592000, immutable`；
   - **主服回落对 mod fail-closed 回 404**（主服不存 mod 字节，与 assets 的 Render 回落刻意不同）；
   - HEAD 支持（etag/hash 增量失效）。
3. **R2 推送方式二选一**：`@aws-sdk/client-s3` 正式依赖 vs `wrangler r2 object put` CLI 子进程包装——
   **待第 4 条凭据核实后在 `wrangler.toml` 里定稿**；本地 dry-run 先按「本地落盘 + 日志明说」实现。

## 待用户提供/核实的（阻塞 B2 真实推送验收，不阻塞代码与 dry-run）

- Cloudflare 后台：R2 是否已开通、可建桶名 `sp-mods`；
- Cloudflare 后台：`game.jyuanblog.cc.cd` 与 Pages 项目是否同 zone（决定 R2 绑定能否直接挂 Pages 项目，还是要经 Worker 路由）；
- 推送凭据形态：API Token（dashboard 签发）还是 Wrangler OAuth。

## 命令痕迹（仓库内可见部分的核实记录）

```bash
ls functions/                          # assets/ ws.js（无 mods/）
ls wrangler.toml                       # No such file or directory
grep -rn "r2_bucket\|SP_MODS" functions/ . --include="*.toml" --include="*.js"   # 零命中
grep -n "CF_R2_ENDPOINT" server/admin/cfStorage.js   # :10 env 预留
```
