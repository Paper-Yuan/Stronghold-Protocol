#!/usr/bin/env node
// tools/publish-mod.mjs — publish a verified mod pack (CF_MOD_TRI_PLAN.md C3).
//
// Flow: [optional verify] → split (art → CDN, data+kit → slim zip) → slim zip → CDN →
// catalog entry into server/.mod-cache/catalog.json (served at /mods/index.json).
//
//   node tools/publish-mod.mjs <stagingDir> [--verify] [--allow-pending] [--cache=server/.mod-cache] [--dry-run]
//
// --dry-run resolves nothing remote and prints what would be uploaded.

import path from 'node:path';
import { createCdnClient } from '../server/mod/cdnClient.js';
import { publishPack } from '../server/mod/publish.js';
import { verifyPack } from '../server/modverify/run.js';

function parseArgs(argv) {
  const opts = { verify: false, allowPending: false, dryRun: false, cacheRoot: null, staging: null };
  for (const a of argv) {
    if (a === '--verify') opts.verify = true;
    else if (a === '--allow-pending') opts.allowPending = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--cache=')) opts.cacheRoot = a.slice(8);
    else if (!a.startsWith('--')) opts.staging = a;
  }
  return opts;
}

async function main() {
  const { staging, verify, allowPending, dryRun, cacheRoot } = parseArgs(process.argv.slice(2));
  if (!staging) {
    console.error('usage: node tools/publish-mod.mjs <stagingDir> [--verify] [--allow-pending] [--cache=DIR] [--dry-run]');
    process.exit(2);
  }
  const cache = path.resolve(cacheRoot || path.join('server', '.mod-cache'));
  const log = (m) => console.log(m);

  if (verify) {
    log(`[publish] 先跑五道验证: ${staging}`);
    const { code, report } = await verifyPack(path.resolve(staging), { timeoutMs: 180000 });
    log(`[publish] 验证 overall=${report?.overall} (exit ${code})`);
    if (code !== 0 && report?.overall !== 'pending') {
      console.error('[publish] 验证未通过，终止发布');
      process.exit(1);
    }
  }

  const cdn = createCdnClient({});
  if (dryRun) {
    // Resolve the plan without uploading: read the pack and report what would go where.
    const { promises: fsp } = await import('node:fs');
    const { unpackModZip } = await import('../shared/modZip.js');
    const zip = new Uint8Array(await fsp.readFile(path.join(staging, 'pack.zip')));
    const { meta, art } = await unpackModZip(zip);
    log(`[dry-run] pack=${meta?.id} 素材 ${Object.keys(art).length} 件 → packs/${meta?.id}/assets/**`);
    log(`[dry-run] 瘦身 zip → packs/${meta?.id}/<sha256>.zip（CDN ${cdn.publicBase}）`);
    log('[dry-run] catalog 条目写入 ' + path.join(cache, 'catalog.json'));
    return;
  }

  const { catalogEntry, report } = await publishPack(path.resolve(staging), { cdn, cacheRoot: cache, allowPending, log });
  await cdn.kick().catch((err) => log(`[publish] kick 失败（发布轮可稍后手动催）: ${err.message}`));
  log(JSON.stringify({ catalogEntry, assets: report.assets, zip: report.zip }, null, 2));
}

main().catch((err) => { console.error('[publish] 失败:', err); process.exit(1); });
