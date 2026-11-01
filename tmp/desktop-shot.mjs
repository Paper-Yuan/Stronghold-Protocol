// Throwaway: drive the packaged app's own smoke hook (desktop/main.mjs `--sp-screenshot=`). Node spawns the exe with
// UTF-16 args, so an ASCII-only path avoids the cmd.exe code-page mangling seen with a Chinese working directory.
//
//   node tmp/desktop-shot.mjs <exe> <shotPath> [--local]
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

const [, , exe, shot, ...rest] = process.argv;
if (!exe || !shot) {
  console.error('usage: node tmp/desktop-shot.mjs <exe> <shot> [--local]');
  process.exit(2);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['--no-sandbox', `--user-data-dir=E:\\Workbox\\sp-ud`, `--sp-screenshot=${shot}`, ...rest];
const child = spawn(exe, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
const timer = setTimeout(() => { console.error('timeout, killing'); child.kill(); }, 120000);
child.on('exit', (code) => {
  clearTimeout(timer);
  console.log(log.trim().split('\n').slice(-12).join('\n'));
  console.log(`[driver] exit ${code}; shot exists: ${existsSync(shot)}${existsSync(shot) ? ` (${statSync(shot).size} bytes)` : ''}`);
  process.exit(existsSync(shot) ? 0 : 1);
});
