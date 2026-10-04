# 05 · Enemies, Waves, Bosses, Maps — 卫戍协议：盟约 (act2autochess)

Research deliverable for the architect. It comes with two data files:

- `05-maps.json` (~200 KB): 11 stage terrains (8 active), 38 round/wave templates with routes, and helper ground paths.
- `05-enemies.json` (~340 KB): 326 enemies (stats, abilities, skills, autochess roles), special-enemy pools, the per-mode round schedule, bosses, bounty effects, the recommended generation algorithm, and LP rules.

Sources:
- Official: Kengxxiao/ArknightsGameData zh_CN. The files used are `activity_table.autoChessData` and `activity_table.activity.AUTOCHESS_SEASON.act2autochess`, plus `enemy_database`, `enemy_handbook_table`, `character_table` (devices), and `levels/act1autochess|act2autochess`.
- Community: PRTS (卫戍协议/帮助, 卫戍协议：盟约 + 战场一览, 下半/战场一览), arknights.wiki.gg/Stronghold_Protocol, forum.gamer.com.tw (#12294, #12316), and the official notice ak.hypergryph.com/news/5114.
- Anything the data does not state is marked **[ASSUMED]**.

---

## 1. How a match is put together (data flow)

```
modeId ──► stageDatasDict (weighted) ──► ONE stage map (terrain) for the whole match   (05-maps.json stages)
       └─► battleDataDict[mode][round] ──► wave TEMPLATE level (routes+spawns)          (05-maps.json roundLevels)
                                         └─ template enemy keys = placeholders ─► replaced by special-enemy pools (05-enemies.json)
turnInfoDataDict[mode][round] ─► rest-phase time, isBossTurn, boss overtime (150 s)
```

- The round levels (`level_act1autochess_01…h06`, `h07_xx`, `h08_xx`, `tr01/02/04`) have their own `mapData`, but it is only a generic all-road grid. **Ignore that grid.** Take the terrain from the stage chosen at match start, and use only the round level's `routes`, `waves` and `branches`.
- WALK routes in the templates have no checkpoints (start (9,10) or (12,10) → end (9,2)). The server must pathfind on the real stage grid.
- FLY routes carry explicit N-shaped checkpoints. PRTS confirms: "空中敌人路线为N形或反N形".

## 2. Maps

### 2.1 Coordinate convention (verified)
- Position `[row, col]`: row 0 is the **bottom** row and col 0 is the left column.
- The tile at (row, col) is `tiles[ mapData.map[H-1-row][col] ]`. `map[0]` in the raw file is the **top** row. This was verified because route start/end points fall on `tile_start` / `tile_end` only under this convention.
- In `05-maps.json`, `stage.rows[i]` is row i (bottom first). `rowsTopDown` holds the same grid printed top-first for human reading.
- 1 tile = 1 world unit. Every level uses `moveMultiplier` 0.5, so effective speed is about `moveSpeed × 0.5` tiles/s **[ASSUMED engine semantics; community rule of thumb]**.

### 2.2 Layout of every stage (19 rows × 21 cols; several areas on one grid)

| rows | area |
|---|---|
| 14–18 | Enemy preview pen: the next-round enemies are displayed here during the rest phase. `enemy_place_rect ((14,7),(18,13))`; row 16 is `previewNotAlloed`. |
| 13, 6 | Hard separators (`X`). The act2 m01 blowers sit on them. |
| **9–12** | **Normal-round battlefield.** Cols 2–10 are the LOCAL player's board. Cols 11–18 are the slot used to display the partner's board (`player_map_lr_offset` 8, `player_map_lr_boundary_col` 10). |
| 8 | Cols 4–8: 5 hand tiles *without* `isValidHand`. Not bench slots **[ASSUMED: staging/equipment display]**. |
| **7** | **Bench**: cols 0–9, 10 slots (`isValidHand`=1; constData `maxDeckChessCnt` = 10). |
| **1–5** | **Boss / final-offensive battlefield** shared by 2 players: left half cols 2–10, right half cols 10–18. |
| 0 | Boss-area benches: cols 0–9 (left player), cols 11–20 (right player). |

Normal board, per player:
- Enemy gates: `S` at (9,10) ("lower red gate"; rounds 1–3 use only this one) and at (12,10).
- Protection objective: `E` at (9,2).
- Col 9 is a floor lane you cannot deploy on.
- Deploy cap is 8 (`characterLimit`).
- DP: `initialCost` 0 / `maxCost` 99. DP is irrelevant because units auto-deploy.
- Ranged units may use melee tiles.

Boss board:
- Teleport-outs / spawns `O` at (2,10) and (5,10).
- Ends `E` at (2,2) and (2,18).
- Teleport-ins `I` at (1,3) and (1,17).
- Multi-player boss routes cross **both** halves: walk to (1,3), DISAPPEAR, wait 3 s, APPEAR at (5,10), then cross the other half. The two paired players therefore defend in series.
- Single-player `*_s` templates use only the left half.

### 2.3 Legend (glyphs in `rows`)

| glyph | tile | height | build | ground-passable | notes |
|---|---|---|---|---|---|
| `#` | forbidden | HIGH | – | no (fly only) | void |
| `X` | forbidden | HIGH | – | no (nothing) | separator |
| `r` | road | LOW | ALL | yes | main deploy tile (melee **or** ranged) |
| `R` | road | LOW | NONE | yes | (act1 m06 only) |
| `f` / `p` | floor | LOW | NONE | yes | lane col 9 / preview pen |
| `h` | wall | HIGH | RANGED | no | high ground |
| `b` | fence_bound | LOW | ALL | no (fly only) | deployable, but ground enemies path around it |
| `a` / `A` | achand | HIGH | – | – | bench slot / non-bench hand tile |
| `S` `E` `I` `O` | start / end / telin / telout | LOW | NONE | yes | |
| `m` | mire | LOW | ALL | yes | a trigger every 1 s on it (PRTS 沼泽控制; the first on entering): enemies +1 layer of atk-speed −5 / move −5 % (重量 ≥ 3, the skill's `value`: +2 layers), operators +1 layer of atk-speed −5 only; max 10; cleared on leaving |
| `g` | smog | LOW | ALL | yes | an operator here cannot be targeted by enemy **ranged** attacks |
| `d` | deepsea | LOW | ALL | yes | enemies take 40 dmg/s (无来源 true 持续伤害, not 环境伤害), atk-speed −60, move ×0.6 |
| `i` | infection | LOW | ALL | yes | allies on it and enemies crossing it get 70 true dmg/s, +20 % ATK, +20 ASPD for 300 s from their last contact (an enemy keeps it after leaving the tile; the tiles never switch off) |

### 2.4 Stage pool (`stageDatasDict`)

| stage | PRTS name | weight | modes | deploy tiles on normal board (ranged-only) | devices (`predefines.tokenInsts`) |
|---|---|---|---|---|---|
| act1autochess_m01 | 战场#01 | 50 | training, FUNNY, NORMAL | 22 (0) | 阻隔工事 ×12 (crate, HP 100; reroutes enemies; an enemy it blocks destroys it) |
| act1autochess_m02 | 战场#02 | 50 | NORMAL/HARD/ABYSS | 21 (0) | 阻隔工事 ×16, 射击台 ×16 (hidden; lets high-ground ops sit on it) |
| act1autochess_m03 | 战场#03 | 50 | NORMAL/HARD/ABYSS | 19 (0) | 射击台 ×16 (visible), 阻隔工事 ×8 |
| act1autochess_m04 | 战场#04 活性源石 | 50 | NORMAL/HARD/ABYSS | 19 (0) | 阻隔工事 ×12; 8 `i` tiles |
| act2autochess_m01 | 战场#05 源石流发生装置 | 50 | NORMAL/HARD/ABYSS | 16 (3) | 8 blowers (`trap_013_blower`) in rows 13/6, cols 5/9/13/17 (boss area 5/9/11/15), facing DOWN, 3 tiles. Operators facing the airflow direction get ATK +30 %, facing against it −30 %. Enemies moving with the flow get move +80 %, against it −50 %. |
| act2autochess_m02 | 战场#06 沼泽控制 | 50 | NORMAL/HARD/ABYSS | 19 (3) | `trap_098_mire` controller; 阻隔工事 ×4 on the col-9 lane (forces the upper gate around) |
| act2autochess_m03 | 战场#07 排气格栅 | 50 | NORMAL/HARD/ABYSS | 23 (0) | `g` smog tiles; 阻隔工事 ×10. The rune references `tile_reed` (ignite 15 s / 40 dmg) with no reed tiles present, so it is probably a leftover. |
| act2autochess_m04 | 战场#08 涨潮控制 | 50 | NORMAL/HARD/ABYSS | 25 (0) | `trap_042_tidectrl`: deep water `d` on the lanes |
| act1 m05 / m06 / m07 | season-1 #05–#07 | **0** | – | – | Disabled this season: deepsea+canoe, sandstorm+mounds, bushes. Kept in the JSON for reference. |

Always-present hidden controllers:
- `trap_1112_acblzd` 盟约寒风 at (18,0): Kjerag bond, periodic cold on all enemies.
- `trap_1104_aclasert` “双眼皮” turrets (HP 3000, ATK 900) on m01. They scale with the top bond's layers and are bond-activated. See the bond research.

`groundPathsHelper` in each stage holds the shortest 8-direction path (no corner cutting) for every gate→end pair. It also has a variant with crates treated as blocked. Use it for tests; the server should re-path live, because crates break.

Example (act2autochess_m01, top row first):
```
12 ####hrrr#fS#hrrr#fS##      S(12,10)/(9,10) → E(9,2); snake path via (9,7)-(12,7)-(12,5)-(9,5)
11 ####hr#r#f##hr#r#f###
10 ####hr#r#f##hr#r#f###
 9 ##Errr#rrrSrrr#rrrS##
 8 ####AAAAA##I#########
 7 aaaaaaaaaa###########      bench
```

## 3. Waves

### 3.1 Round schedule (from `battleDataDict` + `turnInfoDataDict` + template `maxPlayTime`)

Template slot codes:
- N = `enemy_1422_lrsldr`, E = `1427_lrnazg`, S = `1425_lrcmra` (ground)
- NF = `1005_yokai`, EF = `1042_frostd`, SF = `1040_bombd` (fly)
- T = `1000_gopro_2`, TF = `1041_lazerd` (token; used only in the escaped templates)

| R | template | battle s | rest s (multi) | 机变 (multi NORMAL) | composition | total |
|---|---|---|---|---|---|---|
| 1 | act1autochess_01 | 45 | 65 | | N2 NF2 + literal 源石虫 ×2 | 6 |
| 2 | 02 | 45 | 65 | | N6 NF9 | 15 |
| 3 | 03 | 55 | 65 | Y | N10 E1 NF9 EF2 | 22 |
| 4 | 04 | 55 | 95 | | N4 E1 S1 NF8 EF3 SF2 | 19 |
| 5 | 05 | 55 | 95 | | N11 E2 S1 NF13 EF3 SF2 | 32 |
| 6 | 06 | 70 | 100 | Y | N13 E2 S2 NF16 EF3 SF3 | 39 |
| 7 | 07 | 85 | 105 | | N14 E4 S3 NF15 EF5 SF2 | 43 |
| 8 | h01 | 85 | 105 | | N11 E3 S4 NF8 EF5 SF4 | 35 |
| 9 | h02 | 95 | 125 | Y | N15 E3 S2 NF8 EF5 SF4 | 37 |
| 10 | h03 | 95 | 125 | | N15 E4 S4 NF9 EF5 SF4 | 41 |
| 11 | h04 | 115 | 125 | | N13 E4 S7 NF11 EF6 SF5 | 46 |
| 12 | h05 | 115 | 125 | | N15 E9 S10 NF17 EF10 SF9 | 70 |
| 13 | h06 | 115 | 150 | | N13 E12 S13 NF11 EF10 SF10 | 69 |
| 14 | boss (h07_xx) | until the boss dies; −1 LP/s after 150 s | 195 | | boss + escorts | |
| 15 | hidden core (h08_xx) | same | 195 (215 HARD/ABYSS) | | | |

Mode differences:
- **FUNNY (标准)** has 9 rounds: 01–07, h01, then the boss in round 9.
- **Single modes** have rest time 300. The 下半 update made it unlimited, with a 24 h reconnect window.
- `specialPhaseTime` (机变阶段) is 150 s in single and 16 s in multi.
- 机变 rounds (`isSpPrepare`) by mode:

  | mode | 机变 rounds |
  |---|---|
  | multi NORMAL | 3, 6, 9 |
  | multi FUNNY | 3, 9 |
  | multi HARD/ABYSS | 3, 9, 11 |
  | single NORMAL | 6, 9 |
  | single HARD/ABYSS | 3, 9, 11 |
  | single FUNNY | none |
  | training | 3 |

- Training has 4 rounds (slime / ghost, then boss_7). Its rest time is 999 s.

Timing: every action in a template has `preDelay` (seconds from battle start) and `interval` between its `n` spawns. Enemy AI ends the battle when all enemies are dead, or when the battle time runs out (any enemies still alive then count as leaked).

### 3.2 Enemy factions & special enemies (特训敌人)

Official ingredients:
- `constData`: `templateEnemy*` (8 placeholders), `specialEnemyNum` 3, `minReplacedEnemyCount` 1, `maxReplacedEnemyCount` 5, `enemyTypeIdentifierToFillRandom` 1 (= SPECIAL), `enemyMaxHpFactor` 1, `enemyAtkFactor` 5, `enemyDefFactor` 3, `enemyMagicResistanceFactor` 3.
- `specialEnemyRandomTypeDict`: FLY/TIMES/ELEMENT/DOT/INVISIBLE/REFLECTION have count 3, weight 3. SPECIAL has count −1 (always available).
- Type names (`enemyTypeDatas`):

  | type | name | description |
  |---|---|---|
  | SPECIAL | 特异 | high damage and toughness |
  | FLY | 飞行 | many aerial units |
  | TIMES | 频次 | needs a number of hits to kill |
  | ELEMENT | 元素 | element damage |
  | DOT | 持续 | damage over time |
  | INVISIBLE | 隐匿 | stealth |
  | REFLECTION | 折射 | refraction |

- `specialEnemyInfoDict` has 67 entries. Each is a trio: special key, `attachedNormalEnemyKeys`, `attachedEliteEnemyKeys`, plus `randomWeight` (8–15) and `isInFirstHalf`.
- `randomEnemyAttributeDict` has 324 entries: `enemyBattleEffectivenessFactor` (0.1–1.2), `isFlyEnemy`, and `extraEnemyKeyList` (summons).
- `modeDataDict.inactiveEnemyKey` bans 18 strong keys in FUNNY/NORMAL.
- wiki.gg: "Starting from Alliance there can be up to 3 enemy factions per Protocol, along with a boss chosen from a separate pool… enemies do not get strategies and only get generic stat buffs as rounds escalate."

**Recommended generation [ASSUMED reconstruction]** (also in `05-enemies.json → generation.recommendedAlgorithm`):
1. **Match start:** pick 3 of the 6 typed factions (uniform). Training uses FLY, TIMES and ELEMENT.
2. **Round r ≤ 7** uses entries with `firstHalf`=true. **Rounds 8–13** use `firstHalf`=false; these are the upgraded "_2" enemies.
3. **Ground entry G:** a weighted pick among the chosen non-FLY factions plus SPECIAL, for the current half.
4. **Fly entry F:** a weighted FLY pick, only if FLY was chosen. Otherwise the fly slots keep yokai / frostd / bombd.
5. **Replace:** S → G.key, N → G.N, E → G.E. SF → F.key, NF → F.N, EF → F.E. Literal keys stay unchanged (round-1 slime, boss escorts).
6. **Count:** each replaced template enemy becomes `k = clamp(round(be(template)/be(new)), 1, 5)` copies, where `be = (hp + 5·atk + 3·def + 3·res) / enemyBattleEffectivenessFactor`.
   - With this formula almost all second-half specials map 1 : 1.
   - Swarm enemies map up to 5 : 1: 炽焰/灼热源石虫, 萨科塔之翼, 步兵.
   - `k` is precomputed in `specialEntries.rows[].kS / N[][2] / E[][2]`.
   - Optionally cap the total spawn count per round at about 1.5 × the template count.
7. **Stat scaling [ASSUMED]:** season effects `aceffect_enemy_1..5` exist (急行军 +15 % speed, 补给线 +8 % HP, 补给线II +20 % HP, 攻坚装备 +10 % ATK / +20 % HP, 攻坚装备II ×0.8 / ×0.8, 攻坚装备III ATK ×0.7 / HP ×0.75), but no data links them to modes or rounds. Proposed mapping:

   | when | effect |
   |---|---|
   | FUNNY | III |
   | NORMAL | II |
   | HARD | ×1 |
   | ABYSS | 攻坚装备 + 急行军 |
   | rounds 8–10 | +补给线 |
   | rounds 11–13 | 补给线II |

   “炎佑” (9012_acloon) and the 墨魂 minis (msf*) are excluded, following their `enemy_exclude` lists.
8. **Bounties (机变阶段 悬赏决策):** there are 129 ENEMY_GAIN effects (`bountyEffects`). Each adds N copies of an enemy to the chooser's next 1 / 2 / all battles.
   - `kill_gain_coin`: the killer earns coin.
   - `selfbattle_win_gain_coin`: pays coin if the chooser's own combat phase is perfect.
   - 战术特训 enemies are at 70 % HP/ATK/DEF in single mode (PRTS patch note).

### 3.3 Unite phase (联防) template
`level_act1autochess_escaped_multi` has 8 SPAWN slots (N, E, S, NF, EF, SF, T, TF; up to 5 each). Its routes start on the partner half at (9,18) / (12,18) and cross to (9,2). The single variant is `escaped_single`. For the remake, spawning the leaked enemies at the helper's own gates is acceptable.

## 4. LP (目标生命值) rules
- **Start LP** is the band's `totalHp` (20–45; 歌利亚 training band = 45).
- **Normal rounds:**
  - Unkilled enemies (reached the objective, or still alive at the time limit) cost LP. Official help: "根据未击倒敌人的数量…每回合最多扣除10点".
  - The cap is `costPlayerHpLimit` = 10.
  - **[ASSUMED]** Each counted enemy costs 1, excluding `notCountInTotal` units and boss parts. `lifePointReduce` is not used here, because several regular faction enemies (王庭军战士, 逐火战士, 萨科塔之翼 …) have `lpr` 0.
- **Team mode:**
  - Leaks are held back. If at least one player leaked and at least one player cleared perfectly, a 联防 phase runs: up to 2 perfect players fight the union of all leaked enemies.
  - Survivors of the 联防 phase then cost their owners' LP (cap 10).
  - If nobody cleared perfectly, leaks cost LP immediately.
  - Bonds do not stack during 联防.
- **Boss round:**
  - All LP merge into one pool with no cap.
  - After 150 s, every second costs 1 LP.
  - **[ASSUMED]** Each leaked enemy costs its `lpr`: most bosses 2, 盐风主教昆图斯 1, 卢西恩 30, typical enemies 1.
- **Hidden core (round 15, NORMAL+):**
  - Single: activated bond layers > 300 and LP > 1.
  - Multi: total layers across all players > 1000 and LP sum > 1.

`lpr` distribution across the 326 exported enemies: 255 ×1, 42 ×0, 21 ×2, 5 ×5, 2 ×30, 1 ×3. Among act2-relevant enemies: 175 ×1, 27 ×0, 20 ×2.

## 5. Bosses (`bossInfoDict`: season weights / HP pool + global enemyId)

bloodPoint is the boss HP pool for each difficulty. Per the notices, it is **shared by all players/battlefields**. `boss_battle_multi_player` spawns a mirrored copy on the partner half that shares HP. **[ASSUMED]** Single mode uses the same value.

| id | enemy | name | w | bloodPoint FUNNY / NORMAL / HARD / ABYSS | DB hp / atk / def / res | lpr | key abilities (handbook) |
|---|---|---|---|---|---|---|---|
| boss_1 | 9013_acstmk | 假想敌：胄 | 6 | 247 500 / 675 000 / 1 800 000 / 3 600 000 | 600000/650/1000/25 | 2 | Random magic beam. 灭顶之灾: shell at the highest-ATK operator; 3×3 stun + physical DoT; the shell can be shot down. <20 % HP: damage taken ×0.5 and an extra shell. Every 50 s summons drones (yokai, `boss_summon_enemy`). |
| boss_2 | 9017_achunt | 假想敌：铳 | 6 | 225 000 / 400 000 / 800 000 / 3 000 000 | 120000/750/1100/60 | 2 | Targets highest DEF. Erosion damage. Unblockable. ASPD ramps on the same target (+80, 5 stacks). 最终之罚: charge at the highest-DEF unit. Two copies in multi. |
| boss_3 | 9021_acduml | 假想敌：管 | 6 | 285 000 / 708 750 / 2 000 000 / 4 000 000 | 85000/300/700/50 | 2 | Summons “余音” (9023_acdums) every 40 s (20 s below 50 % HP). 裂管之奏: triple hit on each 余音 (AoE magic + apoptosis). |
| boss_4 | 1521_dslily | 盐风主教昆图斯 | 5 | 307 500 / 708 750 / 2 100 000 / 4 200 000 | 100000/380/500/50 | 1 | Hits the 2 highest-DEF targets. 大潮 (global magic + neural), 崩坍, 断裂生殖 (子代 `trap_039_dstnta` stun). 物种爆发 kills everything after a long time. |
| boss_5 | 2016_csphtm | 卢西恩，“猩红血钻” | 10 | 200 000 / 390 000 / 780 000 / 3 000 000 | 80000/1500/600/40 | **30** | 40 % evade while unblocked. Blinks behind its blocker and leaves 不祥幻影 (2017_csphts). 40 % DEF penetration + neural. Two copies in multi. |
| boss_6 | 9032_aclionk | 阿利斯泰尔，帝国余晖 | 5 | 285 000 / 705 000 / 1 990 000 / 3 980 000 | 81000/820/1030/20 | 2 | 王权号令 (plus-shaped strike, drops equipment 10028/29/30). 莫非王土 animates the equipment. ≤50 %: +DEF, RES 45, 2 equipment at once. Eventually kills everything. |
| boss_7 | 9033_acdeer | “萨米的意志” | 5 | 277 500 / 787 500 / 2 000 000 / 4 000 000 | 240000/800/800/40 | 2 | 冰凌 (hits the whole column). 自然涌动 (stun + magic DoT). ≤50 %: damage taken ×0.4 and 2 targets. Training boss. |
| boss_8 | 9013_acstmk_2 | 假想敌：胄 (隐秘核心) | 50 | 750 000 / 937 500 / 3 600 000 / 7 200 000 | 1200000/750/1200/30 | 2 | Adds 斩胄之剑 / 破胄之锤 (9014/9015; invulnerable until shot down). |
| boss_9 | 9017_achunt_2 | 假想敌：铳 (隐秘核心) | 40 | 675 000 / 900 000 / 2 800 000 / 3 950 000 | 120000/750/1100/60 | 2 | Linked to 3 “碎铳之簧” (9018/19/20) that take damage for it. Damage taken ×0.2. |
| boss_10 | 9021_acduml_2 | 假想敌：管 (隐秘核心) | 40 | 825 000 / 1 012 500 / 3 800 000 / 7 600 000 | 85000/300/700/50 | 2 | Comes with 假想敌：弦 (9022_acdumm). |

Boss escorts per level (template keys still get replaced) are in `05-maps.json roundLevels.*h07*/h08*`:
- boss_1: 重装防御组长 ×14 (`1006_shield_2`)
- boss_2: 愧悔魂灵圣杯 (`1430_lrrook`, 100k HP, 0 ATK)
- boss_3: 堂皇 (`1209_sfden_2`)
- boss_4: 复核洋流使者 (`1438_dspred`)
- boss_5: 骇笑看客 (`2009_csaudc`) and 绯红歌伶 (`2010_csdcr`)
- boss_6: “萨科塔昂首” (`10085_hllevi_2`)
- boss_7: 冰爆源石虫 (`1067_snslime`) and 游击队盾卫 (`1081_sotisd`)
- hidden cores: “帝国的甲胄” (`10027_vtsk`), 假想敌：淤困 (`9007_acelem`), 假想敌：再生 (`9010_acpupp`)

## 6. Enemy stat tables (raw level-0; full data incl. skills/talents in `05-enemies.json.enemies`)

Columns: rk N/E/B; spd is moveSpeed; bat is base attack time in seconds; range in tiles (−1 or 0 means melee or no attack); mv W = walk, F = fly.

Official autochess overrides already applied:
- 灼藤 (10067_ftsjc): ATK 400
- 元核孽生者 (1439_dslntf): ATK 400, talent `3.hp_ratio` 0.2

Both come from `level_autochess_enemy_data`.

### Template placeholders (constData)
| key | name | rk | hp | atk | def | res | spd | bat | range | lpr | mv | dmg | slot / be |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1422_lrsldr | 萨卡兹枯朽前锋 | N | 4700 | 300 | 100 | 40 | 0.8 | 3 | -1 | 1 | W | PHYS/MAGI | Normal be=6620 |
| 1427_lrnazg | “灵幛” | E | 15000 | 900 | 500 | 50 | 0.7 | 5 | 1.3 | 1 | W | PHYS | Elite be=21150 |
| 1425_lrcmra | 孽罪奇美拉 | E | 20000 | 800 | 1000 | 50 | 0.6 | 5 | -1 | 1 | W | PHYS/MAGI | Special be=27150 |
| 1005_yokai | 妖怪 | N | 800 | 0 | 50 | 0 | 0.9 | 2.3 | 0 | 1 | F | NO_D | NormalFly be=950 |
| 1042_frostd | 寒霜 | E | 6500 | 100 | 600 | 30 | 0.9 | 1 | 2.5 | 1 | F | NO_D | EliteFly be=8890 |
| 1040_bombd | 暴鸰 | E | 4000 | 800 | 150 | 30 | 0.6 | 5 | 2 | 1 | F | PHYS | SpecialFly be=8540 |
| 1000_gopro_2 | 猎狗pro | N | 1700 | 260 | 0 | 20 | 1.9 | 1.4 | 0 | 1 | W | PHYS | Token be=3060 |
| 1041_lazerd | 法术大师A1 | N | 2700 | 220 | 100 | 65 | 1.5 | 2.15 | 1.8 | 1 | F | MAGI | TokenFly be=4772 |

### Special (特训) entries: S-slot enemy, with attached N / E (k = copies per replaced template enemy)
| key | name | rk | hp | atk | def | res | spd | bat | range | lpr | mv | dmg | type,half,w · kS · N(k) · E(k) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1041_lazerd | 法术大师A1 | N | 2700 | 220 | 100 | 65 | 1.5 | 2.15 | 1.8 | 1 | F | MAGI | FLY,1st,w10 · k2 · “萨科塔之翼”×1 · 妖怪MKII×2 |
| 1355_mrfly | 护障 | N | 6000 | 0 | 80 | 40 | 1.2 | 2 | 2.5 | 1 | F | NO_D | FLY,1st,w10 · k1 · 妖怪×1 · 妖怪MKII×2 |
| 1017_defdrn | 御4 | N | 4000 | 0 | 150 | 20 | 0.8 | 2 | 2.5 | 1 | F | NO_D | FLY,1st,w10 · k2 · 妖怪×1 · 妖怪MKII×2 |
| 10084_hlegle | “萨科塔之眼” | N | 5500 | 1000 | 150 | 30 | 0.7 | 3 | 1.3 | 0 | F | PHYS | FLY,1st,w10 · k1 · “萨科塔之翼”×1 · 妖怪MKII×2 |
| 1407_hummbd | 远眺 | N | 4500 | 250 | 120 | 20 | 0.7 | 3 | 2 | 1 | F | PHYS | FLY,1st,w10 · k1 · 妖怪×1 · 妖怪MKII×2 |
| 1005_yokai_3 | 威龙 | E | 30000 | 660 | 170 | 0 | 0.5 | 3.8 | 2 | 1 | F | PHYS | FLY,2nd,w10 · k1 · 妖怪×1 · 妖怪MKII×2 |
| 1112_emppnt | 帝国炮火先兆者 | E | 13000 | 1000 | 800 | 50 | 0.5 | 5 | 2 | 1 | F | PHYS | FLY,2nd,w10 · k1 · 妖怪×1 · 妖怪MKII×2 · banned FUNNY+NORMAL |
| 1041_lazerd_2 | 法术大师A2 | E | 6000 | 600 | 140 | 65 | 0.8 | 3.5 | 3 | 1 | F | MAGI | FLY,2nd,w10 · k1 · 妖怪MKII×1 · 寒霜×1 |
| 9009_acfort | 假想敌：黑云 | E | 24000 | 500 | 150 | 20 | 0.5 | 3 | 2.5 | 1 | F | PHYS | FLY,2nd,w10 · k1 · 妖怪MKII×1 · 威龙×1 |
| 1195_sfyin_2 | 明鉴 | N | 3100 | 390 | 0 | 20 | 1.5 | 1.5 | 0 | 1 | W | PHYS | TIMES,1st,w10 · k2 · 磨砻×1 · 俗心×1 |
| 1288_duskls_2 | 深池逐火精锐战士 | N | 6000 | 180 | 100 | 50 | 0.7 | 2 | 0 | 0 | W | MAGI | TIMES,1st,w10 · k3 · 深池逐火战士×1 · 深池逐火战士×2 |
| 1197_sfshu | 俗心 | N | 2500 | 320 | 60 | 0 | 1.4 | 1.4 | 0 | 1 | W | PHYS | TIMES,1st,w10 · k2 · 磨砻×1 · 俗心×1 |
| 1292_duskld | 深池逐火护卫 | E | 10000 | 350 | 550 | 60 | 0.5 | 3.5 | 0 | 0 | W | MAGI | TIMES,2nd,w10 · k1 · 深池逐火战士×1 · 深池逐火精锐战士×2 |
| 1207_sfji | 沉沙 | E | 11000 | 1100 | 600 | 30 | 1.3 | 2.2 | 0 | 1 | W | PHYS | TIMES,2nd,w10 · k1 · 磨砻×1 · 俗心×1 · banned FUNNY+NORMAL |
| 1199_sfjin | 身观 | E | 6500 | 700 | 750 | 0 | 0.8 | 4 | 0 | 1 | W | PHYS | TIMES,2nd,w10 · k1 · 磨砻×1 · 俗心×1 |
| 9010_acpupp | 假想敌：再生 | E | 12000 | 1100 | 300 | 40 | 0.5 | 5 | -1 | 1 | W | PHYS | TIMES,2nd,w10 · k1 · 俗心×1 · 雅气×1 |
| 1161_tidmag | 控潮术师 | N | 6000 | 200 | 200 | 60 | 0.7 | 2.5 | 2.2 | 1 | W | MAGI | ELEMENT,1st,w10 · k1 · 潜水员×1 · 码头水手×1 |
| 1305_mhslim_2 | 炽焰源石虫 | N | 1800 | 80 | 0 | 0 | 0.8 | 2 | 1.8 | 1 | W | MAGI | ELEMENT,1st,w10 · k5 · 灼热源石虫×5 · 炽焰源石虫×5 |
| 2025_syufo | 掠海漂移体 | E | 20000 | 500 | 250 | 40 | 0.6 | 4 | 2.6 | 1 | W | PHYS | ELEMENT,2nd,w10 · k1 · 骨海漂流体×1 · 骨海漂流体×4 |
| 1161_tidmag_2 | 领潮员 | N | 8000 | 260 | 220 | 60 | 0.7 | 2.5 | 2.2 | 1 | W | MAGI | ELEMENT,2nd,w10 · k1 · 潜水员×1 · 码头水手长×1 |
| 1439_dslntf | 元核孽生者 | E | 30000 | 400 | 0 | 70 | 0.25 | 3 | 0 | 1 | W | PHYS | ELEMENT,2nd,w10 · k1 · 底海滑动者×1 · 富营养的滑动者×4 |
| 1275_dwlock_2 | 萨卡兹王庭军精锐术师 | E | 14000 | 500 | 250 | 50 | 0.8 | 4 | 2.5 | 1 | W | MAGI | ELEMENT,2nd,w10 · k1 · 萨卡兹王庭军战士×1 · 萨卡兹王庭军精锐战士×2 · banned FUNNY+NORMAL |
| 9007_acelem | 假想敌：淤困 | E | 36000 | 600 | 200 | 40 | 0.5 | 1 | -1 | 1 | W | MAGI | ELEMENT,2nd,w10 · k1 · 萨卡兹王庭军战士×1 · 萨卡兹王庭军精锐战士×2 |
| 1234_dsubrl | 深溟巢涌者 | E | 10000 | 140 | 550 | 60 | 0.8 | 1 | 1.6 | 1 | W | MAGI | DOT,1st,w10 · k1 · 单核掠食者×1 · 异光体掠食者×2 |
| 1272_nhtank | 萨卡兹枯朽战车 | E | 12000 | 750 | 750 | 10 | 0.7 | 4.5 | 2.2 | 1 | W | PHYS | DOT,1st,w10 · k1 · 萨卡兹枯朽战士×1 · 萨卡兹枯朽战士组长×3 |
| 1270_nhstlk | 逐腐兽 | E | 12000 | 550 | 150 | 20 | 1.4 | 1.8 | 0 | 1 | W | PHYS/MAGI | DOT,1st,w10 · k2 · 萨卡兹枯朽战士×1 · 萨卡兹枯朽战士组长×3 |
| 1234_dsubrl_2 | 富营养的巢涌者 | E | 14000 | 160 | 550 | 60 | 0.8 | 1 | 1.6 | 1 | W | MAGI | DOT,2nd,w10 · k1 · 异光体掠食者×1 · 异光体掠食者×2 · banned FUNNY+NORMAL |
| 10122_uacann_2 | 集团军重型火炮 | N | 10000 | 500 | 350 | 0 | 0.8 | 5 | 10 | 1 | W | PHYS | DOT,2nd,w10 · k1 · 萨卡兹枯朽战士组长×1 · 萨卡兹枯朽战士组长×3 · banned FUNNY+NORMAL |
| 1272_nhtank_2 | 尖端萨卡兹枯朽战车 | E | 15000 | 850 | 750 | 10 | 0.7 | 4.5 | 2.2 | 1 | W | PHYS | DOT,2nd,w10 · k1 · 萨卡兹枯朽战士组长×1 · 疯狂的逐腐兽×1 · banned FUNNY+NORMAL |
| 9006_actoxi | 假想敌：蚀裂 | E | 15000 | 400 | 400 | 10 | 0.6 | 1.5 | -1 | 1 | W | MAGI | DOT,2nd,w15 · k1 · 萨卡兹枯朽战士组长×1 · 疯狂的逐腐兽×1 |
| 1299_ymkilr | 山海众头目 | E | 8500 | 800 | 250 | 20 | 1.1 | 2.5 | 1.2 | 1 | W | PHYS | INVISIBLE,1st,w10 · k1 · 宿主士兵×2 · 隐形弩手×3 |
| 10034_cnvsax | 节日爵士乐手 | E | 10000 | 650 | 300 | 10 | 0.7 | 1 | 2.5 | 1 | W | PHYS/MAGI | INVISIBLE,1st,w10 · k2 · 宿主士兵×2 · 隐形弩手×3 |
| 10042_prtrop_2 | 扶桥老手 | N | 8000 | 720 | 300 | 30 | 0.65 | 2 | -1 | 1 | W | PHYS | INVISIBLE,1st,w10 · k2 · 寻险水手×1 · 架桥船工×2 |
| 1389_winbab_2 | 访问团强攻冠军 | N | 7000 | 650 | 400 | 10 | 0.6 | 3 | 3.5 | 1 | W | PHYS | INVISIBLE,2nd,w10 · k1 · 访问团新兵×1 · 隐形弩手组长×2 |
| 1299_ymkilr_2 | 山海众秘使 | E | 11000 | 1000 | 300 | 20 | 1.1 | 2.5 | 1.2 | 1 | W | PHYS | INVISIBLE,2nd,w10 · k1 · 萨卡兹枯朽辟路前锋×1 · 隐形弩手组长×2 |
| 1404_msnip | 重弩突袭者 | N | 6000 | 400 | 180 | 60 | 0.7 | 3.5 | -1 | 1 | W | MAGI | INVISIBLE,2nd,w10 · k1 · 潜伏者×2 · 隐形弩手组长×2 |
| 9008_acbunn | 假想敌：骨刺 | E | 12000 | 360 | 300 | 60 | 0.5 | 4 | 2 | 1 | W | MAGI | INVISIBLE,2nd,w10 · k1 · 业余竞演者×1 · 隐形弩手组长×2 · banned FUNNY+NORMAL |
| 1174_duholy | 深池伙友卫队 | E | 15000 | 900 | 900 | 0 | 0.8 | 4 | 1.4 | 1 | W | PHYS | REFLECTION,1st,w10 · k1 · 深池侦察兵×1 · 深池重甲卫士×1 |
| 1168_dumage | 深池暗影术师 | N | 4500 | 300 | 150 | 20 | 1.1 | 3 | 2.5 | 1 | W | MAGI | REFLECTION,1st,w10 · k4 · 深池侦察犬×1 · 深池方阵战士×3 |
| 1170_dushld | 深池重甲卫士 | E | 7000 | 700 | 750 | 0 | 0.7 | 4 | 0 | 1 | W | PHYS | REFLECTION,1st,w10 · k2 · 深池侦察兵×1 · 深池方阵战士×3 |
| 1174_duholy_2 | 深池伙友卫队精英 | E | 20000 | 1100 | 1000 | 0 | 0.8 | 4 | 1.4 | 1 | W | PHYS | REFLECTION,2nd,w10 · k1 · 深池侦察队长×1 · 深池重甲卫士队长×1 · banned FUNNY+NORMAL |
| 1170_dushld_2 | 深池重甲卫士队长 | E | 9000 | 900 | 1100 | 0 | 0.7 | 4 | 0 | 1 | W | PHYS | REFLECTION,2nd,w10 · k1 · 深池侦察队长×1 · 深池方阵指挥官×2 |
| 1172_dugago | 守墓石像 | E | 10000 | 550 | 550 | 0 | 0.5 | 4 | 1.6 | 1 | W | PHYS/MAGI | REFLECTION,2nd,w10 · k1 · 深池侦察队长×1 · 深池方阵指挥官×2 |
| 9011_acrefr | 假想敌：镜膜 | E | 18000 | 1000 | 600 | 0 | 0.5 | 5.5 | -1 | 1 | W | PHYS | REFLECTION,2nd,w10 · k1 · 深池侦察队长×1 · 深池重甲卫士队长×1 |
| 1010_demon_2 | 萨卡兹大剑组长 | E | 15000 | 750 | 250 | 50 | 0.85 | 2 | 0 | 1 | W | PHYS | SPECIAL,1st,w10 · k1 · 萨卡兹刀兵×1 · 萨卡兹大剑手×2 |
| 1045_hammer | 粉碎攻坚手 | E | 10000 | 1000 | 1000 | 0 | 0.5 | 3.5 | 2.5 | 1 | W | PHYS | SPECIAL,1st,w10 · k1 · 宿主士兵×2 · 步兵×5 |
| 1118_lidbox_2 | 拳师囚犯 | E | 9500 | 400 | 400 | 0 | 1.6 | 1 | 0 | 1 | W | PHYS | SPECIAL,1st,w10 · k2 · 普通囚犯×1 · 老练囚犯×2 |
| 1325_cbgpro_2 | 高级军用猎狗 | N | 4600 | 360 | 0 | 30 | 1.7 | 1.5 | 0 | 1 | W | PHYS | SPECIAL,1st,w10 · k3 · 猎狗pro×2 · 军用猎狗×3 |
| 1121_lifbos | 重犯 | E | 20000 | 800 | 400 | 0 | 0.8 | 3 | 0 | 1 | W | PHYS | SPECIAL,1st,w10 · k1 · 普通囚犯×1 · 老练囚犯×2 |
| 1006_shield_3 | 重装五十夫长 | E | 40000 | 1000 | 1200 | 0 | 0.75 | 2.6 | 0 | 1 | W | PHYS | SPECIAL,2nd,w10 · k1 · 宿主士兵×2 · 重装侦察兵×1 |
| 1329_cbshld | 弧光镜卫 | N | 10000 | 700 | 3300 | 60 | 0.75 | 3 | 0 | 1 | W | PHYS | SPECIAL,2nd,w10 · k1 · Dor-1号失败品×1 · 莱茵生命防卫科高级成员×2 |
| 1045_hammer_2 | 粉碎攻坚组长 | E | 20000 | 1500 | 2000 | 0 | 0.5 | 3.5 | 2.5 | 1 | W | PHYS | SPECIAL,2nd,w10 · k1 · 宿主重装士兵×1 · 宿主重装士兵×1 |
| 1387_winshd | 访问团持盾者 | E | 12000 | 500 | 1200 | 20 | 0.5 | 3 | 0 | 1 | W | PHYS | SPECIAL,2nd,w10 · k1 · 访问团新兵×1 · 访问团老兵×1 |
| 1121_lifbos_2 | 传奇重犯 | E | 25000 | 1000 | 500 | 0 | 0.8 | 3 | 0 | 1 | W | PHYS | SPECIAL,2nd,w10 · k1 · 老练囚犯×1 · 强壮囚犯×1 |
| 1320_wdrrl_2 | 萨卡兹悖谬暴虐兵长 | E | 25000 | 1200 | 800 | 20 | 0.8 | 2.9 | 0 | 1 | W | PHYS | SPECIAL,2nd,w10 · k1 · 萨卡兹枯朽辟路前锋×1 · 萨卡兹大剑手×2 |
| 10124_uashld_2 | 集团军中坚盾卫 | E | 25000 | 950 | 1800 | 60 | 0.7 | 3.8 | 1 | 1 | W | PHYS | SPECIAL,2nd,w10 · k1 · 宿主士兵×2 · 宿主重装士兵×1 |
| 1328_cbjedi | 弧光锋卫 | E | 10000 | 700 | 550 | 50 | 0.75 | 3 | 0 | 1 | W | MAGI | SPECIAL,1st,w10 · k1 · Dor-1号失败品×1 · 莱茵生命防卫科高级成员×2 |
| 1355_mrfly_2 | 护障·P | N | 10000 | 0 | 80 | 50 | 1.2 | 2 | 2.5 | 1 | F | NO_D | FLY,1st,w8 · k1 · 妖怪×1 · 御4×2 · banned FUNNY+NORMAL |
| 1197_sfshu_2 | 雅气 | N | 3350 | 410 | 70 | 0 | 1.4 | 2 | 0 | 1 | W | PHYS | TIMES,1st,w8 · k1 · 磨砻×1 · 雅气×1 · banned FUNNY+NORMAL |
| 10067_ftsjc | 灼藤 | E | 13000 | 400 | 250 | 65 | 0.85 | 3.5 | -1 | 1 | W | MAGI | ELEMENT,2nd,w8 · k1 · 卷心籽×1 · 灼藤×1 · banned FUNNY+NORMAL |
| 1270_nhstlk_2 | 疯狂的逐腐兽 | E | 16000 | 700 | 200 | 20 | 1.4 | 1.8 | 0 | 1 | W | PHYS/MAGI | DOT,2nd,w8 · k1 · 萨卡兹枯朽战士×1 · 萨卡兹枯朽战士组长×3 · banned FUNNY+NORMAL |
| 1283_sgkill | 家族灭迹人 | E | 12000 | 800 | 800 | 45 | 0.9 | 3 | 1.8 | 1 | W | PHYS | INVISIBLE,2nd,w8 · k1 · 业余竞演者×1 · 隐形弩手组长×2 · banned FUNNY+NORMAL |
| 1175_dushdo_2 | 深池伙友影刃精英 | E | 15000 | 580 | 550 | 0 | 0.8 | 2.1 | 1.4 | 1 | W | MAGI | REFLECTION,2nd,w8 · k1 · 深池侦察犬×1 · 深池伙友卫队精英×1 · banned FUNNY+NORMAL |
| 1254_lypa_2 | 测试用动力装甲 | E | 10000 | 850 | 800 | 20 | 1.2 | 1.3 | 0 | 1 | W | PHYS | SPECIAL,2nd,w10 · k2 · Dor-1号失败品×1 · 莱茵生命防卫科高级成员×2 · banned FUNNY+NORMAL |
| 1425_lrcmra_2 | 渎罪奇美拉 | E | 25000 | 1200 | 1200 | 50 | 0.6 | 5 | -1 | 1 | W | PHYS/MAGI | SPECIAL,2nd,w10 · k1 · 萨卡兹枯朽辟路前锋×1 · 萨卡兹大剑手×2 · banned FUNNY+NORMAL |
| 1329_cbshld_2 | 弧光镜卫长 | N | 13000 | 900 | 3500 | 60 | 0.75 | 3 | 0 | 1 | W | PHYS | SPECIAL,2nd,w10 · k1 · Dor-α号失败品×1 · Dor-β号复制体×2 · banned FUNNY+NORMAL |
| 1072_dlancer | 萨卡兹穿刺手 | E | 6000 | 450 | 150 | 40 | 0.25 | 4 | 0 | 1 | W | PHYS | SPECIAL,2nd,w10 · k3 · 萨卡兹刀兵×1 · 萨卡兹大剑组长×1 · banned FUNNY+NORMAL |

### Attached normal/elite enemies (N/E slots)
| key | name | rk | hp | atk | def | res | spd | bat | range | lpr | mv | dmg | abilities |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10083_hlbird | “萨科塔之翼” | N | 1500 | 0 | 0 | 30 | 0.9 | 1 | -1 | 0 | F | NO_D | 飞行单位; 生命值首次降至一半以下时，在数秒内陷入恐惧 |
| 1005_yokai_2 | 妖怪MKII | N | 1550 | 220 | 50 | 0 | 0.9 | 3 | 2 | 1 | F | PHYS | 飞行单位 |
| 1005_yokai | 妖怪 | N | 800 | 0 | 50 | 0 | 0.9 | 2.3 | 0 | 1 | F | NO_D | 飞行单位 |
| 1042_frostd | 寒霜 | E | 6500 | 100 | 600 | 30 | 0.9 | 1 | 2.5 | 1 | F | NO_D | 飞行单位; 周围的我方单位的攻击速度大幅度降低 |
| 1005_yokai_3 | 威龙 | E | 30000 | 660 | 170 | 0 | 0.5 | 3.8 | 2 | 1 | F | PHYS | 飞行单位 |
| 1195_sfyin | 磨砻 | N | 2000 | 310 | 0 | 20 | 1.5 | 1.5 | 0 | 1 | W | PHYS | 被击倒后生成2个<木制瑞印> |
| 1197_sfshu | 俗心 | N | 2500 | 320 | 60 | 0 | 1.4 | 1.4 | 0 | 1 | W | PHYS | 被击倒后生成3个<小说卷轴> |
| 1288_duskls | 深池逐火战士 | N | 5000 | 150 | 50 | 50 | 0.7 | 2 | 0 | 0 | W | MAGI | 位于燃烧的芦苇丛附近时攻击额外造成灼燃损伤; 被击倒时暂时变为隐匿、需要5次伤害击倒的<怨恨的余烬>，一段时间后重生 |
| 1288_duskls_2 | 深池逐火精锐战士 | N | 6000 | 180 | 100 | 50 | 0.7 | 2 | 0 | 0 | W | MAGI | 位于燃烧的芦苇丛附近时攻击额外造成灼燃损伤; 被击倒时暂时变为隐匿、需要5次伤害击倒的<暴怒的余烬>，一段时间后重生 |
| 1197_sfshu_2 | 雅气 | N | 3350 | 410 | 70 | 0 | 1.4 | 2 | 0 | 1 | W | PHYS | 被击倒后生成3个<诗画卷轴> |
| 1158_divman | 潜水员 | N | 3300 | 240 | 150 | 20 | 0.9 | 2.7 | 1.9 | 1 | W | PHYS | 免疫水蚀，在水中攻击力提升并获得隐匿 |
| 1160_hvyslr | 码头水手 | E | 10000 | 800 | 800 | 20 | 0.7 | 3.5 | 0 | 1 | W | PHYS | 能在数次攻击后晕眩我方单位; “水蚀”状态下快速损失生命 |
| 1305_mhslim | 灼热源石虫 | N | 1200 | 50 | 0 | 0 | 0.8 | 2 | 1.8 | 1 | W | MAGI | 攻击造成灼燃损伤 |
| 1305_mhslim_2 | 炽焰源石虫 | N | 1800 | 80 | 0 | 0 | 0.8 | 2 | 1.8 | 1 | W | MAGI | 攻击造成灼燃损伤 |
| 2021_syfish | 骨海漂流体 | N | 4000 | 250 | 150 | 10 | 1.2 | 2 | 0 | 1 | W | PHYS | 攻击额外造成侵蚀损伤 |
| 1160_hvyslr_2 | 码头水手长 | E | 14000 | 1000 | 1000 | 20 | 0.7 | 3.5 | 0 | 1 | W | PHYS | 能在数次攻击后晕眩我方单位; “水蚀”状态下快速损失生命 |
| 1148_dssbr | 底海滑动者 | N | 2800 | 280 | 130 | 10 | 1.1 | 2 | 0 | 1 | W | PHYS | 攻击额外造成神经损伤 |
| 1148_dssbr_2 | 富营养的滑动者 | N | 3600 | 360 | 150 | 10 | 1.1 | 2 | 0 | 1 | W | PHYS | 攻击额外造成神经损伤 |
| 1229_darmy | 萨卡兹王庭军战士 | N | 4200 | 240 | 220 | 40 | 0.9 | 2.5 | -1 | 0 | W | MAGI | 攻击造成凋亡损伤 |
| 1229_darmy_2 | 萨卡兹王庭军精锐战士 | N | 5500 | 380 | 280 | 40 | 0.9 | 2.5 | -1 | 0 | W | MAGI | 攻击造成凋亡损伤 |
| 1433_dsbasi | 单核掠食者 | N | 4300 | 280 | 0 | 10 | 1.6 | 1.1 | -1 | 1 | W | PHYS |  |
| 1433_dsbasi_2 | 异光体掠食者 | N | 5700 | 350 | 0 | 10 | 1.6 | 1.1 | -1 | 1 | W | PHYS |  |
| 1267_nhpbr | 萨卡兹枯朽战士 | N | 4500 | 380 | 100 | 20 | 0.8 | 2.5 | 0 | 1 | W | PHYS | 被击倒时释放污染秽蚀，使周围我方持续损失生命 |
| 1267_nhpbr_2 | 萨卡兹枯朽战士组长 | N | 5500 | 450 | 100 | 20 | 0.8 | 2.5 | 0 | 1 | W | PHYS | 被击倒时释放污染秽蚀，使周围我方持续损失生命 |
| 1270_nhstlk_2 | 疯狂的逐腐兽 | E | 16000 | 700 | 200 | 20 | 1.4 | 1.8 | 0 | 1 | W | PHYS/MAGI | 攻击使目标在一段时间内持续受到法术伤害，目标接受治疗时解除此效果 |
| 1043_zomsbr | 宿主士兵 | N | 2500 | 250 | 100 | 30 | 0.9 | 1.8 | 2.5 | 1 | W | PHYS | 能够自然回复生命 |
| 1019_jshoot | 隐形弩手 | N | 1800 | 260 | 100 | 20 | 0.9 | 2.7 | 2.2 | 1 | W | PHYS | 隐匿 |
| 10043_sailor | 寻险水手 | N | 5500 | 350 | 50 | 10 | 0.9 | 2 | -1 | 1 | W | PHYS | 经过悬索桥或被<盐坨子炮>传送时，移动速度短暂提升 |
| 10042_prtrop | 架桥船工 | N | 6000 | 600 | 150 | 30 | 0.65 | 2 | -1 | 1 | W | PHYS | 隐匿; 可以架设可通行的悬索桥 |
| 1381_winman | 访问团新兵 | N | 5800 | 300 | 100 | 0 | 0.9 | 1.7 | 0 | 1 | W | PHYS |  |
| 1019_jshoot_2 | 隐形弩手组长 | N | 2700 | 310 | 130 | 20 | 0.9 | 2.7 | 2.2 | 1 | W | PHYS | 隐匿 |
| 1422_lrsldr_2 | 萨卡兹枯朽辟路前锋 | N | 5500 | 350 | 100 | 40 | 0.8 | 3 | -1 | 1 | W | PHYS/MAGI | 位于源石污染区内时，攻击造成法术伤害 |
| 1009_lurker | 潜伏者 | N | 2200 | 300 | 90 | 20 | 1 | 2 | 0 | 1 | W | PHYS | 隐匿 |
| 10031_cnvsld | 业余竞演者 | N | 4000 | 300 | 100 | 0 | 1.5 | 2 | -1 | 1 | W | PHYS | 隐匿; 狂欢时刻失去隐匿 |
| 1166_dusbr | 深池侦察兵 | N | 3000 | 280 | 110 | 0 | 1 | 2 | 0 | 1 | W | PHYS | 折射 |
| 1170_dushld | 深池重甲卫士 | E | 7000 | 700 | 750 | 0 | 0.7 | 4 | 0 | 1 | W | PHYS | 折射 |
| 1165_duhond | 深池侦察犬 | N | 2800 | 300 | 0 | 0 | 1.7 | 1.4 | 0 | 1 | W | PHYS | 折射 |
| 1169_duphlx | 深池方阵战士 | N | 4000 | 300 | 300 | 0 | 1 | 2.5 | 1.5 | 1 | W | PHYS | 其他方阵战士位于附近时，防御力提升（可叠加）; 折射 |
| 1166_dusbr_2 | 深池侦察队长 | N | 4400 | 380 | 180 | 0 | 1 | 2 | 0 | 1 | W | PHYS | 折射 |
| 1170_dushld_2 | 深池重甲卫士队长 | E | 9000 | 900 | 1100 | 0 | 0.7 | 4 | 0 | 1 | W | PHYS | 折射 |
| 1169_duphlx_2 | 深池方阵指挥官 | N | 6000 | 450 | 400 | 0 | 1 | 2.5 | 1.5 | 1 | W | PHYS | 其他方阵指挥官位于附近时，防御力提升（可叠加）; 折射 |
| 1071_dftman | 萨卡兹刀兵 | N | 2800 | 300 | 70 | 50 | 1 | 2.5 | 0 | 1 | W | PHYS |  |
| 1010_demon | 萨卡兹大剑手 | E | 7500 | 600 | 230 | 50 | 0.85 | 2 | 0 | 1 | W | PHYS |  |
| 1046_agent | 步兵 | N | 2500 | 280 | 85 | 40 | 1.1 | 2 | 0 | 1 | W | PHYS |  |
| 1116_liprr | 普通囚犯 | N | 5500 | 280 | 60 | 0 | 1.1 | 2 | 0 | 1 | W | PHYS | 初始为禁锢状态，禁锢状态下攻击速度降低; 攻击数次后解放，解放后攻击力提升 |
| 1116_liprr_2 | 老练囚犯 | N | 7500 | 380 | 60 | 0 | 1.1 | 2 | 0 | 1 | W | PHYS | 初始为禁锢状态，禁锢状态下攻击速度降低; 攻击数次后解放，解放后攻击力提升 |
| 1000_gopro_2 | 猎狗pro | N | 1700 | 260 | 0 | 20 | 1.9 | 1.4 | 0 | 1 | W | PHYS |  |
| 1325_cbgpro | 军用猎狗 | N | 3800 | 290 | 0 | 30 | 1.7 | 1.5 | 0 | 1 | W | PHYS |  |
| 1402_tgshd_2 | 重装侦察兵 | E | 13000 | 700 | 1500 | 0 | 0.7 | 3 | -1 | 1 | W | PHYS | 被攻击时使攻击者暴露5秒; 暴露状态下的我方无法通过封阻物避开敌方视线，且受到的伤害提升 |
| 1251_lysyta | Dor-1号失败品 | N | 2750 | 310 | 0 | 50 | 1.5 | 1.8 | 0 | 1 | W | PHYS | 接触未激活的<R系列动力装甲>时，为其回复一定技力 |
| 1249_lysdb_2 | 莱茵生命防卫科高级成员 | N | 6000 | 485 | 300 | 0 | 1 | 2.8 | 0 | 1 | W | PHYS | 可以抵挡一次物理或法术伤害 |
| 1061_zomshd | 宿主重装士兵 | E | 10000 | 600 | 800 | 0 | 0.75 | 2.6 | 0 | 1 | W | PHYS | 能够自然回复生命 |
| 1381_winman_2 | 访问团老兵 | N | 7800 | 400 | 200 | 0 | 0.9 | 1.7 | 0 | 1 | W | PHYS |  |
| 1119_vofsd | 强壮囚犯 | E | 11000 | 600 | 700 | 0 | 0.8 | 3.3 | 0 | 1 | W | PHYS | 初始为禁锢状态，禁锢状态下攻击速度降低; 攻击数次后解放，解放后攻击力提升、法术抗性提升且能够自然回复生命 |
| 1017_defdrn | 御4 | N | 4000 | 0 | 150 | 20 | 0.8 | 2 | 2.5 | 1 | F | NO_D | 飞行单位; 为周围敌军持续提供防御力加成 |
| 10065_ftzlc | 卷心籽 | N | 3800 | 240 | 0 | 5 | 1 | 1.7 | -1 | 1 | W | PHYS | 可以被<灼藤>或<灼芯>点燃; 点燃状态下死亡后对周围造成大量法术伤害 |
| 10067_ftsjc | 灼藤 | E | 13000 | 400 | 250 | 65 | 0.85 | 3.5 | -1 | 1 | W | MAGI | 攻击额外造成灼燃损伤; 首次攻击前，攻击力不断提升且首次攻击对目标和周围造成法术伤害和灼燃损伤 |
| 1174_duholy_2 | 深池伙友卫队精英 | E | 20000 | 1100 | 1000 | 0 | 0.8 | 4 | 1.4 | 1 | W | PHYS | 容易受到我方单位攻击; <深池伙友影刃精英>位于附近时，激活力场使周围我方攻击速度下降; 折射 |
| 1251_lysyta_2 | Dor-α号失败品 | N | 3200 | 360 | 50 | 50 | 1.5 | 1.8 | 0 | 1 | W | PHYS | 接触未激活的<R系列动力装甲>时，为其回复一定技力 |
| 1252_lysytb_2 | Dor-β号复制体 | N | 9000 | 420 | 50 | 50 | 0.9 | 3.2 | 2.2 | 1 | W | PHYS | 接触未激活的<R系列动力装甲>时，为其回复一定技力 |
| 1010_demon_2 | 萨卡兹大剑组长 | E | 15000 | 750 | 250 | 50 | 0.85 | 2 | 0 | 1 | W | PHYS |  |

## 7. Open questions / assumptions to confirm
1. **Replacement algorithm.** Is there one special entry per round or one per spawn action? Is the k-copies formula right? It is inferred from `min/maxReplacedEnemyCount` and the BE factors, and is not documented anywhere.
2. **Enemy stat scaling.** It is unknown how `aceffect_enemy_*` map to modes and rounds. `difficultyFactorInfo` (1.0/1.6/1.7/1.7) and `modeFactorInfo` (1.25) look like **reward** coefficients: PRTS notes "获取卫戍认证系数提升至×1.25".
3. **Boss HP in single mode.** It may be the same bloodPoint or a scaled one. The multi pool is shared by 4 players across 2 battlefields.
4. **Leak weighting.** The rule is by count; whether `lpr` ever matters outside boss rounds is unknown.
5. **Row 8 / row 1 non-bench hand tiles:** exact use is unknown (temporary staging for 临时整备区?).
6. **4-player lobbies.** Normal rounds use 4 separate boards. Boss rounds put pairs on 2 boss battlefields. It is not known how partners are assigned for 联防 (proposal: the 2 perfect players with the lowest index).

---

## Addendum (critic)

Written 2026-09-27 by the completeness critic. It supersedes the conflicting lines above. Sources: round-level `options` re-read from the level JSONs, PRTS `卫戍协议：盟约_下半` §开始模拟 and §隐秘核心, PRTS `卫戍协议/帮助`, and BWIKI `盟约`.

| § | Was | Now | Tag |
|---|---|---|---|
| 2.2 "DP initialCost 0 / DP irrelevant" | from the `m0X` terrain files | The **round levels** (`01…h06`, `h07/h08`, `escaped_*`) have `initialCost` **10**, `costIncreaseTime` 1 s and `maxCost` 99. The value 0 belongs to the terrain files, which are not used for battle options. **DP matters:** initial deployment is free, but auto-redeploy after a knock-out needs DP ≥ the unit's `cost` (BWIKI "在再部署时间归零、地块可部署且部署费用足够后，将在原位置自动部署"). | VERIFIED |
| 2.2 row 8 "5 hand tiles [ASSUMED staging]" | – | They are the **5 temporary hand slots** (临时手牌区): "溢出的手牌会临时存放至整备区前方的5个空位上". | VERIFIED |
| 3.1 "FUNNY has 9 rounds" | – | Only **solo** FUNNY has 9 rounds (R9 = boss `h07_01_S` and its alternatives). **Multi FUNNY has 14 rounds** (R14 boss, no R15), with SP rounds 3 and 9. | VERIFIED (data) |
| 3.2 step 7, stat scaling [ASSUMED] | FUNNY III / NORMAL II … | **Replaced by the per-mode, per-round table in 01 Addendum A3** (`01-core-data.json → _criticAddendum.enemyStatMultipliers`). `atk × base × 1.1^k`, `hp × base × 1.2^k (× 1.08 in the ABYSS rounds marked there)`. DEF and RES unchanged. Leader HP pools are excluded. **ABYSS: all enemies move ×1.15 from R3.** Apply it after the special-enemy replacement, on the level-0 stats. | VERIFIED (PRTS, user-sourced) |
| 4 "Hidden core: >300 / >1000" | 上半 values | **下半: solo > 350 activated layers and LP > 1; multi team sum > 1200 and merged LP > 1.** Available on 险境 and harder. | VERIFIED |
| 4 boss round | – | The boss HP pool is not scaled by A3. Overtime −1 LP/s starts after `bossTurnHpReduceTime` = 150 s. The battle does not end at the level's 120 s ("计时结束后战斗仍然会继续"). Wave enemies that reach a goal subtract their `lifePointReduce` from the merged LP; at 0 the team fails at once. **Movable bosses spawn one per alive player's side**, and all of them share the pool. | VERIFIED |
| 3.1 timeout | "alive at the limit count as leaked" | Confirmed: "在作战时间结束后，如果战场中存在仍未被击杀的敌人，就无法达成完美作战。根据最终未击倒的敌方数量，扣除其来源玩家的目标生命值（每回合最多10点）". The combat ends at `maxPlayTime`. [ASSUMED] The limit is in game-time seconds; combat always runs at 2×. | VERIFIED |
| 3.3 联防 | helpers | At most 2 helpers. They keep their end-of-combat HP ratio, SP and positions. With 1 helper use `escaped_single`; with 2 use `escaped_multi`. Survivors cost their **source** player LP, capped at 10. | VERIFIED |

Still [ASSUMED] from this file:
- The special-enemy replacement counts `k`.
- The per-round faction pick.
- The spawn-lane mapping when a leaked enemy is replayed in 联防.
- Whether bounty and special enemies also receive the A3 multipliers. Recommend **yes**, using the current round's `k`.
