// test/modverify.test.js — C2-7: pipeline固化（fixture 合成小包，不拷 fanpack 全集）。
// Verifies the five-gate pipeline end to end on a synthetic pack: gate1 L1/L2, gate2 ES2020,
// gate3 determinism (negative: Math.random + string false-positive guard), gate4 merger injection
// + report shape, gate5 skip-without-CHROME_PATH, plus the fork wrapper's exit-code contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildZip, shaOf } from './helpers/miniZip.js';
import { createReport, recordGate, finalizeReport } from '../server/modverify/report.js';
import { verifyPack } from '../server/modverify/run.js';

const GOOD_PACK_JSON = JSON.stringify({ id: 'demo', type: 'data', name: '演示包', version: '1.0.0', app: '>=0.2.0', credits: '测试', files: { records: 'records.json' } });
const GOOD_RECORDS = JSON.stringify([{ id: 'demoBond', name: '演示盟约' }]);
const ES2021_CODE = 'const x = 800_000;';
const RANDOM_CODE = 'if (Math.random() > 0.5) console.log(1);';
const STRING_RANDOM_CODE = 'const s = "Math.random() is mentioned in a string"; // Date.now() in a comment too';

function makePack(t, members) {
  return buildZip(members);
}

async function runCli(args, opts = {}) {
  const r = spawnSync('node', ['server/modverify/cli.js', ...args], { encoding: 'utf8', timeout: 180000, ...opts });
  return r;
}

test('report.js：create/record/finalize 形状与 skip≠pass 语义', () => {
  const r = createReport('demo');
  assert.equal(r.gates.length, 5);
  assert.equal(r.overall, 'not-run');
  recordGate(r, 1, 'pass', 'ok', 5);
  recordGate(r, 2, 'skip', 'no acorn', 1);
  recordGate(r, 3, 'pass', 'ok', 2);
  recordGate(r, 4, 'pass', 'ok', 10);
  recordGate(r, 5, 'skip', 'no chrome', 1);
  finalizeReport(r);
  assert.equal(r.overall, 'pending', 'one skip among run gates → pending, not pass (C4 admin confirmation decides)');
  assert.equal(r.finishedAt !== null, true);

  const r2 = createReport('demo');
  recordGate(r2, 1, 'pass', 'ok', 1);
  finalizeReport(r2);
  assert.equal(r2.overall, 'pass', 'partial selection (--gate=1) with pass → overall pass, not-run gates ignored');
});

test('端到端：干净小包 → 五道全过（gate5 无 CHROME_PATH 则 skip，overall=pending）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mv-clean-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const zip = makePack(t, { 'pack.json': GOOD_PACK_JSON, 'records.json': GOOD_RECORDS, 'kits/ok.js': 'export const kit = {};' });
  await (await import('node:fs/promises')).writeFile(join(dir, 'pack.zip'), zip);

  const r = await runCli([dir]);
  assert.equal(r.status, 0, `exit 0 expected, got ${r.status}: ${r.stderr.slice(0, 300)}`);
  const report = JSON.parse(await readFile(join(dir, 'verify-report.json'), 'utf8'));
  assert.equal(report.gates[0].status, 'pass');
  assert.equal(report.gates[1].status, 'pass');
  assert.equal(report.gates[2].status, 'pass');
  assert.equal(report.gates[3].status, 'pass');
  assert.ok(['pass', 'skip'].includes(report.gates[4].status), 'gate5 either passes with CHROME_PATH or skips');
  assert.ok(['pass', 'pending'].includes(report.overall));
});

test('gate1 负向：pack.json 缺 type → L1 fail', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mv-bad1-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bad = buildZip({
    'pack.json': JSON.stringify({ id: 'bad', name: 'x', version: '1', app: '>=0.2.0', credits: 'x', files: { records: 'records.json' } }), // no type
    'records.json': '[]',
  });
  await (await import('node:fs/promises')).writeFile(join(dir, 'pack.zip'), bad);
  const r = await runCli([dir, '--gate=1']);
  const out = JSON.parse(r.stdout.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
  assert.equal(out.gates?.[0]?.status, 'fail', 'gate1 status must be fail');
  assert.equal(out.overall, 'fail', 'overall must be fail');
  assert.equal(r.status, 1, 'exit code must be 1 for a failed run');
});

test('gate1：包 type 非 data → fail；缺 chessId 的 chess 记录 → L2 fail', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mv-bad2-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bad = buildZip({
    'pack.json': JSON.stringify({ id: 'bad', type: 'ui', name: 'x', version: '1', app: '>=0.2.0', credits: 'x', files: { records: 'records.json' } }),
    'records.json': '[]',
  });
  await (await import('node:fs/promises')).writeFile(join(dir, 'pack.zip'), bad);
  const r = await runCli([dir, '--gate=1']);
  assert.equal(r.status, 1, 'exit code must be 1 for a failed run');
  const out = JSON.parse(r.stdout.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
  assert.equal(out.gates?.[0]?.status, 'fail');
  assert.match(out.gates?.[0]?.detail ?? '', /type/);
});

test('gate2 负向：ES2021 语法 → fail 且行号正确', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mv-g2-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bad = buildZip({ 'pack.json': GOOD_PACK_JSON, 'records.json': '[]', 'kits/bad.js': ES2021_CODE });
  await (await import('node:fs/promises')).writeFile(join(dir, 'pack.zip'), bad);
  const r = await runCli([dir, '--gate=2']);
  const out = JSON.parse(r.stdout.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
  assert.equal(out.gates?.[1]?.status, 'fail');
  assert.match(out.gates?.[1]?.detail ?? '', /800_000|Identifier directly after number/);
});

test('gate3 负向：Math.random 报、字符串里的 Math.random 不报', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mv-g3-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bad = buildZip({
    'pack.json': GOOD_PACK_JSON,
    'records.json': '[]',
    'kits/bad.js': RANDOM_CODE,
    'kits/ok-string.js': STRING_RANDOM_CODE,
  });
  await (await import('node:fs/promises')).writeFile(join(dir, 'pack.zip'), bad);
  const r = await runCli([dir, '--gate=3']);
  const out = JSON.parse(r.stdout.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
  assert.equal(out.gates?.[2]?.status, 'fail');
  assert.match(out.gates?.[2]?.detail ?? '', /Math\.random\(\)/);
  assert.doesNotMatch(out.gates?.[2]?.detail ?? '', /ok-string/, 'string/comment mention must not false-positive');
});

test('gate4：合并器经 --merger 注入（customContent 默认件），无硬 import 断言（modverify-merger.mjs 绿）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mv-g4-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const zip = makePack(t, { 'pack.json': GOOD_PACK_JSON, 'records.json': GOOD_RECORDS });
  await (await import('node:fs/promises')).writeFile(join(dir, 'pack.zip'), zip);
  const r = await runCli([dir, '--gate=4']);
  const out = JSON.parse(r.stdout.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
  assert.equal(out.gates?.[3]?.status, 'pass');
  assert.match(out.gates?.[3]?.detail ?? '', /无硬 import/);
});

test('fork 封装：verifyPack 返回 code 与报告路径，坏目录 → 非零', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mv-fork-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const zip = makePack(t, { 'pack.json': GOOD_PACK_JSON, 'records.json': GOOD_RECORDS });
  await (await import('node:fs/promises')).writeFile(join(dir, 'pack.zip'), zip);
  const { code, report, reportPath } = await verifyPack(dir, { timeoutMs: 180000 });
  assert.equal(code, 0);
  assert.ok(report && report.gates.length === 5);
  assert.ok(reportPath.endsWith('verify-report.json'));

  const { code: codeBad } = await verifyPack(join(tmpdir(), 'definitely-not-a-staging-dir-xyz'), { timeoutMs: 30000 });
  assert.notEqual(codeBad, 0, 'bad staging dir → nonzero exit');
});

test('gate5：无 CHROME_PATH 时明确 skip（报告 skip≠pass）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mv-g5-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const zip = makePack(t, { 'pack.json': GOOD_PACK_JSON, 'records.json': GOOD_RECORDS });
  await (await import('node:fs/promises')).writeFile(join(dir, 'pack.zip'), zip);
  const r = spawnSync('node', ['server/modverify/cli.js', dir, '--gate=5'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, CHROME_PATH: '', PUPPETEER_EXECUTABLE_PATH: '' } });
  const out = JSON.parse(r.stdout.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
  assert.equal(out.gates?.[4]?.status, 'skip');
  assert.match(out.gates?.[4]?.detail ?? '', /CHROME_PATH/);
});
