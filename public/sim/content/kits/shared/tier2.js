// server/sim/content/kits/shared/tier2.js — helpers and notes of the Tier 2 operator kits (formerly tier2.js; the kits
// live one per file in ../ops/).
//
// export default { [baseChessId]: (bb, chess, def) => Kit } (docs/SIM.md §7.2). Shared helpers live in shared/tier1.js
// (named exports). Numbers come from the skill / talent / trait blackboards (elite module upgrades are in the elite
// record's trait.bb and hidden index −1 talents). fx kinds: see the shared/tier1.js header.
//
// Covered (normal + elite): 2_01 送葬人 2_02 赫默 2_03 崖心(H) 2_04 小满 2_05 哈洛德 2_06 莎草 2_07 幽灵鲨 2_08 泡泡
// 2_09 休谟斯 2_10 洛洛 2_11 风丸 2_12 砾 2_13 蒂比 2_14 调香师 2_15 协律(H) 2_16 拉普兰德 2_17 折桠 2_18 灰毫 2_19 锡人.
//
// Operator loadouts (DESIGN §16): every visible chess also authors its selectable NON-default skill in `skills`
// ({ [skillId]: SkillSpec }, official Lv4 / Lv7 blackboards — the kit function receives the SELECTED skill's `bb`, so
// every spec is built from `bb`; the trigger rule comes from that skill's data). Talent / install hooks that belong to
// the default skill only (target locks, counters, hit triggers) check onDefaultSkill(chess). Module choices need no
// code here: `chess` is the loadout-resolved record (trait.bb / talents of the selected module, or none).

/**
 * Whether the SELECTED skill of a loadout-resolved chess record is its default skill (DESIGN §16: `chess.skill` is the
 * selected SkillRecord, `chess.skills[]` flags the default one). Records without skill choices count as default.
 */
function onDefaultSkill(chess) {
  const d = (chess?.skills ?? []).find((s) => s && s.isDefault);
  return !d || !chess?.skill || d.skillId === chess.skill.skillId;
}

export { onDefaultSkill };
