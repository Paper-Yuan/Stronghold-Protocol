# 07 — Art and audio assets: sources, feasibility and the final plan

Scope: every art and audio asset the fan remake of **卫戍协议：盟约 (act2autochess)** needs, with **URL patterns that have been checked**, measured hit rates, file sizes and fallbacks.
Machine-readable companion: **`docs/research/07-assets.json`**. It maps every id to resolved URLs and byte sizes: 138 operators, 20 tokens, 200 enemies, 23 bonds, 59 shop items, 40 bands, the UI sprite groups and the audio banks.
**All 4,451 unique URLs in that JSON were HEAD-checked on 2026-09-27 and returned `200`.**

Probe artifacts are in the scratchpad at `…/scratchpad/gd/extra/assets/`:
- Git-tree listings: `y_*.txt`, `fx_spine.txt`, `am_enemies.txt`, `aa2_*.txt`, `aa2v_*.txt`.
- Id lists: `charids.txt`, `enemyids.txt`, `tokenids.txt`, `trapids.txt`.
- Spine sample: `spine_sample/`.
- Browser render proof: `spine_test.png`, produced from `spine_test.html`.
- Generator script: `gen_assets_json.py`.

---

## 0. TL;DR: the final plan

| Class | Source (primary) | Pattern | Hit rate (pool) | Typical file | Fallback |
|---|---|---|---|---|---|
| a) Avatar (square) | yuanyan3060/ArknightsGameResource `avatar/` | `{charId}.png`, E2: `{charId}_2.png` | **138/138**; E2 122/138 | 180×180 PNG, ~58 KB | E2 missing → base `{charId}.png` (the 16 misses are the 预备干员/Sharp/Pith/… `char_60x/61x` ids that have no E2 art) |
| b) Half-body portrait | same repo `portrait/` | `{charId}_1.png`, E2 `_2.png` | **138/138**; E2 122/138 | 180×360 PNG, ~117 KB | `_1` |
| b') Full art (detail panel only) | same repo `skin/` | `{charId}_1b.png`, E2 `_2b.png` | 138/138; E2 122/138 | 681×1317, ~0.8 MB (E2 ~3.2 MB) | portrait `_1`; lazy-load only |
| c) Skill icon | same repo `skill/` | `skill_icon_{skill.iconId ?? skillId}.png` (percent-encode `[` `]`) | **317/317** (all skills of pool operators; 144 are default skills) | 128×128, ~19 KB | `arts/ui/[uc]charcommon/skills/empty_skill.png` |
| d) Profession / sub-profession | ArknightsAssets/ArknightsAssets2 `@cn` `assets/dyn/arts/…` | `profession_hub/icon_{prof}.png`, `ui/subprofessionicon/sub_{subProfessionId}_icon.png` | 8/8, **58/58** | ~12 KB / ~2 KB | battlecard `icon_profession_*.png` |
| e) Enemy icon | yuanyan `enemy/` | `{enemyId}.png` | **200/200** | ~158×158, ~44 KB | none needed |
| f) **Bond icons: the real autochess ones** | AA2 `ui/autochess/[uc]autochesscommon/arts/bondicon/` | `{iconId.toLowerCase()}.png`, e.g. `icon_yanship.png` | **23/23** | ~110×98 white glyph, ~4 KB | `arts/camplogo/logo_{nation}.png` (see §4) |
| g) **Item / trap icons: the real autochess ones** | AA2 `…/arts/shopitemicon/` | `{trapId}.png` | **59/59** (56 EQUIP + 3 MAGIC) | ~137×157, ~19 KB | none needed |
| g') Band (strategy) icons | AA2 `…/arts/bandicon/` | `icon_{bandId minus "band_"}.png` | **40/40** | 180×180, ~69 KB | — |
| h) Map tiles | **none usable**: the game map is a 3D Unity scene | — | — | — | **Draw tiles procedurally** (§7). Use real autochess backdrops for the lobby and prep screens. |
| i) UI: rarity, elite, chess-level, shop, HUD | AA2 `ui/autochess/…` (537 PNGs) + `arts/rarity_hub`, `elite_hub` | see JSON `autochessUi`, `arts` | 100% | 0.3–250 KB | CSS-drawn panels (Unity 9-slice borders are not in the dump) |
| j) Fonts | Google Fonts + self-hosted Bender / Novecento | §8 | — | — | system CJK |
| k) BGM + SFX: **the real game audio** | AA2 `@voice` branch `assets/dyn/audio/sound_beta_2/…` | mapped by `audio_data.json` banks | BGM 3/3; per-operator SFX **138/138**; enemies 185/200; autochess UI SFX 47 banks | mp3; BGM ~2 MB, SFX 5–60 KB | WebAudio-synthesized blips (§6.4) |
| l) **Battle Spine (in-battle chibi)** | operators: **fexli/ArknightsResource `spine/`**; enemies: **isHarryh/Ark-Models `models_enemies/`** | `spine/{id}/{id}/{Front\|Back}/{id}.{skel,atlas,png}`; enemies via `models_data.json` `assetList` | ops Front **138/138**, Back 135/138; enemies **198/200** | median op front+back ≈ 690 KB; enemy ≈ 134 KB | missing Back → mirrored Front; missing enemy → static icon sprite (§5.6) |
| Spine runtime | **PixiJS 7.4.2 + pixi-spine 4.0.6** (UMD from jsDelivr) | — | render checked in headless Chrome | 456 KB + 362 KB | — |

**Size budget, all classes, only what the pool needs**

| | Size |
|---|---|
| Raw | ≈ 200 MB (≈ 700 MB if full art is included, so leave full art out of the bundle) |
| After build-time optimization | **≈ 65–75 MB**: WebP for images, gzip/brotli for skel |
| Initial page load (lazy-loading Spine per board) | **< 6 MB** |

---

## 1. Id inventory (from `act2autochess`)

| Set | Count | Notes |
|---|---|---|
| Operators (`charShopChessDatas[*].charId ∪ backupCharId`) | **138 unique charIds** over 133 chess | 74 PRESET, 55 NORMAL, 4 DIY. DIY chess have `charId=null`, so the operator is chosen at runtime and uses the chosen operator's assets. Chess levels 1–6: 20/19/21/26/25/22. |
| Most chess are `evolvePhase=PHASE_2` | 94 PHASE_2 (+ 39 PHASE_1) non-golden; every golden chess is PHASE_2 | → Prefer **E2 avatar/portrait** (`_2`) and fall back to `_1`. |
| Tokens/summons referenced by pool operators | 20 | `displayTokenDict` and `overrideTokenKey`. Bond summon "炎佑" (Yan 6/9) has no token id in the data, see §5.6. |
| Enemies | **200** | Union of `enemyInfoDict`, `specialEnemyInfoDict`, `bossInfoDict`-linked ids and level files. All 200 are in `enemy_handbook_table`. |
| Bonds | 23 | `bondInfoDict[*].iconId`: `icon_yanShip` … `icon_suntShip` |
| Shop items | 59 | `trapShopChessDatas[*].trapId` = `trap_10xx_acarmNNN` and friends |
| Bands (strategies) | 40 | `bandDataListDict` keys `band_*` |
| Sub-professions in pool | 58 | e.g. `fastshot`, `protector`, `ritualist`, `primprotector`, `counsellor`, `hunter`… |
| Nations in pool | 18 + None | bolivar, columbia, egir, higashi, iberia, kazimierz, kjerag, laterano, leithanien, lungmen, rhodes, rim, sami, sargon, siracusa, ursus, victoria, yan |

Newest operators in the pool, all verified present in every class: `char_4211_snhunt` 雪猎, `char_4207_branch` 折桠, `char_4196_reckpr` 录武官, `char_4194_rmixer` 信仰搅拌机, `char_4193_lemuen` 蕾缪安, `char_4191_tippi` 蒂比, `char_1047_halo2` 溯光星源, `char_1046_sbell2` 圣聆初雪, `char_1045_svash2` 凛御银灰, and the activity-only `char_616_pithst` 盟约·辅助干员 and `char_617_sharp2` 领主·Sharp.

---

## 2. Sources evaluated

| Repo | Branch | Updated | What it has | Verdict |
|---|---|---|---|---|
| `yuanyan3060/ArknightsGameResource` | `main` | 2026-09-24 | avatar (incl. `token_*`, non-autochess `trap_*`), portrait, skin (full art `b`), skill, enemy, item, item_rarity_img, map (not autochess) | **Primary for 2D portraits and icons.** AGPL-3.0 applies to its code; the art is © Hypergryph. |
| `ArknightsAssets/ArknightsAssets2` | `cn` (art), `voice` (all audio) | 2026-09-23 | Full ArknightsStudio dump: `assets/dyn/ui/autochess/**` (real autochess UI), `activity/[uc]act2autochess/**`, `arts/**` (camplogo, profession, rarity, elite, subprofession, loading illustrations), `battle/[pack]common/**`, and all audio under `@voice` | **Primary for autochess-specific icons, UI and ALL audio.** Battle spine here is incomplete: atlas/skel without PNGs. |
| `fexli/ArknightsResource` | `main` | 2026-09-20 | `spine/{charId}/{charId}/{Front,Back}/` battle models + base (`build_*`) models + skins; `camplogo`, `charpor`, `skills`… | **Primary for operator battle Spine** |
| `isHarryh/Ark-Models` | `main` | 2026-08-02 | `models_enemies/` enemy battle Spine (PC build, PMA forced), `models/` base (基建) chibis only, `models_illust/` dynamic illustrations; `models_data.json` index | **Primary for enemy battle Spine.** Its operator models are base chibis, not battle chibis. |
| `Aceship/Arknight-Images` | `main` | **2024-05** (stale) | avatars etc. | Hit rate **89/138**. It lacks every 2024+ operator. Not recommended. |
| PRTS `media.prts.wiki/{md5[0]}/{md5[0:2]}/{文件名}` | — | live | e.g. `头像_德克萨斯.png` returns 200 | Last-resort fallback only: Chinese-name keyed, and hotlinking is discouraged. `torappu.prts.wiki` timed out from this host. |
| `web.hycdn.cn` (official CDN) | — | — | guessed avatar path → 404 | not usable |
| `TimWangZi/The-font-of-Arknights` | `master` | — | Bender, Novecento Wide, 思源宋体 | font source (§8) |

**CDN behaviour, all checked**
- `raw.githubusercontent.com` returns `access-control-allow-origin: *` with `cache-control: max-age=300`.
- `cdn.jsdelivr.net/gh/<repo>@<branch>/…` works with CORS `*` and a 7-day cache for yuanyan, fexli, Ark-Models and AA2 `@cn`.
- **jsDelivr returns 404 for the AA2 `@voice` branch.** Use raw for audio.
- Do **not** hotlink at runtime (GitHub rate limits, availability, and it is impolite). **Mirror at build time** (§9).

**Path gotchas**
- `[uc]` → `%5Buc%5D` and `[pack]` → `%5Bpack%5D`.
- Skill icons such as `skill_icon_skcom_atk_up[1].png` need `%5B1%5D`. curl's globbing also breaks on unencoded brackets.
- Skin ids contain `#` → `%23`. Skins are not needed.
- Bond `iconId` is camelCase in data (`icon_yanShip`) but **lower-case on disk** (`icon_yanship.png`).
- Band icon = `icon_` + bandId minus `band_`.
- Liskarm's default battle model lives at `spine/char_107_liskam/char_107_liskarm/…`, a dump-side typo.
- `char_1012_skadi2` has a single `Spine/` folder instead of `Front/` and `Back/`.
- Enemy spine filenames can differ from the folder name: `1043_zomsbr/enemy_1043_zomsabr.*`, `1169_duphlx/enemy_1169_duphx.*`. **Always use `models_data.json → data[key].assetList`.** `07-assets.json` already resolves this.

---

## 3. 2D portraits and icons (classes a–e, i)

### a) Avatars
- URL: `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/{charId}.png`
  - E2 variant: `{charId}_2.png`.
  - Mirror: `https://cdn.jsdelivr.net/gh/yuanyan3060/ArknightsGameResource@main/avatar/…`.
- Checked by curling all 138 charIds (xargs -P16): **138/138** 200. E2 variant: 122/138.
- The 16 without E2 are `char_600_cpione, 601_cguard, 602_cdfend, 603_csnipe, 604_ccast, 605_cmedic, 606_csuppo, 607_cspec, 608_acpion, 609_acguad, 610_acfend, 611_acnipe, 612_accast, 613_acmedc, 614_acsupo, 615_acspec`. They have no E2 art in-game, so use the base image.
- Size 180×180 RGBA, avg 58 KB (8.4 MB for the set, preferring E2). WebP q88 comes to about 15 KB each.
- Tokens: `avatar/{tokenId}.png` hits **15/20**.
  - Missing: `token_10012_rosmon_shield`, `token_10039_ulpia_block`, `token_10040_siege2_vlion`, `token_10057_svash2_eagle`, `token_10058_sbell2_icetgt`.
  - Fallback: owner operator avatar with a small "召唤物" badge, or the battlecard `icon_profession_token.png`.

### b) Portraits
- `…/portrait/{charId}_1.png` (E2 `_2.png`), 180×360 半身像 (the squad-card crop used on shop cards). **138/138**; E2 122/138. Avg 117 KB, about 31 KB as WebP q88.
- Full art `…/skin/{charId}_1b.png` is 681×1317, avg 787 KB; E2 `_2b` averages 3.2 MB. Use it only in the operator detail modal, lazy-loaded. Keep it out of the bundle; fetch on demand from jsDelivr.

### c) Skill icons
- `…/skill/skill_icon_{iconId}.png`, where `iconId = skill_table[skillId].iconId ?? skillId`. **317/317** (every skill of every pool operator, after percent-encoding brackets). 128×128, avg 19 KB.
- The shop only shows the chess's default skill (`defaultSkillIndex`), which is 144 distinct icons (≈ 2.7 MB raw).

### d) Profession and sub-profession
- `https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn/arts/profession_hub/icon_{caster|medic|pioneer|sniper|special|support|tank|warrior}.png`
  - Large white variant: `profession_large_hub/icon_profession_{p}_large_white.png`.
  - Small battle-card variant: `arts/ui/[uc]battlecommon/ui_battle_new/battlecard/icon_profession_{p}.png`, which also includes `…_token.png`.
- Sub-profession: `…/arts/ui/subprofessionicon/sub_{subProfessionId}_icon.png`. **58/58**, ~2 KB white glyphs.

### e) Enemies
- `…yuanyan…/enemy/{enemyId}.png`, **200/200**, avg 44 KB.
- The boss HP-bar portrait style exists as `arts/ui/[uc]battlecommon/ui_battle_new/enemybossinfo/…` for only a few bosses. Use the enemy icon inside `sprite_enemy_boss_avatar_bg.png`.

### i) Rarity, elite and misc UI (all 200)
- Rarity stars: `arts/rarity_hub/rarity_{0..5}.png`, plus `rarity_yellow_{i}`, `rarity_black_{i}` and `rarity_left_{i}`.
  - Autochess-specific: `ui/autochess/[uc]autochessouter/arts/charraritysprite/rarity_{0..5}.png`.
- Elite icons: `arts/elite_hub/elite_{0..3}.png`, `_large`, `_card`.
  - Autochess `eliteIconId` values (`shopCharChessInfoData[*].eliteIconId`) map to `…/[uc]autochessouter/arts/charelitesprite/{char_elite_base_1|char_elite_base_2|char_elite_gold_2}.png`. Also available: `char_elite_detail_*`.
- Chess tier (等阶 1–6): `…/chesslevelsprite/chess_level_icon_{0..6}.png`, `chess_level_detail_{0..6}.png`.
  - Shop card: `…/autochess_shop_card_item/img_chess_level_{1..6}.png`, `frame_lv{1..3}.png`, `bg_common.png`, `ice_matte.png` (frozen), `icon_ice.png`.
- Shop level (调度中心): `…/shoplevelsprite/shop_level_icon_{1..6}.png`, `shop_level_tag_{1..6}.png` (150×595 vertical banners). Tag bg colours in data: `#434343, #626654, #445760, #615B74, #6C5E41, #5d341e`.
- Garrison (特质) type icons: `…/garrisontypeicon/{icon_battle|icon_bond|icon_gold|icon_support}.png`, plus `s_` small versions. These match `garrisonDataDict[*].eventTypeIcon`.
- Mode icons `mode_{normal|hard|abyss|funny|training}_icon.png`. Buff icons `icon_{boss_debuff|enemy_debuff|player_buff|stage_buff|team_buff}.png`, matching `effectDecoIconId`.
- Title icons `comment_icon_{1..6}.png` (playerTitle `picId`). Trophies `trophy_level{1..5}_icon.png`. Enemy-type icons `{fly|times|dot|element|invisible|reflection|special}_icon.png`, matching `enemyInfoDict` keys.
- Bond board pips: `…/[uc]autochessbattle/arts/bondboardicon/{n}_{k}.png` (1_0 … 4_4).
- HUD: `…/hud/autochess_hud_panel/*.png` (55 files: `icon_hp`, `icon_battle`, `icon_boss`, `icon_coop`, `icon_rest`, `hp_bar`, `bg_*`…).
- Shop: `…/shop/autochess_shop/*.png` (`refresh_icon`, `frozen_icon`, `upgrade_max`, `bg_money`, `cost_free`…).
- Equip slot: `…/act2autochess_equip_slot_panel/*.png`. Round banner: `…/dialog/round_start_dialog/*.png`.
- Loading illustrations (1920-class, ~0.9 MB each): `arts/loadingillusts/loading_ac_{core|normal|hard|abyss|funny|prototype|train|training}.png`.
  - `modeDataDict.loadingPicId` values such as `loading_AC_core` → lower-case the id.
- Lobby / backdrop art:
  - `activity/[uc]act2autochess/prefabs/act2autochess_activity_stage/{entry_bkg_01,entry_bkg_02,bkg_01,bkg_02,bg_mountains_tiled,season_logo,img_coin}.png`.
  - Mode select: `ui/autochess/[uc]autochessouter/modechoice/auto_chess_mode_choice_state/{normal,hard,abyss,funny}_rhodes_island.png`.
  - Battle ready: `…/battleready/auto_chess_battle_ready_state/{bg_mountain1,bg_mountain2,bg_terrain,rhodes}.png`.
- Battle common sprites: `battle/[pack]common/sprites/{sprite_shadow,sprite_direction_arrow,sprite_direction_ring,sprite_box_shadow}.png` and `…/projectiles/projectile_arrow.png`.
  - Battle UI: `arts/ui/[uc]battlecommon/ui_battle_new/{btn_speed_1x,btn_speed_2x,btn_pause,slider_hp_back,slider_hp_fill,sprite_skill_ready…}.png`.
- Caveat: Unity sprite 9-slice borders are not in the dump. Use the art for icons, badges and backdrops, and draw frames and panels in CSS or canvas.

---

## 4. Bond icons (f): the real ones are available

`https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn/ui/autochess/%5Buc%5Dautochesscommon/arts/bondicon/{iconId lowercased}.png`
All 23 are verified: white glyphs on transparent, so tint via CSS `filter` or canvas `globalCompositeOperation='source-in'`. Nation fallbacks come from `arts/camplogo/logo_{id}.png` (44 logos, 20–110 KB). The non-nation fallbacks below are [ASSUMED] suggestions.

| bondId | Name | Real icon file | Bytes | Fallback |
|---|---|---|---|---|
| yanShip | 炎 | `icon_yanship.png` | 5466 | camplogo/logo_yan.png |
| sargonShip | 萨尔贡 | `icon_sargonship.png` | 2845 | camplogo/logo_sargon.png |
| victoriaShip | 维多利亚 | `icon_victoriaship.png` | 4267 | camplogo/logo_victoria.png |
| kjeragShip | 谢拉格 | `icon_kjeragship.png` | 5255 | camplogo/logo_kjerag.png |
| lateranoShip | 拉特兰 | `icon_lateranoship.png` | 4725 | camplogo/logo_laterano.png |
| egirShip | 阿戈尔 | `icon_egirship.png` | 4715 | camplogo/logo_egir.png |
| siracusaShip | 叙拉古 | `icon_siracusaship.png` | 6956 | camplogo/logo_siracusa.png |
| kazimierzShip | 卡西米尔 | `icon_kazimierzship.png` | 4288 | camplogo/logo_kazimierz.png |
| preciShip | 精准 | `icon_preciship.png` | 4872 | sub_fastshot_icon |
| swiftShip | 迅捷 | `icon_swiftship.png` | 3675 | icon_profession_pioneer |
| skillfulShip | 灵巧 | `icon_skillfulship.png` | 4166 | sub_executor_icon |
| arcaneShip | 奥术 | `icon_arcaneship.png` | 4114 | icon_profession_caster |
| steadShip | 坚守 | `icon_steadship.png` | 2702 | icon_profession_tank |
| deputShip | 助力 | `icon_deputship.png` | 3726 | icon_profession_support |
| visiShip | 远见 | `icon_visiship.png` | 3451 | garrisontypeicon/icon_gold |
| miraShip | 奇迹 | `icon_miraship.png` | 4945 | garrisontypeicon/icon_gold (tinted) |
| investShip | 投资人 | `icon_investship.png` | 2058 | garrisontypeicon/icon_gold |
| raidShip | 突袭 | `icon_raidship.png` | 2982 | sub_executor_icon |
| indomShip | 不屈 | `icon_indomship.png` | 3439 | sub_unyield_icon |
| maniShip | 调和 | `icon_maniship.png` | 3124 | garrisontypeicon/icon_bond |
| emptyShip | 协防干员 | `icon_emptyship.png` | 2762 | battlecard icon_profession_token |
| soloShip | 独行 | `icon_soloship.png` | 2169 | sub_lord_icon |
| suntShip | 绝技 | `icon_suntship.png` | 3366 | elite_hub/elite_2.png |

Band / strategy icons (g'): `…/[uc]autochesscommon/arts/bandicon/icon_{bldsk|amiya|duyaoy|sarkazb|orchid|justin|ermengard|lmlee|kirara|pepe|harold|sciurus|paganini|clementia|emperor|mberry|humus|quintus|yu|doberm|cathy|malkie|qalaisa|chen|damaztic|pith|dusk|cannot|ducklord|lisa|vodfox|ioleta|jesica|mlyss|makiri|fang|mlynar|chiave|narant|amedic}.png`. All **40/40** are 180×180 "STRATEGY" cards, ~69 KB each.

## 5. Items / traps (g)
`…/[uc]autochesscommon/arts/shopitemicon/{trapId}.png`, **59/59**, ~137×157 on a transparent background, avg 19 KB, e.g. `trap_1041_acarm041` 维式重锤.
- The 3 non-shop special traps are effect ids with no icons: `trap_copy_front_char`, `trap_create_self_choice`, `trap_disney_special`. Use the icon of the item that grants them.
- Rarity backgrounds for item frames: yuanyan `item_rarity_img/sprite_item_r{1..6}.png`.
- Level-placed traps (`trap_1104_aclasert`, `trap_1105_accrate`, `trap_1112_acblzd`, `trap_098_mire`, `trap_013_blower`, `trap_042_tidectrl`) have no autochess icon. Draw them as tile overlays.

---

## 5b. Battle Spine (l): the real in-battle animated chibis

### 5.1 Sources and verification
- **Operators (fexli):** `https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/{charId}/{charId}/{Front|Back}/{charId}.{skel|atlas|png}`
  - jsDelivr: `https://cdn.jsdelivr.net/gh/fexli/ArknightsResource@main/spine/…`.
  - **Front 138/138. Back 135/138**: missing for `char_4134_cetsyr` 魔王, `char_291_aglina` 安洁莉娜 and `char_1012_skadi2` 浊心斯卡蒂. Skadi2 has one model in a `Spine/` folder. These are supporters that are often shown only from the front.
  - One texture page per model.
- **Enemies (Ark-Models):** `https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models_enemies/{enemyId minus "enemy_"}/{assetList[.skel|.atlas|.png]}`. **198/200.**
  - Missing: `enemy_1305_mhslim(_2)`. AA2 has its atlas and skel but not its PNG.
- **Sample downloaded:** `char_102_texas` Front and Back plus `enemy_1007_slime` → `…/scratchpad/gd/extra/assets/spine_sample/`.
  - Texas Front: skel 187,826 B, atlas 4,903 B, png 65,126 B (512×512).
  - Texas Back: 73,065 / 3,346 / 47,290 B (256×256).
  - Slime: 16,567 / 552 / 11,659 B (128×128).
- **Skel header:** read with a varint-string parser, and again with the pixi-spine 3.8 `SkeletonBinary` in Node. Every sampled file reports **version `3.8.99`**: 11 operators and 5 enemies.
- **Browser proof:** headless Chrome rendered Texas Front (Attack_Loop), Texas Back, 雪猎 Front and enemy “自在” (`enemy_1517_xi`, boss) with PixiJS 7.4.2 and pixi-spine 4.0.6 loaded **directly from jsDelivr**, with no errors. Screenshot: `…/scratchpad/gd/extra/assets/spine_test.png`.

### 5.2 Sizes

| Set | Raw | Optimized (skel+atlas gzip ≈ 24%, PNG → lossless WebP ≈ 50%) |
|---|---|---|
| Operators Front (138) | skel 44.3 + png 20.6 + atlas 1.2 = 66 MB | — |
| Operators Back (135) | skel 24.6 + png 16.7 + atlas 0.8 = 42 MB | — |
| **Operators total** | **108 MB**; median op 690 KB; max `char_427_vigil` 3.1 MB | **≈ 36 MB** |
| **Enemies (198)** | skel 14.9 + png 11.1 + atlas 0.5 = **26.6 MB**; avg 134 KB | **≈ 9 MB** |

Gzip measurements: texas skel 188 KB → 46 KB; snhunt 659 KB → 122 KB; ghost2 933 KB → 184 KB. A texas 512² PNG goes from 65 KB to 31 KB as lossless WebP.
**Estimate for 133 ops + 60 enemies on one server: about 110 MB raw, about 38 MB served.** A client only downloads the models on its board or in its shop, typically 10–25 models = 5–15 MB.

### 5.3 Runtime: use pixi-spine, not official spine-ts 3.8
- CDN:
  - `https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js` (456 KB)
  - `https://cdn.jsdelivr.net/npm/pixi-spine@4.0.6/dist/pixi-spine.js` (362 KB, UMD → `PIXI.spine`, auto-detects 3.7/3.8/4.0/4.1)
  - Or `@pixi-spine/all-3.8@4.0.6/dist/pixi-spine-3.8.js` (148 KB) for a 3.8-only build.
  - npm: `pixi.js@7`, `pixi-spine@4.0.6`. pixi-spine 4 needs PixiJS **7**, not 8.
- Load with `PIXI.Assets.load(url.skel)`. The `.atlas` and `.png` must sit next to it with the same basename. Then `new PIXI.spine.Spine(res.spineData)` and `spine.state.setAnimation(0, name, loop)`.
- **Why not official spine-ts 3.8** (`cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@3.8/spine-ts/build/spine-webgl.js`, reachable):
  1. Its atlas parser only treats `rotate: true|90` as rotated. **Arknights atlases use `rotate: 270`** (seen in ghost2 and ulpia), so those regions render wrong.
  2. The fexli atlases **omit the `size:` line**. pixi-spine falls back to the real texture size; spine-ts 3.8 divides by page width 0.
- Atlas quirks to normalize at build time:
  - Insert `size: W,H` after the page name, read from the PNG.
  - If PNGs are converted to WebP, rename the page line.
- **Alpha:**
  - fexli operator textures are **straight alpha**: a 512² texas texture has 193 pixels with RGB > A, up to 108 over. Load them normally.
  - Ark-Models enemy textures are **premultiplied** (README: "强制启用 PMA"; slime has 1 violation of ≤2). Add a `pma: true` page line to those atlases (pixi-spine honours it and sets `ALPHA_MODES.PMA`), or set `baseTexture.alphaMode = PIXI.ALPHA_MODES.PMA`. Otherwise edges come out dark.
- Licensing note: pixi-spine is MIT, but it embeds Spine Runtime code under the Spine Runtimes License, which technically expects a Spine Editor licence. This is commonly tolerated for non-commercial fan tools, and should be noted in the credits.

### 5.4 Animation names (parsed; the naming varies, so build a resolver)

| Unit | Animations |
|---|---|
| char_103_angel (F) | Attack, Default, Die, Idle, Start |
| char_102_texas (F) | Attack_Start/Loop/End, Default, Die, Idle, Skill, Start. **Back model has no Die, no Skill.** |
| char_172_svrash (F) | Attack, Combat, Combat_Down, Default, Die, Idle, Skill, Start |
| char_350_surtr (F) | Attack, Die, Idle, Skill_2, Skill_2_Down, Skill_3_Begin/Idle/Loop, Start |
| char_2015_dusk (F) | Attack, Die, Idle, Skill2_Begin/Loop/End, Skill3_Attack, Start. No underscore after "Skill". |
| char_4211_snhunt (F) | Attack_Begin/Loop/End, Attack_Down_*, Reload_*, Skill_1, Skill_2_Begin/Loop/End, Skill_Down_*, Die, Idle, Start. Events: `BeastOnAttack`, `OnAttack`, `OnStart`. |
| char_1023_ghost2 (F) | Attack, Attack_Down, Die, Die_B, Idle, Idle_B, Skill_1, Skill_3_*, Start, Start_B… |
| char_4134_cetsyr (F) | no Attack; Skill_{1,2,3}_Begin/Loop/End, Idle, Die, Stun, Stun_Begin, Start |
| char_1012_skadi2 (Spine) | no Attack; Skill_{n}_Begin/Loop, Idle, Die, Stun, Start |
| char_600_cpione, char_616_pithst | Attack, Default, Die, Idle, Start |
| enemy_1007_slime | Attack, Default, Die, Idle, Move_Begin/Loop/End |
| enemy_1000_gopro_2 | … + Run_Begin/Loop/End |
| enemy_1502_crowns | Appear, Attack, Die, Disappear, Idle, Move |
| enemy_1517_xi (boss) | Attack_01, Attack_02, Die, Idle, Move, Revive_01, Skill_01, Skill_01_02, Skill_02_Begin/Loop/End. Events: OnAttack, OnPlayAudio. |
| enemy_9009_acfort | Attack, Die, Idle, Move, Skill_1_Begin/Loop/End, Skill_2 |

**Resolver.** Precompute it at build time by parsing every skel in Node with `@pixi-spine/runtime-3.8`; see `spinetest/parse.cjs` in the scratchpad. Emit `anims.json`, then resolve each role in order:
- `idle`: `Idle` → `Default`.
- `deploy`: `Start` (fall back to `Idle`).
- `attack`:
  - `Attack`;
  - else `Attack_Start|Attack_Begin` → `Attack_Loop` → `Attack_End`;
  - else `Combat`;
  - else (pure supporter) `Skill_1_Loop`, or just `Idle` with a flash.
  - Prefer non-`_Down` variants. Use `_Down` when the target is below the unit on screen.
- `skill`, for the chess's default skill index n (1-based):
  - `Skill_{n}_Begin` → `Skill_{n}_Loop` (while active) → `Skill_{n}_End`;
  - else `Skill{n}_Begin/Loop/End`;
  - else `Skill_{n}`;
  - else `Skill`;
  - else fall back to `attack`.
  - During a skill, `Skill_{n}_Idle` replaces `idle` when present.
- `die`: `Die` (if the Back model lacks it, swap to the Front model for the death animation), else fade out over 0.5 s.
- `move` (enemies): `Move_Begin` → `Move_Loop` → `Move_End`; else `Move`; else `Run_Loop`.
- `stun`: `Stun_Begin` → `Stun`, else freeze the current track at `timeScale = 0`.
- **Hit timing:** apply damage and spawn projectiles on the Spine event `OnAttack` (operators and enemies). If no event fires, use 50% of the attack animation. Scale the attack animation's `timeScale` to `animDuration / attackInterval` so it matches the simulated attack speed.

### 5.5 Direction and scale
- **Operators:**
  - Front model when facing right or down.
  - Front mirrored (`scale.x = -1`) when facing left.
  - Back model when facing up; if there is no Back model, use Front.
- **Enemies:** single model; flip x by the sign of horizontal velocity. The model faces right by default. [ASSUMED from standard Arknights behaviour; verify by eye]
- **Scale [ASSUMED]:** skeleton height is ~360–450 units for a standard chibi. Start with `scale = tilePx / 300` so a chibi stands about 1.2 tiles tall, and tune by eye. Anchor at the feet (Spine origin 0,0 is at the feet).
- Put `battle/[pack]common/sprites/sprite_shadow.png` under each unit.

### 5.6 Gaps and fallbacks
- **Tokens/summons:** fexli has the **default** battle Spine for only 1/20 tokens (`token_10000_silent_healrb`); the rest exist only as skin variants (e.g. `…vodfox_doll_witch_2`). AA2 has their atlas and skel but no PNGs.
  - Options, in order of preference:
    1. Use the first skin-variant Spine, listed in `tokens[*].battleSpineSkinVariantsOnly` in the JSON. It looks slightly off-model, but it animates.
    2. Draw the token avatar (15/20) as a circular sprite with a bob tween.
    3. Draw a procedural glyph.
- **"炎佑" (Yan-bond summon), [ASSUMED]:** no token id is in the data. Render it with the `token_10015_dusk_drgn` skin-variant Spine tinted orange-red, or with the Yan bond glyph plus fire particles.
- **enemy_1305_mhslim:** reuse `enemy_1007_slime` Spine with a hue shift, or fall back to the icon sprite.
- **General policy:** if any Spine load fails, render the square avatar or enemy icon in a rarity-coloured diamond with a tween (idle bob, lunge on attack, flash on hit). The game must never block on Spine.

---

## 6. Audio (k): the real audio is available in AA2 `@voice`

Base: `https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/voice/assets/dyn/audio/sound_beta_2/` (CORS `*`; jsDelivr 404s on this branch). The mapping comes from `excel/audio_data.json`, downloaded to `…/extra/assets/audio_data.json`. For an `asset` like `Audio/Sound_Beta_2/CustomSE/act1autochess/act1autochess_b_ui_roundstart`, strip the prefix, lower-case it and append `.mp3`.

### 6.1 BGM (verified)

| Level bgmEvent / context | Files | Size |
|---|---|---|
| act2autochess `m01–m04` use `bgmEvent=act1autochess_shop` → bank `battle.ON_GAME_READY.act1autochess_shop` | `music/act1autochess/m_bat_act1autochess_loop.mp3` | 2.0 MB |
| Lobby: `sys.ON_ACTIVITY_LOADED.act1autochess` | `music/act1autochess/m_sys_act1autochess_intro.mp3`, then loop `m_sys_act1autochess_loop.mp3` | 1.1 + 1.1 MB |
| `h07_05` levels use `bgmEvent=rglk1phantomcastle` | `music/rogue_1/m_bat_rglk1phantomcastle_intro.mp3` + `_loop.mp3` | 1.0 + 1.5 MB |

Play the intro, then crossfade to a looping `AudioBufferSourceNode` (`crossfade: 1.0` s in the bank).

### 6.2 Autochess UI and battle SFX (47 banks, all resolved, in `07-assets.json → audio.autochessSfxBanks`)
Key bank names, which make good event names for our code:
- **Shop:** `ui.ON_ACT1AUTOCHESS_SHOP_UPGRADE`, `…SHOP_LOCK`, `…GETMONEY`.
- **Equipment and bonds:** `battle.ON_ACT1AUTOCHESS_EQUIP_DONE`, `…CHAR_BONUS` (3-merge upgrade), `…EQUIP_BONUS`, `…ADD_BOND` (buffup).
- **Round flow:** `ui.…ROUNDSTART`, `…BATTLESTART`, `…BATTLESTART_BOSS`, `…REST`, `…YOURTURN`, `…YOURTURN_CIRCLE`, `…COUNTDOWN`.
- **Boss rounds:** `…BOSSROUND_{TEAM,SINGLE,SECRET}`, `…KILLBOSS{,_ALL,_NORMAL}`, `…DEFENCE_{START,UNITE}`.
- **End of battle and settlement:** `…BATTLEOVER_{REDUCE,NOREDUCE,NORMAL}`, `…SETTLEMENT_{SUCCEED,FAIL,TEAM,BOSSSIGN}`.
- **Matchmaking and lobby:** `…MATCH_{SUCCEED,FAIL,CANCEL}`, `…PLAYER_{JOINROOM,READY}`, `…STRATEGY`, `…LOAD`, `…START`, `…GOFIRST`, `…DISCONNECT`, `…BROADCASTHINT`, `…ENTER_DANGER`.
- **Other:** `battle.ON_CUSTOM_TRIGGER.autochess_kill_gain_coin`, `battle.ON_ACT1AUTOCHESS_MAGIC_PLACE_BATTLE`.
- Files are under `customse/act1autochess/*.mp3` (46 files, 5–75 KB). Generic sounds: `battle/b_char/b_char_set.mp3` (deploy), `battle/b_enemy/b_enemy_dead_{n,h}.mp3`, `battle/b_ui/b_ui_{win,lose}.mp3`, `general/g_ui/g_ui_btn_{h,u}.mp3`, `g_ui_confirm_h.mp3`.

### 6.3 Per-unit combat SFX (exact, from the data)
Banks are keyed by unit id:
- `battle.ON_ABILITY_START.{charId}.attack` (swing or fire)
- `battle.ON_ABILITY_HIT.{charId}.attack` (impact)
- `battle.ON_UNIT_BORN.{id}`, `battle.ON_UNIT_DEAD.{id}`
- `battle.ON_SKILL_START.{skillId}` (skill activation)

Coverage: **138/138 operators** and **185/200 enemies** have at least one bank; the remaining 15 enemies use a generic `e_atk`/`e_imp` sound. `07-assets.json` lists the resolved URLs per unit (`operators[*].sfx`, `operators[*].skills[*].sfx`, `enemies[*].sfx`).

The pool's needed set is **691 mp3 = 8.7 MB**:
- `player/p_atk`, `p_imp`, `p_skill`: 452 files, 6.8 MB
- `enemy/e_*`: 223 files, 2.6 MB
- `battle/`: 0.9 MB
- `customse/`: 1.3 MB

Pitch-randomize using the bank's `minPitch`/`maxPitch` (typically 0.8–1.2). Respect `maxSoundAllowed`, which caps concurrent instances per bank at 1–2 (`popOldest`). This matters in a 20-unit fight.

### 6.4 Optional and fallback audio
- Voice (optional, off by default): `voice_cn/{charId}/cn_{NNN}.mp3`, about 30 lines and ~1 MB per operator.
  - Useful lines, by the standard charword ids [ASSUMED mapping, confirm with `charword_table.json`]: `cn_021`/`cn_022` 选中干员, `cn_023`/`cn_024` 部署, `cn_025`–`cn_028` 作战中.
  - Japanese voice is under `voice/`.
- **WebAudio synthesis fallback**, used if the fetch fails or the user mutes "game audio":
  - UI click: 1.2 kHz square, 30 ms, exponential decay.
  - Coin: two sines, 1.5→2.2 kHz, 80 ms.
  - Hit: white-noise burst through a band-pass (1–3 kHz), 60 ms.
  - Deploy: low 110 Hz sine thump plus a noise click.
  - BGM fallback: silence or an ambient pad. Do not try to imitate the OST.
- Monster Siren (official streaming, `monster-siren.hypergryph.com/api/songs`) returns JSON but **no CORS headers**, so the browser cannot use it directly. Not recommended.

---

## 7. Map tiles and battle background (h)

- The game data has **no 2D map texture**. Autochess maps are 19×21 tile grids rendered as a 3D Unity scene.
  - The AA2 root PNGs `assets/tile_floor.png`, `tile_road.png` and similar are 64×64 **editor debug placeholders** (green, wood planks). Do not use them.
  - yuanyan `map/` previews do not include autochess stages.
- act2autochess level tile keys: `tile_road`, `tile_floor`, `tile_wall`, `tile_forbidden`, `tile_fence_bound`, `tile_start`, `tile_end`, `tile_telin`, `tile_telout`, **`tile_achand`** (autochess bench/hand area), `tile_mire` (m02), `tile_smog` (m03), `tile_deepsea` (m04).
  - `heightType` is LOWLAND or HIGHLAND; `buildableType` is ALL, MELEE, RANGED or NONE.
- **Procedural tile renderer, in the Arknights look [ASSUMED palette, tune by eye]:**
  - Oblique top-down view; each tile is an inset square with a 1 px lighter top edge and a darker bottom bevel.
  - LOWLAND road `#3b4048` with subtle 45° noise. Deployable lowland gets a faint blue-grey outline `#6f8aa3` at 40% when a melee chess is dragged.
  - HIGHLAND (`tile_wall`) is a raised block: top `#6b7280`, side face `#3a3f47` 10 px tall, with a white 1 px top rim.
  - `tile_forbidden`: `#22262c` with a diagonal hatch. `tile_fence_bound`: dark plus a yellow-black edge stripe.
  - `tile_start` (enemy spawn): red `#d0453b` pulsing frame with an arrow glyph. `tile_end` (protection point): blue `#2d7fd6` with a house glyph.
  - `tile_telin`/`telout`: purple ring. `tile_mire`: murky green overlay. `tile_smog`: animated grey fog alpha. `tile_deepsea`: teal wave overlay.
  - `tile_achand`: bench slots with a dashed outline.
  - Attack-range preview: `arts/ui/[uc]battlecommon/ui_battle_new/attack_range_attack.png` and `attack_range_stand.png`, or draw orange `#ff9c33` squares at 35% alpha.
- **Backdrop:** a dark gradient `#15171b → #262a31`, with `bg_mountains_tiled.png` (act2 entry, 112 KB) parallaxed at 20% opacity. Lobby: `entry_bkg_01.png` (0.99 MB) and `season_logo.png`.

---

## 8. Fonts (j)

| Use | Font | Source | Size |
|---|---|---|---|
| Chinese UI and body | **Noto Sans SC** 400/500/700/900 (思源黑体) | Google Fonts, `fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&display=swap` (200); npm `@fontsource/noto-sans-sc@5` | sliced unicode-range, ~50–100 KB per used slice |
| Chinese titles (formal, serif as in-game) | Noto Serif SC 600/900 (思源宋体) | Google Fonts (200) | same |
| Numbers, HUD, costs, timers (in-game **Bender**) | **Bender** (Jovanny Lemonad, free incl. commercial) | `https://raw.githubusercontent.com/TimWangZi/The-font-of-Arknights/master/font/Bender/BENDER.OTF` (200, 52 KB); also Light and Thin. Convert to woff2 and self-host. | 52 KB |
| English headers (in-game **Novecento Wide**) | Novecento Sans Wide Normal | same repo, `font/Novecento-Wide-Normal-2.otf` (200, 45 KB); self-host | 45 KB |
| Google-only fallbacks for Bender / Novecento | **Rajdhani** 600/700; **Saira Condensed** 500/700; Barlow Condensed; Teko; Oswald; Chakra Petch | Google Fonts, all 200 | — |

Recommended CSS stacks:
- Numerals and English UI: `font-family: Bender, Rajdhani, 'Noto Sans SC', sans-serif`.
- Headlines: `'Novecento Wide', 'Saira Condensed', 'Noto Sans SC'`.

Avoid redistributing Georgia and Times New Roman (Microsoft fonts) from that repo. The 11 MB 思源宋体 OTFs are unnecessary because Google Fonts serves them subset.

---

## 9. Build and delivery plan (recommended)

1. **Keep assets out of git.** Add `client/public/assets/` to `.gitignore`.
2. Write `scripts/fetch-assets.mjs`. It reads `docs/research/07-assets.json` and downloads, with concurrency of about 16, retry ×3 and a jsDelivr mirror when raw fails:
   - `assets/char/avatar/{charId}.webp`, choosing E2 if present, else base.
   - `assets/char/portrait/{charId}.webp`.
   - `assets/skill/{iconId}.webp`.
   - `assets/enemy/icon/{enemyId}.webp`.
   - `assets/ui/…`, `assets/bond/{bondId}.png`, `assets/item/{trapId}.webp`, `assets/band/{bandId}.webp`.
   - `assets/spine/op/{charId}/{front|back}/{charId}.{skel,atlas,webp}` and `assets/spine/enemy/{enemyId}/…`.
   - `assets/audio/{bgm|sfx}/…mp3`.
   - Full art is not downloaded; fetch it lazily from jsDelivr at runtime.
3. **Post-process:**
   - Icons and portraits → WebP q88. Spine textures → **lossless WebP**, then rewrite the atlas page line.
   - Inject `size:` into fexli atlases and `pma: true` into Ark-Models atlases.
   - Normalize every filename to lowercase ASCII.
   - Precompute `anims.json` (animation list + resolver result per model) and `sfx.json` (per unit: attack start and hit URLs, skill start, die).
   - Serve `.skel` and `.atlas` with gzip or brotli via Node `compression`.
4. **Runtime loading:**
   - Preload UI, icons, avatars and portraits: about 6 MB.
   - Load Spine on demand when a chess enters the shop, bench or board, or when an enemy wave is announced. Cache with `PIXI.Assets` and an LRU of about 60 models.
   - Show the avatar-sprite fallback until the Spine loads.
5. **Budgets after optimization:**

   | Asset group | Size |
   |---|---|
   | Avatars | ~2 MB |
   | Portraits | ~4 MB |
   | Default-skill icons | ~0.8 MB |
   | Enemy icons | ~2 MB |
   | Bonds, items, bands, UI subset | ~4 MB |
   | Loading illustrations | ~2 MB |
   | Op Spine | ~36 MB |
   | Enemy Spine | ~9 MB |
   | Audio (BGM + SFX) | ~15 MB |
   | **Total on the server** | **≈ 75 MB** |
   | Per client (typical session) | ≈ 20–30 MB |

## 10. Licensing note

- All images, Spine models and audio are **© Hypergryph (上海鹰角网络); overseas publisher Yostar**.
- Every mirror repo states this: fexli "All files … copyrighted by Hypergryph … solely for educational and research purposes", and Ark-Models "不得用于商业用途".
- No official permissive fan-game policy was found. Hypergryph and Yostar do enforce copyright.
- Therefore:
  - Non-commercial only; no ads, donations or paywall.
  - Show a credits screen: "Arknights © Hypergryph / Yostar. This is an unofficial fan project; all game assets belong to their owners."
  - Keep it private or small-group, and remove on request.
  - Do not redistribute bulk asset archives; fetch at deploy time.
  - Also credit the asset dumpers and tooling: yuanyan3060, fexli/ArkResourceAutoUpdateBot, isHarryh/ArkUnpacker, ArknightsAssets/ArknightsStudio, Kengxxiao/ArknightsGameData, pixi-spine (MIT) and the Spine Runtimes License.
- Fonts: Noto (SIL OFL); Bender (free by author); Novecento Sans (free licence by Synthview).

## 11. Open questions and [ASSUMED] items

1. **Token spines:** only 1 of 20 defaults is available (§5.6). Approve the skin-variant or avatar fallback.
2. **炎佑 summon visual** [ASSUMED]: the data has no dedicated model.
3. **Tile palette and 3D look** [ASSUMED]: procedural. Tune against in-game screenshots (PRTS map pages or bwiki screenshots of 卫戍协议).
4. **Spine scale** `tilePx/300` and enemy default facing [ASSUMED]: verify visually during build.
5. **PMA** for Ark-Models enemy textures: add `pma: true`, then check visually for dark halos. The test render looked acceptable even without it.
6. Voice line index mapping (`cn_021`–`cn_028`) [ASSUMED]: confirm against `charword_table.json` if voices get enabled.
7. The Unity 9-slice metadata for UI panels is not in the dump, so panels are drawn in CSS. Only icons and backdrops use the real sprites.

---

## Addendum (critic)

Written 2026-09-27 by the completeness critic.

- **Spot check.** 40 URLs were sampled at random from the 4,469 unique URLs in `07-assets.json`: avatars, enemy skel, audio on `@voice`, and others. Each got a `curl -I` on 2026-09-27. **Result: 40/40 returned `200`.** The URL patterns in §0 hold.
- **UI reference captured** for the designer. It is not to be shipped: it is official art and layout.
  - The official gameplay-intro long image, 800×13685, sliced into `scratchpad/gd/extra/critic/intro_00..09.jpg`.
  - 11 in-game screenshots (`*.jpg` in the same folder): prep with shop at R1/R2/R3, briefing, strategy draft, the three 机变 families, 联防, Final Assault, and the banned-operator dropdown.
  - They confirm these layout facts:
    - bottom shop bar: LEVEL card | operator cards | item card | funds card;
    - freeze and refresh buttons above the bar;
    - "剩余可放置角色" label;
    - 3×2 机变 grid;
    - bond strip with layer numbers under the discs;
    - `‹ 自己 ›` / `‹ 全景 ›` view switcher.
- **Icons that are also needed:**
  - Disabled-bond badge: the person-✕ glyph on greyed bond discs.
  - "层数叠加已禁用" state of the bond strip.
  - Price-0 reward card.
  - Candidates are in the AA2 `ui/autochess/…` groups already listed in §3 i). If none match, draw them in CSS or SVG.
