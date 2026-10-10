// server/modverify/gates/gate3.js — determinism check (§2-C2-4).
// AST walk (not regex — comments and strings must not false-positive). Flags calls to
// nondeterministic sources: Math.random, Date.now, crypto.randomUUID, performance.now,
// new Date() with zero arguments. acorn absent → 'skip'.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { unpackModZip } from '../../../shared/modZip.js';

// Forbidden call targets: [object path, property]. A call `obj.prop(...)` is flagged;
// zero-arg `new Date()` is flagged separately (constructor, not member call).
const FORBIDDEN_CALLS = [
  [['Math'], 'random'],
  [['Date'], 'now'],
  [['crypto'], 'randomUUID'],
  [['performance'], 'now'],
];

function* walk(node, parent = null) {
  if (!node || typeof node !== 'object') return;
  yield [node, parent];
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) yield* walk(c, node);
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      yield* walk(child, node);
    }
  }
}

function isForbiddenCall(node) {
  if (node.type !== 'CallExpression') return null;
  const callee = node.callee;
  if (callee.type !== 'MemberExpression' || callee.computed) return null;
  const obj = callee.object;
  if (obj.type !== 'Identifier') return null;
  for (const [path, prop] of FORBIDDEN_CALLS) {
    if (path[0] === obj.name && callee.property.type === 'Identifier' && callee.property.name === prop) {
      return `${obj.name}.${prop}()`;
    }
  }
  return null;
}

function isNewDateZeroArg(node) {
  return node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'Date' && (!node.arguments || node.arguments.length === 0);
}

export async function run({ zipPath, stagingDir, packId }) {
  let acorn;
  try {
    acorn = await import('acorn');
  } catch {
    return { status: 'skip', detail: 'acorn 未安装；确定性检查无法运行（skip≠pass）' };
  }

  let zipBuffer;
  if (zipPath) {
    zipBuffer = new Uint8Array(await fsp.readFile(zipPath));
  } else {
    const { buildZip } = await import('../../../test/helpers/miniZip.js');
    const files = {};
    for (const f of await fsp.readdir(stagingDir)) {
      if (f.endsWith('.js') || f.endsWith('.json')) files[f] = await fsp.readFile(path.join(stagingDir, f));
    }
    zipBuffer = buildZip(files);
  }
  const { kits } = await unpackModZip(zipBuffer);

  const hits = [];
  for (const [name, code] of Object.entries(kits)) {
    let ast;
    try {
      ast = acorn.parse(code, { ecmaVersion: 2020, sourceType: 'module', locations: true });
    } catch {
      continue; // syntax already handled by gate2
    }
    for (const [node] of walk(ast)) {
      const called = isForbiddenCall(node);
      if (called) hits.push(`${name}:${node.loc.start.line} ${called}`);
      else if (isNewDateZeroArg(node)) hits.push(`${name}:${node.loc.start.line} new Date()`);
    }
  }

  if (hits.length) {
    return { status: 'fail', detail: `确定性违规 ${hits.length} 处（非确定性来源会破坏 SP_VERIFY 一致性）: ${hits.slice(0, 10).join('; ')}` };
  }
  return { status: 'pass', detail: `AST 全量遍历 ${Object.keys(kits).length} 个 .js 文件，未发现 Math.random / Date.now / crypto.randomUUID / performance.now / new Date()` };
}
