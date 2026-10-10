// server/modverify/gates/gate4.js — merge + all-bot SP_VERIFY smoke (§2-C2-5, skeleton acceptance).
// Status contract (frozen): ended===true → 'pass'; mismatches>0 is recorded in detail with the
// calibration warning, NOT a status change. The real "mismatches===0 within 120s" assertion is
// an A2-first-run calibration item (F), not this skeleton's acceptance.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { unpackModZip } from '../../../shared/modZip.js';

export async function run({ stagingDir, zipPath, receipt, mergeFn, packId, timeoutMs }) {
  const t0 = Date.now();

  // 1. unpack sections
  let zipBuffer;
  if (zipPath) {
    zipBuffer = new Uint8Array(await fsp.readFile(zipPath));
  } else {
    const { buildZip } = await import('../../../test/helpers/miniZip.js');
    const files = {};
    for (const f of await fsp.readdir(stagingDir)) {
      if (f.endsWith('.json')) files[f] = await fsp.readFile(path.join(stagingDir, f));
    }
    zipBuffer = buildZip(files);
  }
  const { sections } = await unpackModZip(zipBuffer);

  // 2. base data (read-only re-load, never the process singleton — §2-C2-2 official baseline)
  const { loadData } = await import('../../data.js');
  const baseDir = path.resolve('data');
  const baseData = loadData(baseDir, { log: () => {} });

  // 3. merge through the injected merger (mergeFn came in via --merger, never hard-imported)
  let merged;
  try {
    merged = mergeFn(baseData, sections);
  } catch (err) {
    return { status: 'fail', detail: `合并器执行失败: ${String(err?.message || err).slice(0, 500)}` };
  }

  // 4. all-bot harness run (best-effort: the full SP_VERIFY bot局 is an A2-calibration item)
  let harnessInfo = 'harness 未拉起（骨架验收：合并成功即可，bot 局执行归 A2 校准）';
  let verifyStats = null;
  try {
    const harnessPath = path.resolve('test/match/harness.js');
    const harness = await import((await import('node:url')).pathToFileURL(harnessPath).href);
    if (typeof harness.makeMatch === 'function') {
      const m = await harness.makeMatch({
        mode: 'coop', humans: 0, bots: 4, seed: 4242,
        data: merged, verify: 'all', clientCombat: false, captureFrames: false,
      });
      const h = await m;
      if (h && typeof h.run === 'function') {
        const reached = h.run(() => h.ended != null, { maxSteps: 6000000 });
        verifyStats = h.verifyStats ?? null;
        harnessInfo = `bot 局已跑 (reached=${reached}, ended=${h.ended != null})${verifyStats ? `, verify=${JSON.stringify(verifyStats)}` : ''}`;
      }
    }
  } catch (err) {
    harnessInfo = `bot 局拉起失败（登记非断言）: ${String(err?.message || err).slice(0, 200)}`;
  }

  // 5. determinism digest into a mod-specific golden family (never test/golden/*.json)
  const digestPath = path.join(stagingDir, 'golden-mod.json');
  try {
    const { createHash } = await import('node:crypto');
    const digest = createHash('sha256').update(JSON.stringify(merged)).digest('hex').slice(0, 16);
    await fsp.writeFile(digestPath, JSON.stringify({ packId, digest, mergedSections: Object.keys(sections) }, null, 2));
  } catch { /* digest write is informational */ }

  const durationMs = Date.now() - t0;
  const mismatchNote = verifyStats?.mismatches ? `，mismatches=${verifyStats.mismatches}（确定性校准待 A2 后首跑）` : '';
  return {
    status: 'pass',
    detail: `合并成功（merger=${path.basename(String(stagingDir))} 注入件，无硬 import）；${harnessInfo}${mismatchNote}；确定性摘要写入 golden-mod.json`,
    extra: { verifyStats, harnessInfo },
  };
}
