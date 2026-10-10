// server/modverify/run.js — server-side wrapper: fork the verifier process (§2-C2-1).
// The game server calls this instead of importing gates itself. A crashed/timed-out
// verifier never takes the game server with it: exit 0 = all gates pass, 1 = some fail,
// 2 = verifier crashed. Overall status is read from the staging dir's verify-report.json.

import { fork } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run the verification pipeline for one staged upload.
 * @param {string} stagingDir absolute path of the staging dir (contains pack.zip)
 * @param {{ gate?: number|null, merger?: string, timeoutMs?: number, log?: (msg: string) => void }} opts
 * @returns {Promise<{ code: 0|1|2, report: object|null, reportPath: string }>}
 */
export async function verifyPack(stagingDir, { gate = null, merger, timeoutMs = 120000, log = () => {} } = {}) {
  const args = [stagingDir];
  if (gate != null) args.push(`--gate=${gate}`);
  if (merger) args.push(`--merger=${merger}`);
  args.push(`--timeout-ms=${timeoutMs}`);

  const child = fork(path.join(HERE, 'cli.js'), args, { silent: true });
  child.stdout?.on('data', (d) => log(String(d).trim()));
  child.stderr?.on('data', (d) => log(`[verifier stderr] ${String(d).trim()}`));

  const code = await new Promise((resolve) => {
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(2);
    }, timeoutMs + 5000);
    child.on('exit', (c) => { clearTimeout(killer); resolve(c ?? 2); });
    child.on('error', () => { clearTimeout(killer); resolve(2); });
  });

  const reportPath = path.join(stagingDir, 'verify-report.json');
  let report = null;
  try { report = JSON.parse(await fsp.readFile(reportPath, 'utf8')); } catch {}
  return { code, report, reportPath };
}
