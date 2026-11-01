// test/annihilation-import.test.js — 湮灭专属 mod 的导入归一化（tools/research-normalize.mjs 的 normalizeImportedTree）。
//
// 为什么单独钉这里：这条规则是「重导入同一份整合包不许把 research 里手工修好的文案冲掉」的**唯一**保障，
// 而两个站在它上面的东西都不适合当单测 —— tools/extract-annihilation-mods.mjs 要 modref/（CI 没有那个包），
// 生成期护栏（build-data 的 checkTextContracts）要整条 build 链。所以这里直接测那个纯函数，用合成记录覆盖
// 四类缺陷（tools/research-normalize.mjs 头注释的 1/2/3 + 「desc 是权威、永远不拿 descRaw 覆盖它」）：
//
//   1. `desc` 里的字面 `\n`（反斜杠 + n 两个字符）→ 真换行；
//   2. `descRaw` 坏了、`desc` 是好的、磁盘上那份 research 已经手工修好 → 沿用磁盘的 descRaw（kept，不报 mismatch）；
//   3. 没有 previous（或 previous 也对不上）→ 记一条 mismatch，**desc 一个字都不能动**；
//   4. `eventTypeIcon` 非法 → 按 `eventTypeDesc` 映射官方四图标；合法值保留；映射不到置空串。
//
// 最后两条是「装配」而不是「算法」：skipSections 必须排除 bondAnnOverrides（覆盖块不是 desc/descRaw 的派生物，
// 下钻它只会得到假 mismatch），以及导入器不许再长出一份内联实现（唯一实现在 research-normalize.mjs）。
// 只读：本文件不写任何仓库文件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeImportedTree, officialGarrisonTypeIcons, richTextPlain } from '../tools/research-normalize.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXTRACTOR = join(ROOT, 'tools', 'extract-annihilation-mods.mjs');
const RESEARCH = join(ROOT, 'docs', 'research', '20-annihilation-mods.json');
const ICONS = officialGarrisonTypeIcons(JSON.parse(readFileSync(join(ROOT, 'data', 'cdn-resource-config.json'), 'utf8')));

// 一对「包内坏、desc 是好」的文案：包内 builder 把黑板上限的「每叠加」写成了「叠加」（就是 2026-10-29 手工修
// kazdelShip 的那一处）。descRaw 是带标记的富文本，desc 是它的纯文本 —— 后者由 richTextPlain 现算，测试不手写。
const GOOD_RAW = '对处于<@ba.vup>眩晕</>的单位伤害提升\n<每叠加<@autochess.dgreen>100</>层>获得一件“萨卡兹的断角”';
const BAD_RAW = GOOD_RAW.replace('每叠加', '叠加');
const DESC = richTextPlain(GOOD_RAW);

test('desc 里字面 \\n（两个字符）在导入时解成真换行', () => {
  const root = {
    bonds: { plain: { desc: '第一行\\n第二行' } },
    garrisons: [{ desc: '整备区\\n每回合+1' }, { desc: '没有问题的一行' }],
  };
  const r = normalizeImportedTree(root);
  assert.equal(root.bonds.plain.desc, '第一行\n第二行');
  assert.equal(root.garrisons[0].desc, '整备区\n每回合+1', '数组里的记录同样处理');
  assert.equal(root.garrisons[1].desc, '没有问题的一行', '没有字面 \\n 的文案原样保留');
  assert.deepEqual(r.mismatches, []);
  assert.deepEqual(r.kept, []);
});

test('descRaw 坏、desc 好、磁盘上那份已修好 → 沿用磁盘的 descRaw（kept，且不报 mismatch）', () => {
  assert.notEqual(richTextPlain(BAD_RAW), DESC, 'precondition: 包内这份 descRaw 与 desc 对不上');
  const root = { bonds: { kazdelShip: { desc: DESC, descRaw: BAD_RAW } } };
  const previous = { bonds: { kazdelShip: { desc: DESC, descRaw: GOOD_RAW } } };
  const r = normalizeImportedTree(root, { previous });

  assert.equal(root.bonds.kazdelShip.descRaw, GOOD_RAW, '重导入不许把手工修复冲掉');
  assert.equal(root.bonds.kazdelShip.desc, DESC, 'desc 不动（它是权威，不是从 descRaw 反推的）');
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].record, 'bonds.kazdelShip');
  assert.match(r.kept[0].why, /kept the on-disk descRaw/);
  assert.deepEqual(r.mismatches, [], '沿用磁盘那份后就没有不一致了');
});

test('previous 按同一条路径匹配（键 + 数组下标），不是按内容猜', () => {
  const root = { items: { records: [{ desc: DESC, descRaw: BAD_RAW }], effects: { e1: { desc: DESC, descRaw: BAD_RAW } } } };
  // 只有同一条路径上那份是对的 descRaw 才认：records[] 下标 0 认、effects.e1 的 descRaw 也是坏的
  const previous = { items: { records: [{ descRaw: GOOD_RAW }], effects: { e1: { descRaw: BAD_RAW } } } };
  const r = normalizeImportedTree(root, { previous });
  assert.equal(root.items.records[0].descRaw, GOOD_RAW, '数组下标也参与路径');
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].record, 'items.records[0]');
  assert.equal(r.mismatches.length, 1, 'prev 也坏的那条仍然报出来');
  assert.equal(r.mismatches[0].record, 'items.effects.e1');
});

test('没有 previous（或 previous 也对不上）→ 记一条 mismatch，desc 一个字都不动', () => {
  for (const previous of [null, { bonds: { k: { descRaw: BAD_RAW } } }, { bonds: { other: { descRaw: GOOD_RAW } } }]) {
    const rec = { desc: DESC, descRaw: BAD_RAW };
    const root = { bonds: { k: rec } };
    const r = normalizeImportedTree(root, { previous });
    assert.equal(r.mismatches.length, 1, `previous=${JSON.stringify(previous)}`);
    assert.equal(r.kept.length, 0);
    assert.equal(r.mismatches[0].record, 'bonds.k');
    assert.equal(r.mismatches[0].why, 'desc ≠ plainText(descRaw)');
    assert.equal(rec.desc, DESC, 'desc 是权威：一个字都不许变（这是本函数的红线）');
    assert.equal(rec.descRaw, BAD_RAW, '也不许把 descRaw 换成 desc —— 冲掉证据等于静默放过');
  }
});

test('eventTypeIcon：非法值按 eventTypeDesc 映射官方四图标，合法值保留，映射不到置空', () => {
  assert.deepEqual([...ICONS].sort(), ['icon_battle', 'icon_bond', 'icon_gold', 'icon_support'], '图标集来自官方资源表');
  const root = {
    garrisons: {
      server: { eventTypeIcon: 'icon_server', eventTypeDesc: '整备能力' },
      legal: { eventTypeIcon: 'icon_bond', eventTypeDesc: '特异化' },
      unknown: { eventTypeIcon: 'icon_server', eventTypeDesc: '不存在的分类' },
    },
  };
  const r = normalizeImportedTree(root, { icons: ICONS });
  assert.equal(root.garrisons.server.eventTypeIcon, 'icon_gold', 'icon_server 不存在 → 按「整备能力」映射');
  assert.equal(root.garrisons.legal.eventTypeIcon, 'icon_bond', '合法图标不拿 eventTypeDesc 覆盖');
  assert.equal(root.garrisons.unknown.eventTypeIcon, '', '映射不到官方四图标 → 留空让 UI 按触发时机兜底');
  assert.deepEqual(r.icons.map((i) => [i.record, i.from, i.to]), [
    ['garrisons.server', 'icon_server', 'icon_gold'],
    ['garrisons.unknown', 'icon_server', ''],
  ]);
  // 不给 icons 集时图标一律不动（导入器读不到 cdn-resource-config 的那条分支）
  const noSet = { garrisons: { server: { eventTypeIcon: 'icon_server', eventTypeDesc: '整备能力' } } };
  assert.deepEqual(normalizeImportedTree(noSet, { icons: null }).icons, []);
  assert.equal(noSet.garrisons.server.eventTypeIcon, 'icon_server');
});

test('skipSections：默认跳过 _doc/_extract，覆盖块 bondAnnOverrides 必须由调用方一起跳过', () => {
  // 默认值：_doc 是文本、_extract 是生成器的元数据，都不是数据记录
  assert.deepEqual(normalizeImportedTree({ _doc: '说明', _extract: { probe: { desc: 'A', descRaw: 'B' } } }).mismatches, []);
  // 覆盖块是包内的替换文本片段（desc 不是由 descRaw 生成的，包内两处文案本身就不一致）→ 下钻它只会得到假 mismatch。
  // 这条正是「导入器去重后行为逐字等价」的关键：extract-annihilation-mods.mjs 的 NORMALIZE_SKIP 带着它。
  const doc = () => ({ bondAnnOverrides: { egirShip: { desc: '覆盖文案', descRaw: '包内两处文案本身不一致' } } });
  const strict = normalizeImportedTree(doc(), { skipSections: ['_doc', '_extract', 'bondAnnOverrides'] });
  assert.deepEqual(strict.mismatches, []);
  const naive = normalizeImportedTree(doc(), { skipSections: ['_doc', '_extract'] });
  assert.equal(naive.mismatches.length, 1);
  assert.equal(naive.mismatches[0].record, 'bondAnnOverrides.egirShip');
});

test('导入器没有第二份归一化实现：只从 research-normalize.mjs 调 normalizeImportedTree', () => {
  const src = readFileSync(EXTRACTOR, 'utf8');
  assert.doesNotMatch(src, /function normalizeImported\s*\(/, '导入器又长出了一份内联实现（去重被回退）');
  assert.match(src, /import \{[^}]*normalizeImportedTree[^}]*\} from '\.\/research-normalize\.mjs'/);
  assert.match(src, /const norm = normalizeImportedTree\(out, \{ icons: garrisonIcons, previous: previousDoc, skipSections: NORMALIZE_SKIP \}\)/);
  assert.match(src, /const NORMALIZE_SKIP = Object\.freeze\(\['_doc', '_extract', 'bondAnnOverrides'\]\)/, '跳过键是等价性的一部分');
  assert.match(src, /if \(norm\.kept\.length\) out\._extract\.descKeptFromDisk = norm\.kept;/);
});

test('随仓的 research：每条记录的 desc 与 plainText(descRaw) 都对得上（kazdelShip 的手工修复还在）', () => {
  const doc = JSON.parse(readFileSync(RESEARCH, 'utf8'));
  const bad = [];
  const walk = (value, path) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    if (typeof value.desc === 'string' && typeof value.descRaw === 'string' && richTextPlain(value.descRaw) !== value.desc) bad.push(path);
    if (typeof value.desc === 'string' && /\\n/.test(value.desc)) bad.push(`${path}.desc（字面 \\n）`);
    for (const [k, v] of Object.entries(value)) if (v && typeof v === 'object') walk(v, `${path}.${k}`);
  };
  for (const [section, value] of Object.entries(doc)) if (!['_doc', '_extract', 'bondAnnOverrides'].includes(section)) walk(value, section);
  assert.deepEqual(bad, [], 'research 源必须满足 desc = 纯文本(descRaw)');
  // 2026-10-29 手工修的那条（包内漏了「每」）：唯一被「沿用磁盘 descRaw」救回来的记录
  const kazdel = doc.bonds.kazdelShip;
  assert.ok(kazdel, 'research 里仍有 kazdelShip');
  assert.equal(richTextPlain(kazdel.descRaw), kazdel.desc);
  assert.match(kazdel.descRaw, /<每叠加/);
});
