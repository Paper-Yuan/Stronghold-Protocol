// test/helpers/designDocs.js — the design document as one text, for the tests that pin its sentences.
//
//   import { designText } from '../helpers/designDocs.js';
//   const DESIGN = designText(ROOT);   // the index's preamble, then every `## N.` block in § order
//
// docs/DESIGN.md is the index since 0.2.0: the current rules live in docs/design/*.md, the per-release revisions in
// docs/history/*.md, and every `## N.` block (its heading, text and the `---` after it) sits in one of those files
// verbatim. designText() puts the blocks back in section order (not file order — the tests slice it as `## n.` →
// `## n+1.`), so from `## 0.` on it is the pre-split DESIGN.md byte for byte. A section found twice throws.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HEAD_RE = /^## (\d+)\./;

/** The folders that hold the `## N.` blocks, after the index. */
export const DESIGN_DIRS = ['docs/design', 'docs/history'];

/** Split a Markdown text at its `## N.` headings: { preamble, blocks: Map<N, text> } (each block ends before the next heading). */
export function splitBlocks(text) {
  const lines = text.split('\n');
  const blocks = new Map();
  let cur = null;
  let buf = [];
  const preamble = [];
  const flush = () => {
    if (cur == null) preamble.push(...buf);
    else {
      if (blocks.has(cur)) throw new Error(`§${cur} appears twice`);
      blocks.set(cur, buf.join('\n'));
    }
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(HEAD_RE);
    if (m) { flush(); cur = Number(m[1]); }
    buf.push(line);
  }
  flush();
  return { preamble: preamble.join('\n'), blocks };
}

/** The design text in § order: the index's preamble, then every part file's blocks sorted by section number. */
export function designText(root) {
  const index = readFileSync(join(root, 'docs/DESIGN.md'), 'utf8');
  const all = new Map();
  const { preamble, blocks: own } = splitBlocks(index);
  for (const [n, t] of own) all.set(n, t);
  for (const dir of DESIGN_DIRS) {
    if (!existsSync(join(root, dir))) continue;
    for (const f of readdirSync(join(root, dir)).filter((x) => x.endsWith('.md')).sort()) {
      for (const [n, t] of splitBlocks(readFileSync(join(root, dir, f), 'utf8')).blocks) {
        if (all.has(n)) throw new Error(`§${n} appears twice (${dir}/${f})`);
        all.set(n, t);
      }
    }
  }
  return [preamble, ...[...all].sort((a, b) => a[0] - b[0]).map(([, t]) => t)].join('\n');
}
