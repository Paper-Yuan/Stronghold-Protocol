// server/modverify/gates/gate1.js — zip unpack + schema layered validation (§2-C2-2).
// L1 contract layer: pack.json required fields (B1's data type files roles now validate
//   against shared/packs.js normalizeManifest — B1 landed before C2).
// L2 record layer: section JSON shapes against MOD_UI_ADAPTATION_PLAN.md §4 minimal field
//   sets + CUSTOM_SECTIONS whitelist; out-of-whitelist section names are hard errors.

import { promises as fsp } from 'node:fs';
import { unpackModZip } from '../../../shared/modZip.js';
import { normalizeManifest, PACK_TYPES } from '../../../shared/packs.js';
import { CUSTOM_SECTIONS } from '../../../shared/customContent.js';

// Minimal required fields per section (MOD_UI_ADAPTATION_PLAN.md §4.1–4.7 data contract).
// Each entry: field must exist on EVERY record of that section. Sections not listed here
// (e.g. variants) are shape-checked only to be an array of objects.
const SECTION_REQUIRED = {
  chess: ['chessId', 'name'],
  records: ['id', 'name'],
  tokens: ['tokenId'],
  bands: ['bandId'],
  items: ['id', 'name'],
  skins: ['id'],
};

function sectionOf(records, name) {
  return records && Array.isArray(records) ? records : records?.[name];
}

export async function run({ stagingDir, zipPath, packId }) {
  let zipBuffer;
  if (zipPath) {
    zipBuffer = new Uint8Array(await fsp.readFile(zipPath));
  } else {
    // smoke mode: synthesize a zip from a bare directory so the same gates run
    const { buildZip } = await import('../../../test/helpers/miniZip.js');
    const files = {};
    for (const f of await fsp.readdir(stagingDir)) {
      if (f.endsWith('.json') || f === 'pack.json') files[f] = await fsp.readFile(path.join(stagingDir, f));
    }
    zipBuffer = buildZip(files);
  }

  const { meta, sections, kits, art } = await unpackModZip(zipBuffer);

  // ---- L1: pack.json contract via the real normalizeManifest (B1-2 roles table) ----
  if (!meta) throw new Error('pack.json 缺失或 JSON 坏（unpackModZip fail-closed 已抛）');
  const m = normalizeManifest(meta, { id: meta.id || packId, folder: true });
  const l1Problems = [];
  if (m.problems.length) l1Problems.push(...m.problems);
  if (meta.type && meta.type !== 'data') l1Problems.push(`type 必须是 'data'（实际 '${meta.type}'）`);
  if (!meta.name) l1Problems.push('缺 name');
  if (!meta.version) l1Problems.push('缺 version');
  if (!meta.app) l1Problems.push('缺 app');
  if (!meta.credits) l1Problems.push('缺 credits');
  if (l1Problems.length) {
    return { status: 'fail', detail: `L1 契约层 ${l1Problems.length} 个问题: ${l1Problems.join('; ')}` };
  }

  // ---- L2: section shapes against the whitelist + required fields ----
  const sectionNames = Object.keys(sections);
  const whitelist = new Set(CUSTOM_SECTIONS);
  const outOfBand = sectionNames.filter((s) => !whitelist.has(s));
  if (outOfBand.length) {
    return { status: 'fail', detail: `越界段名（不在 CUSTOM_SECTIONS 白名单）: ${outOfBand.join(', ')}` };
  }

  const l2Problems = [];
  for (const [section, required] of Object.entries(SECTION_REQUIRED)) {
    const recs = sectionOf(sections[section], section);
    if (!recs) continue;
    if (!Array.isArray(recs)) { l2Problems.push(`${section} 不是数组`); continue; }
    recs.forEach((r, i) => {
      if (!r || typeof r !== 'object') { l2Problems.push(`${section}[${i}] 不是对象`); return; }
      for (const f of required) {
        if (r[f] === undefined || r[f] === null || r[f] === '') l2Problems.push(`${section}[${i}] 缺 ${f}`);
      }
    });
    if (recs.length > 2000) l2Problems.push(`${section} 记录数过大 (${recs.length})`);
  }
  // every non-whitelisted-required section still must be an array of objects
  for (const section of sectionNames) {
    if (SECTION_REQUIRED[section]) continue;
    const recs = sections[section];
    if (recs !== undefined && !Array.isArray(recs) && typeof recs !== 'object') {
      l2Problems.push(`${section} 形状异常（应为数组或对象）`);
    }
  }

  if (l2Problems.length) {
    return { status: 'fail', detail: `L2 记录层 ${l2Problems.length} 个问题: ${l2Problems.slice(0, 20).join('; ')}` };
  }

  const kitCount = Object.keys(kits).length;
  const artCount = Object.keys(art).length;
  return {
    status: 'pass',
    detail: `L1 契约通过（B1 files 角色表校验并入）；L2 ${sectionNames.length} 段 ${Object.values(sections).reduce((n, s) => n + (Array.isArray(s) ? s.length : 1), 0)} 条记录通过；kits ${kitCount}、art ${artCount}`,
    extra: { sectionNames, kitCount, artCount },
  };
}
