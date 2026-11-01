#!/usr/bin/env node
// tools/extract-zhajing-default-loadout.mjs — 炸惊模拟的「默认模组装配」表：modref/v2.1/data → docs/research/21。
//
// WHAT THIS IS. 炸惊模拟 each 棋子位 carries a default module (the play set's own builder picked the operator's first
// module: "策略 A"). `zjDefaultLoadout.json` is that table: `{ version, note, count, byBaseId }`, one entry per base chess id
// with `{ op, module, moduleName, typeName, choices }`. The client uses it to **pre-fill** 干员调配 for operators the player
// has not configured (T13); a configured operator always wins.
//
// WHY IT IS A RESEARCH SOURCE. `data/*.json` is a build product (AGENTS.md), so the table cannot be copied in: it is read
// here, filtered against this repository's own chess records, and written as docs/research/21-zhaijing-default-loadout.json;
// tools/build-data.mjs then re-emits it as data/zjDefaultLoadout.json (default version only) with the integrity checks below.
//
// THE FILTER (everything it drops is listed in `_doc.dropped`):
//   * a base id this repository does not have;
//   * a base id that is **not** a 炸惊 record (`zhajing !== true`) — 6 package copies are `zhajing: false` (锡人/赫拉格/锏),
//     and chess_zj_22_a (赫拉格) is one of them: it carries no 炸惊 pool membership, so a pre-fill for it would be dead data;
//   * an entry whose `module` resolves on neither the record's golden `modules[]` nor the golden's default `module.id`.
//     Exactly one entry is in that class today (see `_doc.dropped`); the *build* re-checks all three conditions and fails.
//
// USAGE
//   node tools/extract-zhajing-default-loadout.mjs [--ref <file>] [--data <dir>] [--out <dir>] [--check]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const REF_FILE = join(ROOT, 'modref', 'v2.1', 'data', 'zjDefaultLoadout.json');
const DATA_DIR = join(ROOT, 'data');
const OUT_DIR = join(ROOT, 'docs', 'research');

const args = process.argv.slice(2);
const opt = { ref: REF_FILE, data: DATA_DIR, out: OUT_DIR, check: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--ref' || a === '--data' || a === '--out') {
    const v = args[++i];
    if (!v) { console.error(`${a} needs a path`); process.exit(2); }
    opt[a.slice(2)] = resolve(ROOT, v);
  } else if (a === '--check') opt.check = true;
  else if (a === '--help' || a === '-h') { console.log('usage: node tools/extract-zhajing-default-loadout.mjs [--ref <file>] [--data <dir>] [--out <dir>] [--check]'); process.exit(0); }
  else { console.error(`unknown option ${a}`); process.exit(2); }
}
if (!existsSync(opt.ref)) {
  console.error(`default-loadout source not found: ${opt.ref}\nThe reference package is a temporary extraction (modref/, not in git).`);
  process.exit(1);
}

const src = JSON.parse(await readFile(opt.ref, 'utf8'));
const chess = JSON.parse(await readFile(join(opt.data, 'chess.json'), 'utf8'));

/** Where a base id's module choices live: the golden record's `modules[]` and its default `module.id`. */
function moduleChoices(baseId) {
  const rec = chess[baseId];
  const golden = rec && rec.goldenId ? chess[rec.goldenId] : null;
  return {
    golden,
    ids: (golden?.modules || []).map((m) => m.uniEquipId),
    defaultId: golden?.module?.id ?? null,
  };
}

const byBaseId = {};
const dropped = [];
const defaultOnly = [];
for (const [baseId, entry] of Object.entries(src.byBaseId || {})) {
  const rec = chess[baseId];
  if (!rec) { dropped.push({ baseId, reason: 'not in this repository' }); continue; }
  if (rec.zhajing !== true) { dropped.push({ baseId, reason: `not a 炸惊 record (zhajing: ${JSON.stringify(rec.zhajing ?? null)}, name ${rec.name})` }); continue; }
  const { ids, defaultId } = moduleChoices(baseId);
  if (entry.module && !ids.includes(entry.module) && entry.module !== defaultId) {
    dropped.push({ baseId, reason: `module ${entry.module} is on neither the golden modules[] (${ids.join(', ') || 'empty'}) nor its default module` });
    continue;
  }
  // the default module that is not in `modules[]` cannot be *selected*, only inherited — mark those (one entry today)
  if (entry.module && !ids.includes(entry.module)) defaultOnly.push(baseId);
  if (Array.isArray(rec.skills) && entry.skill && !rec.skills.some((s) => s.skillId === entry.skill || s.index === entry.skill)) {
    dropped.push({ baseId, reason: `skill ${entry.skill} is not unlocked on the record` });
    continue;
  }
  byBaseId[baseId] = entry;
}

const counts = {
  source: Object.keys(src.byBaseId || {}).length,
  emitted: Object.keys(byBaseId).length,
  dropped: dropped.length,
  inheritedDefaultModuleOnly: defaultOnly.length,
};

const note = '炸惊模拟默认模组装配：玩家未配置该干员时使用本表预填（已配置的以玩家为准）。'
  + '生成自本仓 data/chess.json 的 zhajing 记录（取该干员精锐记录的默认模组）；每条 = 一个棋子位。';

const doc = [
  '炸惊模拟的「默认模组装配」表 —— 由 tools/extract-zhajing-default-loadout.mjs 从 modref/v2.1/data/zjDefaultLoadout.json',
  '（0.3.1-mod.4 的构建产物）抽取并**按本仓记录过滤**，tools/build-data.mjs 再生成 data/zjDefaultLoadout.json',
  '（默认版本专属：data/versions/* 不带）。客户端用它做 干员调配 的预填（T13）：玩家未配置的干员用本表，已配置的以玩家为准。',
  '',
  '形状：{ version, note, count, byBaseId }；byBaseId 的键 = **炸惊棋子的 base 棋-id**（`chess_zj_01_a` 这种 `_a` 形态），',
  '每条形如 { op, module, moduleName, typeName, choices }：',
  '  · `op`        = 干员名（与 data/chess.json 的 `name` 逐条相等，提取器核对过）；',
  '  · `module`    = 默认模组的 `uniEquipId`；`moduleName` / `typeName` = 该模组的显示名与类型名（如「能天使的杰作」/ MAR-X）；',
  '  · `choices`   = 该干员精锐记录 `modules[]` 的条数（= 可选模组个数；提取器核对过逐条相等，build-data 再校验一次）。',
  '  · 注意：记录本身**不在** `byBaseId` 里带技能 —— 包内 84 条一条都没有 `skill` 字段，本仓照原样；若日后出现，',
  '    build-data 会校验它在该记录的 `skills` 里。',
  '',
  `计数：包内 ${counts.source} 条 → 本仓保留 ${counts.emitted} 条（丢 ${counts.dropped} 条）。`,
  '',
  '被丢掉的（每条都有理由，见 _extract.dropped）：',
  ...(dropped.length ? dropped.map((d) => `  · ${d.baseId}：${d.reason}`) : ['  · （无）']),
  '',
  '`chess_zj_22_a` 属于包内 6 条**忘了打 zhajing 标记**的记录（锡人/赫拉格/锏 的 a/b），本仓原样保留 `zhajing: false`',
  '（它们 visible:false，两边池子都进不去），所以这张表也不给它预填 —— 否则会得到一条指向「拿不到的干员位」的数据。',
  '',
  `默认模组不在 modules[] 里、只能继承不能选的：${defaultOnly.length ? defaultOnly.join('、') : '（无）'}`,
  '（机械师 chess_zj_28：精锐记录的 `module.id` 是 uniequip_002_mcnist，但 `modules[]` 只有 uniequip_002_branch ——',
  '包内记录本身如此；`module` 与默认模组相同，所以「用它的默认装配」仍然成立，只是玩家选不到第二个模组。',
  'build-data 对这一类按「等于默认 module.id」放行，并在生成报告里点名。）',
  '',
  '包内原文 note（保留备查，本仓的 note 重写过）：',
  `  ${src.note}`,
].join('\n');

const out = { _doc: doc, _extract: { source: 'modref/v2.1/data/zjDefaultLoadout.json', generator: 'tools/extract-zhajing-default-loadout.mjs', counts, dropped, inheritedDefaultModuleOnly: defaultOnly, packageNote: src.note }, version: src.version, note, count: Object.keys(byBaseId).length, byBaseId };

console.log(`source: ${counts.source} entries → emitted ${counts.emitted} (dropped ${counts.dropped}, inherited-default-module ${counts.inheritedDefaultModuleOnly})`);
for (const d of dropped) console.log(`  dropped ${d.baseId}: ${d.reason}`);
if (opt.check) { console.log('--check: nothing written'); process.exit(0); }
await mkdir(opt.out, { recursive: true });
const text = `${JSON.stringify(out, null, 2)}\n`;
const dest = join(opt.out, '21-zhaijing-default-loadout.json');
await writeFile(dest, text);
console.log(`wrote ${dest} (${Buffer.byteLength(text)} B)`);
