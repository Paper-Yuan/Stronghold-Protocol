// scripts/pack-release.mjs — 打包精简全量服务器发布包 (排除安卓工程、大测试文件、git 历史)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, `stronghold-v${APP_VERSION}-server-release.tar.gz`);

console.log(`[Pack] 开始打包全量服务端生产发布包 v${APP_VERSION}...`);

const excludes = [
  '--exclude=.git',
  '--exclude=.github',
  '--exclude=.agents',
  '--exclude=.cache',
  '--exclude=android',
  '--exclude=*.apk',
  '--exclude=node_modules',
  '--exclude=*.tar.gz',
  '--exclude=*.zip',
  '--exclude=.devcontainer',
  '--exclude=test/fixtures',
];

const includeTargets = [
  'server',
  'shared',
  'public',
  'data',
  'tools',
  'deploy',
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'hot-swap.sh',
  'nginx-stronghold.conf',
];

// Ensure deploy directory exists
if (!fs.existsSync(path.join(ROOT, 'deploy'))) {
  fs.mkdirSync(path.join(ROOT, 'deploy'), { recursive: true });
}

try {
  const cmd = `tar -czf "${OUT_FILE}" ${excludes.join(' ')} ${includeTargets.join(' ')}`;
  console.log(`[Pack] 执行打包命令...`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });

  const stat = fs.statSync(OUT_FILE);
  const sizeMb = (stat.size / 1024 / 1024).toFixed(2);
  console.log(`[Pack] 打包完成！`);
  console.log(`  - 产物文件: ${OUT_FILE}`);
  console.log(`  - 大小: ${sizeMb} MB`);
} catch (err) {
  console.error(`[Pack] 打包失败:`, err);
  process.exit(1);
}
