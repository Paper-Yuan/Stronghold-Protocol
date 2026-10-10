# 酒神/真言新皮肤补录指导（错位巡礼/IV）

- **创建时间**：2026-10-10
- **适用仓库**：`E:/Workbox/sp-upgrade-2.1`（分支 `feature/v0.2.1-fusion-master`）
- **任务性质**：皮肤目录增量更新（271 → 273 款），**纯数据 + 资源 + 测试，无服务端/协议/客户端代码改动**
- **前置调研已完成**：本文件的所有 ID、URL、尺寸、动画名均已实测验证（2026-10-10）

---

## 1. 背景：缺什么、为什么缺

官方 2026-10 新上「错位巡礼/IV」系列（Y-7 17 批）共 3 款皮肤：

| 干员 | 皮肤名 | skinId | 在本项目干员池？ |
|---|---|---|---|
| 酒神 Phatm | 真我自扼 | `char_1042_phatm2@sightseer#4` | ✅ 在 |
| 真言 Mantra | 万籁俱寂 | `char_4204_mantra@sightseer#4` | ✅ 在 |
| 列托 Leto | 来日欢歌 | `char_194_leto@sightseer#4` | ❌ 不在（无任何资源，忽略） |

以 `data/assets.json` 的 209 名干员资产池为口径，官方 outfit 皮肤共 273 款可收录，本地已录 271 款——
**酒神/真言这两款是池内唯二缺口**（同批第三款列托不在池内，其余系列早已收齐）。补上后即为完全体。

四层全部缺，需一起补：

| 层 | 文件 | 现状 |
|---|---|---|
| 调研表 | `docs/research/08-skins.json` | 无这两位干员的键 |
| 客户端目录 | `data/skins.json`（由调研表生成） | 无 |
| 资产清单 | `data/assets.json` 的 `chars[].skins`（由 inject 脚本写入） | 无 |
| 素材文件 | `public/assets/char/skin_avatar/`、`public/assets/spine/op/{charId}/{stem}/` | 无（磁盘上只有原皮 `_1`/`_2`） |

**上游资源已验证可用**（2026-10-10 实测全部 HTTP 200）：

- spine 三件套 ×2 朝向：`fexli/ArknightsResource@main` 的 `spine/{charId}/{stem}/{Front,Back}/`
  - 酒神 Front skel 747KB / 真言 Front skel 466KB，atlas+png 各朝向齐备
- 皮肤头像：`yuanyan3060/ArknightsGameResource@main` 的 `avatar/{stem with %23}.png`（各 ~68KB）
- 皮肤 skel 动画名已核对与默认模型一致（酒神含 `Attack_1/Attack_2/Skill_2_Loop_1/Skill_3_Loop` 等，真言含 `Attack/Skill_2_Loop/Skill_3_Idle` 等）——inject 脚本直接复用默认模型的 anims 映射，成立。

---

## 2. 命名规则（照抄现有 sightseer 条目即可）

两条已核实的硬规则（`docs/SKINS.md` 原文）：

```
stem   = skinId.replace(/@/g, '_').replace(/#/g, '_')
         char_1042_phatm2@sightseer#4  →  char_1042_phatm2_sightseer_4
avatar = 'avatar/' + encodeURIComponent(avatarId) + '.png'
         avatarId 来自官方 skin_table（= portraitId，本两款已查实），# 编码为 %23
```

本款即：

- `stem`：`char_1042_phatm2_sightseer_4` / `char_4204_mantra_sightseer_4`
- 头像 URL：`…/avatar/char_1042_phatm2_sightseer%234.png` / `…/avatar/char_4204_mantra_sightseer%234.png`

---

## 3. 操作步骤

### 步骤 1：编辑 `docs/research/08-skins.json`

在 `skins` 对象里新增两个干员键。键的排列不按字典序（现状即无序），追加到任意位置均可；建议紧挨着同系列条目方便日后维护。两个条目的完整 JSON（**可直接粘贴**，格式与现有条目一字不差）：

```json
"char_1042_phatm2": [
  {
    "skinId": "char_1042_phatm2@sightseer#4",
    "stem": "char_1042_phatm2_sightseer_4",
    "name": "真我自扼",
    "group": "错位巡礼/IV",
    "avatar": {
      "url": "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/char_1042_phatm2_sightseer%234.png"
    },
    "battleSpine": {
      "front": {
        "skel": {
          "url": "https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char_1042_phatm2/char_1042_phatm2_sightseer_4/Front/char_1042_phatm2_sightseer_4.skel"
        },
        "atlas": {
          "url": "https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char_1042_phatm2/char_1042_phatm2_sightseer_4/Front/char_1042_phatm2_sightseer_4.atlas"
        },
        "png": {
          "url": "https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char_1042_phatm2/char_1042_phatm2_sightseer_4/Front/char_1042_phatm2_sightseer_4.png"
        },
        "jsdelivrSkel": "https://cdn.jsdelivr.net/gh/fexli/ArknightsResource@main/spine/char_1042_phatm2/char_1042_phatm2_sightseer_4/Front/char_1042_phatm2_sightseer_4.skel"
      },
      "back": {
        "skel": {
          "url": "https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char_1042_phatm2/char_1042_phatm2_sightseer_4/Back/char_1042_phatm2_sightseer_4.skel"
        },
        "atlas": {
          "url": "https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char_1042_phatm2/char_1042_phatm2_sightseer_4/Back/char_1042_phatm2_sightseer_4.atlas"
        },
        "png": {
          "url": "https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char_1042_phatm2/char_1042_phatm2_sightseer_4/Back/char_1042_phatm2_sightseer_4.png"
        },
        "jsdelivrSkel": "https://cdn.jsdelivr.net/gh/fexli/ArknightsResource@main/spine/char_1042_phatm2/char_1042_phatm2_sightseer_4/Back/char_1042_phatm2_sightseer_4.skel"
      }
    }
  }
],
"char_4204_mantra": [
  {
    "skinId": "char_4204_mantra@sightseer#4",
    "stem": "char_4204_mantra_sightseer_4",
    "name": "万籁俱寂",
    "group": "错位巡礼/IV",
    "avatar": {
      "url": "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/char_4204_mantra_sightseer%234.png"
    },
    "battleSpine": {
      "front": {
        "skel": {
          "url": "https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char_4204_mantra/char_4204_mantra_sightseer_4/Front/char_4204_mantra_sightseer_4.skel"
        },
        "atlas": {
          "url": "https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char_4204_mantra/char_4204_mantra_sightseer_4/Front/char_4204_mantra_sightseer_4.atlas"
        },
        "png": {
          "url": "https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char_4204_mantra/char_4204_mantra_sightseer_4/Front/char_4204_mantra_sightseer_4.png"
        },
        "jsdelivrSkel": "https://cdn.jsdelivr.net/gh/fexli/ArknightsResource@main/spine/char_4204_mantra/char_4204_mantra_sightseer_4/Front/char_4204_mantra_sightseer_4.skel"
      },
      "back": {
        "skel": {
          "url": "https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char_4204_mantra/char_4204_mantra_sightseer_4/Back/char_4204_mantra_sightseer_4.skel"
        },
        "atlas": {
          "url": "https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char_4204_mantra/char_4204_mantra_sightseer_4/Back/char_4204_mantra_sightseer_4.atlas"
        },
        "png": {
          "url": "https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/char_4204_mantra/char_4204_mantra_sightseer_4/Back/char_4204_mantra_sightseer_4.png"
        },
        "jsdelivrSkel": "https://cdn.jsdelivr.net/gh/fexli/ArknightsResource@main/spine/char_4204_mantra/char_4204_mantra_sightseer_4/Back/char_4204_mantra_sightseer_4.skel"
      }
    }
  }
],
```

同时更新文件头部 `meta.counts`（实测当前为 `"operators": 115, "skins": 174`，与实际 172/271 早就不符；顺手改成 174/273 保持诚实即可，不强求）。

### 步骤 2：重新生成客户端目录

```bash
node tools/build-skins.mjs
# 预期输出: [skins] 173 个干员 / 273 套皮肤 → data\skins.json
```

### 步骤 3：下载素材（两个脚本都跑，按需增量、已存在的自动跳过）

```bash
node tools/fetch-skin-avatars.mjs   # 下载 2 个皮肤头像 → public/assets/char/skin_avatar/
node tools/fetch-skin-spines.mjs    # 下载 12 个 spine 文件 → public/assets/spine/op/{charId}/{stem}/{front,back}/
```

fetch-skin-spines 支持按干员过滤（只下这单）：`node tools/fetch-skin-spines.mjs phatm2` 再 `node tools/fetch-skin-spines.mjs mantra`。两个脚本都以 jsdelivr 镜像为首选源、raw.github 为 fallback，断点续传安全（已存在且 >100B/1KB 即跳过）。

**下载后核对落盘（共 14 个新文件）：**

```
public/assets/char/skin_avatar/char_1042_phatm2_sightseer_4.png        (~68KB)
public/assets/char/skin_avatar/char_4204_mantra_sightseer_4.png        (~68KB)
public/assets/spine/op/char_1042_phatm2/char_1042_phatm2_sightseer_4/front/{stem}.skel|.atlas|.png
public/assets/spine/op/char_1042_phatm2/char_1042_phatm2_sightseer_4/back/{stem}.skel|.atlas|.png
public/assets/spine/op/char_4204_mantra/char_4204_mantra_sightseer_4/front/{stem}.skel|.atlas|.png
public/assets/spine/op/char_4204_mantra/char_4204_mantra_sightseer_4/back/{stem}.skel|.atlas|.png
```

### 步骤 4：注入资产清单

```bash
node tools/inject-skins-assets.mjs
# 预期输出: ✔ 成功向 data/assets.json 注入 173 名干员的共 273 套皮肤资产条目。
```

脚本行为（已读源码核实）：遍历 08-skins.json，为每款皮肤写入 `data/assets.json` 的
`chars[charId].skins[skinId] = { name, group, avatar, spine }`；**只有磁盘上存在该皮肤的 front skel 时才写 spine 字段**（否则留空、渲染器回退原皮骨骼），所以步骤 3 必须先于步骤 4。它同时把 `stats.skins`/`stats.charsWithSkins` 一并更新。

### 步骤 5：同步 public/data（静态 web 副本）

```bash
node tools/sync-static-web.mjs
```

把 `data/*.json` 整体拷到 `public/data/`（`public/data/skins.json` 目前还是 271 的旧副本，必须同步）。

### 步骤 6：更新硬编码计数的测试（**必改，否则必红**）

`test/skins.test.js` 两处硬断言：

- 第 16 行测试标题 `全量 271 套皮肤内置元数据覆盖与映射正确` → 273
- 第 19 行 `assert.equal(charKeys.length, 172, …)` → **173**
- 第 30 行 `assert.equal(totalSkins, 271, …)` → **273**

### 步骤 7：验证

```bash
node --test --test-name-pattern "皮肤" test/skins.test.js   # 注意：不要用管道 grep 过滤（会挂），用 --test-name-pattern
```

再人工开一局验证：干员调配 → 选中酒神 → 皮肤节应出现「真我自扼（错位巡礼/IV）」行、头像可显示；装备后进战场 spine 模型应换装，正面/背面均正常（`_wantsBack` 走 skin 分支）。

---

## 4. 绝对不要做的事（历史教训）

| 禁止 | 原因 |
|---|---|
| ❌ 跑 `npm run assets`（全量 `fetch-assets.mjs`）重刷清单 | 会**剪枝 38 个 DIY token、扁平化中日双语语音分组**（b7b06e44 已踩过、975585e1 才修回来）。皮肤增量只走本文的三个专用脚本。 |
| ❌ 试图 `npm run assets` 后再手动恢复 | 高风险且无必要——fetch-assets 当前**完全不感知皮肤**（无 skin 逻辑），皮肤条目只由 inject 脚本写入，互不干扰。 |
| ❌ 修改 `data/skins-installed.json`（174 条） | 已无任何代码消费者（全仓库 grep 零引用，仅文档提及）。它是按需安装时代的历史遗留，内置管线不读它。**保持原样不动。** |
| ❌ 移植 `tools/install-skins.mjs` / `server/skinInstall.js` | `docs/SKINS.md` 提到的这两个文件在当前分支**不存在**（属按需安装设计，内置方案已废弃）。以 `tools/fetch-skin-*.mjs` + `inject-skins-assets.mjs` 为准。 |
| ❌ 下载 `skin/{portraitId}b.png` 全身立绘 | ~2.5MB/张，全套 +435MB，明确不做（`docs/SKINS.md` 原文决策）。 |

---

## 5. 与其他任务的整合点

- **APK bundle 重打包**：皮肤素材走 `public/assets/`，打进 `app_bundle.zip` 需重跑 `npm run bundle:android`（或 `scripts/pack/` 管线）。+14 个文件约 **2.2MB**（skel 747K+466K ×2 朝向、atlas、png 头像），对 621MB 包体无感。
- **0.2.3 上游合并**（`docs/UPSTREAM_023_MERGE_PLAN.md`）：本任务不碰 41 个热文件，与合并无冲突面；建议在合并前先落地，皮肤数据属于「本地增量、上游不覆盖」类。
- **皮肤商店立绘计划**（`docs/SKIN_SHOP_PORTRAIT_PLAN.md`，未实施）：该计划按 `chars[charId].skins[skinId]` 取图，新增两款后自动被覆盖到，无需额外工作。
- **`data/assets.json` 的 `stats.chars` 138 / `hash` 字段**：inject 脚本只改 `stats.skins`/`charsWithSkins`，`hash` 会与磁盘事实脱节——这是现状既有行为（271 时也如此），不用修。

## 6. 交付清单（Definition of Done）

- [ ] `docs/research/08-skins.json`：+2 干员键 / +2 皮肤条目
- [ ] `data/skins.json` counts：chars 172→**173**，skins 271→**273**（build-skins 重新生成）
- [ ] `data/assets.json`：`chars[char_1042_phatm2].skins`、`chars[char_4204_mantra].skins` 各 +1 条（含 spine）
- [ ] `public/data/skins.json` 同步为 273
- [ ] 磁盘 +14 个素材文件（2 头像 + 12 spine 文件），尺寸与 §3 核对表一致
- [ ] `test/skins.test.js` 三处计数改 273/173，`node --test --test-name-pattern 皮肤 test/skins.test.js` 绿
- [ ] 人工验证：调配面板两款皮肤可见可选、战场换装正常（含背面）
- [ ] 若需发 APK：重跑 bundle 并过一遍 apksigner（记得 `--min-sdk-version 21` 陷阱，见记忆）
