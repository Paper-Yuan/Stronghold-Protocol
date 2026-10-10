// server/mod/publish.js — publish a VERIFIED pack (CF_MOD_TRI_PLAN.md §0.3 发布流程, C3).
//
// User's decision (2026-10-10): the admin uploads a whole zip → the server verifies it (C2)
// → the server SPLITS it: static art goes to the third-party CDN (deduped by sha256), data
// JSON + kit JS stay in a slim zip which is itself uploaded to the CDN under packs/<id>/<sha256>.zip
// → the catalog entry is written for the game server to aggregate at /mods/index.json.
//
// Precondition: a passing verification report in the staging dir. A pack whose report is
// missing, failed, or pending-admin-approval is refused — "检测正常后才拆分".

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { unpackModZip } from '../../shared/modZip.js';
import { sha256Of } from './cdnClient.js';
import { buildZip } from './zipWriter.js';
import { upsertPack } from './catalogStore.js';

/** Read the verification report if present. */
async function readReport(stagingDir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(stagingDir, 'verify-report.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Deep-rewrite every `art/<rel>` reference in the section data to its CDN URL. */
function rewriteArtRefs(sections, urlByRel) {
  let text = JSON.stringify(sections);
  for (const [rel, url] of Object.entries(urlByRel)) {
    // Only rewrite the pack-relative art reference forms; never touch unrelated strings.
    text = text.split(`art/${rel}`).join(url);
  }
  return JSON.parse(text);
}

/**
 * @param {string} stagingDir dir holding pack.zip + verify-report.json
 * @param {{ cdn: object, cacheRoot: string, allowPending?: boolean, log?: (m: string) => void }} opts
 * @returns {Promise<{ catalogEntry: object, report: object }>}
 */
export async function publishPack(stagingDir, { cdn, cacheRoot, allowPending = false, log = () => {} }) {
  const verify = await readReport(stagingDir);
  if (!verify) throw new Error('缺少 verify-report.json：必须先跑五道验证再发布');
  if (verify.overall === 'fail') throw new Error('验证未通过（overall=fail）：拒绝发布');
  if (verify.overall === 'pending' && !allowPending) {
    throw new Error('验证有 skip 项（overall=pending）：需管理员确认后以 allowPending 发布（C4 放行策略）');
  }
  if (verify.overall === 'not-run') throw new Error('验证未执行：拒绝发布');

  const zipPath = path.join(stagingDir, 'pack.zip');
  const zipBuffer = new Uint8Array(await fsp.readFile(zipPath));
  const { meta, sections, kits, art } = await unpackModZip(zipBuffer);
  if (!meta?.id) throw new Error('pack.json 缺 id：拒绝发布');

  const packId = meta.id;
  const artRels = Object.keys(art);

  // ---- 1. static art → CDN, deduped against the public index (one fetch for the batch) ----
  const index = await cdn.remoteIndex();
  const urlByRel = {};
  let uploaded = 0;
  let skipped = 0;
  for (const rel of artRels) {
    const key = `packs/${packId}/assets/${rel}`;
    const res = await cdn.put(key, Buffer.from(art[rel]), { source: packId, what: `MOD ${packId} 素材`, index });
    urlByRel[rel] = cdn.urlFor(key);
    if (res.skipped) skipped += 1;
    else uploaded += 1;
  }
  log(`[publish] ${packId}: 素材 ${artRels.length} 件（新传 ${uploaded} / 查重跳过 ${skipped}）`);

  // ---- 2. rewrite section art references to absolute CDN URLs ----
  const rewritten = rewriteArtRefs(sections, urlByRel);

  // ---- 3. slim zip: meta (minus the local art role) + rewritten data + kits ----
  const slimMeta = { ...meta };
  if (slimMeta.files && typeof slimMeta.files === 'object') {
    slimMeta.files = { ...slimMeta.files };
    delete slimMeta.files.art; // art no longer ships inside the pack
  }
  slimMeta.assets = {
    base: `${cdn.publicBase}/packs/${packId}/assets/`,
    index: urlByRel['index.json'] ?? null,
  };

  const members = { 'pack.json': JSON.stringify(slimMeta, null, 2) };
  for (const [section, json] of Object.entries(rewritten)) members[`${section}.json`] = JSON.stringify(json);
  for (const [name, src] of Object.entries(kits)) members[`kits/${name}`] = src;

  const slimZip = buildZip(members);
  const slimSha = sha256Of(slimZip);

  // ---- 4. slim zip → CDN (content-addressed; append-only means a re-publish mints a new key) ----
  const zipKey = `packs/${packId}/${slimSha}.zip`;
  await cdn.put(zipKey, slimZip, { source: packId, what: `MOD ${packId} 分发包`, index });

  // ---- 5. catalog entry (sha256/bytes describe the slim zip) + store ----
  const features = Array.isArray(meta.features) && meta.features.length
    ? meta.features.slice(0, 8).map((f) => String(f).slice(0, 60))
    : Object.keys(rewritten).map((s) => `${s} 扩展`);

  const catalogEntry = {
    id: packId,
    name: String(meta.name || packId).slice(0, 120),
    version: String(meta.version || '0.0.0').slice(0, 32),
    minApp: String(meta.app || '>=0.2.0').slice(0, 32),
    sha256: slimSha,
    bytes: slimZip.length,
    url: cdn.urlFor(zipKey),
    features,
  };
  await upsertPack(cacheRoot, catalogEntry);

  const report = {
    packId,
    publishedAt: Date.now(),
    assets: { total: artRels.length, uploaded, skipped, base: slimMeta.assets.base, index: slimMeta.assets.index },
    zip: { key: zipKey, sha256: slimSha, bytes: slimZip.length },
    catalogEntry,
    verification: { overall: verify.overall, gates: verify.gates.map((g) => ({ gate: g.gate, status: g.status })) },
  };
  await fsp.writeFile(path.join(stagingDir, 'publish-report.json'), JSON.stringify(report, null, 2));

  // flip the staging receipt to published (best effort — the receipt is informational)
  try {
    const receiptPath = path.join(stagingDir, 'receipt.json');
    const receipt = JSON.parse(await fsp.readFile(receiptPath, 'utf8'));
    receipt.status = 'published';
    receipt.publishedAt = report.publishedAt;
    receipt.packId = packId;
    await fsp.writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  } catch { /* no receipt (smoke dir) — fine */ }

  log(`[publish] ${packId}: 瘦身 zip ${slimZip.length} 字节 → ${zipKey}`);
  return { catalogEntry, report };
}
