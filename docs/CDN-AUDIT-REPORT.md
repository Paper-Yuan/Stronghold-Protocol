# CDN 皮肤资源与全语言/皮肤特色语音排查测试报告

## 一、排查概述

通过深入比对客户端数据定义（`data/skins.json`、`data/skins-installed.json`、`data/skin-voices.json`、`data/assets.json`）、CDN 清单映射（`public/data/cdn-resource-config.json`，版本 `f3216bd82a48`，共 13,889 个文件）、本地实际文件以及线上 CDN（`https://weishucdn.jiangjiangze.icu`）进行实测，测试结果如下：

---

## 二、测试结论速览

| 测试项 | 规范/本地文件数 | CDN 已收录 | CDN 缺失数 | 缺失影响 |
|---|---|---|---|---|
| **皮肤头像/立绘 (Avatar)** | 273 款 | 271 款 | **2 款** | 穿戴这 2 款皮肤时，头像加载失败 |
| **皮肤 Spine 动画模型** | 1,035 个文件 | 1,023 个文件 | **12 个文件** | 这 2 款皮肤的战斗模型 404，变透明/方块 |
| **干员语音 (中文 CN)** | 2,842 条 | 2,688 条 | **154 条 (皮肤专属)** | 基础语音正常，皮肤专属台词 404 |
| **干员语音 (日文 JP)** | 2,842 条 | 2,688 条 | **154 条 (皮肤专属)** | 基础语音正常，皮肤专属台词 404 |
| **干员语音 (英文 EN)** | 2,674 条 | **0 条** | **2,674 条 (100% 缺失)** | 选英文语音全灭，直接静音/404 |
| **干员语音 (韩文 KR)** | 2,674 条 | **0 条** | **2,674 条 (100% 缺失)** | 选韩文语音全灭，直接静音/404 |
| **方言与小语种语音** | 1,632 条 | **0 条** | **1,632 条 (100% 缺失)** | 方言、意、德、俄、法、西全部缺失 |
| **皮肤特色专属语音** | 560 条 (4 语种) | **0 条** | **560 条 (100% 缺失)** | 11 款特色皮肤战斗语音全部缺失 |

---

## 三、具体缺失清单与分析

### 1. 皮肤资源缺失（2 款皮肤）

在全部 273 款皮肤中，有且仅有 **2 款皮肤** 的资源未收录进 CDN 配置：

1. **暮落「真我自扼」(`char_1042_phatm2@sightseer#4`)**
   - **头像**: `/assets/char/skin_avatar/char_1042_phatm2_sightseer_4.png`
   - **Spine 模型 (共 6 个文件)**:
     - 正向: `/assets/spine/op/char_1042_phatm2/char_1042_phatm2_sightseer_4/front/char_1042_phatm2_sightseer_4.{skel,atlas,png}`
     - 背向: `/assets/spine/op/char_1042_phatm2/char_1042_phatm2_sightseer_4/back/char_1042_phatm2_sightseer_4.{skel,atlas,png}`
2. **曼陀罗「万籁俱寂」(`char_4204_mantra@sightseer#4`)**
   - **头像**: `/assets/char/skin_avatar/char_4204_mantra_sightseer_4.png`
   - **Spine 模型 (共 6 个文件)**:
     - 正向: `/assets/spine/op/char_4204_mantra/char_4204_mantra_sightseer_4/front/char_4204_mantra_sightseer_4.{skel,atlas,png}`
     - 背向: `/assets/spine/op/char_4204_mantra/char_4204_mantra_sightseer_4/back/char_4204_mantra_sightseer_4.{skel,atlas,png}`

> **注**：经线上探针检测，这两款皮肤的头像文件在 CDN 服务器物理存在（HTTP 200），但 Spine 模型（12 个文件）线上返回 404；而本地工作区磁盘上全部完整存在。

---

### 2. 多语言语音缺失详情

CDN 现存配置（`cdn-resource-config.json`）仅收录了 `cn`（2688条）和 `jp`（2688条），其余全部缺失：

- **英文语音 (EN)**: 本地磁盘及 `assets.json` 中收录 182 位干员、共 2,674 个音频，CDN 收录 **0**。
- **韩文语音 (KR)**: 本地磁盘及 `assets.json` 中收录 182 位干员、共 2,674 个音频，CDN 收录 **0**。
- **方言/特殊语种 (voiceCustom)**:
  - `cn_topolect`（汉语方言：四川话、粤语、吴语等）：912 个音频，CDN 收录 **0**。
  - `ita`（意大利语，如德克萨斯）：342 个音频，CDN 收录 **0**。
  - `rus`（俄语）：196 个音频，CDN 收录 **0**。
  - `spa`（西班牙语）：98 个音频，CDN 收录 **0**。
  - `ger`（德语）：56 个音频，CDN 收录 **0**。
  - `fre`（法语）：28 个音频，CDN 收录 **0**。

---

### 3. 皮肤特色专属语音缺失详情 (`data/skin-voices.json`)

系统为当前在场的 10 位干员、11 款特殊皮肤配置了专属对战/交互槽位语音（登场、索敌、选框、入场、1~4技能、战斗结算）：

| 皮肤 Key | 干员 / 皮肤名称 | 中文条目 | 日文条目 | 英文条目 | 韩文条目 |
|---|---|---|---|---|---|
| `char_472_pasngr_epoque#17` | 异客 - 今昔须臾之梦 | 14 | 14 | 14 | 14 |
| `char_4064_mlynar_epoque#28` | 玛恩纳 - 远路 | 14 | 14 | 14 | 14 |
| `char_1012_skadi2_iteration#2` | 浊心斯卡蒂 - 红女爵 | 14 | 14 | 14 | 14 |
| `char_249_mlyss_boc#8` | 缪尔赛思 - 新枝 | 14 | 14 | 14 | 14 |
| `char_1016_agoat2_epoque#34` | 纯烬艾雅法拉 - 远行前的野餐 | 14 | 14 | 14 | 14 |
| `char_1016_agoat2_epoque#57` | 纯烬艾雅法拉 - 后来的故事 | 14 | 14 | 0 (未配) | 0 (未配) |
| `char_1032_excu2_sale#12` | 圣约送葬人 - 众志归一 | 14 | 14 | 14 | 14 |
| `char_245_cello_sale#12` | 塑心 - 无我唯识 | 14 | 14 | 14 | 14 |
| `char_1038_whitw2_sale#15` | 荒芜拉普兰德 - 无序的谦卑 | 14 | 14 | 14 | 14 |
| `char_4134_cetsyr_epoque#50` | 魔王 - 追悼 | 14 | 14 | 14 | 14 |
| `char_1041_angel2_iteration#6` | 新约能天使 - 寻翼之歌 | 14 | 14 | 0 (未配) | 0 (未配) |
| **总计** | **11 款特殊皮肤** | **154** | **154** | **126** | **126** |

**实测结果**：上述 560 条皮肤特色语音在 CDN 上**全部返回 404**，`cdn-resource-config.json` 中一条都没有。

---

## 四、核心根因与拦截机理

在客户端架构中，`public/resource-sw.js`（Service Worker）执行了严苛的清单过滤：

```javascript
// public/resource-sw.js (L287)
const path = paths.find(p => Object.prototype.hasOwnProperty.call(config.files, p));
if (!path) return new Response('当前版本不存在此资源', { status: 404 });
```

**问题闭环链路**：
1. **生成时漏配**：在构建打包 `f3216bd82a48` CDN 清单时，打包脚本只抓取了中/日干员基础语音，未将 EN、KR、方言、小语种以及后加的 11 款特殊皮肤语音纳入生成范围。
2. **前端硬拦截**：即便自建服务器（Node.js / Nginx）上有完整的这些静态资源，但因为 SW 拦截器先查 `config.files`，不在白名单中的资源直接在浏览器端被阻断并强行返回 404，**根本不会回退向源站请求**！
