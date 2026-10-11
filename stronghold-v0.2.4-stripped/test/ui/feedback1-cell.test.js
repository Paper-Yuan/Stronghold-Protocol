// Player feedback after 0.1.0, #4 (workstream WA): the 突变细胞 item card says what the official text leaves out — the
// cell is not consumed, it returns to the hand with the destroyed operator's other equipment, and the new operator joins
// the 整备区 to be deployed again (official footage; PR #2) (items.json `note`, built by tools/build-data.mjs ITEM_RULES;
// server: builtinMeta char_chess_transformation_equip).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { ItemDetail } = await import('../../public/js/ui/detailPanel.js');
const { data } = await import('../../public/js/data.js');

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return typeof v === 'object' ? textOf(v.props?.children) : '';
};
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

test('ItemDetail: 突变细胞 (both qualities) says it returns to the hand and the new operator joins the 整备区; an ordinary item has no rule line', async () => {
  await data.loadAll('items', 'assets');
  const rule = (item) => [...walk(ItemDetail({ item, piece: null, editable: false }))].find((n) => hasClass(n, 'dhint--rule'));
  for (const id of ['chess_item_5_08_e_a', 'chess_item_5_08_e_b']) {
    const cell = data.lookup('items', id);
    assert.ok(cell && cell.note, `${id}: items.json note`);
    const t = textOf(rule(cell));
    assert.match(t, /原干员销毁/);
    assert.match(t, /突变细胞与其他装备退回整备区，可再次配发/);
    assert.match(t, /高一阶的随机初始干员（最高6阶），进入整备区，需要重新部署/);
  }
  const plain = data.lookup('items', 'chess_item_1_01_e_a'); // 维式重锤
  assert.equal(plain.note, null);
  assert.equal(rule(plain), undefined);
});

test('the rule line has its own style (game-panels.css .dhint--rule), not only a test hook', () => {
  const css = readFileSync(path.join(ROOT, 'public/css/screens/game-panels.css'), 'utf8');
  assert.match(css, /\.dhint--rule\s*\{[^}]*color:/);
});
