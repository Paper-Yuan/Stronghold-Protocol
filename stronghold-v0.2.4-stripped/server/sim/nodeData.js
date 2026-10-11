// server/sim/nodedata.js — the Node-only default data loader of the simulation (DESIGN §14).
//
// server/sim/** is shared with browsers (served read-only at /sim/), so every Node API lives here. simdata.js imports
// this module dynamically — and only under Node — to build its default DataSource:
//   * generated data: `server/data.js → getData()` (data/*.json, tools/build-data.mjs),
//   * research fallback: docs/research/03-operators.json, 05-enemies.json, 05-maps.json (sim tests before/without data).
// Browsers never load this file: they inject the fetched /data/*.json with simdata.js setSimData(data).
//
// This module must not import simdata.js (simdata awaits this module at its top level; a cycle would deadlock).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });

/** data/*.json through the server/data.js singleton (null when unavailable). */
export async function loadGenerated() {
  try {
    const mod = await import('../data.js');
    return mod.getData({ log: QUIET });
  } catch {
    return null;
  }
}

/** Drop the server/data.js singleton, then load again (tests / hot reload after data regeneration). */
export async function reloadGenerated() {
  try {
    const mod = await import('../data.js');
    mod.resetData?.();
  } catch { /* ignore */ }
  return loadGenerated();
}

/**
 * Research JSON in the raw-map shape a DataSource accepts: `{ chess, enemies, tokens, stages, waves }` (tokens carry
 * `byOwner[chessId]` variants; stages get the research legend).
 */
export function loadResearch() {
  const read = (f) => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'research', f), 'utf8')); } catch { return null; }
  };
  const ops = read('03-operators.json');
  const en = read('05-enemies.json');
  const maps = read('05-maps.json');
  const chess = {};
  const tokens = {};
  for (const c of ops?.chess ?? []) {
    chess[c.chessId] = c;
    for (const t of c.tokens ?? []) {
      if (!tokens[t.tokenId]) tokens[t.tokenId] = { ...t, byOwner: {} };
      tokens[t.tokenId].byOwner[c.chessId] = t;
    }
  }
  const stages = {};
  for (const [id, s] of Object.entries(maps?.stages ?? {})) {
    stages[id] = { ...s, legend: maps?._meta?.legend ?? null };
  }
  return { chess, enemies: en?.enemies ?? {}, tokens, stages, waves: maps?.roundLevels ?? {} };
}
