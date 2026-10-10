# 同人内容包 mod（fanpack-mod）

把「卫戍协议：盟约」上游 **0.2.1**（[sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)）
装成**带卡兹戴尔 / 罗德岛盟约**的版本：一个可安装、可卸载的覆盖式 mod。

它来自本仓库（[`D:\卫戍协议`](https://github.com/sganggs/Stronghold-Protocol) 的本地分支）里的同人内容包与其引擎挂钩，
**不含**干员语音 / 音效、干员时装（皮肤）、口径开关（满练度 / 12 部署位）与低配适配——那几项是本仓库自己的另外几件事。

## 安装

```bash
# 0. 目标先按上游的说明准备一次（依赖 + 素材 + 前端库），mod 只补背包内干员那部分美术
cd D:\Stronghold-Protocol
npm ci
npm run assets      # 上游自己的素材（约 190 MB），和上游的用法完全一样

# 1. 解压这个 zip 到任意目录，然后指向你的 0.2.1 checkout
node install.mjs D:\Stronghold-Protocol

# 2. 下载包内干员的美术素材（立绘 / 战斗 Spine / 技能图标，约 3 MB；官方素材不随 mod 分发）
node install.mjs D:\Stronghold-Protocol --assets

# 3. 起服
npm start
```

安装时会：

* 校验目标是不是 0.2.1 的 checkout，并且**每一个要覆盖的文件都还是官方原文**（sha256 比对，换行不算差异）；
  不是就停下，除非加 `--force`（备份照样保留）；
* 把要覆盖的文件备份到 `<目标>/mod-fanpack/backup/`，并写一份 `mod-manifest.json`（装了什么、什么被覆盖、素材下载到哪）；
* 把 mod 自己复制到 `<目标>/mod-fanpack/`，以后 `--verify` / `--uninstall` / `--assets` 都从那里跑；
* 最后自检：用**目标自己的** `server/data.js` 载入一次数据，确认卡兹戴尔 / 罗德岛已经在合并后的数据里。

| 命令 | 作用 |
|---|---|
| `node install.mjs <目标>` | 安装（`--dry-run` 只看计划，不写任何文件） |
| `node install.mjs <目标> --assets` | 下载包内干员的美术素材（可重复跑，断点续传） |
| `node install.mjs <目标> --verify` | 校验：装的文件是否还是原样、素材齐不齐、数据里有没有这两个盟约 |
| `node install.mjs <目标> --uninstall` | 还原：覆盖的还原、新加的删除（之后删掉 `mod-fanpack/` 目录即可） |

## 装完会多出什么

* **两个核心盟约**：卡兹戴尔、罗德岛，各自的叠加效果、盟约策略页（`盟约策略` 界面的入口在房间 / 简报 / 战斗里）。
* **包内装备**：8 件自造装备与它们的商店偏向（`shopBondBias`：把盟约签名装备的刷出概率偏向你叠得最高的盟约）；
  官方 5 / 6 阶盟约签名装备也带上 `giveBondId`，同样进入偏向与图鉴。
* **查看装备（装备图鉴）**：`装备` 界面列出全部装备，可按盟约 / 品阶 / 仅看商店可售筛选。
* **包内干员**：12 名官方赛季没有的干员（含卡兹戴尔 / 罗德岛的棋子、自选形态、召唤物），带自己的特质（`特质` 区块在
  `干员调配` 与战斗详情卡里）、技能实现、召唤物（凯尔希的 Mon3tr、维什戴尔的魂灵之影、隐德来希的重构体等）。
* **品阶偏差**：录武官、谢拉格不融冰按本仓库的口径记 3 阶（商店价格、图鉴排序一起变）。
* **四个界面语言**的中文新增词条（`public/i18n/*.json` 只加不改）。

## 不包含

| 不装的 | 为什么 |
|---|---|
| 干员语音（选中 / 部署 / 技能 / 行动开始 / 出发）与攻击 / 技能 / 击倒 / 部署音效 | 那是本仓库单独做的语音包，素材量与版权都另算；mod 只带内容 |
| 干员时装（皮肤）与 `换装` Tab | 需要另一套素材与下载器（270+ 套时装），与本 mod 的目的无关 |
| 口径开关（满练度 / 12 部署位）与 `data/official.json` | 目标仓库默认就是官方口径；开关需要一整套运行时补丁 + UI |
| 低配适配（`inset` 长写、`replaceAll` polyfill 等） | 与内容无关，且要改十几个 CSS 文件 |

## 素材

`public/assets/**` 是《明日方舟》的素材，版权归鹰角网络 / Yostar 所有，**这个 mod 不分发任何一份**：`--assets` 会按
`asset-additions.json` 里的清单从社区 dump（yuanyan3060 / fexli 的仓库，以及 PRTS wiki 上的 M3利爪 图标）下载缺的那几份，
和上游 `npm run assets` 下载的是同一批来源。包自己的 6 张图（两个盟约徽记 + 4 件装备图标）在 `payload/packs/fanpack/art/`，
一并在安装时复制到 `public/assets/pack/`。

## 目录

```
install.mjs            安装 / 卸载 / 校验 / 下载素材
manifest.json          每个文件的目标路径、装上去的 sha256、以及它所替代的 0.2.1 原文的 sha256
asset-additions.json   包内干员素材清单（path → 下载地址 + 大小）
files.json             打包时的清单（哪些文件是照搬、哪些是裁剪过的）
payload/**             要装的文件本体（含 packs/fanpack/ 内容包与 data/assets.json 清单）
docs/**                内容包自己的文档（CUSTOM / PACKS 的副本）
```

## 注意

* 装了 mod 之后，**目标仓库自带的测试会有一些失败**——它们是按「官方 0.2.1 的数据与文件清单」写死的：棋子 266→292、
  盟约 14→25、录武官 / 不融冰 3 阶、9 件盟约签名装备的 `giveBondId`、`PACK_TYPES.data` 从 planned 变 supported、
  `content/index.js` 的 KITS 多了包内条目、`main.js` 多两个 import、`loadout.js` 的 import 行多一个 `GarrisonBlock`、
  `public/assets` 里是官方素材（少了包内干员那几份就会报「文件不存在」）……都在预料之中，与安装是否完好无关：
  **判断安装是否完好用 `--verify`**。想跑上游的测试就先 `--uninstall`。
* mod 只针对 **0.2.1** 制作（`manifest.json` 里逐个文件的原文 sha256 就是那个 tag 的）。上游发新版后要重新打包
  （本仓库 `node tools/mod-bundle.mjs --upstream v0.2.2`）。
* 卸载不会碰备份之外的文件：`data/chess.json`、`data/items.json`、`data/assets.json` 都是被覆盖的文件，卸载时从
  `mod-fanpack/backup/` 还原；`public/assets/pack/*.png` 与 `--assets` 下载的素材会一起收走。
* `--assets` 会在 `public/assets/` 下建 `char/ token/ spine/ skill/ item/` 的目录；上游素材还没装时同一目录里只有包内
  干员那几份，游戏能跑但大部分棋子没有立绘 —— 先 `npm run assets` 再装 mod 最省事（安装器也会提示）。
