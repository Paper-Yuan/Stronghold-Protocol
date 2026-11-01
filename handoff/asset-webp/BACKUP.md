# 立绘 PNG 原件备份（WebP 转换前）

> 转换参数：**q90 + alpha_quality=100 + exact=False（method=6）**（`handoff/asset-webp/extended/EXTENDED-PLAN.md` §6.1）。
> `exact=False` 会永久丢弃**全透明像素底下的 RGB**，不可逆 —— 所以原图**必须先离开仓库**再转。这份文件记录备份在哪、
> 怎么验、怎么恢复。

## 1. 备份位置

**仓库外**：`E:\Workbox\_assets-orig\`（与仓库同在 E: 卷，所以是 `rename` 移动，不占额外空间，也不进 git、不进 public）。

目录结构与仓库内**逐字节对应**：

```
E:\Workbox\_assets-orig\
  public\assets\char\illust\<id>.png                 精二全幅立绘（含 <id>_1.png 精一同目录孪生）
  public\assets\char\illust\skin\<stem>.png          皮肤全幅立绘
  public\assets\char\illustration\<id>_<n>.png       精一 / _2 / _skin1 全幅立绘
  public\assets\char\portrait\<stem>.png             半身像 180×360
```

所以恢复就是「把 `_assets-orig\public\` 盖回仓库的 `public\`」。

## 2. 备份清单（2026-10-31 转换实测）

| 目录 | 移入备份 | 备份体积 | 校验后回退成 PNG | 白名单留 PNG |
|---|---:|---:|---:|---:|
| `public/assets/char/illust` | 478 | 912.23 MiB | 30 | 0 |
| `public/assets/char/illust/skin` | 272 | 856.05 MiB | 13 | 5 |
| `public/assets/char/illustration` | 7 | 12.94 MiB | 0 | 8 |
| `public/assets/char/portrait` | 752 | 86.39 MiB | 193 | 0 |
| **合计（移动数）** | **1509** | **1867.61 MiB** | **236** | **13** |

逐文件清单在 `.cache/webp-convert/moved.json`（临时文件，用完即删；本表与下面的恢复命令不依赖它）。

**现在 `_assets-orig` 里是 1273 个文件 / 1,842,830,195 字节（1757.46 MiB）** —— 少了 236 个：那是逐张校验
（PSNR / alpha）没过、按规矩**回退成 PNG** 的那些，它们已经从备份移回 `public/assets/`，在仓库里以 PNG 身份继续
存在（见 `handoff/asset-webp/verify/reverted.tsv`）。所以「原件一份不少」：**1273 张在备份、236 张回退在 public、
13 张白名单从未移动**，合计 1522 张 = 转换前四个目录的全部 PNG。

### 2.1 白名单：这 13 张**没有移动、也没有转换**，仍是原 PNG

依据 `EXTENDED-PLAN.md` §6.4 —— 2376 px 宽（DPR3）下 PSNR 34.21–39.95 dB，属于「可接受」档，按业主要求保留 PNG
（合计 84,557,793 字节 = 80.64 MiB）：

| 目录 | 文件 |
|---|---|
| `char/illustration` | `char_4182_oblvns_2.png`、`char_4183_mortis_2.png`、`char_4184_dolris_2.png`、`char_4185_amoris_2.png`、`char_4186_tmoris_2.png`、`char_4183_mortis_skin1.png`、`char_4184_dolris_skin1.png`、`char_4185_amoris_skin1.png` |
| `char/illust/skin` | `char_4065_judge_epoque_33.png`、`char_1034_jesca2_cfa_1.png`、`char_4064_mlynar_iteration_3.png`、`char_1023_ghost2_boc_6.png`、`char_4116_blkkgt_witch_5.png` |

## 3. 恢复命令

### 3.1 全量恢复（反悔：整批退回 PNG）

在仓库根 `E:\Workbox\系统` 下：

```bat
:: 1) 把备份盖回 public（同一结构，/E 递归）
robocopy "E:\Workbox\_assets-orig\public" "E:\Workbox\系统\public" /E
```

```js
// 2) 删掉同名的 .webp（PNG 已经回来，WebP 是多余的一份）
//    存成任意 _tmp.mjs 跑一次即可（本次的临时脚本已按纪律删除）
import fs from 'node:fs';
import path from 'node:path';
const PUB = 'E:/Workbox/系统/public/assets';
const DIRS = ['char/illust', 'char/illust/skin', 'char/illustration', 'char/portrait'];
let n = 0;
for (const d of DIRS) {
  for (const name of fs.readdirSync(path.join(PUB, d))) {
    if (!name.toLowerCase().endsWith('.webp')) continue;   // 这四个目录都是平铺的，子目录只有一个 skin/
    fs.unlinkSync(path.join(PUB, d, name)); n++;
  }
}
console.log('removed', n, 'webp');
```

### 3.2 单张恢复

```bat
copy /Y "E:\Workbox\_assets-orig\public\assets\char\illust\char_1046_sbell2.png" "E:\Workbox\系统\public\assets\char\illust\"
```

单张恢复后不用改清单：解析器（`tools/inject-skins-assets.mjs` / `tools/assets/manifest.mjs`）对这四个目录
**优先 `.webp`、缺失才回落 `.png`**，所以这张会自动回到 `.png`。

### 3.3 恢复后必须重跑管线

```bash
node tools/fetch-assets.mjs --offline --add-only
node tools/inject-skins-assets.mjs
node tools/sync-static-web.mjs
```

`data/assets.json` 里的 URL 会跟着磁盘上的真实扩展名变回 `.png`（**不要手改 `data/*.json`**）。

## 4. 校验备份完整性

```bash
node -e "const fs=require('fs');const d='E:/Workbox/_assets-orig';let n=0,b=0;const w=(x)=>{for(const e of fs.readdirSync(x,{withFileTypes:true})){const p=x+'/'+e.name;if(e.isDirectory())w(p);else{n++;b+=fs.statSync(p).size;}}};w(d);console.log(n,b)"
```

期望：**1273 个文件 / 1,842,830,195 字节**（= 1757.46 MiB）。数量或字节数不符就不要往下做，先查 `_assets-orig`
是否被移动过。

> 想连「回退成 PNG 的 236 张」一起核对总量：它们的原件在 `public/assets/` 里（同路径 `.png`），
> `node -e "…"` 把两个根一起统计即可 —— 1273 + 236 + 13 白名单 = 转换前的 1522 张。

## 5. 保留与清理

- `E:\Workbox\_assets-orig\` **长期保留**，直到真机验收（iOS Safari / Android Chrome）通过、并且决定不再需要 PNG 源。
- 它是仓库外的目录，仓库打包 / 提交 / 清理都碰不到它。
- `public/assets/` 本身不进 git（AGENTS.md「No game art in git」），所以这份备份是**唯一**的 PNG 原件。
