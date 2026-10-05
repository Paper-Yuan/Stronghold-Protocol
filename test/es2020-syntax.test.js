// test/es2020-syntax.test.js — validates that all public client JS, shared JS, and browser-facing sim modules
// comply strictly with ES2020 (no ES2021+ logical assignments, no top-level await, no incompatible syntax)
// to ensure zero runtime SyntaxError on older Android WebViews (Chromium 80-88).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  let files = [];
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else if (p.endsWith('.js') || p.endsWith('.mjs')) files.push(p);
  }
  return files;
}

describe('ES2020 Browser Syntax Gate (Chromium 80-88 compatibility)', () => {
  test('all public/js, shared, and content modules parse with ES2020 without syntax errors', () => {
    const dirs = [
      path.join(ROOT, 'public/js'),
      path.join(ROOT, 'shared'),
      path.join(ROOT, 'server/sim/content'),
    ];
    let allFiles = [];
    for (const d of dirs) allFiles.push(...walk(d));
    allFiles.push(path.join(ROOT, 'server/sim/spec.js'));
    allFiles.push(path.join(ROOT, 'server/sim/Battle.js'));

    const errors = [];
    for (const f of allFiles) {
      const code = readFileSync(f, 'utf8');
      try {
        acorn.parse(code, { ecmaVersion: 2020, sourceType: 'module' });
      } catch (err) {
        errors.push({ file: path.relative(ROOT, f), err: err.message });
      }
    }

    assert.equal(errors.length, 0, `Found ${errors.length} ES2020 syntax violations: ${JSON.stringify(errors, null, 2)}`);
  });

  test('browser-facing simdata.js (transformed by server/index.js) parses cleanly with ES2020', () => {
    const simdataPath = path.join(ROOT, 'server/sim/simdata.js');
    const raw = readFileSync(simdataPath, 'utf8');
    const browserCode = raw.replace(/if\s*\(\s*IS_NODE\s*\)\s*\{[\s\S]*?\n\}/, '/* browser */');
    
    assert.doesNotThrow(() => {
      acorn.parse(browserCode, { ecmaVersion: 2020, sourceType: 'module' });
    }, 'Browser simdata.js must parse with ecmaVersion 2020 without Unexpected reserved word');
  });
});
