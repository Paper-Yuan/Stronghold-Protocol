#!/usr/bin/env node
// tools/kit-coverage.mjs — which selectable skills of every visible chess have a hand-authored skill spec (DESIGN §16).
//
// Operator loadouts let the player pick any skill unlocked for both the normal and the elite chess (shared/protocol.js
// loadoutOptions — exactly what room.loadout accepts). The kit loader (server/sim/content/index.js selectSkillSpec) uses, for the SELECTED skill:
//   skills[skillId] of the kit  → 'skills'   (hand-authored per skill)
//   kit.skill, default skill only → 'kit'     (hand-authored default)
//   otherwise                    → 'generic'  (content/generic.js from the blackboard — an approximation)
// A skill counts as covered when both its normal and its elite def get a hand-authored spec ('skills' | 'kit').
//
// Usage: node tools/kit-coverage.mjs [--json] [--missing] [--tier N] [--strict]
//   --json     machine-readable report { summary, chess: [{ chessId, name, tier, skills: [{ index, skillId, name,
//              isDefault, normal, elite, covered }] }] } on stdout
//   --missing  list only the chess with at least one uncovered skill
//   --tier N   only tier N (1–6)
//   --strict   exit code 1 when any selectable skill is uncovered (CI once every kit is authored)
// Unknown options are errors (exit code 2).

import { getDefaultSource } from '../server/sim/simdata.js';
import { loadoutOptions } from '../shared/protocol.js';
import { KITS, skillSpecSource } from '../server/sim/content/index.js';

const USAGE = 'usage: node tools/kit-coverage.mjs [--json] [--missing] [--tier N] [--strict]';

function parseArgs(argv) {
  const o = { json: false, missing: false, tier: null, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--missing') o.missing = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '--tier') {
      const t = Number(argv[++i]);
      if (!Number.isInteger(t) || t < 1 || t > 6) return null;
      o.tier = t;
    } else return null;
  }
  return o;
}

/**
 * Coverage report of every visible chess (optionally one tier).
 * @param {{ tier?: number|null, kits?: object, ds?: object }} [opts]
 */
export function kitCoverage({ tier = null, kits = KITS, ds = getDefaultSource() } = {}) {
  const chessMap = ds.raw?.chess ?? {};
  const rows = [];
  const bases = Object.values(chessMap)
    .filter((c) => c && !c.isGolden && c.visible && (tier == null || c.tier === tier))
    .sort((a, b) => a.tier - b.tier || String(a.chessId).localeCompare(String(b.chessId), 'en', { numeric: true }));
  for (const base of bases) {
    if (!Array.isArray(base.skills)) continue;
    const choices = loadoutOptions(base, base.goldenId ? chessMap[base.goldenId] ?? null : null);
    const skills = choices.skills.map((index) => {
      const rec = base.skills.find((s) => s.index === index);
      const src = (id) => {
        const def = chessMap[id] ? ds.getChess(id, { skillIndex: index }) : null;
        return def ? skillSpecSource(def, kits) : 'none';
      };
      const normal = src(base.chessId);
      const elite = base.goldenId ? src(base.goldenId) : normal;
      const authored = (s) => s === 'skills' || s === 'kit';
      return { index, skillId: rec.skillId, name: rec.name, isDefault: !!rec.isDefault, normal, elite, covered: authored(normal) && authored(elite) };
    });
    rows.push({ chessId: base.chessId, name: base.name, tier: base.tier, skills });
  }
  const all = rows.flatMap((r) => r.skills);
  const summary = {
    chess: rows.length,
    skills: all.length,
    covered: all.filter((s) => s.covered).length,
    defaultCovered: all.filter((s) => s.isDefault && s.covered).length,
    defaults: all.filter((s) => s.isDefault).length,
    chessFullyCovered: rows.filter((r) => r.skills.every((s) => s.covered)).length,
  };
  return { summary, chess: rows };
}

const isMain = import.meta.url === new URL(process.argv[1] ?? '', 'file://').href || process.argv[1]?.endsWith('kit-coverage.mjs');
if (isMain) {
  const o = parseArgs(process.argv.slice(2));
  if (!o) {
    console.error(USAGE);
    process.exit(2);
  }
  const rep = kitCoverage({ tier: o.tier });
  const list = o.missing ? rep.chess.filter((r) => r.skills.some((s) => !s.covered)) : rep.chess;
  if (o.json) {
    process.stdout.write(JSON.stringify({ summary: rep.summary, chess: list }, null, 1) + '\n');
  } else {
    const mark = (s) => (s.covered ? '✓' : s.normal === s.elite ? `· ${s.normal}` : `· ${s.normal}/${s.elite}`);
    for (const r of list) {
      const cells = r.skills.map((s) => `S${s.index + 1}${s.isDefault ? '*' : ''} ${s.name} ${mark(s)}`);
      console.log(`T${r.tier} ${r.name.padEnd(8, '　')} ${r.chessId.padEnd(18)} ${cells.join(' | ')}`);
    }
    const s = rep.summary;
    console.log(`\n${s.covered}/${s.skills} selectable skills hand-authored (defaults ${s.defaultCovered}/${s.defaults}); ` +
      `${s.chessFullyCovered}/${s.chess} chess fully covered. (* = default skill; ✓ = normal+elite authored; ` +
      `· = falls back to: generic | none (no kit))`);
  }
  if (o.strict && rep.summary.covered < rep.summary.skills) process.exitCode = 1;
}
