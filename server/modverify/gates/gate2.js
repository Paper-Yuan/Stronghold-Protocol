// server/modverify/gates/gate2.js — ES2020 syntax gate (§2-C2-3).
// Same parse contract as test/es2020-syntax.test.js:40: acorn.parse with ecmaVersion 2020,
// sourceType 'module'. acorn is a devDependency; when it cannot load this gate reports
// 'skip' (never 'pass') so C3's admin-confirmation policy decides.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { unpackModZip } from '../../../shared/modZip.js';

export async function run({ zipPath, stagingDir, packId }) {
  let acorn;
  try {
    acorn = await import('acorn');
  } catch {
    return { status: 'skip', detail: 'acorn 未安装（npm install 后重跑）；按 §2-C2 报告 skip≠pass，放行归管理员确认' };
  }

  let zipBuffer;
  if (zipPath) {
    zipBuffer = new Uint8Array(await fsp.readFile(zipPath));
  } else {
    const { buildZip } = await import('../../../test/helpers/miniZip.js');
    const files = {};
    for (const f of await fsp.readdir(stagingDir)) {
      if (f.endsWith('.json') || f.endsWith('.js')) files[f] = await fsp.readFile(path.join(stagingDir, f));
    }
    zipBuffer = buildZip(files);
  }
  const { kits } = await unpackModZip(zipBuffer);

  const files = Object.entries(kits);
  if (!files.length) return { status: 'pass', detail: '包内无 .js 文件，无语法风险面' };

  const errors = [];
  for (const [name, code] of files) {
    try {
      acorn.parse(code, { ecmaVersion: 2020, sourceType: 'module' });
    } catch (err) {
      errors.push(`${name}:${err.loc?.line ?? '?'}:${err.loc?.column ?? '?'} ${err.message.split(' (')[0]}`);
    }
  }

  if (errors.length) {
    return { status: 'fail', detail: `${errors.length} 处 ES2020 语法违规: ${errors.slice(0, 10).join('; ')}` };
  }
  return { status: 'pass', detail: `${files.length} 个 .js 文件 ES2020 解析通过（Chromium 80-88 兼容面）` };
}
