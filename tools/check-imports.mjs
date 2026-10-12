// Import boundaries for the sim and the match layer.
//
// server/sim is served to the browser, so it must not import the match, the lobby, the HTTP entry,
// the net layer, public/, or any Node builtin. server/match must not import public/ or that net layer.
// server/data.js is allowed (the Node loader reaches it on purpose).
//
// Default exit code is 0 even when violations are listed. --strict exits 1 when any are listed.
// Usage: node tools/check-imports.mjs [--strict] [--root <dir>]

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HTTP_SPECS = new Set([
  'http', 'https', 'http2', 'net', 'tls', 'dgram', 'ws',
  'node:http', 'node:https', 'node:http2', 'node:net', 'node:tls', 'node:dgram',
]);

const builtins = new Set(builtinModules);

/** Drop comments. Strings, including the import specifiers, stay. Newlines stay so line numbers match. */
export function maskComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = endOfString(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === '`') {
      const end = endOfTemplate(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function endOfString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\') { j += 2; continue; }
    if (src[j] === '\n') break;
    j++;
  }
  return Math.min(src.length, j + 1);
}

function endOfTemplate(src, i) {
  let j = i + 1;
  while (j < src.length && src[j] !== '`') {
    if (src[j] === '\\') { j += 2; continue; }
    if (src[j] === '$' && src[j + 1] === '{') {
      j += 2;
      let depth = 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "'" || src[j] === '"') { j = endOfString(src, j); continue; }
        if (src[j] === '`') { j = endOfTemplate(src, j); continue; }
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        if (depth > 0) j++;
      }
      j++;
      continue;
    }
    j++;
  }
  return Math.min(src.length, j + 1);
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

function skipWs(src, i) {
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}

function readQuoted(src, i) {
  if (src[i] !== "'" && src[i] !== '"') return null;
  const q = src[i];
  let j = i + 1;
  let spec = '';
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\') { spec += src[j + 1] ?? ''; j += 2; continue; }
    if (src[j] === '\n') return null;
    spec += src[j];
    j++;
  }
  if (src[j] !== q) return null;
  return { spec, quoteAt: i, end: j + 1 };
}

/** The `from 'spec'` of an import/export clause, or null when the statement is not one. */
function readFrom(src, i) {
  let depth = 0;
  const start = i;
  while (i < src.length && i - start < 8000) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const str = readQuoted(src, i);
      if (!str) return null;
      i = str.end;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) return null;
    else if (depth === 0 && src.startsWith('from', i) && !/\w/.test(src[i - 1] ?? '') && !/\w/.test(src[i + 4] ?? '')) {
      const str = readQuoted(src, skipWs(src, i + 4));
      return str;
    }
    i++;
  }
  return null;
}

/**
 * @param {string} src raw source
 * @returns {{ spec: string, line: number }[]}
 */
export function findSpecifiers(src) {
  const masked = maskComments(src);
  /** @type {{ spec: string, line: number }[]} */
  const found = [];
  const re = /\b(import|export|require)\b/g;
  let m;
  while ((m = re.exec(masked))) {
    const kw = m[1];
    let i = skipWs(masked, m.index + kw.length);
    if (kw === 'require') {
      if (masked[i] !== '(') continue;
      const str = readQuoted(masked, skipWs(masked, i + 1));
      if (str) found.push({ spec: str.spec, line: lineOf(masked, str.quoteAt) });
      continue;
    }
    if (kw === 'import' && masked[i] === '.') continue; // import.meta
    if (kw === 'import' && masked[i] === '(') {
      const str = readQuoted(masked, skipWs(masked, i + 1));
      if (str) found.push({ spec: str.spec, line: lineOf(masked, str.quoteAt) });
      continue;
    }
    if (kw === 'import' && (masked[i] === "'" || masked[i] === '"')) {
      const str = readQuoted(masked, i);
      if (str) found.push({ spec: str.spec, line: lineOf(masked, str.quoteAt) });
      continue;
    }
    if (kw === 'export') {
      if (masked.startsWith('type', i) && /\s/.test(masked[i + 4] ?? '')) i = skipWs(masked, i + 4);
      const c = masked[i];
      if (c !== '{' && c !== '*') continue;
    }
    const from = readFrom(masked, i);
    if (from) found.push({ spec: from.spec, line: lineOf(masked, from.quoteAt) });
  }
  return found;
}

function isBuiltin(spec) {
  if (spec.startsWith('node:')) return true;
  return builtins.has(spec);
}

function isHttp(spec, resolved) {
  if (HTTP_SPECS.has(spec)) return true;
  if (spec === 'ws' || spec.startsWith('ws/')) return true;
  if (resolved === 'server/net.js' || resolved === 'server/index.js') return true;
  return false;
}

/**
 * @param {string} spec
 * @param {string} fromFile posix path relative to the root
 * @param {'sim'|'match'} area
 * @returns {{ code: string, resolved: string } | { note: true, resolved: string } | null}
 */
export function classify(spec, fromFile, area) {
  const fromDir = path.posix.dirname(fromFile);
  let resolved = spec;
  if (spec.startsWith('.')) {
    resolved = path.posix.normalize(path.posix.join(fromDir, spec));
  }
  const escaped = resolved.startsWith('..') || path.posix.isAbsolute(spec);
  if (area === 'sim') {
    if (resolved === 'server/match' || resolved.startsWith('server/match/')) return { code: 'sim-match', resolved };
    if (resolved === 'server/lobby.js' || resolved.startsWith('server/lobby/')) return { code: 'sim-lobby', resolved };
    if (resolved === 'server/index.js') return { code: 'sim-entry', resolved };
    if (isHttp(spec, resolved)) return { code: 'sim-http', resolved };
    if (resolved === 'public' || resolved.startsWith('public/')) return { code: 'sim-client', resolved };
    if (escaped || isBuiltin(spec)) return { code: 'sim-node', resolved };
    if (resolved === 'server/data.js') return { note: true, resolved };
    return null;
  }
  if (resolved === 'public' || resolved.startsWith('public/')) return { code: 'match-client', resolved };
  if (isHttp(spec, resolved)) return { code: 'match-http', resolved };
  return null;
}

function walkJs(dir, rel, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === 'node_modules') continue;
    const abs = path.join(dir, name);
    const child = rel ? `${rel}/${name}` : name;
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) walkJs(abs, child, out);
    else if (/\.(?:js|mjs|cjs)$/.test(name)) out.push(child.split(path.sep).join('/'));
  }
}

/**
 * @param {string} root absolute repository root
 * @returns {{ violations: { file: string, line: number, spec: string, code: string, resolved: string }[], notes: { file: string, line: number, spec: string, resolved: string }[] }}
 */
export function scan(root) {
  const files = [];
  walkJs(path.join(root, 'server', 'sim'), 'server/sim', files);
  walkJs(path.join(root, 'server', 'match'), 'server/match', files);
  /** @type {{ file: string, line: number, spec: string, code: string, resolved: string }[]} */
  const violations = [];
  /** @type {{ file: string, line: number, spec: string, resolved: string }[]} */
  const notes = [];
  for (const file of files) {
    const area = file.startsWith('server/sim/') ? 'sim' : 'match';
    let src;
    try { src = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    for (const hit of findSpecifiers(src)) {
      const result = classify(hit.spec, file, area);
      if (!result) continue;
      if (result.note) notes.push({ file, line: hit.line, spec: hit.spec, resolved: result.resolved });
      else violations.push({ file, line: hit.line, spec: hit.spec, code: result.code, resolved: result.resolved });
    }
  }
  const byPos = (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.spec.localeCompare(b.spec);
  violations.sort(byPos);
  notes.sort(byPos);
  return { violations, notes };
}

export function formatReport({ violations, notes }) {
  const lines = [];
  if (violations.length === 0) lines.push('no import-boundary violations');
  else {
    lines.push(`${violations.length} import-boundary violation(s):`);
    for (const v of violations) lines.push(`${v.file}:${v.line}: ${v.spec} [${v.code}]`);
  }
  if (notes.length) {
    lines.push(`${notes.length} allowed note(s):`);
    for (const n of notes) lines.push(`note ${n.file}:${n.line}: ${n.spec} -> ${n.resolved}`);
  }
  return lines.join('\n') + '\n';
}

function main(argv) {
  let strict = false;
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') strict = true;
    else if (a === '--root') {
      const dir = argv[++i];
      if (!dir || dir.startsWith('--')) {
        console.error('check-imports: --root needs a directory');
        return 1;
      }
      root = path.resolve(dir);
    } else if (a === '--help' || a === '-h') {
      console.log('usage: node tools/check-imports.mjs [--strict] [--root <dir>]');
      return 0;
    } else {
      console.error(`check-imports: unknown argument ${a}`);
      return 1;
    }
  }
  const report = scan(root);
  process.stdout.write(formatReport(report));
  if (strict && report.violations.length) return 1;
  return 0;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invoked) process.exit(main(process.argv.slice(2)));
