// 宴's skill clips (the owner's playtest of 2026-10-07: 「干员宴的模型开局时是跪地的状态」): her one unnumbered skill set
// (Skill_Start / Skill_Loop / Skill_End, a sit-down rest) belongs to S1 分神 only; S2 — the 卫戍 default 落地斩·破门, on
// from every deployment for its duration — attacks with her ordinary clips (tools/assets/spine.js PREFAB_SPINE_ROLES).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRoles } from '../tools/assets/anim-roles.mjs';
import { applyRoleFix, PREFAB_SPINE_ROLES } from '../tools/assets/spine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIPS = ['Attack', 'Die', 'Idle', 'Skill_End', 'Skill_Loop', 'Skill_Start', 'Start'];
const durations = Object.fromEntries(CLIPS.map((n) => [n, 1]));

test('宴: the resolver alone gives both skill indices the sit-down set; the role fix keeps it for S1 and attacks normally in S2', () => {
  const resolved = resolveRoles(CLIPS, { skillIndices: [1, 0], durations });
  assert.equal(resolved.skills['1'].loop, 'Skill_Loop', 'by name alone, S2 would kneel (the reported bug)');
  const { roles, missing } = applyRoleFix(resolved, PREFAB_SPINE_ROLES.char_337_utage, durations);
  assert.deepEqual(missing, []);
  assert.equal(roles.skills['0'].loop, 'Skill_Loop', 'S1 分神 keeps her rest');
  assert.equal(roles.skills['1'].loop, 'Attack');
  assert.equal(roles.skills['1'].via, 'attack', "via 'attack': the renderer plays no skill clip (render/spine.js)");
  assert.equal(roles.skill.index, 1, 'the primary (equipped by default) skill is S2');
  assert.equal(roles.skill.via, 'attack');
});

test('宴: the shipped manifest carries the fix on both models', () => {
  const a = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
  for (const side of ['front', 'back']) {
    const an = a.chars.char_337_utage.spine[side].anims;
    assert.equal(an.skill.via, 'attack', `${side}: no kneeling during 落地斩·破门`);
    assert.equal(an.skills['1'].via, 'attack', side);
    assert.equal(an.skills['0'].loop, 'Skill_Loop', `${side}: S1 分神 sits down`);
  }
});
