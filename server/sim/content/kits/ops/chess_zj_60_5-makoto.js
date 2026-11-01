// server/sim/content/kits/ops/chess_zj_60_5-makoto.js — 结城理 (char_4217_makoto) kit, 炸惊模拟 chess_zj_60_5_a.
// Kit contract and rules: ../README.md; the file-level helpers of this kit: ../shared/mod-tier3.js.
//
// PORT NOTE (0.3.1-mod.4 → 0.3.3): semantic port of the pack's `ops/op-makoto.js` (756 lines; the pack registered it under
// the charId through its own MOD_KIT_KEYS). This repository resolves the default data by CHESS id only, so the key is
// `chess_zj_60_5_a` — see kits/index.js ZHAJING_KIT_FILES. Record facts the kit reads: tier 5, SPECIAL / dollkeeper, MELEE,
// ATK 785, HP 2805, BAT 1.2, default skill S3 (skchr_makoto_3), T0 不羁之力 (atk 0.8 / base_attack_time 0.4 / max_hp_t1
// 0.35 / sluggish 8), T1 S.E.E.S.队长 (atk_scale 4.3), both talents' rangeGrid = x-1 (13 tiles).
//
// ADAPTATIONS to 0.3.3 (beyond the import paths):
//   * The two 人格面具 are DISPLAY-ONLY here: data/tokens.json carries no `token_makoto_*` record and tokens.js TOKEN_IDS
//     has no such key, so `maskToken()` returns the pack's token ids as literals — the sim only emits them in a 'summon' fx.
//   * The pack's temporary `process.stderr` diagnostic block is removed (/sim/ also runs in browsers: no `process`).
//   * The header paragraphs below are the pack's own documentation of the mechanics, kept verbatim on purpose.
import { bodyInKeys } from '../../../body.js';
import { weaknessRetype } from '../../items/battle.js';
import {
  MASK_SWITCH, NINE, altSkills, copyGrid, defOf, enemiesOn, fx, gridKeys, num, onTiles, selectedId, skillData, talentBb, traitBb,
} from '../shared/mod-tier3.js';
/**
 * 结城理's two bond queries, local to this file: a kit may not import `content/support/index.js` (an `index.js` module —
 * `test/content/kits_layout.test.js` refuses it for the import cycle it could create, and no other kit does). Both read the
 * same live battle state the support module exposes:
 *   * layers: `support.bondLayers` = `battle.getPlayer(pid).bonds[bondId].layers`;
 *   * member: `support.isMember` for a bond the operator does not carry itself is false except for 调和 (maniShip)
 *     substitution and the two 惊变 cross-module rules — 【S.E.E.S】 is neither a 核心盟约 nor a 惊变 rule, so the local
 *     version is exact here: the unit's own bonds (the kit counts a 「"S.E.E.S"袖章」 wearer separately).
 */
const bondLayers = (battle, pid, bondId) => Math.max(0, num(battle.getPlayer?.(pid)?.bonds?.[bondId]?.layers, 0));
const isMember = (battle, u, bondId) => {
  const own = u?.def?.raw?.bonds ?? u?.def?.bonds ?? [];
  return Array.isArray(own) && own.includes(bondId);
};

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 结城理 (dollkeeper, 阶 III) — 不羁之力's <替身> state carries one of his two 人格面具, the one the state was entered
  // with: 俄耳甫斯 (S1, ranged) / 塔纳托斯 (S2 / S3, melee). The mask is the skill's own state: the kit re-picks it at
  // every cast and drops it with the skill (spec `onStart` / `onEnd`). The <替身> state itself (duration 20, blockCnt 0,
  // its HP) is the dollkeeper profession's — 不羁之力 adds ATK +atk and 攻击间隔增大 +base_attack_time while a mask runs.
  //   The mod's DEFAULT skill in the data is S2 (o.skill = skchr_makoto_2, like every 卫戍 chess), so `skill` below is
  //   S2's spec and S1 / S3 are authored as `skills` alts — each built from its OWN blackboard.
  //   S1 俄耳甫斯的竖琴 (alt): the mask attacks with arts damage (attack@atk_scale), and an ally below half HP in range
  //   is healed attack@heal_scale × ATK instead (PRTS 被动 text).
  //   S2 塔纳托斯的囚锁 (default): up to attack@max_target enemies of the mask's range take attack@atk_scale × ATK arts,
  //   each with attack@prob to be feared attack@fear s; a feared enemy below attack@kill_atk_scale × ATK is knocked out
  //   (attack@kill_damage true damage).
  //   S3 开辟明日的剑刃 (alt, ammo attack@trigger_time): 塔纳托斯, ASPD +talent@attack_speed, up to attack@max_target
  //   enemies take attack@atk_scale × ATK arts + the 1-tile splash of the same scale, nearby allies dodge attack@prob of
  //   a phys/arts hit, and up to attack@max_target_heal allies in range are healed attack@heal_scale × ATK per second.
  //   [ASSUMED / not in this kit] the masks as separate board pieces (their own attacks, 总攻击 of S.E.E.S.队长), the S3
  //   弱点伤害 conversion (its own damage type is not broken out by the data) and the "塔纳托斯在场时改为召唤俄耳甫斯" swap.
  // ---------------------------------------------------------------------------------------------------------------
  // 结城理 (dollkeeper, 阶 III) — 不羁之力's <替身> state carries one of his two 人格面具, the one the state was entered
  // with: 俄耳甫斯 (S1, ranged) / 塔纳托斯 (S2 / S3, melee). The mask is the skill's own state; the <替身> state itself
  // (duration 20, blockCnt 0, its HP) is the dollkeeper profession's.
  //   不羁之力 at 阶 III (E2): entering the <替身> state 停顿 (sluggish, −80 % move speed) every enemy on his own range
  //   row (range_table x-1, the official 13-tile grid of 结城理 / both his masks — NOT the generic 傀儡师 3×3 风丸 and
  //   归溟幽灵鲨 use, x-4) for bb.sluggish = 8 s, and while the state runs 攻击力+atk (0.8 at E2, additive
  //   atkPct), 攻击间隔增大 base_attack_time (a FLAT +0.4 s of BAT → batPct = 0.4 / the chess's BAT 1.2, the kits' rule
  //   for a seconds blackboard — NOT the raw 0.4 multiplier) and 生命值+max_hp_t1 (hpMul 0.7 over the profession's own
  //   0.5 substitute multiplier ⇒ ×1.35 of the base max HP).
  //   S.E.E.S.队长 at 阶 III: when the <替身> state ENDS (the substitute buff expires, or he is knocked out inside it),
  //   总攻击 — atk_scale 4.3 × ATK true damage to every enemy within 1.5 tiles (PRTS: 可叠加, one burst per S.E.E.S.
  //   member in range; the sim applies 结城理's own burst once).
  //   The mask FIGHTS as him: the dollkeeper substitution keeps his own board piece (blockCnt 0) and the mask's attacks
  //   are his own attacks / skill ticks, exactly like the other dollkeepers (风丸 tier2, 归溟幽灵鲨 tier5). The mask is
  //   never a second board piece: `token_makoto_*` are display-only in tokens.json, and what shows 塔纳托斯 / 俄耳甫斯
  //   is the clip-set change of his OWN Spine (Doll_Skill_1_* / Doll_Skill_2_* / Doll_Skill_3_P1_* / P2_*): the kit
  //   emits the renderer's 'phase' fx with `form` (render/units.js FORMS `char_4217_makoto`).
  //   The mod's DEFAULT skill in the data is S2 (o.skill = skchr_makoto_2, like every 卫戍 chess), so `skill` below is
  //   S2's spec and S1 / S3 are authored as `skills` alts — each built from its OWN blackboard.
  //   S1 俄耳甫斯的竖琴 (alt, 俄耳甫斯, enters the P2 half directly): the mask's ordinary attack deals attack@atk_scale ×
  //   ATK arts, and "范围内有生命值低于50%的友方干员时，改为对其治疗" — that condition is judged per mask attack (its
  //   `beforeAttack` hook): with a hurt ally under half HP in the mask net, the same attack heals attack@heal_scale × ATK
  //   INSTEAD of dealing damage. S1's 俄耳甫斯 still attacks (only S3's does not).
  //   S2 塔纳托斯的囚锁 (default, 塔纳托斯): the ordinary attack strikes up to attack@max_target enemies of the mask's range
  //   for attack@atk_scale × ATK **arts** damage, EACH of them with attack@prob to be feared attack@fear s, and a feared
  //   enemy below attack@kill_atk_scale × ATK is knocked out (attack@kill_damage true damage) — the execute rider runs per
  //   victim of the attack, not once per cast.
  //   S3 开辟明日的剑刃 (alt, 塔纳托斯 → 俄耳甫斯): 塔纳托斯's ordinary attack deals attack@atk_scale × ATK **弱点伤害** to
  //   up to attack@max_target enemies (弱点 is a retype, not a damage type: `weaknessRetype`, items/battle.js, turns a
  //   phys/arts instance into whichever of the two the victim resists less — the sim has no 'weakness' dmgType, so the
  //   instance is authored as arts and retyped per victim), with ASPD +talent@attack_speed while the mask is up. The P2
  //   half (俄耳甫斯) is S3's own passive tail: attack@block_cnt more block count, allies in range dodge attack@prob of a
  //   phys/arts hit (the user's 口径 includes 结城理 himself), and up to attack@max_target_heal allies in range are healed
  //   attack@heal_scale × ATK per second (自身 included) until the <替身> ends — and, as the same passive says, 俄耳甫斯
  //   does not attack. "塔纳托斯在场时，开启技能或受到致命伤时改为召唤俄耳甫斯": with the 塔纳托斯 mask already up, the next
  //   cast — or the lethal hit that would have knocked him out — switches the mask to 俄耳甫斯 instead of ending the state.
  //   THE PASSIVE IS THE NORMAL ATTACK REWRITTEN, NOT A BURST (user's 口径, PRTS 被动 wording): every 结城理 skill's
  //   description puts the damage / heal / fear / execute / dodge / regen in its **被动** half and leaves the **主动** half
  //   as the single sentence "立即切换为<替身>状态作战". So a mask's passive is carried by the 人格面具's ORDINARY attack
  //   while the <替身> state runs — the engine's own attack loop at its own 攻击间隔 — and never by an extra hit fired the
  //   moment the skill is cast. Mechanically: `trait.canAttack` (the profile's own hook, ai.js `updateAlly`, read off
  //   `effectiveProfile`) carries "不能攻击" for S3's 俄耳甫斯 half and the switch animation, while the skill's `attack`
  //   override ({ atkScale, dmgType, maxTargets, onEachHit }) is the 塔纳托斯 half's rewritten attack (`resolveHit`, ai.js).
  //   技能条 = <替身> 剩余时间 (the user's 口径): all three skills are AUTHORED as `duration` skills whose duration is the
  //   特性's own bb.duration (`dollDuration`, 20 s) even though the DATA declares them 瞬发 (duration 0, durationType
  //   NONE) — the 20 s belong to 特性 char_4217_makoto.trait ("持续20秒后自身再次替换<替身>"). The client's skill bar
  //   fills `sp / spCost` and only TINTS it with `UF.SKILL` (public/js/render/units.js), so an instant skill (whose
  //   `activate` zeroes sp) paints an empty, idle bar while the <替身> state runs — measured before this change: at
  //   t=20 s `skill.active false`, snapshot `UF.SKILL false`, sp creeping 0.03 → 2.0 and a SECOND auto-cast of S2 at
  //   t≈36 s inside the 俄耳甫斯 half (SP had regrown: no 阻回 for an instant skill). As a `duration` skill the bar IS
  //   the state's timer: `UF.SKILL` stays set for the whole <替身>, snapshot.js unitTuple sends `spCost × timeLeft /
  //   duration` (a draining bar) and skills.js stops SP gain while a timed skill runs (阻回 — the official 特性 has it,
  //   "替身"期间不回复技力). The CAST is unchanged: it is the switch itself ("主动：立即切换为<替身>状态作战"), and the
  //   塔纳托斯→俄耳甫斯 relay re-activates the same skill for the FRESH 20 s (relayToOrpheus → restartBar), so the
  //   second bar is that phase's own timer and only the LAST phase's expiry leaves him in the 本体.
  //   S3 is NOT ammo: its data carries no `attack@trigger_time` at all (the old `?? 31` fallback was invented — the key
  //   belongs to 安洁莉娜 S3, which stays ammo), and its passive runs "直到<替身>状态结束", i.e. the state's own 20 s.
  //   [ASSUMED] the two 人格面具 tokens' base_attack_time 1.1 s (no mask stats in the local gamedata dump) and the
  //   per-S.E.E.S.-member multiplication of 总攻击 (one burst; the sim has no squad model).
  chess_zj_60_5_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const stats = { atk: num(t0.atk, 0.4), bat: num(t0.base_attack_time, 0.4), hp: num(t0.max_hp_t1, 0.35), sluggish: num(t0.sluggish, 0) };
    const sees = num(t1.atk_scale, 1.8);
    const sid = selectedId(chess, d);
    const baseBat = Math.max(0.1, num(chess?.stats?.bat, 1) || 1);
    /** 本体's own attack range (傀儡师 1-1 = 2 tiles, the 职业统一口径): restored when the <替身> state ends. */
    const bodyGrid = copyGrid(d.rangeGrid) ?? copyGrid(chess?.rangeGrid) ?? null;
    /**
     * <替身> duration: the 特性's own `duration` — professions.js `dollkeeper: (tb) => ({ dollDuration: num(tb.duration,
     * 20) })`, the number the `dollSwitch` handler's `enter()` creates the `trait:substitute` buff with. The bar must run
     * as long as that state, so it is the ONE number the three skills take their own `duration` from — never a literal 20
     * (another 特性 bb / a module would move both together). Read with the file's own helpers (`traitBb` = def.traitBb,
     * the raw `trait.bb` as the fallback for a record whose normalised slot is missing).
     */
    const dollRaw = num(traitBb(d).duration, num(d?.raw?.trait?.bb?.duration, 20));
    const dollDuration = dollRaw > 0 ? dollRaw : 20;
    const maskToken = (m) => (m === 'orpheus' ? 'token_makoto_orpheus' : 'token_makoto_thanatos');
    const maskForm = (m) => (sid === 'skchr_makoto_1' ? 'doll1' : sid === 'skchr_makoto_3' ? (m === 'orpheus' ? 'doll3p2' : 'doll3p1') : 'doll2');
    /**
     * 结城理's 人格面具 / 不羁之力 range net: the OFFICIAL range_table grid `x-1` = **13 tiles** (the 菱形 3-3-3-3 plus the
     * centring row's 5, 正前方 2nd tile [0,2] included) — his OWN range, unlike the generic 傀儡师 3×3: 风丸 and 归溟幽灵鲨
     * carry the same 本体 `1-1` (2 tiles, 职业统一口径, NOT a bug, never touched here) but their <替身> form uses `x-4`
     * (3×3), while 结城理's three skills AND both his talents are `rangeId` x-1. Derived from the data, never hand-written:
     *   - `s.rangeGrid` of each skill's own record (skchr_makoto_1/2/3 all 13 tiles): the widest grid the data offers is
     *     the mask's range whichever skill is selected (`skillData` gives a non-default skill its own normalised record);
     *   - `d.skills[].rangeGrid` (all three, same x-1) — the record of a skill other than the selected one;
     *   - talent 0 不羁之力 bb.range_id / talent 1 S.E.E.S.队长 bb.range_id are BOTH x-1, whose `talent.rangeGrid` slot
     *     holds the same 13-tile grid whenever the data fills it (null in data/chess.json today, so it is only a candidate).
     * The 9-tile `NINE` (file-level, shared with other operators' kits — never redefined/deleted) is only the LAST-resort
     * [FALLBACK] here, for a hypothetical data set in which no skill record has a grid wider than the 3×3 <替身> form.
     */
    const maskNets = () => {
      const cands = [d.skill?.rangeGrid, ...(d.skills ?? []).map((s) => s?.rangeGrid), d.talents?.[0]?.rangeGrid, d.talents?.[1]?.rangeGrid]
        .filter((g) => Array.isArray(g) && g.length);
      return cands.reduce((a, b) => (b.length > (a?.length ?? 0) ? b : a), null) ?? copyGrid(d.talents?.[0]?.rangeGrid) ?? NINE;
    };
    /** 人格面具's own attack range (range_table x-1, 13 tiles): at most `n` enemies of it, best targets first. */
    const maskTargets = (battle, unit, n) => enemiesOn(battle, unit, [...new Set(gridKeys(maskNets(), unit))], Math.max(1, n), unit.profile);
    /** 不羁之力's range (talent bb range_id x-1, the same 13 tiles): the switch's 停顿. */
    const auraTargets = (battle, unit) => [...new Set(gridKeys(maskNets(), unit))];
    /**
     * Show the entered mask on his own model: his Spine carries the Persona clips, so the <替身> state switches the
     * view's clip set exactly like an enemy's 模式 ('phase' fx carrying \`form\`, render/units.js FORMS).
     */
    const showMask = (battle, unit) => {
      const f = maskForm(unit.mem.makotoMask);
      if (unit.mem.makotoForm === f) return;
      unit.mem.makotoForm = f;
      unit.form = f;
      // ★ 2026-10-16（用户报告「三技能第一阶段傀儡召唤的是俄耳甫斯」）：
      //   client/render/units.js 的 `doll3p1` 定义带 `end: 'Doll_Skill_3_P1toP2_ChangeEnd'` + `next: 'doll3p2'`
      //   —— 那个 end 剪辑本身就是**切到俄耳甫斯**的动画。render/app.js:1747-1749 会按 fx 的 `dur` 去排它
      //   （`f.end && dur > 0 ? { clip: f.end, in: dur, roles: next } : null`）。
      //   原来一律发 `dur: MASK_SWITCH (0.5)`，于是进 P1 才 0.5 s 客户端就播切换动画、转入 doll3p2：
      //   塔纳托斯的入场动画（P1_SwitchIn = 1 s）还没放完就被俄耳甫斯顶掉，20 s 的 P1 被压成 0.5 s。
      //   修法：进入 P1 时 **不给 dur**（dur 0 ⇒ 客户端不排 end 剪辑），P1 就一直留在塔纳托斯；
      //   真正要切 P2 时（relayToOrpheus / S3 的"改为召唤俄耳甫斯"）再发一次 phase —— 那时 `doll3p1.next`
      //   的 ChangeEnd 由这一次的 dur 负责，时序才对。其余形态没有 end，dur 只影响切换观感，保持不变。
      const P1 = 'doll3p1';
      const dur = f === P1 ? 0 : MASK_SWITCH;
      // ★ 2026-10-17（官方特效 DESIGN §33）：进入面具时补发一个 `substitute` fx，让官方层的**形态切换特效**
      //   `makoto_change_01` 播出来。他的切换动画在客户端不是由技能预制体驱动的 —— skchr_makoto_1/2/3 三个
      //   预制体里 effects 全是空的，特效挂在 `CommonAbilities` 的 `makoto[switch2stand_s1|s2|s3_1|s3_2]` 上，
      //   由 buff 模板 `makoto_s1_trigger` / `makoto_s3_trigger` 在 `ON_BUFF_START` 触发 —— 而本作模拟不跑客户端
      //   buff 系统，所以那些触发器永远不会响（用户：「平a特效出来了，但是技能特效没有」）。
      //   render/vfx/talents.js 的 `triggerKinds` 把这些节点映射到模拟侧的 fx kind：**致命一击
      //   （ON_BEFORE_TRY_SET_HP_ZERO）→ 'substitute' / 'undying'**，因为那四个节点都同时挂了 `makoto_tr`
      //   的致命一击触发器。所以这里只要发一次 `substitute`，render/vfx/talentfx.js 的 `fx()` 就会把
      //   `makoto_change_01` 播在 `unit` 上（`_modeOk(triggered)` 对触发的节点一律放行），并返回 true 让自制
      //   特效让位（render/app.js:1755）。`form` / `dur` 与 professions.js 的 dollkeeper 同形。
      //   注意：`phase` 本身不在 triggerKinds 里（talents.js:131-141 只认 substitute / undying / swap /
      //   dollEnd / skill / born），所以不补这一发，切换特效永远不播。
      battle.fx('substitute', { x: unit.x, y: unit.y, id: unit.id, form: f, dur });
      battle.fx('phase', { x: unit.x, y: unit.y, id: unit.id, kind: f, form: f, dur });
      fx(battle, 'summon', unit, { token: maskToken(unit.mem.makotoMask), skill: 'makoto' });
    };
    const hideMask = (battle, unit) => {
      if (unit.mem.makotoForm == null) return;
      unit.mem.makotoForm = null;
      unit.form = null;
      // ★ 2026-10-17（官方特效）：退出面具 → 官方层的 `makoto_change_01`（回本体）。`swap` 是 triggerKinds 里
      //   「主动退出替身」的那一个（professions.js leave() 同款，'dollEnd' 留给阵亡），对应客户端
      //   `makoto[switch2normal]`（它的触发器是 standin buff 的 ON_BUFF_FINISH）。同 showMask，见那边的说明。
      //   `form: 'base'` 而不是 null：职业 dollkeeper 的 swap 也带 form null（professions.js:246），
      //   带 'base' 才能把它与本 kit 的退出区分开（与下面 phase 的 kind: 'base' 同义）。
      battle.fx('swap', { x: unit.x, y: unit.y, id: unit.id, form: 'base' });
      battle.fx('phase', { x: unit.x, y: unit.y, id: unit.id, kind: 'base', form: null, dur: MASK_SWITCH });
    };
    /**
     * 不羁之力 of the entered mask: while he fights as the <替身> — ATK +atk (additive atkPct), 攻击间隔增大
     * +base_attack_time SECONDS (batPct = seconds / this chess's BAT), 生命值 +max_hp_t1 (hpMul over the profession's
     * substitute 0.5). Also owns S.E.E.S.队长's 总攻击, which fires when the state ENDS.
     */
    const applyMask = (battle, unit) => {
      if (unit.trait.doll && unit.alive) {
        unit.mem.makotoSaw = true;
        showMask(battle, unit);
        if (!unit.findBuff('makoto:mask')) {
          const mods = {};
          if (stats.atk) mods.atkPct = stats.atk;
          if (stats.bat) mods.batPct = stats.bat / baseBat;
          if (stats.hp > 0 && stats.hp < 5) {
            // 生命值+35 % is OF the operator's own max HP; the profession's substitute buff only carries a `hpMul` when the
            // operator owns a real 替身 token (风丸's 纸偶 — professions.js `dollHpMul`), and 结城理's `token_makoto_*` are
            // display-only, so his <替身> max HP is his OWN (professions.js header) and the share to cancel out is 1:
            // 1.35 / 1 over upstream v0.1.3's `enter()` — the old 1.35 / 0.5 belonged to the profession helper this
            // migration removed (v0.1.1's exported `enter`-doll-state entry point).
            const sub = unit.findBuff('trait:substitute');
            const share = num(sub?.mods?.hpMul, 1) || 1;
            if (share > 0) mods.hpMul = (1 + stats.hp) / share;
          }
          battle.addBuff(unit, { key: 'makoto:mask', mods });
        }
      } else {
        if (unit.findBuff('makoto:mask')) battle.removeBuff(unit, 'makoto:mask');
        hideMask(battle, unit);
      }
    };
    /**
     * ★ 2026-10-17（用户：「替身状态并非永远是0 而是基于基础状态降到0」）：
     * 俄耳甫斯（S3 的 P2 面具）的「阻挡数+2」。
     *
     * 为什么单列一个函数、而不是在 `use()` 里挂一次：
     *   ① `use()` 先发 `dollSwitch`，`professions.js` 的 `startSwitch()` 会
     *      `for (const b of unit.buffs) if (b.status) removeBuff(b)` —— 把刚挂的 buff 清掉；
     *   ② S3 的「塔纳托斯 → 俄耳甫斯」实际走的是 install 里 tick 钩子的 `makotoFatalRelay` 那条路
     *      （install 的 fatal 守卫对 S3 明确让路，第 566 行），那条**不经过 `use()`**。
     *   所以改成"状态标记"式：每 tick 按当前面具同步 —— 该有就补上、不该有就摘掉，
     *   与 `makoto:mask` 同款写法，两条路都能生效，且被清掉后会自动重建。
     *
     * 数值语义（配合 units.js 的 -99 置零修复）：替身的 `blockCnt: -99` 把**基础**阻挡数压到 0，
     * 这里的 +2 是"置零之后"新加的加成 ⇒ 最终 0 + 2 = 2。
     */
    const syncDollBlock = (battle, unit) => {
      const want = unit.trait.doll && unit.alive && unit.mem.makotoMask === 'orpheus' && sid === 'skchr_makoto_3';
      const has = !!unit.findBuff('makoto:dollBlock');
      if (want && !has) {
        battle.addBuff(unit, { key: 'makoto:dollBlock', mods: { blockCnt: num(bb['attack@block_cnt'], 2) } });
      } else if (!want && has) {
        battle.removeBuff(unit, 'makoto:dollBlock');
      }
    };
    /** S.E.E.S.队长 总攻击: atk_scale × ATK true damage around him when the <替身> state ends. */
    /**
     * ★ 2026-10-17（S.E.E.S.txt，用户）：
     *   「<五名不同【S.E.E.S】干员在场时>「结城理」天赋「S.E.E.S队长」造成的伤害提高 1500%（受层数影响）」，
     *   ★ 2026-10-18（owner）：1000% → **1500%**，每层斜率 0.01 → **0.02**
   *   ⇒ 公式 (1500 + 2x)/100 = **×（15 + 0.02x）**，x = 【S.E.E.S】层数。
     *   · 只数**干员**（kind === 'op'）：召唤物 / 装置不算人数；
     *   · `isMember` 已经把「戴『"S.E.E.S"袖章』的干员」算成成员（bonds.json seesShip.zj.equipCombo），
     *     所以「带了就算」自然生效（用户 2026-10-17：「带了就算」）；
     *   · 不足 5 名 → ×1（不加成）。
     */
    const seesTalentMult = (battle, unit) => {
      let n = 0;
      for (const a of battle.allies()) {
        if (!a || a.kind !== 'op' || !a.alive) continue;
        // 模拟侧的 `isMember` 只看棋子自带的 bonds，**不认** zj.equipCombo，
        // 所以要自己把「戴『"S.E.E.S"袖章』的干员」也算进来（用户：带了就算）。
        const armband = Array.isArray(a.items)
          && a.items.some((it) => String(it).startsWith('chess_item_sees_armband'));
        if (armband || isMember(battle, a, 'seesShip')) n++;
      }
      if (n < 5) return 1;
      return (1500 + 2 * bondLayers(battle, unit.ownerId, 'seesShip')) / 100;
    };
    const allOutAttack = (battle, unit) => {
      if (!(sees > 0) || !unit.alive) return;
      const list = battle.enemiesInRadius(unit.x, unit.y, 1.5);
      if (!list.length) return;
      // ★ 2026-10-17：原来发 'aoe'（kinds.js → 通用橙色 blast）。二天赋的官方爆发特效
      //   makoto_talent_finish_01 在 index.json 里没有任何 use 引用、计划表播不到它，所以改发专属 kind
      //   'makotoSees'，由 FX_BINDINGS（public/js/render/vfx/skills.js）挂上官方 prefab；
      //   官方特效关掉时 'makotoSees' 在 kinds.js 里有自己的兜底画法（不会退回橙色爆炸）。
      fx(battle, 'makotoSees', unit, { radius: 1.5, skill: 'makotoSees' });
      const mult = seesTalentMult(battle, unit);
      for (const e of list) {
        battle.dealDamage(unit, e, { amount: unit.s.atk * sees * mult, type: 'true', isSkill: true, tags: ['talent', 'makotoSees'] });
      }
    };
    /**
     * Enter the mask state of the cast ("主动：立即切换为<替身>状态作战"): the ACTIVE half of every 结城理 skill is the
     * switch itself, so the cast fires the profession's own `dollSwitch` hook (upstream v0.1.3's official extension
     * point — the same call 归溟幽灵鲨's S2 `onEnd` makes) and only then does the mask exist to fight. The alternative
     * entry — a fatal hit — is the profession's own hook and stays untouched; `enter()` refuses while `trait.doll` is
     * already up, so a re-entry from inside the state (S3's 塔纳托斯→俄耳甫斯 switch) neither restarts the state nor
     * re-fires the switch animation. NB `enter()` → `startSwitch()` ends a running skill (`sk.end('substitute')`,
     * professions.js) and `use()` runs inside `onStart`, where the bar is already active (skills.js `activate`).
     */
    const use = (battle, unit, m, initial = true) => {
      // S3: "塔纳托斯在场时，开启技能或受到致命伤时改为召唤俄耳甫斯"
      if (initial && sid === 'skchr_makoto_3' && unit.mem.makotoMask === 'thanatos' && unit.trait.doll) m = 'orpheus';
      // 优先遵循上游 v0.1.3：傀儡师机制由 professions.js 的 `dollSwitch` hook 提供（官方扩展点；tier5.js 归溟幽灵鲨
      // S2 同款用法），内建 1 s 切换动画、阻回、禁疗、替身满血与切换期免疫。`enter()` 自带状态判断与幂等处理。
      // ★ 2026-10-18（owner）：原「每叠加 100 层 → 傀儡/替身态持续时间 -1s（最少 2s）」**已删除**，
      //   替身态时长回到特性数据里的固定值（bb.duration）。
    battle.emit('dollSwitch', { unit, reason: 'skill', done: false });
      // 技能条不在这里拉：上游的切换动画（1 s）结束后替身态才成立，拉早了条会比替身早 1 s（错位）。
      // 拉条在 install 的 tick 钩子里做 —— 检测到"替身态已开始但技能没在跑"的那一刻。
      // never the 本体 1-1 (2 tiles) — the mask fights with the skill's `rangeId`. `Battle.relocate`/`refreshRange` rebuild
      // the absolute net from whatever tile he stands on, so the range travels with him.
      if (unit.rangeGrid !== maskNets()) { unit.rangeGrid = maskNets(); battle.refreshRange(unit); }
      unit.mem.makotoMask = m;
      // the relay phase: 塔纳托斯 is the form that chains into 俄耳甫斯 (1), anything already in the P2 half stays 2
      // (S3's own 塔纳托斯→俄耳甫斯 switch enters the P2 half directly and must not be re-chained)
      if (m === 'orpheus') unit.mem.makotoRelay = 2;
      else if (unit.mem.makotoRelay !== 2) unit.mem.makotoRelay = 1;
      const prev = unit.findBuff('makoto:dollBlock');
      if (prev) battle.removeBuff(unit, prev);
      // 阻挡数+2 **不在这里挂** —— 见 syncDollBlock 上方说明（`dollSwitch` 的 startSwitch 会清掉 status buff）。
      applyMask(battle, unit);
    };
    /**
     * Start the skill's own timer for the <替身> phase just entered (the relay's P2 half): the bar of a `duration` skill
     * IS the state's remaining time (snapshot.js drains sp by `timeLeft / duration`), and the cast's `activate` spent the
     * charge — so the same skill is re-activated FOR FREE (`{ free: true }`: no charge, no sp bookkeeping) with reason
     * 'relay', which every `onStart` uses to skip the cast's own work (the mask entry — the state entry itself ran in
     * `use()`, which `relayToOrpheus` calls before this).
     * `sp` is zeroed like the cast's own `activate` does when it spends the charge: 阻回 (skills.js `gainSp` returns 0
     * while a timed skill runs) keeps it there, so the phase-2 bar never shows a leftover SP from the one tick between
     * the P1 expiry and this relay, and the next real cast still starts from 0. A skill that is somehow still running
     * (it should not be: both timers start in the same tick) only has its timer reset instead.
     */
    const restartBar = (battle, unit, reason = 'relay') => {
      const sk = unit.skill;
      if (!sk || sk.noSkill || sk.kind !== 'duration') return false;
      if (sk.active) { sk.timeLeft = sk.duration; return true; }
      sk.sp = 0;
      return sk.activate(reason, { free: true });
    };
    /**
     * 塔纳托斯 → 俄耳甫斯 relay (the user's rule, off the data): 塔纳托斯 fights for his 20 s of <替身>, and when that
     * state ends he is NOT done — the mask switches to 俄耳甫斯 (the healing / non-attacking form) for a FRESH 20 s of
     * <替身>, and only when THAT ends does 结城理 return to the 本体. The 20 s come from the same `trait:substitute`
     * duration the profession uses (bb.duration / dollDuration), so the relay is one more entry, never a new timer.
     * S3's own "塔纳托斯在场时…改为召唤俄耳甫斯" switch is a different door into the same form (a cast / fatal hit while
     * 塔纳托斯 is up). `mem.makotoRelay` marks the phase: 1 = 塔纳托斯 ran, 2 = the 俄耳甫斯 half, 0 = nothing to chain.
     * The relay is reached from the `tick` hook on the tick the `trait:substitute` buff expired — the buffs phase runs
     * before the allies phase in Battle.step, so `doll` is already false here and the hook's `enter()` accepts (its
     * `trait.doll` guard keeps the FIRST cast from resetting a running state; it is never in the way here).
     */
    const relayToOrpheus = (battle, unit) => {
      unit.mem.makotoRelay = 2;
      use(battle, unit, 'orpheus', false);    // emit `dollSwitch` (a fresh DOLL_SWITCH + dollDuration state), mask = P2
      if (unit.rangeGrid !== maskNets()) { unit.rangeGrid = maskNets(); battle.refreshRange(unit); }
      showMask(battle, unit);                 // applyMask re-runs on the next tick; the clip set switches right here
      restartBar(battle, unit);               // the user's "这时候是新的技能条": the P2 half gets its own 20 s bar
    };
    /** The mask's least-healthy hurt ally on its own range net, under `lim` of max HP (null: none) — 结城理 included. */
    const hurtAllyInRange = (battle, unit, lim) => {
      const keys = new Set(gridKeys(maskNets(), unit));
      return battle.injuredAlliesInKeys(keys, unit).find((a) => a.hpRatio < lim) ?? null;
    };
    /**
     * 俄耳甫斯's heal of S3's P2 half: "每秒治疗范围内最多…名友方干员" attack@heal_scale × ATK.
     * **自身 included**（用户口径「对自身以及范围内队友提供治疗」），并且**自身免疫禁疗**：
     * upstream 的 <替身> buff 带 `healFree`（禁疗；PRTS 异常效果「受到的治疗量变为0」，professions.js L151），
     * 它会把结城理自己的这份治疗清零。`opts.ignoreHealFree` 是引擎自带的逃生口
     * （damage.js L513；史尔特尔 S3 的起手治疗用的是同一个，PRTS「无视禁疗」）—— 用户 2026-10-06 决定：
     * 俄耳甫斯形态对自身免疫禁疗。
     */
    const orpheusRegen = (battle, unit, heal, healN) => {
      if (!(heal > 0)) return;
      const hurt = battle.injuredAlliesInKeys(new Set(gridKeys(maskNets(), unit)), unit).slice(0, healN);
      for (const a of hurt) battle.heal(unit, a, unit.s.atk * heal, a === unit ? { ignoreHealFree: true } : undefined);
    };
    /**
     * The mask's rewritten ORDINARY attack (block header): while the <替身> runs, 塔纳托斯 hits up to attack@max_target
     * enemies on the mask's 13-tile net for attack@atk_scale × ATK — as arts for S2, as the 弱点 retype for S3 — and S2's
     * rider runs on EVERY victim: attack@prob to fear it attack@fear s, and a feared enemy below attack@kill_atk_scale × ATK
     * is knocked out (attack@kill_damage true damage).
     *
     * ★ 2026-10-17（用户：「二技能代码还是有问题」）**斩杀的判定范围修过一次**：
     *   官方描述是「**范围内**恐惧中的敌人若生命值低于结城理攻击力的 230% 则立刻倒下」——
     *   主语是**范围内所有恐惧中的敌人**，不限于本次普攻命中的那至多 `max_target` 个。
     *   旧实现把斩杀只挂在 `onEachHit` 上（每个被命中的目标各判一次），于是：
     *     4 个敌人都站在网内、都被恐惧、第 4 个血量远低于阈值，但它不在 `max_target=3` 之内、**永远不会被斩杀**
     *     （实测：hp=883 < 阈值 3415、开技前就恐惧、在网内 → 25 秒后仍存活）。
     *   现在每次出手（`onEachHit` 第一次触发时）**额外扫一遍面具网**，把范围内所有"恐惧中且低于阈值"的敌人一并斩杀。
     *   已按命中的目标记录在 `done` 里，避免同一目标被斩杀两次。
     */
    const thanatosAttack = (s, o) => {
      const scv = num(s.bb['attack@atk_scale'], 2);
      const fear = num(o.fear, 0), p = num(o.prob, 0), killAt = num(o.killAt, 0), kill = num(o.kill, 0);
      /** 本次出手已处理过的目标（命中的 + 范围扫描补上的）+ 记下是哪一帧，跨帧自动重来。 */
      let done = null, doneFrame = -1;
      const spec = {
        atkScale: scv,
        dmgType: 'arts',
        // the target cap rides on the ATTACK override (ai.js merges every `attack` key onto the profile; `maxTargets` is
        // the key `acquireTargets` counts with).
        maxTargets: o.maxTargets ?? undefined,
        tags: ['skill', 'makoto'],
        onEachHit({ battle, unit, target }) {
          // ★ 帧号必须用 `battle.tickCount` —— `battle.frame` **不存在**（`undefined`）。
          //   我第一版写成 `battle.frame`，`typeof … === 'number'` 为假 ⇒ `f` 恒为 0 ⇒ `doneFrame !== f` 永假
          //   ⇒ `done` 永不重置 ⇒ 第一帧之后 `done.has(target)` 恒真 ⇒ **恐惧与斩杀全被跳过**
          //   （实测：192 次命中只触发 1 次恐惧；30 秒 12 次命中里 `rng.chance` 只被调用 1 次）。
          const f = battle.tickCount ?? 0;
          // ★ 本次出手（同一帧内的多次命中算一次）先扫一遍面具网：
          //   「范围内恐惧中的敌人若生命值低于 230% 攻击力则立刻倒下」—— 官方描述的主语是**范围内所有**恐惧中的敌人，
          //   不限于本次普攻命中的那至多 max_target 个（旧实现只判被命中的目标，第 4 个及以后永远杀不掉）。
          if (!done || doneFrame !== f) {
            done = new Set(); doneFrame = f;
            if (kill > 0 && killAt > 0) {
              for (const e of maskTargets(battle, unit, 99)) {
                if (!e || !e.alive || done.has(e)) continue;
                if (!e.findBuff('fear')) continue;
                // 同一个阈值口径（当前生命 < 攻击力 × killAt），与下面逐目标那条一致
                if (e.hp < unit.s.atk * killAt) {
                  done.add(e);
                  battle.dealDamage(unit, e, { amount: kill, type: 'true', isSkill: true, tags: ['skill', 'makotoExecute'] });
                }
              }
            }
          }
          if (!target || !target.alive || done.has(target)) return;
          done.add(target);
          // S3 弱点伤害: no 'weakness' dmgType exists in the engine — 弱点 retypes a phys/arts instance to the one the victim
          // resists less (weaknessRetype, items/battle.js), so it is applied per victim here.
          if (o.weakness) weaknessRetype({ amount: unit.s.atk * scv, type: 'arts' }, unit, target);
          if (!fear || !(p > 0)) return;
          const wasFeared = !!target.findBuff('fear');   // "范围内恐惧中的敌人" — the state before this hit's own roll
          let feared = false;
          if (battle.rng.chance(p)) { battle.applyStatus(target, 'fear', { duration: fear, source: unit }); feared = true; }
          if (!target.alive || !(wasFeared || feared)) return;
          if (kill > 0 && target.hp < unit.s.atk * killAt) {
            battle.dealDamage(unit, target, { amount: kill, type: 'true', isSkill: true, tags: ['skill', 'makotoExecute'] });
          }
        },
      };
      return new Proxy(spec, {
        // `noAttack` is TRUE from the start and stays true: this override exists only for the 塔纳托斯 half's skills (S2 /
        // S3), and 俄耳甫斯 — their relay's P2 half — never uses it. The live mask decision belongs to `trait.canAttack`
        // (a resolved-profile value), because a Proxy getter cannot see the unit.
        get: (t, k) => (k === 'noAttack' ? true : t[k]),
      });
    };
    /**
     * 俄耳甫斯's rewritten ordinary attack of S1: "攻击对敌人造成攻击力210%的法术伤害，范围内有生命值低于50%的友方干员
     * 时，改为对其治疗相当于结城理攻击力50%的生命值" — the condition is judged when the attack RESOLVES, on the mask's own
     * net: a hurt ally under half HP takes the heal **instead of** the damage ("改为"), otherwise the attack is arts damage
     * at attack@atk_scale. "Instead" is exact: the `beforeAttack` hook (install, below) heals that ally and cancels the
     * whole attack before any damage instance of it exists, so the enemy on a tile of the same net takes nothing that
     * tick — the mask heals or it strikes, never both (the PRTS sentence has no "并"). There is no 庇护 / damage
     * reduction anywhere in the three 被动 texts, so none is added.
     */
    const hurtLowAlly = (battle, unit) => hurtAllyInRange(battle, unit, 0.5);
    const healLowAlly = (battle, unit, hs) => {
      const a = hurtLowAlly(battle, unit);
      if (!a || !(hs > 0)) return null;
      // same "自身免疫禁疗" rule as orpheusRegen: the <替身> buff's `healFree` must not zero 结城理's own heal
      battle.heal(unit, a, unit.s.atk * hs, a === unit ? { ignoreHealFree: true } : undefined);
      return a;
    };
    /**
     * 三个技能的触发判定都用「开技能之后的攻击范围」——面具的 x-1 网（13 格）：敌人一走进这个网就开技能，不必等它
     * 走进本体的 1-1（2 格）。数据里三个技能的规则都是 DEFAULT，而 DEFAULT 走 `onAboutToAttack()` →
     * `_defaultCondition()`（skills.js:490，**不带 range 参数**），只读 `baseRangeKeys` = 本体范围；技能自己的
     * `targeting.rangeGrid` 只影响运行期的 live range（queries.js `_refreshRange` 只在 `u.skill.active` 时读
     * `spec.targeting`），触发判定完全看不到它。所以在每个 spec 上显式声明 ACTIVE_RANGE，引擎每 tick 用
     * `_triggerKeys()` 按 13 格网判定。
     *
     * 本体形态同样生效，**不用 `trait.doll` 门控**（用户 2026-10-10）。这取代了原先只在 S1/S2 上注册、且被
     * `trait.doll` 门控的 `addTriggerRange`（旧注释的理由是"the skill is what puts him into <替身>"）：那张网
     * 是 13 格的子集，ACTIVE_RANGE 已完全覆盖，故整段移除。
     */
    const s1 = (s) => ({
      // S1's bar is the same <替身> timer; S1 enters 俄耳甫斯 directly, so nothing relays after it and its own expiry is
      // what returns him to the 本体 (mem.makotoRelay stays 2, relayMask null).
      kind: 'duration',
      duration: dollDuration,
      trigger: { rule: 'ACTIVE_RANGE', grid: maskNets() },
      // 只声明**对空**，不带 `rangeGrid`：运行期攻击范围因此保持本体那 1-1（2 格），只有 S3 才把运行期攻击网换成 x-1
      // （见 s3 上的说明）。S1 召唤的俄耳甫斯就是 `tokens.token_makoto_orpheus`（数据 `attackKind: 'melee'` +
      // `canHitFly: true`），本体 form 是 `canHitFly: false`；面具是显示用的、token 上的 canHitFly 不会自动带过来。
      targeting: { canHitFly: true },
      attack: {
        atkScale: num(s.bb['attack@atk_scale'], 2.1),
        dmgType: 'arts',
        // single target ("攻击对敌人" — no 至多N名): no `maxTargets` on `targeting` either.
        maxTargets: 1,
        tags: ['skill', 'makoto'],
      },
      onStart({ battle, unit, reason }) {
        if (reason === 'relay') return;
        use(battle, unit, 'orpheus');
      },
    });
    const s2 = (s) => ({
      // the bar IS the <替身> timer (block header): `duration` from the 特性, not the 瞬发 record the data ships
      kind: 'duration',
      duration: dollDuration,
      relayMask: 'orpheus',                  // 塔纳托斯 → 俄耳甫斯
      trigger: { rule: 'ACTIVE_RANGE', grid: maskNets() },
      // ★ 2026-10-17（用户：「他的三技能可以对空的 你改一下」）：**S2 原来漏了对空声明**（S1 / S3 都有）。
      //   面具（塔纳托斯 / 俄耳甫斯）按数据是能打空中单位的 —— 两个 token 都是 `attackKind: 'melee'` +
      //   `canHitFly: true`（见 s3 上的说明）；本 fork 里面具是显示用的、token 的 canHitFly 不会自动带过来，
      //   所以每个技能都要显式声明。少了这一行 ⇒ `ai.js:315` 的 `if (!prof.canHitFly && e.isFlying) continue;`
      //   会把所有空中单位挡掉，表现为「二技能打不到飞机」。
      //   只声明对空、**不带 `rangeGrid`**：运行期攻击范围因此保持本体那 1-1（2 格），与 S1 同款；
      //   只有 S3 才把运行期攻击网换成 x-1（见 s3 上的说明）。`maxTargets` 由 `attack` 上的 override 携带。
      targeting: { canHitFly: true },
      attack: thanatosAttack(s, {
        maxTargets: Math.max(1, Math.floor(num(s.bb['attack@max_target'], 4))),
        fear: num(s.bb['attack@fear'], 1.5), prob: num(s.bb['attack@prob'], 0.35),
        killAt: num(s.bb['attack@kill_atk_scale'], 2.5), kill: num(s.bb['attack@kill_damage'], 1e7),
      }),
      onStart({ battle, unit, reason }) {
        if (reason === 'relay') return;      // the relay's fresh bar: the state entry already ran in relayToOrpheus
        use(battle, unit, 'thanatos');
      },
    });
    const s3 = (s) => {
      const heal = num(s.bb['attack@heal_scale'], 0.3), healN = Math.max(1, Math.floor(num(s.bb['attack@max_target_heal'], 4)));
      const dodge = num(s.bb['attack@prob'], 0.35);
      return {
        // NOT ammo (block header): the data has no `attack@trigger_time` for 结城理 — the old `?? 31` fallback was an
        // invented bar — and the passive runs "直到<替身>状态结束", the state's own 20 s. Same bar as S2's.
        kind: 'duration',
        duration: dollDuration,
        // 没有 `relayMask`：S3 的 <替身>态结束**不再**自动接二阶段（用户 2026-10-10）。塔纳托斯这一条跑完就结束技能、
        // 回到本体并触发 S.E.E.S.队长 的总攻击；只有"塔纳托斯在场时受到致命伤"那一条路会切到俄耳甫斯（install 的
        // fatal 守卫 → tick 钩子），而且**继承**这一条条的剩余时间，不再重算（见 restartBar 上方的说明）。
        trigger: { rule: 'ACTIVE_RANGE', grid: maskNets() },   // 见 s1 上方的说明
        mods: { aspd: num(s.bb['talent@attack_speed'], 45) },
        // the mask's own x-1 net while the bar runs (the engine's live range; the trigger reads the same net through
        // each spec's own ACTIVE_RANGE instead) — the range regression's assert A/C reads this grid, and assert D reads
        // its `maxTargets` (the same attack@max_target the attack override carries: ai.js writes the key from both places
        // onto the resolved profile, so the cap is the data's either way).
        // 对空：面具（塔纳托斯 / 俄耳甫斯）是**可以打空中单位**的 —— 数据里两个面具 token
        // （`data/backups.json` 的 `tokens.token_makoto_thanatos` / `token_makoto_orpheus`）都是
        // `attackKind: 'melee'` + `canHitFly: true`，而本体 form 是 `canHitFly: false`。本 fork 里面具是**显示用**的
        // （本体自己不换单位，见 showMask），token 上的 canHitFly 不会被自动带过来，所以按技能显式声明；`ai.js`
        // 的 `effectiveProfile` 只在技能运行期间应用 `targeting`，本体形态因此仍然打不到空中单位（用户 2026-10-10）。
        targeting: { rangeGrid: maskNets(), maxTargets: Math.max(1, Math.floor(num(s.bb['attack@max_target'], 4))), allInRange: false, canHitFly: true },
        // 塔纳托斯's ordinary attack: attack@atk_scale × ATK as 弱点伤害 (the retype above), up to attack@max_target enemies
        attack: thanatosAttack(s, {
          weakness: true,
          maxTargets: Math.max(1, Math.floor(num(s.bb['attack@max_target'], 4))),
        }),
        onStart({ battle, unit, reason }) {
          if (reason !== 'relay') use(battle, unit, 'thanatos');
          // The 俄耳甫斯 half's aura is S3's OWN passive ("使范围内友方干员获得…闪避并每秒治疗…，直到<替身>状态结束"), so it
          // runs from the FIRST bar and re-runs on the relay's fresh bar — including 结城理 himself (user's 口径: "自身
          // 获得闪避"; PRTS says 范围内友方干员 and he stands on his own range net).
          const near = new Set(gridKeys(maskNets(), unit));
          for (const a of battle.alliesFor(unit, unit.ownerId)) {
            if (!unit.alive || a.kind !== 'op' || !onTiles(a, near)) continue;
            a.mem.makotoDodge = Math.max(num(a.mem.makotoDodge, 0), dodge);
          }
        },
        // ★ 2026-10-17：**不要**给 S3 加"技能期间再次施放 → 切俄耳甫斯"。
        //   用户 2026-10-10 的明确口径：「他不会主动进入俄耳甫斯状态」——S3 的替身态结束**不再**自动接二阶段，
        //   塔纳托斯这一条跑完就结束技能、回本体并触发总攻击；只有「受到致命伤」那条路才切俄耳甫斯
        //   （由 install 里的 fatal 守卫 + tick 钩子负责）。
        //   我曾按描述的「开启技能…改为召唤俄耳甫斯」试过加 `onRecast`，与用户口径冲突，已撤销。
        onTick({ battle, unit, skill, dt }) {
          // the regen is 俄耳甫斯's ("并每秒治疗…"): 塔纳托斯 does not heal — the user's rule "塔纳托斯 = 仅能攻击"
          if (unit.mem.makotoMask !== 'orpheus' || !skill.active) return;
          unit.mem.makotoHeal = (unit.mem.makotoHeal ?? 0) + (dt || 0);
          if (unit.mem.makotoHeal < 1) return;
          unit.mem.makotoHeal = 0;
          orpheusRegen(battle, unit, heal, healN);
        },
      };
    };
    const kit = {
      // `trait.canAttack` (the PROFILE's own hook, ai.js `updateAlly` — it is read off `effectiveProfile(unit)`, so the
      // skill's `attack` override merges onto it) carries the two states in which the mask does not fight with its
      // rewritten attack: the 1 s `dollSwitch` animation (the passive applies "在<替身>状态下", after the switch — without
      // this the animation's own attack landed unreduced, measured 1326.6 = 737 × 1.8) and the 俄耳甫斯 half of S3, whose
      // own 被动 says it does not attack at all ("不能攻击"; its `attack` override's `noAttack` covers it too). S1's
      // 俄耳甫斯 DOES attack — its 被动 is "攻击对敌人造成攻击力210%的法术伤害，…改为对其治疗…" — so `sid`, not the mask,
      // decides that half. The 本体 (no mask) must keep attacking: the DEFAULT 技能策略 casts "about to attack" (skills.js
      // `onAboutToAttack`), so a false there would make all three skills impossible to cast (measured: S2 never cast).
      trait: {
        canAttack: (battle, u) => {
          const m = u.mem.makotoMask ?? null;
          if (m == null) return true;
          if (u.trait.dollSwitching) return false;
          return !(m === 'orpheus' && sid === 'skchr_makoto_3');
        },
      },
      skill: s2(skillData(chess, d, bb, 'skchr_makoto_2')),
      skills: altSkills(chess, d, bb, {
        skchr_makoto_1: s1,
        skchr_makoto_3: s3,
      }),
      talents: [
        { install(battle, unit) {
          // the <替身> state entered by a fatal hit carries the mask its skill picked (S2 / S3 default: 塔纳托斯)
          battle.on('fatal', (ctx) => { if (ctx.unit === unit && unit.mem.makotoMask == null) unit.mem.makotoMask = 'thanatos'; }, { owner: unit, priority: -200 });
          // S3's own passive: "塔纳托斯在场时，开启技能**或受到致命伤**时改为召唤俄耳甫斯". A lethal hit taken while
          // 塔纳托斯 is the running mask因此 **does not knock him out** (user's decision 2026-10-06, "读法 A: 不死,
          // 改为切俄耳甫斯", following the PRTS wording). `ctx.prevented` short-circuits the profession's own
          // dollkeeper `fatal` hook (professions.js), which would otherwise treat it as "the 替身 was knocked out";
          // `enter()` then re-runs for a FRESH 20 s as 俄耳甫斯 (it accepts: `startSwitch` expired the old buff).
          // Only the 塔纳托斯 half is intercepted — in the 俄耳甫斯 half nothing is, so the 替身 can be knocked out
          // there and the operator retreats, which is the one way this state still ends by death.
          battle.on('fatal', (ctx) => {
            if (ctx.unit !== unit || ctx.prevented) return;
            if (!unit.trait.doll || unit.mem.makotoMask !== 'thanatos') return;
            // S3 的这条路必须让开：它由 install 里那条守卫接管（那条**继承**剩余时间，不重算）。本处理器注册在 -100，
            // 而 battle/hooks.js 按 priority **降序**插队，所以它比那条 -150 的守卫**先跑**；先跑就会 `relayToOrpheus`
            // 把技能条重算成一条满的 —— 正是用户 2026-10-10 要去掉的"重新计算持续时间"。
            if (sid === 'skchr_makoto_3') return;
            ctx.prevented = true;                       // 不死：这一击不击倒他
            relayToOrpheus(battle, unit);               // 改为召唤俄耳甫斯（全新的 20 s）
            unit.hp = unit.s.maxHp;                     // 切换重设生命至最大值（PRTS 傀儡师特性）
            unit.markDirty();
          }, { owner: unit, priority: -100 });
          // 不羁之力: "切换为<替身>状态时停顿周围一定范围内敌人sluggish秒" — 停顿 = the engine's sluggish (−80 % move)
          if (stats.sluggish > 0) {
            battle.on('fatal', (ctx) => {
              if (ctx.unit !== unit || !ctx.prevented) return;
              const keys = new Set(auraTargets(battle, unit));
              for (const e of battle.enemies) {
                if (!e.alive || e.hidden) continue;
                if (!keys.has(`${e.tileR},${e.tileC}`) && !bodyInKeys(e, keys)) continue;
                battle.applyStatus(e, 'sluggish', { duration: stats.sluggish, source: unit });
              }
              fx(battle, 'aoe', unit, { radius: 1.5, skill: 'makotoSluggish' });
            }, { owner: unit, priority: -210 });
          }
        } },
      ],
      install(battle, unit) {
        // 三个技能各自的触发网都在自己的 spec 上（`trigger: { rule: 'ACTIVE_RANGE', grid: maskNets() }`，见 s1 上方
        // 的说明）。这里原先为 S1/S2 注册过一个被 `trait.doll` 门控的 `addTriggerRange`——那张网是 13 格的子集，
        // ACTIVE_RANGE 已完全覆盖，故已移除（用户 2026-10-10）。
        /**
         * S1's "改为对其治疗" is a REPLACEMENT, not an addition ("改为": the heal takes the attack's place). The judgement
         * is made on `beforeAttack` — the engine's own point for "the attack about to be made is replaced" (the same hook
         * 塞雷娅 S1's "触发时会替换当次攻击" / 拉普兰德 S2 use) — BEFORE a damage instance of this attack exists, so the
         * enemy in reach takes nothing that tick. The heal picks the mask net's least-healthy <50 % ally, 结城理 included.
         */
        if (sid === 'skchr_makoto_1') {
          const hs = num(skillData(chess, d, bb, 'skchr_makoto_1').bb['attack@heal_scale'], 0.5);
          battle.on('beforeAttack', (ctx) => {
            if (ctx.attacker !== unit || !unit.skill?.active || !unit.alive) return;
            if (unit.mem.makotoMask !== 'orpheus') return;      // only 俄耳甫斯 heals ("范围内…改为对其治疗")
            if (!hurtLowAlly(battle, unit)) return;             // no ally below half HP on the net ⇒ the attack stands
            healLowAlly(battle, unit, hs);
            ctx.targets = [];
            ctx.cancel = true;                                  // the damage of this attack does not happen
          }, { owner: unit, priority: -100 });
        }
        // 不羁之力 runs while the <替身> state does; its END (the substitute expiring with him alive) is the
        // S.E.E.S.队长 总攻击. A fatal hit inside the state runs the 死亡 path instead, which fires it from there.
        battle.on('tick', () => {
          // "受致命伤时改为召唤俄耳甫斯" (S3's own 被动) was marked by the fatal handler while 塔纳托斯 was up: the state is
          // still running (its own 20 s were not restarted), the mask switches to 俄耳甫斯.
          if (unit.alive && unit.trait.doll && unit.mem.makotoFatalRelay) {
            unit.mem.makotoFatalRelay = false;
            unit.mem.makotoMask = 'orpheus';
            unit.mem.makotoRelay = 2;
            applyMask(battle, unit);
            // 切换重设生命至最大值（PRTS 傀儡师特性）——`applyHpLoss` 把这一击压在 1 HP，而这条路上**不重进** <替身>态，
            // 没有 `enter()` 代劳；`relayToOrpheus` 那条路是自己写 `unit.hp = unit.s.maxHp` 的（S3 现在走这条）。
            unit.hp = unit.s.maxHp;
            unit.markDirty();
          }
          // the relay: 塔纳托斯's 20 s just ran out with him alive and still on the field → a FRESH 20 s
          // (`doll` is already false here, so the dollSwitch `enter()` accepts).
          if (!unit.trait.doll && unit.alive && unit.mem.makotoRelay === 1 && (unit.skill?.spec?.relayMask ?? null)) {
            relayToOrpheus(battle, unit);
            return;
          }
          if (unit.trait.doll && unit.alive) unit.mem.makotoSaw = true;
          else if (unit.mem.makotoSaw) { unit.mem.makotoSaw = false; allOutAttack(battle, unit); }
          applyMask(battle, unit);
          // 俄耳甫斯的「阻挡数+2」按当前面具同步（替身的 -99 已把基础压到 0 ⇒ 最终 0 + 2 = 2）。
          // 放在 applyMask 之后：面具/形态在这一 tick 已经定下来，两条切换路（fatal relay / use()）都覆盖到。
          syncDollBlock(battle, unit);
          // 技能条 = 本次 <替身> 的剩余时间（用户口径）。上游 `dollSwitch` 先跑 1 s 切换动画，提前拉条会让条与替身计时错位；
          // `trait:dollSwitching` 消失即替身态真正开始（`restartBar` 把条重置为完整时长）。reason 必须用 'relay'：各技能的
          // `onStart` 只对该 reason early-return（跳过"进状态"那一施放工作）。
          if (unit.trait.doll && unit.alive && unit.skill && !unit.skill.active && !unit.findBuff('trait:dollSwitching')) {
            restartBar(battle, unit, 'relay');
          }
          // back in the 本体 form the ordinary 1-1 (2 tiles) range returns (the <替身> form's x-1 is dropped with the
          // state): restored once per transition, and only while `bodyGrid` is what the data gave the chess. The mask of
          // the state that just ended too: the NEXT lethal hit is a <本体> hit, which picks 塔纳托斯 again.
          if (!unit.trait.doll && bodyGrid && unit.rangeGrid !== bodyGrid) { unit.rangeGrid = bodyGrid; battle.refreshRange(unit); }
          if (!unit.trait.doll && unit.mem.makotoMask != null) { unit.mem.makotoMask = null; unit.mem.makotoRelay = 0; }
        }, { owner: unit });
        battle.on('death', (ctx) => {
          // ★ 2026-10-17（用户：「我为什么技能期间出现了多次真实伤害 不应该替身状态结束才有吗」）：
          //   **这里漏了"是不是结城理本人死了"的判断**，是我引入的 bug。
          //   `death` 是**全局**事件，载荷 `{ unit, reason, killer, dying }`（battle/deploy.js:149）；
          //   `{ owner: unit }` 只是注册标记，**不过滤事件来源**（对比同文件上面的 `fatal` 处理器：
          //   它写了 `if (ctx.unit !== unit) return;`）。其它 kit 监听 death 时也都做了过滤
          //   （vigil.js:221 / ines.js:112 的 `if (c.unit !== unit) return;`）。
          //   少了这一句 ⇒ **替身形态下每打死一个敌人就触发一次总攻击**（实测：替身态 8→29 秒，
          //   12.83 秒时敌人死亡 → 天赋真实伤害在平A期间就打出来了，本应只在替身态**结束**时来一次）。
          if (ctx?.unit !== unit) return;
          if (!unit.mem.makotoSaw) return;
          unit.mem.makotoSaw = false;
          allOutAttack(battle, unit);   // the <替身> state ended by the knock-out: the squad still strikes
        }, { owner: unit });
        /**
         * "塔纳托斯在场时，开启技能或受到致命伤时改为召唤俄耳甫斯" (S3's own 被动): while 塔纳托斯 is the running mask, the
         * LETHAL hit does not knock him out — it switches the mask to 俄耳甫斯. The dollkeeper's own fatal hook (−100)
         * refuses a hit inside the state (the 替身 is the form that can be knocked out), so this guard holds the hit at 1
         * HP (`applyHpLoss` writes `prevented` back as ≥1 HP) and the `tick` hook below performs the switch — the same
         * `applyMask` / clip-set path the timed relay uses, with the state's own remaining 20 s, not a fresh entry.
         */
        if (sid === 'skchr_makoto_3') {
          // ★ 2026-10-16 修：优先级必须**高于 −100**。原来注册在 −150，理由是「−150 比 −100 后跑」——
          //   实测相反：`professions.js` 的 `installDollkeeper` 也注册在 **−100**，而它**先注册**，
          //   于是它先跑并把 `ctx.prevented = true`（"the 替身 is knocked out"），本条随即 `ctx.prevented`
          //   早退，`makotoFatalRelay` 永远设不上，tick 里那条切换也就永远不执行
          //   —— 表现为「塔纳托斯在场时受致命伤不会改为召唤俄耳甫斯」。
          //   提到 −50 后本条先跑：拦住这一击、留下标记，tick 里再切成俄耳甫斯（继承剩余时间，不重算）。
          battle.on('fatal', (ctx) => {
            if (ctx.unit !== unit || ctx.prevented || !unit.alive) return;
            if (!unit.trait.doll || unit.mem.makotoMask !== 'thanatos') return;
            ctx.prevented = true;
            unit.mem.makotoFatalRelay = true;
          }, { owner: unit, priority: -50 });
        }
        // S3's 闪避 for the allies of the mask net — 结城理 HIMSELF included (user's 口径: "自身获得闪避"; PRTS's "范围内友方
        // 干员" covers him, he stands on his own range). The aura is granted in the S3 spec's `onStart` (both bars), so
        // here only the roll itself, while that skill runs and 俄耳甫斯 is the mask.
        battle.on('hit', (ctx) => {
          const t = ctx.target;
          if (!t || t.side !== 'ally' || !(num(t.mem.makotoDodge, 0) > 0) || !unit.skill?.active) return;
          if (unit.mem.makotoMask !== 'orpheus') return;
          if (ctx.dmg && (ctx.dmg.type === 'phys' || ctx.dmg.type === 'arts') && battle.rng.chance(num(t.mem.makotoDodge))) {
            ctx.dmg.cancel = true;
            fx(battle, 'dodge', t);
          }
        }, { owner: unit });
        battle.on('skillEnd', (ctx) => {
          if (ctx.unit !== unit) return;
          for (const a of battle.alliesFor(unit, unit.ownerId)) a.mem.makotoDodge = 0;
        }, { owner: unit });
      },
    };
    return kit;
  },
};
