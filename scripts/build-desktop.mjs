// Build the desktop bundle: `electron-builder --dir` (handoff/desktop-electron/packaging.md §2.1 — an unpacked directory
// is the distribution form; the player's existing habit is "unzip and run", and there is no auto-update to serve).
//
//   node scripts/build-desktop.mjs            # full build (art embedded)
//
// Output: dist/desktop/Stronghold-Protocol-v<version>-desktop-x64/ — the folder a release zip is made from.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'desktop');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const PRODUCT = 'Stronghold Protocol';
const DIR_NAME = `Stronghold-Protocol-v${VERSION}-desktop-x64`;

/** @param {string} dir @returns {{ files: number, bytes: number }} */
function measure(dir) {
  let files = 0;
  let bytes = 0;
  /** @param {string} d */
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files += 1;
        bytes += statSync(full).size;
      }
    }
  };
  walk(dir);
  return { files, bytes };
}

if (!existsSync(path.join(ROOT, 'node_modules', 'electron-builder', 'package.json'))) {
  console.error('electron-builder is not installed. Install it (dev-only, not global) and run again:');
  console.error('  npm i -D electron@45.2.1 electron-builder@26.18.0');
  process.exit(1);
}
if (!existsSync(path.join(ROOT, 'node_modules', 'electron'))) {
  console.error('electron is not installed. Install it (dev-only, not global) and run again:');
  console.error('  npm i -D electron@45.2.1 electron-builder@26.18.0');
  process.exit(1);
}
// Run electron-builder's own JS entry with this Node instead of the .cmd shim: Node refuses to spawn a .cmd without a
// shell, and a shell would then mangle the `--config.*` arguments.
const builderCli = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');

console.log(`[desktop] building ${PRODUCT} v${VERSION} (asar: false, full art)`);
const run = spawnSync(process.execPath, [builderCli, '--dir', `--config.directories.output=${OUT}`], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
});
if (run.error) {
  console.error(`[desktop] could not start electron-builder: ${run.error.message}`);
  process.exit(1);
}
if (run.status !== 0) {
  console.error(`[desktop] electron-builder failed (exit ${run.status}${run.signal ? `, signal ${run.signal}` : ''})`);
  process.exit(run.status ?? 1);
}

const unpacked = path.join(OUT, 'win-unpacked');
if (!existsSync(unpacked)) {
  console.error(`[desktop] expected ${unpacked} — electron-builder produced a different layout`);
  process.exit(1);
}
const finalDir = path.join(OUT, DIR_NAME);
// Guarded delete: only ever a directory directly under dist/desktop that this script itself names.
if (path.dirname(finalDir) !== OUT) throw new Error(`refusing to remove ${finalDir}`);
if (existsSync(finalDir)) rmSync(finalDir, { recursive: true, force: true });
renameSync(unpacked, finalDir);

const exe = path.join(finalDir, `${PRODUCT}.exe`);
const { files, bytes } = measure(finalDir);
console.log(`[desktop] output: ${finalDir}`);
console.log(`[desktop] exe: ${existsSync(exe) ? exe : '(not found — check productName)'}`);
console.log(`[desktop] ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
