#!/usr/bin/env node
// tools/assert/modverify-merger.mjs — C2 gate4 红线：cli.js 不得硬 import 任何合并器。
// 合并器必须经 --merger 注入（D2 落地后默认值切换），否则验证时合并语义 ≠ 运行时合并语义。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = readFileSync(join(ROOT, 'server/modverify/cli.js'), 'utf8');
const gate4 = readFileSync(join(ROOT, 'server/modverify/gates/gate4.js'), 'utf8');

const bad = [];
for (const [name, src] of [['cli.js', cli], ['gate4.js', gate4]]) {
  const m = src.match(/^import\s+.*from\s+['"]([^'"]*(?:customContent|mod\/overlay)[^'"]*)['"]/gm);
  if (m) bad.push(`${name}: 硬 import 合并器 ${m.join(', ')}`);
  if (/from\s+['"][^'"]*customContent\.js['"]/.test(src)) bad.push(`${name}: 引用 customContent.js 于 import 语句`);
}
if (bad.length) { console.error('FAIL:', bad.join('; ')); process.exit(1); }
console.log('OK: modverify 合并器全部经 --merger 注入，cli/gate4 零硬 import');
