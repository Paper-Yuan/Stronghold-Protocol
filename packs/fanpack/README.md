# fanpack — 本仓库自制的同人内容包

这是本 checkout 自己加的全部内容，按 `docs/PACKS.md` 的内容包格式装在一个文件夹里：**`data` 类型**，由服务端在
启动时合并进官方数据，浏览器拿到的 `/data/*.json` 已含它（`server/data.js` → `shared/customContent.js`）。官方文件
`data/*.json` 一个字都不改，所以官方的完整性测试与上游合并流程完全不受影响。

## 内容

| 部分 | 内容 |
|---|---|
| 盟约 | **卡兹戴尔**（`kazdelShip`）、**罗德岛**（`rhodesShip`）；另外 10 个官方盟约因包里的干员加入而补了成员表（维多利亚 / 炎 / 不屈 / 精准 / 助力 / 突袭 / 灵巧 / 坚守 / 远见 / 奇迹） |
| 装备 | 萨卡兹的断角（3 阶）、**提卡兹之根**（6 阶）、罗德岛抑制环（2 阶）、**罗德岛特制源石弧**（6 阶）、M3利爪（4 阶），各含普通 / 进阶两条记录；两件 6 阶装备在商店里与其它 6 阶同价（4 资金），且只对卡兹戴尔 / 罗德岛盟约生效 |
| 特质 | 34 条 `garrisons` 记录（录武官、不融冰等口径修正同在其中） |
| 干员 | 20 位：新棋子 14 位（红豆 / 陨星 / 闪灵 / 赫德雷 / 阿斯卡纶 / 维什戴尔 / 霜叶 / 坚雷 / 阿米娅 / 迷迭香 / 煌 / 凯尔希 / Mon3tr / 逻各斯），扩展官方棋子 6 位（华法琳 / 伊内丝 / 魔王 / 隐德来希 / 休谟斯 / 烛煌），共 40 条棋子记录；这些干员同时从「干员持有」的自选池里移出（一个干员只会以包里的棋子出场一次） |
| 召唤物 | 4 个 token（Mon3tr / 迷迭香的战术装备 / 魂灵之影 / 重构体） |
| 口径 | `variants.json`：包自己那批棋子的「官方口径」底表，供运行时 `干员练度` 开关使用（与 `data/official.json` 一起下发给浏览器） |
| 美术 | `art/`：两条盟约的标志 + 四件自购装备的图标，构建时复制到 `public/assets/pack/`，只有包被加载时才叠到 `data/assets.json` 上（`server/index.js` `customOverlay`） |

## 文件

| 文件 | 角色（`pack.json` → `files`） | 谁写它 |
|---|---|---|
| `pack.json` | 清单（`type: data`） | 手写 |
| `records.json` | `records`：盟约 / 装备 / 特质 / 美术索引 | 手写；`tools/build-custom.mjs` 只回填盟约成员表与特质 `owners` |
| `chess.json` | `chess`：棋子记录 + `roster` | **生成**：`node tools/build-custom.mjs`（改 `docs/research/custom-operators.json` 后重建） |
| `tokens.json` | `tokens`：召唤物 | 同上 |
| `variants.json` | `variants`：口径补丁 | 同上 |
| `art/index.json` | `art`：`<key>` → 包内文件 | 手写；`art/*.png` 是新图标放这里 |

## 用与不用

- **装**：把这个文件夹（或 `node tools/pack-bundle.mjs fanpack` 打出的 zip 解压出的同名文件夹）放进 `packs/` 即可，
  服务端下次请求 `/packs/index.json` 时就会列出来 —— 不用重启、不用构建步骤。
- **卸**：删掉 `packs/fanpack/`。官方数据本来就是干净的。
- **打包分享**：`node tools/pack-bundle.mjs fanpack` → `fanpack-1.0.0.zip`（默认写在临时目录，`--out <dir>` 换地方）。
- **检查**：`node tools/packs.mjs check --strict`。
- **改内容**：棋子改 `docs/research/custom-operators.json` 再 `node tools/build-custom.mjs`；盟约 / 装备 / 特质直接改
  `records.json`（改完 `node tools/build-custom.mjs` 会回填成员表）；新图标放进 `art/` 并登记到 `art/index.json`。

## 声音

干员语音 / 音效**不在这个包里**：那是全站的功能（`public/js/audio.js`、`data/assets.json` 的语音清单），不随内容包开关。

## 版权

非商业同人作品。《明日方舟》及其素材版权归鹰角网络所有；本包的美术为自制，其余记录由官方数据构建而来。