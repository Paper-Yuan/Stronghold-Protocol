// server/modverify/report.js — verification report shape (CF_MOD_TRI_PLAN.md §2-C2, frozen).
// One report per staging upload; five gates, each pass/fail/skip/not-run.
// skip ≠ pass: gates that could not run (missing acorn, missing CHROME_PATH) land as
// 'skip' and block `overall === 'pass'` until an admin manually clears them (C4 policy).

export const GATE_NAMES = Object.freeze({
  1: 'zip+schema 分层校验',
  2: 'ES2020 语法闸门',
  3: '确定性检查',
  4: '合并与 bot 局 SP_VERIFY',
  5: '客户端渲染冒烟',
});

export function createReport(packId) {
  return {
    packId,
    startedAt: Date.now(),
    gates: [1, 2, 3, 4, 5].map((gate) => ({ gate, name: GATE_NAMES[gate], status: 'not-run', detail: '', durationMs: 0 })),
    overall: 'not-run',
    finishedAt: null,
  };
}

/** Record one gate's outcome. detail is human-facing prose (also written into verify-report.json). */
export function recordGate(report, gate, status, detail, durationMs = 0, extra = {}) {
  const row = report.gates.find((g) => g.gate === gate);
  if (!row) throw new RangeError(`unknown gate ${gate}`);
  row.status = status;
  row.detail = detail;
  row.durationMs = durationMs;
  Object.assign(row, extra);
  return report;
}

/**
 * Finalize overall from the gates that actually RAN. Unselected gates stay 'not-run'
 * and are ignored; a run whose every selected gate passed is 'pass' even when others
 * were never invoked (a full 5-gate run with any skip → 'pending').
 */
export function finalizeReport(report) {
  report.finishedAt = Date.now();
  const ran = report.gates.filter((g) => g.status !== 'not-run').map((g) => g.status);
  if (!ran.length) { report.overall = 'not-run'; return report; }
  if (ran.includes('fail')) report.overall = 'fail';
  else if (ran.every((s) => s === 'pass')) report.overall = 'pass';
  else report.overall = 'pending'; // skips among the run gates — admin confirmation decides (C4)
  return report;
}

/** Write the report into the staging dir as verify-report.json. */
export async function writeReport(report, stagingDir) {
  const { promises: fsp } = await import('node:fs');
  const { join } = await import('node:path');
  await fsp.writeFile(join(stagingDir, 'verify-report.json'), JSON.stringify(report, null, 2));
  return report;
}
