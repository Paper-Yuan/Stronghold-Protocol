// Official module (uniequip) TYPE icons from the local-client art (DESIGN §13 / §16): `data/local-assets.json`
// groups.module is keyed by the client's mixed-case file names ('PRI-X', 'mar-x', …) and matched case-insensitively
// against a module's typeName; the art is optional — without the manifest or an entry every module UI keeps its
// lettered tile / type text.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleTypeIconUrl } from '../../public/js/ui/assetUrls.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOCAL = path.join(ROOT, 'data/local-assets.json');

const entry = (k) => ({ path: `/assets/local/module/${k}.png`, w: 50, h: 50, kind: 'Sprite' });
const manifest = {
  version: 1,
  groups: { module: Object.fromEntries(['PRI-X', 'pri-y', 'mar-x', 'isw-a', 'TRP-D'].map((k) => [k, entry(k)])) },
};

let mode = 'ok';
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/local-assets.json') && mode === 'ok') return { ok: true, status: 200, json: async () => manifest };
  return { ok: false, status: 404, json: async () => ({}) };
};

/** Every vnode of a preact tree (htm output), depth first. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
  if (v.props?.fallback) yield* walk(v.props.fallback);
}
const textOf = (v) => [...walk(v)].map((n) => n.props?.children).flat().filter((c) => typeof c === 'string' || typeof c === 'number').join('');

describe('module type icons (local-client art, optional)', () => {
  test('lookup is case-insensitive both ways and maps the Greek type letters; exact keys win', () => {
    assert.equal(moduleTypeIconUrl(manifest, 'MAR-X'), '/assets/local/module/mar-x.png', 'upper-case type → lower-case file');
    assert.equal(moduleTypeIconUrl(manifest, 'pri-x'), '/assets/local/module/PRI-X.png', 'lower-case type → upper-case file');
    assert.equal(moduleTypeIconUrl(manifest, 'Pri-Y'), '/assets/local/module/pri-y.png');
    assert.equal(moduleTypeIconUrl(manifest, 'PRI-X'), '/assets/local/module/PRI-X.png');
    assert.equal(moduleTypeIconUrl(manifest, ' TRP-D '), '/assets/local/module/TRP-D.png', 'trimmed');
    assert.equal(moduleTypeIconUrl(manifest, 'ISW-A'), '/assets/local/module/isw-a.png');
    assert.equal(moduleTypeIconUrl(manifest, 'ISW-α'), '/assets/local/module/isw-a.png', 'α → a');
    assert.equal(moduleTypeIconUrl(manifest, 'TRP-Δ'), '/assets/local/module/TRP-D.png', 'Δ → d');
  });

  test('missing manifest / group / entry / junk ⇒ null (the caller draws the lettered tile), never throws', () => {
    for (const local of [null, undefined, {}, { groups: null }, { groups: {} }, { groups: { module: 'x' } }, 42, 'str']) {
      assert.equal(moduleTypeIconUrl(local, 'MAR-X'), null, JSON.stringify(local));
    }
    assert.equal(moduleTypeIconUrl(manifest, 'MAR-Y'), null, 'entry missing');
    for (const t of [null, undefined, '', '   ', 42, {}]) assert.equal(moduleTypeIconUrl(manifest, t), null, String(t));
    const broken = { groups: { module: { 'mar-x': { w: 1 }, 'MAR-Y': { path: '' }, 'mar-y': entry('mar-y') } } };
    assert.equal(moduleTypeIconUrl(broken, 'MAR-X'), null, 'entry without a path');
    assert.equal(moduleTypeIconUrl(broken, 'MAR-Y'), '/assets/local/module/mar-y.png', 'an empty exact entry falls through to a valid one');
  });

  test('the real manifest (when extracted on this machine) covers every module type of chess.json, with on-disk files', { skip: !existsSync(LOCAL) && 'no data/local-assets.json (optional)' }, () => {
    const local = JSON.parse(readFileSync(LOCAL, 'utf8'));
    if (!local?.groups?.module) return; // an older extraction without the module group: the UI falls back
    const chess = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
    const recs = Array.isArray(chess) ? chess : Object.values(chess.chess || chess);
    const types = new Set(recs.flatMap((c) => (Array.isArray(c?.modules) ? c.modules : []).map((m) => m?.typeName).filter(Boolean)));
    assert.ok(types.size > 50, `module types in chess.json: ${types.size}`);
    const missing = [];
    for (const t of types) {
      const url = moduleTypeIconUrl(local, t);
      if (!url) { missing.push(t); continue; }
      assert.ok(existsSync(path.join(ROOT, 'public', url)), `${t} → ${url} exists`);
    }
    assert.deepEqual(missing, [], 'every module type has an official icon');
  });

  test('干员调配 module tile: official icon when listed, lettered tile when the manifest or the entry is missing', async () => {
    const { data } = await import('../../public/js/data.js');
    const { Img } = await import('../../public/js/ui/gameComponents.js');
    const { ModuleGlyph } = await import('../../public/js/screens/loadout.js');
    const imgOf = (vnode) => [...walk(vnode)].find((n) => n.type === Img);
    await data.load('local');
    let img = imgOf(ModuleGlyph({ m: null, rec: { uniEquipId: 'uniequip_002_x', typeName: 'MAR-X' }, id: 'uniequip_002_x' }));
    assert.equal(img.props.src, '/assets/local/module/mar-x.png');
    assert.equal(textOf(img.props.fallback), 'X', 'the letter stays as the image-error fallback');
    img = imgOf(ModuleGlyph({ m: null, rec: { uniEquipId: 'uniequip_003_x', typeName: 'MAR-Y' }, id: 'uniequip_003_x' }));
    assert.equal(img.props.src, null, 'unlisted type');
    assert.equal(textOf(img.props.fallback), 'Y');
    // manifest missing
    mode = 'missing';
    const orig = console.warn; console.warn = () => {};
    try { await data.invalidate('local'); } finally { console.warn = orig; }
    assert.equal(data.status('local'), 'missing');
    img = imgOf(ModuleGlyph({ m: null, rec: { uniEquipId: 'uniequip_002_x', typeName: 'MAR-X' }, id: 'uniequip_002_x' }));
    assert.equal(img.props.src, null);
    assert.equal(textOf(img.props.fallback), 'X');
    assert.equal(moduleTypeIconUrl(data.get('local'), 'MAR-X'), null);
  });

  test('the in-match detail panel and shop card resolve the icon from the local manifest and keep their text fallback', () => {
    const detail = readFileSync(path.join(ROOT, 'public/js/ui/detailPanel.js'), 'utf8');
    assert.match(detail, /<\$\{Img\} src=\$\{moduleTypeIconUrl\(data\.get\('local'\), lo\.module\.typeName\)\} fallback=\$\{html`<b class="num">\$\{moduleBadge\(lo\.module\)\}<\/b>`\}/);
    assert.match(detail, /<span class="dmodule__type">\$\{lo\.module\.typeName\}<\/span>/, 'the type text stays');
    const shop = readFileSync(path.join(ROOT, 'public/js/ui/shopBar.js'), 'utf8');
    assert.match(shop, /<\$\{Img\} src=\$\{moduleTypeIconUrl\(data\.get\('local'\), mod\.typeName\)\} class="scard__modicon" \/>\$\{mod\.typeName\}/,
      'icon beside the type text (Img renders nothing without it)');
  });
});
