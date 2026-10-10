// server/modverify/cli.js — verification pipeline entry (CF_MOD_TRI_PLAN.md §2-C2-1).
// Usage: node server/modverify/cli.js <stagingDir> [--gate=N] [--merger=<path>] [--timeout-ms=N]
// Exit codes: 0 = all selected gates passed; 1 = some gate failed; 2 = the verifier itself crashed.
//
// The game server NEVER imports unknown pack JS: gates that need to load kit code run
// in this dedicated verification process only. The merger is injected via --merger
// (default shared/customContent.js; D2 switches to server/mod/overlay.js) — this file
// contains no hard import of either merger (asserted by tools/assert/modverify-merger.mjs).

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReport, recordGate, finalizeReport, writeReport } from './report.js';

const DEFAULT_MERGER = 'shared/customContent.js';

function parseArgs(argv) {
  const opts = { gate: null, merger: DEFAULT_MERGER, timeoutMs: 120000 };
  const positional = [];
  for (const a of argv) {
    if (a.startsWith('--gate=')) opts.gate = Number(a.slice(7));
    else if (a.startsWith('--merger=')) opts.merger = a.slice(9);
    else if (a.startsWith('--timeout-ms=')) opts.timeoutMs = Number(a.slice(13));
    else positional.push(a);
  }
  if (positional.length !== 1) {
    console.error('usage: node server/modverify/cli.js <stagingDir> [--gate=N] [--merger=<path>] [--timeout-ms=N]');
    process.exit(2);
  }
  return { stagingDir: positional[0], ...opts };
}

/** Locate pack.zip + receipt.json inside the staging dir (uploadId dir or a smoke dir). */
async function loadStaging(stagingDir) {
  const zipPath = path.join(stagingDir, 'pack.zip');
  const receiptPath = path.join(stagingDir, 'receipt.json');
  if (await exists(zipPath)) {
    let receipt = {};
    try { receipt = JSON.parse(await fsp.readFile(receiptPath, 'utf8')); } catch {}
    return { zipPath, receipt };
  }
  // smoke mode: a bare dir of unzipped pack files (pack.json at root) — zip it in memory
  if (await exists(path.join(stagingDir, 'pack.json'))) return { zipPath: null, receipt: { uploadId: path.basename(stagingDir) } };
  throw new Error(`staging dir 内既无 pack.zip 也无 pack.json: ${stagingDir}`);
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function main() {
  const { stagingDir, gate, merger, timeoutMs } = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const { zipPath, receipt } = await loadStaging(stagingDir);
  const packId = receipt.uploadId || path.basename(stagingDir);
  const report = createReport(packId);

  const deadline = () => Date.now() - started > timeoutMs;

  // Load the merger through the injection point (never a hard import — see file header).
  const mergerPath = pathToFileURL(path.resolve(merger)).href;
  const mergerModule = await import(mergerPath);
  const mergeFn = mergerModule.mergeCustomContent || mergerModule.mergeOverlay || mergerModule.default;
  if (typeof mergeFn !== 'function') throw new Error(`--merger 注入件未导出合并函数: ${merger}`);

  const selected = gate != null ? [gate] : [1, 2, 3, 4, 5];
  for (const g of selected) {
    if (deadline()) { recordGate(report, g, 'fail', `超时 ${timeoutMs}ms`, Date.now() - started); break; }
    const t0 = Date.now();
    try {
      const gateModule = await import(`./gates/gate${g}.js`);
      const out = await gateModule.run({
        stagingDir, zipPath, receipt, mergeFn, mergerPath: merger,
        timeoutMs: timeoutMs - (Date.now() - started), packId,
      });
      recordGate(report, g, out.status, out.detail, Date.now() - t0, out.extra || {});
    } catch (err) {
      recordGate(report, g, 'fail', String(err?.stack || err).slice(0, 2000), Date.now() - t0);
    }
  }

  finalizeReport(report);
  await writeReport(report, stagingDir);

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.overall === 'pass' ? 0 : report.overall === 'fail' ? 1 : 0);
}

main().catch((err) => {
  console.error('[modverify] verifier crashed:', err);
  process.exit(2);
});
