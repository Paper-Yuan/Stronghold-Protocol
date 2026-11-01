# 超限盟约文案「改成什么效果，文案就写什么」（2026-11-01）

仓库 `E:\Workbox\系统`。**全程零 git 写操作**（没有 commit / checkout / stash / add）。本单只改文案与生成物，
实现一行没动；普通 / 湮灭 / 炸惊三类文本逐字节不变（§5 有哈希）。

上一单把「超限视图 → 盟约页」回填成读 `inf` 覆盖块（见 `handoff/SWEEP-OVERLIMIT-BONDS-2026-11-01.md`）；
业主随后给的口径是：**`inf` 里那句强化文案必须如实描述代码实际行为，数字与常量一致**。本单按这条口径把 8 条
逐条对照 `server/sim/content/bonds/core.js`，改掉 6 条含糊 / 缺数字的，保留 2 条本来就准确的。

| 项 | 结果 |
| --- | --- |
| 有 `inf` 块的盟约 | 8 条（阿戈尔 / 拉特兰 / 维多利亚 / 萨尔贡 / 叙拉古 / 炎 / 卡西米尔 / 谢拉格） |
| 文案与实现一致、**保持原文** | 2 条（炎、谢拉格） |
| 含糊 / 过时 / 缺数字、**已改** | 6 条（萨尔贡、维多利亚、阿戈尔、拉特兰、叙拉古、卡西米尔） |
| 数字来源 | 全部等于代码常量（§4 逐条溯源），未编造任何数字 |
| 新增 msgid | **0**（这些是 `data/*.json` 里的中文描述，不是界面键；四语包零改动） |
| 数据结构 | 未动：仍是「原版原文 + `\n` + 一条 `【超限模拟】` 行」，`test/ui/sweep.test.js` 的「行数 = 1」断言照过 |
| 改动文件 | `docs/research/22-overlimit-bonds.json`（源）→ `data/bonds.json` + `public/data/bonds.json`（生成物） |

---

## 1. 数据链（严格按源改）

```
docs/research/22-overlimit-bonds.json          ← 只改这里（6 条 × 4 字段 = 24 行）
        │ npm run build-data            （tools/build-data.mjs:3698 applyOverlimitBonds，原样搬运）
        ▼
data/bonds.json 里 8 条记录的 `inf` 键          ← 生成物，未手改
        │ node tools/sync-static-web.mjs
        ▼
public/data/bonds.json                          ← 客户端读的那份
        │ shared/zjBonds.js overlayBondRecord（只在 gd.overlimit 时合并，其它模式剥掉 inf）
        ▼
超限局对局内盟约详情 + S.W.E.E.P. 盟约页（public/js/screens/sweep.js:110 overlimitBondView）
```

改动形状（`git diff --numstat`，无 git 写，只读）：

```
1	1	data/bonds.json
24	24	docs/research/22-overlimit-bonds.json
1	1	public/data/bonds.json
```

`data/` 目录 86 个文件里**只有** `data/bonds.json` 变了（逐文件 SHA-256 对比，无新增 / 无缺失）。

---

## 2. 八条「实现 ↔ 文案」对照表（全文）

> 「代码里的真实效果」列的数字全部是常量本身；`data/bonds.json` 的 `bb` 值一并写出，方便核对文案里的百分比。

| 盟约 | 代码里的真实效果（文件:行 + 常量值） | 旧文案 | 新文案（或「保持原文」） |
| --- | --- | --- | --- |
| **炎** `yanShip` | `core.js:198` `YAN_HP_BASE = 0.15`、`core.js:199` `YAN_HP_PER_STACK = 0.002`；`core.js:200-207` 只在 `flags.overlimit` 时给成员 `hp = 0.15 + 0.002×层数`（直接乘算）→ **基础 +15%、每层 +0.2%**。攻击力侧 `base_atk 0.23 + atk_per_stack 0.009×层数`、6/9 人档炎佑（30%、×1.5、−90%）**超限不改**（`core.js:203`、`bb`） | `【超限模拟】【炎】干员生命值+(15+0.2×层数)%（受层数影响，即每层 +0.2%）` | **保持原文** —— 15 = 0.15、0.2 = 0.002，且炎在超限局没有别的专属分支 |
| **萨尔贡** `sargonShip` | `core.js:70` `SARGON_ATK_STACK_CAP = 9999`；`core.js:254` `INF_OL`；`core.js:293-296` 超限局给「数攻击力层数」单开一条标记 buff，`maxStacks = 9999`（引擎 `makeBuff` 缺省 1，这正是「+300% 上限消失」的唯一开关）；攻速 buff 仍 `maxStacks = bb.max_buff_stack_cnt = 25`（`core.js:286`，data 25）；每层攻击力 `base_atk = 0.12`（`core.js:256`）→ **每次开技能 +1 层、每层 +12%、并发层数至多 9999**；`core.js:260-265` 超限局再加 `floor(盟约层数 / 100) × 0.05` 攻击力；`core.js:266-277` 以上两项都只在 6 人档（`atkStacks`）生效，攻速始终 ≤25 层 | `【超限模拟】6 人档的攻击力叠层取消上限（原「至多25层、攻击力至多+300%」不再适用），每次开启技能继续叠加；攻击速度仍至多叠 25 层` | **已改**：`【超限模拟】6 人档的攻击力叠层上限由 25 层提高到 9999 层（原「至多25层、攻击力至多+300%」不再适用），每次开启技能继续叠加，每层仍为+12%攻击力；攻击速度仍至多叠 25 层；【萨尔贡】盟约层数每满 100 层，所有【萨尔贡】干员额外获得5%攻击力` |
| **维多利亚** `victoriaShip` | `core.js:332` `VICTORIA_HP_PER_LAYER = 0.002`；`core.js:350-356` 超限局**全员**（`core.js:348` 注释：不走「携带装备」那道门）`hp = 0.002×层数` → **每层 +0.2% 生命值**；`core.js:328-330` `HAMMER_CAP_LAYERS = 25×30 = 750`、`OVERFLOW_STEP = 50`、`OVERFLOW_BONUS = 0.01`；`core.js:333-337` + `core.js:340` 超限局把 `floor((层数 − 750) / 50) × 1%` 加到 `dmgDealtMul`，只作用于**携带 ≥1 件装备**的成员（`core.js:342`） | `【超限模拟】【维多利亚】干员生命值+(0.2×层数)%（受层数影响）` | **已改**：`【超限模拟】【维多利亚】干员生命值+(0.2×层数)%（受层数影响，无需携带装备）；携带装备的【维多利亚】干员在盟约层数超过 750 层后，每再多50层，造成的伤害额外提升 1%` |
| **谢拉格** `kjeragShip` | `core.js:375` `KJERAG_FREEZE_LOCK = 20`、`core.js:376` `KJERAG_WIND_TRUE_PER_LAYER = 400`；`core.js:402-409` 6 人档下把**无来源的敌方冻结**（= 寒风造成的冻结）夹到 ≤20 s（寒冷时长刻意不动，`core.js:397-398`）；`core.js:410` → `devices.js kjeragColdWind({ damagePerLayer: 400 })`：每阵风对每个存活敌人 `400 × 谢拉格层数` 无来源真伤（每阵风一次，不是每 hit 一次） | `【超限模拟】<在场6名不同【谢拉格】干员>寒风造成的冻结时长至多 20 秒；每阵寒风对每个敌人造成400×层数点真实伤害` | **保持原文** —— 20 = `KJERAG_FREEZE_LOCK`、400 = `KJERAG_WIND_TRUE_PER_LAYER`，`×层数` 与 `damagePerLayer × layers` 同义，且「每阵风 / 每个敌人」与 `devices.js` 的逐敌一次结算一致 |
| **拉特兰** `lateranoShip` | `core.js:420-428` 超限局弹药层数按 `min(600, 层数)` 算（`data: base_ammo_percent 0.05 + ammo_percent_per_stack 0.015×层数`）；`core.js:452` `per = atk_per_consume 0.04 × 2 = 0.08`；`core.js:453` `cap = Infinity`；`core.js:437-448` 超限局层数 >600 后每 100 层：`defIgnorePct +0.004`、`hp +0.01`、`atk +0.01`；`core.js:455-456` `BLAST_EVERY = 100`、`BLAST_SCALE = 0.2`，`core.js:466-478` 每累计 100 发 → 全队【拉特兰】**当前**攻击力总和 ×20% 真伤打全场敌人。除「弹药量 600 层封顶」外，其余三项（+8% / 圣堂殉爆 / 600 层溢出）都在 6 人档内（`core.js:430` 之后才注册） | `【超限模拟】每消耗1发弹药提供的攻击力+8% 不设上限（弹药量加成仍在600层封顶）` | **已改**：`【超限模拟】<在场6名不同【拉特兰】干员>时，每消耗1发弹药提供的攻击力+8% 不设上限；每累计消耗100发弹药，对全场敌人造成全队【拉特兰】干员攻击力总和的20%的真实伤害；盟约层数超过 600 层后，每再多100层，全体【拉特兰】干员无视防御+0.4%、生命+1%、攻击+1%；弹药量加成本身仍在600层封顶` |
| **阿戈尔** `egirShip` | `core.js:655-658` 超限局 `atkPerStack = 0.008` → 成员 `atk +0.8%×层数`（`directMods` 直接乘算）；`core.js:646` `EGIR_BASE_ATK_PER_LAYER = 0.0025`，`core.js:667-669` `atkFinal = 0.0025 × 层数 × 基础面板攻击力`（最终加算）；`core.js:739-750` 5 人档「首次被击倒立刻复活」这条路径上，超限局追加 `aspd +50`（`duration Infinity, persist`）；吞噬继承 `base.atk` / 阻挡数（`core.js:603-612`）**超限不改** | `【超限模拟】吞噬仍继承被吞噬者的基础攻击力；【阿戈尔】干员额外获得0.25%×层数的基础攻击力（最终加算，不受攻击力加成影响）` | **已改**：`【超限模拟】吞噬仍继承被吞噬者的基础攻击力；【阿戈尔】干员攻击力+0.8%×层数（受层数影响），并额外获得0.25%×层数的基础攻击力（最终加算，不受攻击力加成影响）；<在场5名不同【阿戈尔】干员>前3名【阿戈尔】干员被击倒立刻复活时，额外获得50攻击速度` |
| **叙拉古** `siracusaShip` | `core.js:800` `SIRA_ATK_PER_LAYER = 0.001`，`core.js:808-815` 超限局从 3 人档（本条 `activeCount`）起 `atk +0.1%×层数`；`core.js:829-830` 超限局触发概率 `0.03 → 0.10`；`core.js:799` `SIRA_CUR_HP_SHARE = 0.002`，`core.js:845-853` 真伤 = `(base_damage 5000 + damage_per_stack 50×层数) + 目标当前生命值 × 0.002`，精英 / 首领 `min(…, 2_500_000)`；`core.js:856-861` 恐惧没落地（`applyStatus(...) === false`：免疫控制 / 超限抗性 / 不可选中）→ 追加**等额**真伤（`bond:siracusa:blood`） | `【超限模拟】<在场3名不同【叙拉古】干员>起，【叙拉古】干员攻击力+0.1%×层数；6 人档的真伤触发概率提升至10%，真伤改为(5000+50×层数)+目标当前生命值0.2%，对精英与首领仍至多250万` | **已改**（只补最后一句）：`…对精英与首领仍至多250万；目标无法被恐惧时，改为对其造成等额真实伤害` |
| **卡西米尔** `kazimierzShip` | `core.js:878` `KAZ_ATK_SCALE = 2`；`core.js:881-882` 每次部署 `atk_when_born 0.2 × 2 = +40%`，上限 `(base_max_atk_when_born 0.5 + 0.01×层数) × 2 = (100 + 2×层数)%`；`addon/battle.js:166` 突袭用 `raidMods(bb, lv, 2)`，`addon/battle.js:197-207` **只翻攻击力**：`atk = 2×(1 + 0.25 + 0.01×层数) − 1`，`hp = 1 + 0.25 + 0.01×层数` 保持 ×1（data `raidShip.bb`: `base_atk 0.25`、`atk_per_stack 0.01`、`base_max_hp 0.25`、`max_hp_per_stack 0.01`） | `【超限模拟】每次部署的攻击力加成提升至+40%（原 +20%），上限提升至(100+2×层数)%（原 (50+1×层数)%）；同时【突袭】的再部署攻击力乘区翻倍` | **已改**（补公式与「生命值不变」）：`【超限模拟】每次部署的攻击力加成提升至+40%（原 +20%），上限提升至(100+2×层数)%（原 (50+1×层数)%）；同时【突袭】的再部署乘区攻击力翻倍（(1+0.25+0.01×层数) → 2×(1+0.25+0.01×层数)），生命值乘区不变` |

> 表里的中文标记（`<@ba.vup>` / `<@autochess.dgreen>` / `</>`）在页面上由 `RichText` 渲染成彩色片段，
> 与上一单一致；`desc` / `effectDesc` 是 `richTextPlain(raw)` 的纯文本形式，由脚本现算，没有手写。

---

## 3. 改动的 6 条：改前 / 改后原句

（差的都是 `【超限模拟】` 这一行；`【超限模拟】` 之前的基础描述一字未动 —— 逐条断言「基础部分 == 记录自身的 `descRaw`」，8/8 通过。）

**① 萨尔贡**（`sargonShip`）

- 改前：`6 人档的攻击力叠层取消上限（原「至多25层、攻击力至多+300%」不再适用），每次开启技能继续叠加；攻击速度仍至多叠 25 层`
- 改后：`6 人档的攻击力叠层上限由 25 层提高到 9999 层（原「至多25层、攻击力至多+300%」不再适用），每次开启技能继续叠加，每层仍为+12%攻击力；攻击速度仍至多叠 25 层；【萨尔贡】盟约层数每满 100 层，所有【萨尔贡】干员额外获得5%攻击力`
- 差在哪：① 代码里仍有实际上限 `SARGON_ATK_STACK_CAP = 9999`，「取消上限」是含糊说法 → 写成 9999；
  ② 漏了每层 +12%；③ 漏了超限专属的「盟约层数每满 100 层 +5% 攻击力」。

**② 维多利亚**（`victoriaShip`）

- 改前：`【维多利亚】干员生命值+(0.2×层数)%（受层数影响）`
- 改后：`【维多利亚】干员生命值+(0.2×层数)%（受层数影响，无需携带装备）；携带装备的【维多利亚】干员在盟约层数超过 750 层后，每再多50层，造成的伤害额外提升 1%`
- 差在哪：① 说明这条生命值不要求携带装备（代码里它是单独一条 buff）；② 漏了 750 层之后的溢出转伤害。

**③ 阿戈尔**（`egirShip`）

- 改前：`吞噬仍继承被吞噬者的基础攻击力；【阿戈尔】干员额外获得0.25%×层数的基础攻击力（最终加算，不受攻击力加成影响）`
- 改后：`吞噬仍继承被吞噬者的基础攻击力；【阿戈尔】干员攻击力+0.8%×层数（受层数影响），并额外获得0.25%×层数的基础攻击力（最终加算，不受攻击力加成影响）；<在场5名不同【阿戈尔】干员>前3名【阿戈尔】干员被击倒立刻复活时，额外获得50攻击速度`
- 差在哪：漏了两条超限专属：每层 +0.8% 攻击力（0.008）、复活后 +50 攻速。
  （`吞噬仍继承…` 这句如实、且是不变项，原样保留。）

**④ 拉特兰**（`lateranoShip`）

- 改前：`每消耗1发弹药提供的攻击力+8% 不设上限（弹药量加成仍在600层封顶）`
- 改后：`<在场6名不同【拉特兰】干员>时，每消耗1发弹药提供的攻击力+8% 不设上限；每累计消耗100发弹药，对全场敌人造成全队【拉特兰】干员攻击力总和的20%的真实伤害；盟约层数超过 600 层后，每再多100层，全体【拉特兰】干员无视防御+0.4%、生命+1%、攻击+1%；弹药量加成本身仍在600层封顶`
- 差在哪：① 点明这一串是 6 人档的（`+8%` / 殉爆 / 600 层溢出都在 6 人档内），把与档位无关的
  「弹药量加成 600 层封顶」移到句尾；② 漏了【圣堂殉爆】（每 100 发 × 全队攻击力总和 20% 真伤）；
  ③ 漏了 600 层之后的溢出（每 100 层：无视防御 +0.4%、生命 +1%、攻击 +1%）。

**⑤ 叙拉古**（`siracusaShip`）

- 改前：`<在场3名不同【叙拉古】干员>起，【叙拉古】干员攻击力+0.1%×层数；6 人档的真伤触发概率提升至10%，真伤改为(5000+50×层数)+目标当前生命值0.2%，对精英与首领仍至多250万`
- 改后：`…（前段不变）…对精英与首领仍至多250万；目标无法被恐惧时，改为对其造成等额真实伤害`
- 差在哪：漏了「恐惧没落地 → 追加等额真伤」这条超限专属分支。

**⑥ 卡西米尔**（`kazimierzShip`）

- 改前：`每次部署的攻击力加成提升至+40%（原 +20%），上限提升至(100+2×层数)%（原 (50+1×层数)%）；同时【突袭】的再部署攻击力乘区翻倍`
- 改后：`每次部署的攻击力加成提升至+40%（原 +20%），上限提升至(100+2×层数)%（原 (50+1×层数)%）；同时【突袭】的再部署乘区攻击力翻倍（(1+0.25+0.01×层数) → 2×(1+0.25+0.01×层数)），生命值乘区不变`
- 差在哪：① 「翻倍」没给公式；② 只翻攻击力、生命值乘区不动（`raidMods` 的 `atkScale` 只作用于 `atk`），旧文案容易被读成「整条乘区都翻倍」。

---

## 4. 保持原文的 2 条

| 盟约 | 为什么不用改 |
| --- | --- |
| 炎 | 超限局只多一条 `hp = 0.15 + 0.002×层数`，文案写的 `+(15+0.2×层数)%` 与常量逐位对应；炎在 `flags.overlimit` 下没有第二个分支（`core.js:201-205` 是唯一一处），6/9 人档的炎佑数值与普通模式相同。 |
| 谢拉格 | 两条都已写对：`冻结时长至多 20 秒` = `KJERAG_FREEZE_LOCK`；`每阵寒风对每个敌人造成 400×层数点真实伤害` = `KJERAG_WIND_TRUE_PER_LAYER` × `devices.js` 的逐敌一次结算，且「每阵风（不是每 hit）」与代码一致。 |

---

## 5. 普通 / 湮灭 / 炸惊逐字节不变（哈希断言）

改动前先落基线，改完重算（`sha256`，**只取 desc / descRaw**，`inf` 键剥掉后全表再算一次）：

| 断言 | 改前 | 改后 |
| --- | --- | --- |
| 普通（30 条 `desc`+`descRaw`） | `3f2b86f2…483e8bcd` | `3f2b86f2…483e8bcd` ✅ 相同 |
| 湮灭（11 条 `ann.desc`+`ann.descRaw`） | `acc6a145…84ae4714` | `acc6a145…84ae4714` ✅ 相同 |
| 炸惊（21 条 `zj.desc`+`zj.descRaw`） | `582ca138…b9cf9e132` | `582ca138…b9cf9e132` ✅ 相同 |
| 整份 `bonds.json` 去掉 `inf` 键后 | `c5baa16e…600830900` | `c5baa16e…600830900` ✅ 相同 |

完整值：

```
normal         3f2b86f23efa8f4a239ebe4e1be81a49db6bad8611d056c4ce1883a5483e8bcd
annihilation   acc6a14576bd78aeae35371aac0c3625715716f404298e986148c31884ae4714
zhajing        582ca138867b18a7662a5d4f8c3df4a2a7468cccf01192b7be5f687b9cf9e132
allMinusInf    c5baa16e26b68e953dc456d706c3a9c7c504c52356f7652fd446c18600830900
```

另外两条结构性断言也过：

- `data/` 86 个文件逐文件 SHA-256 对比：**只有 `data/bonds.json` 变化**（无新增文件、无消失文件）；
- `inf.descRaw` 的「`【超限模拟】` 之前那一段」与记录自身的 `descRaw` 逐字相同（8/8），
  所以盟约详情里的基础描述、以及 `overlayBondRecord` 在非超限局合并出来的记录都不受影响。

## 6. `data` 重生成日志

```
> node tools/build-data.mjs

loading official data…
building…
炸惊模拟 content: chess=208 garrisons=248 bonds=5 items=11 bands=2 bondZjOverrides=21 backupTokens=2 backupTokenVariants=14 jibianBonds=18 (rangeGrid derived for 4 record(s))
湮灭 mod 干员：潜能表由本仓 atRank 重算（26 条）
湮灭专属 mod content: bonds=2 bondAnnOverrides=11 garrisons=26 chess=26 chessAnnBonds=20 chessAnnBondEdges=26 itemEffects=4 items=8 bondCards=2 scheduleModes=2 scheduleRounds=28
超限词条装备: effects=1 items=1
超限盟约覆盖块: bondInfOverrides=8        ← 8 条都在
炸惊默认装配: entries=83
超限词条: lc=7 sp=7 ex=4 fgo=16 fgoX=1 fgoSP=1
超限负面词条: 17 条
wrote 20 files to E:\Workbox\系统\data (7.84 MB) in 1411 ms
chess=500 visibleChess=112 bonds=30 garrisons=523 items=135 bands=42 effects=368 enemies=249 waves=38 stages=13 bosses=10 tokens=22 factionEntries=67 backupUnits=89 backupForms=259 backupTokens=40 diyOwnedPicks=72
163 warning(s): …  （全是既有的 chess_zj_* potDown / stage 注释类警告，与本单无关；本单没动这些记录）

$ node tools/sync-static-web.mjs
[sync-static-web] Syncing standalone web assets into public/...
[sync-static-web] Sync complete: public/ is now fully self-contained!
```

重跑稳定：`npm run build-data` 的输出逐字节相同（`data/bonds.json` 前后 SHA-256 一致
`d22c33cd3fa30f4a8d47fc5c4ff9cfb8b8912ea6765a440f93aabefd889be3db`，与 `public/data/bonds.json` 同哈希）。

## 7. 验收测试（ℹ 原文）

```
=== node --test test/data.test.js test/sync-static-web.test.js
ℹ tests 39
ℹ suites 0
ℹ pass 39
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4832.363
=== node --test test/ui/sweep.test.js
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 174.4395
=== node --test test/content/bonds.test.js test/content/bonds_core.test.js test/content/bonds_addon.test.js test/content/bonds_support.test.js test/content/overlimit_bonds.test.js
ℹ tests 95
ℹ suites 0
ℹ pass 95
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1287.6257
```

- `test/match/bonds*.test.js`：**不存在**（盟约测试都在 `test/content/`，已全跑，见上 95 条）。
- `npm run typecheck` → `tsc --noEmit --checkJs -p jsconfig.json`，无输出，退出码 0。
- `npx eslint devtools/render-check-sweep-overlimit.mjs` → 无输出。
- 顺带说明：`test/data.test.js` 的「offline rebuild reproduces data/ byte-for-byte」通过，说明 `data/` 与
  research 源一致、没有手改生成物。

## 8. 两张图（真服务端重拍）

服务端：`PORT=3170 node server/index.js`（`vanilla 4a1ddbcd4bfd6315 (431 code files, 30 data files)`，真 `data/*.json`）。
浏览器：系统 Chrome + `puppeteer-core` headless new，`deviceScaleFactor: 1`；**同一页同一帧**只改 `page.setViewport()`。

| 文件 | 像素 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `handoff/shots/sweep-overlimit-bonds-v2-792x630.png` | 792 × 630 | 470,843 | `bf4ef18b28666cde84f7b7bba3b2f1dfae76516c3d15756a262de7e2e6978c6a` |
| `handoff/shots/sweep-overlimit-bonds-v2-1920x1080.png` | 1920 × 1080 | 1,375,164 | `676e748b8410e84055daf2e302208cec916b0d3b6733985bd7de1ac473dae58a` |

拍摄路径：大厅登录 → 独立模拟 → 难度列表末项「超限模拟」→ 打开 S.W.E.E.P.（大厅传 `variant=overlimit`）→
盟约报告 → 依次点开五条记录面板文本 → 停在「拉特兰 超限」→ 1920×1080 截图 → 同页 `setViewport(792×630)` 再截。

页面取值（脚本回读，非人工）：

```
banner  : 超限视图 · 已配置 8 条盟约强化
live    : 当前对局使用超限数值
heading : 超限模拟
拉特兰行 : <在场6名不同【拉特兰】干员>时，每消耗1发弹药提供的攻击力+8% 不设上限；每累计消耗100发弹药，
          对全场敌人造成全队【拉特兰】干员攻击力总和的20%的真实伤害；盟约层数超过 600 层后，每再多100层，
          全体【拉特兰】干员无视防御+0.4%、生命+1%、攻击+1%；弹药量加成本身仍在600层封顶
pendingTiles    : 0      （八条全是有内容的瓦片）
overlimitTiles  : 8
descHasMark     : false  （基础描述里不漏出【超限模拟】）
console error: 0   pageerror: 0
```

复现：`SP_BASE=http://127.0.0.1:3170 SP_SHOT_PREFIX=sweep-overlimit-bonds-v2 node devtools/render-check-sweep-overlimit.mjs`
（脚本这一轮只加了一个 `SP_SHOT_PREFIX` 环境变量，默认值仍是 `sweep-overlimit-bonds`，上一单的用法不变。）

## 9. 需要业主定夺 / 提请注意（2 项）

1. **萨尔贡那个「9999 层」要不要写出来。** 代码里仍有实际上限：`core.js:70 SARGON_ATK_STACK_CAP = 9999`，
   注释写明它是「用来数攻击力层数的标记 buff 的上限」，并注明「9999 与炸惊 `zj` 块对叠层上限用的是同一个数」。
   实际要叠满需要 9999 次开技能、且每次都得落在 `5 + 0.22×层数` 秒的持续窗口内，等于打不到。
   按「若代码仍有某个实际上限，就写那个上限」我写成了 `由 25 层提高到 9999 层`；若业主要的是「就写无上限」，
   改一个常量（`core.js:70`）与这一句即可，文案不必再动别的。
2. **`public/js/ui/overlimitBondText.js` 是孤立文件，且已经和现在的数据对不上。**
   全仓没有任何地方 import 它（只有 `server/sim/content/bonds/addon/battle.js:191` 的注释提到文件名），
   但它里面另存了一版超限文本，例如萨尔贡写「攻击力叠层**无上限**」、炎把 `(23+0.9×层数)%` 直接写进攻击力那一行、
   谢拉格写 `(135+1×层数)%` —— 一旦有人把它接进界面，就会和 `inf` 块当场打架。本单没动它（它不在数据链上），
   建议删掉，或改成读 `data/bonds.json` 的 `inf`。这条属于工程整理，不影响本单验收。

> 另记两条「按代码写、但代码自己标了 `[ASSUMED]`」的地方（不算无法判定，供业主复核）：
> 拉特兰【圣堂殉爆】按「全体当前攻击力总和 ×20%」结算（`core.js:451` 的 `[ASSUMED]`）；
> 叙拉古的「+0.2% 目标当前生命值」按**替换**而非叠加（`core.js:843` 的 `[ASSUMED]`）。文案都是照代码写的事实句。

## 10. 产物与脚本

| 文件 | 说明 |
| --- | --- |
| `docs/research/22-overlimit-bonds.json` | 唯一的手改源（6 条 × 4 字段） |
| `data/bonds.json`、`public/data/bonds.json` | `npm run build-data` + `node tools/sync-static-web.mjs` 生成 |
| `devtools/render-check-sweep-overlimit.mjs` | 拍照脚本（+`SP_SHOT_PREFIX`） |
| `handoff/shots/sweep-overlimit-bonds-v2-*.png` | 两张交付图（§8 有 SHA） |
| `handoff/.ol-rewrite.mjs`、`handoff/.ol-fix2.mjs` | 一次性改写脚本（可复现「只换 `【超限模拟】` 尾部」这一步） |
| `handoff/.ol-baseline.json`、`handoff/.ol-data-baseline.json`、`handoff/.ol-before-after.json`、`handoff/.ol-tests.log`、`handoff/.ol-builddata.log` | 基线哈希 / 改前原句 / 测试与构建日志 |

工作区里 `data/bonds.json`、`public/data/bonds.json`、`docs/research/22-overlimit-bonds.json` 保持未提交状态
（`MM` / `AM`），未做任何 git 写操作。
