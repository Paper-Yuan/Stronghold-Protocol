// test/ui/overlimit-negative-relics.test.js — 超限「负面词条」的局内两处界面（业主 2026-10-31 第二批）。
//
// 契约（与 test/ui/overlimit-relics.test.js / overlimit-relic-panel.test.js 同一套读法，纯视图当函数画）：
//   ① 三选一浮层复用同一套 .zjov / .zjcard，但**要有明显区分**：浮层带 .zjov--neg、眉题是 OVERLIMIT // NEGATIVE、
//      卡面带 .zjcard.is-neg 与 data-negative、分组 data-group="neg"（警示红），档位（Ⅰ/Ⅱ/Ⅲ）是数据字段 tierLabel；
//   ② 不新增任何 t('…')：负面浮层用的每个 msgid 都必须是四语包里已有的（这里逐条查 en.json）；
//   ③ 已选面板把负面词条**列在同一块列表里**（业主未定，先按同一面板 + 分组色区分做）：顺序 = 饰品在前、负面在后，
//      顺序各自 = 服务端 picked / negPicked 的顺序；合计 = 两段之和；空态仍是既有的 `t('还没有选过词条')`。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try { const body = readFileSync(path.join(ROOT, 'data', name), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const { data } = await import('../../public/js/data.js');
await data.load('relicsOverlimit');
await data.load('relicsOverlimitNegative');
const { OverlimitRelicDraftView, OverlimitRelicPanelView, overlimitRelicsOf, pickedNegativeRows } = await import('../../public/js/ui/overlimitRelics.js');
const { normalizeSp } = await import('../../public/js/ui/gameLogic/draft.js');
const { phaseBanner } = await import('../../public/js/ui/gameLogic/phases.js');
const { PHASE } = await import('../../shared/constants.js');

const NEG = JSON.parse(read('data/relicsOverlimitNegative.json')).entries;
const negById = new Map(NEG.map((e) => [e.id, e]));

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && v.type.name === 'RelicCard') { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}
const find = (tree, pred) => [...walk(tree)].filter(pred);
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const byClass = (tree, c) => find(tree, (v) => hasClass(v, c));
const byTestId = (tree, id) => find(tree, (v) => v.props?.['data-testid'] === id)[0];
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));

/** 服务端的负面三选一（solo → untimed，轮到我；三张都来自负面表，带档位）。 */
const negDraft = (over = {}) => normalizeSp({
  family: 'overlimit', relicKind: 'negative', negative: true, round: 5, untimed: true, turn: 'me', order: ['me'], picks: {},
  cards: [
    { idx: 0, kind: 'overlimit', negative: true, id: 'LC-D01', name: NEG[0].name, desc: NEG[0].desc, group: 'neg', impl: 'fund_cut', icon: NEG[0].icon, tierLabel: 'Ⅱ', tierIndex: 1, tierValues: { funds: -4 } },
    { idx: 1, kind: 'overlimit', negative: true, id: 'LC-D10', name: negById.get('LC-D10').name, desc: negById.get('LC-D10').desc, group: 'neg', impl: 'undying_hits', icon: negById.get('LC-D10').icon, tierLabel: null, tierIndex: null, tierValues: null },
    { idx: 2, kind: 'overlimit', negative: true, id: 'LC-D15', name: negById.get('LC-D15').name, desc: negById.get('LC-D15').desc, group: 'neg', impl: 'future_dodge', icon: negById.get('LC-D15').icon, tierLabel: null, tierIndex: null, tierValues: null },
  ],
  ...over,
});

test('① 负面三选一：同一套浮层 + 警示色区分（.zjov--neg / OVERLIMIT // NEGATIVE / is-neg / data-group=neg / 档位小字）', () => {
  const tree = OverlimitRelicDraftView({ sp: negDraft(), myId: 'me', solo: true });
  const ov = byClass(tree, 'zjov')[0];
  assert.ok(ov, '浮层本体仍是 .zjov');
  assert.ok(hasClass(ov, 'zjov--relic'), '与饰品词条同一套修饰类（尺寸 / 缩放都继承）');
  assert.ok(hasClass(ov, 'zjov--neg'), '负面专用修饰类（警示色规则挂在这下面）');
  assert.equal(ov.props['data-negative'], 'true');
  assert.equal(textOf(byClass(tree, 'zjov__micro')[0]), 'OVERLIMIT // NEGATIVE', '眉题与饰品那一档区分（技术字，不是 i18n）');
  assert.equal(textOf(byClass(tree, 'zjov__title')[0]), '词条抉择', '标题仍是既有 msgid');
  const cards = byClass(tree, 'zjcard');
  assert.equal(cards.length, 3);
  assert.ok(cards.every((c) => hasClass(c, 'is-neg')), '每张卡都带 is-neg（警示描边 / 编号色）');
  assert.deepEqual(cards.map((c) => c.props['data-group']), ['neg', 'neg', 'neg']);
  assert.deepEqual(cards.map((c) => c.props['data-negative']), ['true', 'true', 'true']);
  // 档位：写了档位的才有那枚小字（数据字段，不翻译）
  const tiers = byClass(tree, 'zjcard__tier');
  assert.equal(tiers.length, 1, '三张里只有 LC-D01 有档位');
  assert.equal(textOf(tiers[0]), 'Ⅱ');
  assert.equal(textOf(byTestId(tree, 'relic-tier-0')), 'Ⅱ');
  assert.equal(byTestId(tree, 'relic-tier-1'), undefined, '没档位的条目不多画 DOM');
  // 卡面文案逐字来自数据
  assert.deepEqual(byClass(tree, 'zjcard__rarity').map(textOf), ['LC-D01', 'LC-D10', 'LC-D15']);
  assert.deepEqual(byClass(tree, 'zjcard__name').map(textOf).slice(0, 1), [NEG[0].name]);
  assert.equal(byClass(tree, 'zjcard__desc')[0].props.text, NEG[0].desc, '效果全文交给 RichText，逐字来自表里');
});

test('② 一个字节的新文案都没有：负面浮层 / 面板用到的 msgid 都在四语包里', () => {
  const src = read('public/js/ui/overlimitRelics.js');
  const used = [...src.matchAll(/(?<![\w$.])t\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const lang of ['en', 'zh-TW', 'ja', 'ko']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    const strings = pack.strings || pack;
    for (const key of used) assert.ok(Object.prototype.hasOwnProperty.call(strings, key), `${lang}: t('${key}') 必须已存在`);
  }
  // 眉题是技术字（不是 t('…')）
  assert.match(src, /OVERLIMIT \/\/ NEGATIVE/);
});

test('③ 阶段横幅：负面三选一的眉题是 NEGATIVE、色调走警示红；标题仍是既有 msgid', () => {
  const banner = phaseBanner(PHASE.SP_DRAFT, { sp: { family: 'overlimit', negative: true, cards: [] } });
  assert.equal(banner.title, '词条抉择');
  assert.equal(banner.micro, 'NEGATIVE');
  assert.equal(banner.tone, 'red');
  const relic = phaseBanner(PHASE.SP_DRAFT, { sp: { family: 'overlimit', cards: [] } });
  assert.equal(relic.micro, 'RELIC', '饰品那一档不变');
  assert.equal(relic.tone, 'mint');
});

test('④ 已选面板：同一块列表里列出负面词条（饰品在前、负面在后，分组色 neg，档位小字）', () => {
  const picked = ['LC-001', 'FGO-01'];
  const negPicked = [{ id: 'LC-D01', tier: 1 }, { id: 'LC-D10', tier: null }];
  const tree = OverlimitRelicPanelView({ picked, negPicked });
  const rows = byClass(tree, 'zjsel');
  assert.equal(rows.length, 4, '两段加在一起');
  assert.deepEqual(rows.map((r) => r.props['data-group']), ['lc', 'fgo', 'neg', 'neg']);
  assert.deepEqual(byClass(tree, 'zjsel__rarity').map(textOf), ['LC-001', 'FGO-01', 'LC-D01', 'LC-D10']);
  assert.equal(textOf(byTestId(tree, 'overlimit-relic-total')), '4', '合计 = 两段之和');
  // 负面行的警示样式与档位小字
  assert.equal(byClass(tree, 'zjsel--neg').length, 2);
  assert.equal(textOf(byClass(tree, 'zjsel__tier')[0]), 'Ⅱ', '档位来自 negPicked.tier → 数据里的 tiers[].label');
  // 图标：负面行读的是负面表里的 icon
  const srcs = find(tree, (v) => v.type?.name === 'Img').map((v) => v.props?.src);
  assert.equal(srcs[2], negById.get('LC-D01').icon);
  assert.equal(srcs[3], negById.get('LC-D10').icon);
  // 只有负面 / 只有饰品都画得出来；两段都空才是空态
  assert.equal(byClass(OverlimitRelicPanelView({ picked: [], negPicked }), 'zjsel').length, 2);
  assert.equal(byClass(OverlimitRelicPanelView({ picked, negPicked: [] }), 'zjsel').length, 2);
  assert.equal(byTestId(OverlimitRelicPanelView({ picked: [], negPicked: [] }), 'overlimit-relic-empty') != null, true);
  // 顺序稳定：反着传就反过来
  assert.deepEqual(byClass(OverlimitRelicPanelView({ picked: [], negPicked: [...negPicked].reverse() }), 'zjsel__rarity').map(textOf),
    ['LC-D10', 'LC-D01']);
});

test('⑤ overlimitRelicsOf / pickedNegativeRows：负面那段容错（缺省 / 纯 id / 查不到的 id 原样回显）', () => {
  const st = overlimitRelicsOf({ relicsOverlimit: { picked: ['LC-001'], negPicked: [{ id: 'LC-D01', tier: 2 }, 'LC-D10'] } });
  assert.deepEqual(st.picked, ['LC-001']);
  assert.deepEqual(st.negPicked, [{ id: 'LC-D01', tier: 2 }, { id: 'LC-D10', tier: null }], '纯 id 也归一成 { id, tier }');
  assert.deepEqual(overlimitRelicsOf({ relicsOverlimit: { picked: [] } }).negPicked, [], '服务端还没发负面那段：空数组');
  assert.equal(overlimitRelicsOf({ relicsOverlimit: { picked: [], negPicked: [{ nope: 1 }] } }).negPicked.length, 0);
  const rows = pickedNegativeRows(NEG, [{ id: 'LC-D01', tier: 0 }, { id: 'LC-D99', tier: null }]);
  assert.equal(rows[0].name, NEG[0].name);
  assert.equal(rows[0].tier, 'Ⅰ');
  assert.equal(rows[1].name, 'LC-D99', '查不到的 id 原样回显，不编名字');
  assert.equal(rows[1].group, '');
  assert.equal(rows[1].icon, null);
});
