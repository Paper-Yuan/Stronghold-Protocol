// test/ui/card-art.test.js — 名片立绘微调（业主 2026-10-28 A 项，public/js/ui/cardArt.js + room.js 的接线）。
//
// 验收口径（照 handoff 里那个 e2e 脚本能断言的形状）：
//   1. 精二 = `char/illust/<id>.png`（既有的 立绘）；精一 = `char/illust/<id>_1.png`（**同目录同尺寸的全幅立绘**，
//      官方 charId_1b），两者渲染口径完全一样：框里 `object-fit: cover` + 缩放/平移，没有「简略图」角标这类特例。
//   2. 缩放 0.8–2.0（滑杆 / 滚轮 / ←→），框内拖拽平移（`touch-action: none` **只加在框上**），双指缩放，重置回中立值。
//   3. 存本机 pref `room.cardArt`（按 charId）；坏值/缺字段一律回中立值，且**反复往返不变形**（幂等）。
//   4. 座位卡用 `CardArtImage` 画立绘，`_1` 打不开退回精二，精二也打不开才交回头像框。
//
// 浏览器里的真断言在 devtools/lib/zhajing-panels.mjs 的 `readSeatCardPicker`（真机/桌面四档）；
// 这里钉住纯函数、源码接线与样式地板，不需要 Chrome。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CARD_ART_DEFAULT, CARD_ART_PREF, ZOOM_MIN, ZOOM_MAX,
  normalizeCardArt, artSrcOf, artTransform, panTo, pinchTo,
} from '../../public/js/ui/cardArt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const E2 = '/assets/char/illust/char_003_kalts.png';

test('the neutral value: 精二 / 1.0× / 居中 — and an empty or broken value normalises to it', () => {
  assert.deepEqual({ ...CARD_ART_DEFAULT }, { art: 'e2', zoom: 1, ox: 0, oy: 0 });
  assert.equal(CARD_ART_PREF, 'room.cardArt');
  for (const bad of [undefined, null, 'x', 7, [], {}, { art: 'nope', zoom: NaN, ox: undefined, oy: null }]) {
    assert.deepEqual(normalizeCardArt(bad), { art: 'e2', zoom: 1, ox: 0, oy: 0 }, JSON.stringify(bad));
  }
});

test('normalising is idempotent (a stored value survives the round trip; no 0.8× / -100% drift)', () => {
  const cases = [
    { art: 'e1', zoom: 1.6, ox: 37, oy: -20 },
    { art: 'e2', zoom: 0.8, ox: -100, oy: 100 },
    { art: 'e2', zoom: 2, ox: 0, oy: 0 },
  ];
  for (const c of cases) {
    const once = normalizeCardArt(c);
    assert.deepEqual(once, c, JSON.stringify(c));
    assert.deepEqual(normalizeCardArt(once), once, `idempotent: ${JSON.stringify(c)}`);
  }
});

test('clamps: zoom 0.8–2.0, offsets ±100 (percent of the frame), unknown art → 精二', () => {
  assert.equal(ZOOM_MIN, 0.8);
  assert.equal(ZOOM_MAX, 2);
  assert.deepEqual(normalizeCardArt({ zoom: 9, ox: -999, oy: 999, art: 'x' }), { art: 'e2', zoom: 2, ox: -100, oy: 100 });
  assert.deepEqual(normalizeCardArt({ zoom: 0.01 }), { art: 'e2', zoom: 0.8, ox: 0, oy: 0 });
  assert.equal(normalizeCardArt({ zoom: 1.234 }).zoom, 1.23); // round2 只看两位
});

test('精一 reads char/illust/<id>_1.png (same folder as 精二), 精二 the illust itself — never the base name', () => {
  assert.equal(artSrcOf(E2, 'e2'), E2);
  assert.equal(artSrcOf(E2, 'e1'), '/assets/char/illust/char_003_kalts_1.png');
  assert.equal(artSrcOf('/assets/char/illust/char_4217_makoto.png', 'e1'), '/assets/char/illust/char_4217_makoto_1.png');
  // 立绘已转 WebP（handoff/asset-webp/BACKUP.md）：扩展名跟着精二走，不做 png ⇄ webp 的假设
  assert.equal(artSrcOf('/assets/char/illust/char_003_kalts.webp', 'e1'), '/assets/char/illust/char_003_kalts_1.webp');
  // 皮肤立绘在 `illust/skin/…`（没有 `_1` 孪生）：原样返回 ⇒ 精一 = 精二
  const skin = '/assets/char/illust/skin/char_003_kalts_sale_14.png';
  assert.equal(artSrcOf(skin, 'e1'), skin, '[ASSUMED] skins have no 精一 twin');
  assert.equal(artSrcOf('/assets/char/illust/skin/char_003_kalts_sale_14.webp', 'e1'),
    '/assets/char/illust/skin/char_003_kalts_sale_14.webp', '[ASSUMED] skins have no 精一 twin');
  assert.equal(artSrcOf(null, 'e1'), null);
  assert.equal(artSrcOf('', 'e2'), null);
});

test('the frame transform is translate(ox%, oy%) scale(zoom) from the normalised value', () => {
  assert.equal(artTransform({ zoom: 1.2, ox: 10, oy: -5 }), 'translate(10%, -5%) scale(1.2)');
  assert.equal(artTransform(), 'translate(0%, 0%) scale(1)');
});

test('drag: px → percent of the frame, clamped; pinch: a ratio on the starting zoom', () => {
  const box = { w: 200, h: 400 };
  assert.deepEqual(panTo({ ox: 0, oy: 0 }, 100, 50, box), { art: 'e2', zoom: 1, ox: 50, oy: 13 }); // 13 = round(12.5)
  assert.deepEqual(panTo({ ox: 90, oy: 0 }, 100, 0, box), { art: 'e2', zoom: 1, ox: 100, oy: 0 }, 'clamped at +100');
  assert.deepEqual(panTo({ ox: 0, oy: 0 }, 0, 0, { w: 0, h: 0 }), { art: 'e2', zoom: 1, ox: 0, oy: 0 }, 'a zero box does not divide by zero');
  assert.equal(pinchTo({ zoom: 1 }, 100, 150).zoom, 1.5);
  assert.equal(pinchTo({ zoom: 1.8 }, 100, 200).zoom, 2, 'clamped at 2×');
  assert.equal(pinchTo({ zoom: 1 }, 0, 150).zoom, 1, 'no starting spread: no zoom');
  // the offsets are not touched by zooming
  assert.deepEqual(pinchTo({ zoom: 1, ox: 25, oy: -25 }, 100, 120), { art: 'e2', zoom: 1.2, ox: 25, oy: -25 });
});

test('the module owns its stylesheet (lazy link, the same way ui/forge.js does) and the CSS keeps the floors', () => {
  const js = read('public/js/ui/cardArt.js');
  assert.match(js, /link\.href = '\/css\/screens\/card-art\.css'/, 'the stylesheet is injected by the module');
  const css = read('public/css/screens/card-art.css');
  // 精一 is the same full-size 立绘 as 精二: cover, no contain special case, no 「简略图」angle badge
  assert.doesNotMatch(css, /object-fit:\s*contain/, 'no contain special case for any 立绘');
  assert.doesNotMatch(css, /\.cardart__badge/, 'the 简略图 badge is gone');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /data-art="e1"/, 'no e1-only rendering override');
  assert.match(js, /object-fit: cover; transform: \$\{artTransform\(v\)\}/, 'both versions are laid out identically');
  // drag only inside the frame
  assert.match(css, /\.cardart__frame\s*\{[^}]*touch-action: none/s);
  // 24px touch floor on the buttons and the slider; font sizes carry a px floor
  assert.match(css, /\.cardart__vbtn\s*\{[^}]*min-height: 24px/s);
  assert.match(css, /\.cardart__reset\s*\{[^}]*min-height: 24px/s);
  assert.match(css, /\.cardart__range\s*\{[^}]*min-height: 24px/s);
  assert.match(css, /\.rseat__pick--art\s*\{[^}]*min-height: max\(\.36rem, 24px\)/s);
  for (const line of css.split('\n').filter((l) => /^\s*font-size:/.test(l) && !/inherit/.test(l))) {
    assert.match(line, /max\(\d+px,/, `every font-size carries a px floor: ${line.trim()}`);
  }
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('room.js wiring: the seat card draws the 立绘, offers 立绘调整, and the panel is the card-art one', () => {
  const room = read('public/js/screens/room.js');
  assert.match(room, /import \{ CardArt, CardArtImage \} from '\.\.\/ui\/cardArt\.js'/);
  // public/js/assets.js (the big manifest) is loaded on demand — a static import would drag it into main.js's graph
  // (test/ui/plugins-client.test.js「assets.js only when needed」) — so the page resolves illustUrl through its hook
  assert.doesNotMatch(room, /import \{[^}]*illustUrl[^}]*\} from '\.\.\/assets\.js'/, 'no static import of the manifest');
  assert.match(room, /import\('\.\.\/assets\.js'\)/, 'loaded on demand, once');
  assert.match(room, /const illustUrl = useIllustUrl\(\);/);
  // the seat card art: 立绘 first, the portrait chain after it
  assert.match(room, /<span class="cardpick__img">|html`<\$\{CardArtImage\}/);
  assert.match(room, /canTune = isMe && illustOk && !!onTuneCard/);
  assert.match(room, /data-testid="seat-card-art"/);
  assert.match(room, /data-testid="seat-card-pick"/);
  assert.match(room, /onTuneCard=\$\{\(\) => setArtOpen\(true\)\}/);
  assert.match(room, /<\$\{CardArt\} charId=\$\{myOp\.chess\.charId\} illust=\$\{myIllust\} \/>/);
  assert.match(room, /const myIllust = myOp\s*\n\s*\? illustUrl\(data\.get\('assets'\), myOp\.chess\.charId, \{/);
  // the picker still closes on a pick (test/ui/room-cards.e2e.test.js pins that)
  assert.match(room, /const pickCard = \(charId\) => \{ setCard\(charId\); setPicking\(false\); \};/);
});

test('the card-art DOM the e2e panel drives: card-art / 精一精二 / a range / 重置', () => {
  const js = read('public/js/ui/cardArt.js');
  assert.match(js, /data-testid="card-art"/);
  assert.match(js, /data-testid="card-art-frame"/);
  assert.match(js, /data-testid="card-art-reset"/);
  assert.match(js, /<input type="range"/);
  assert.match(js, /\['e1', t\('精一'\)\], \['e2', t\('精二'\)\]/);
  // 精一 is the same full-size illustration → no 「简略图」badge and no separate fit for it
  assert.doesNotMatch(js, /cardart__badge|t\('简略图'\)/, 'no 简略图 badge in the panel');
  assert.match(js, /const src = artSrcOf\(illust, v\.art\);/);
});

test('every literal the panel shows exists in all four i18n packs', () => {
  const literals = ['立绘调整', '立绘', '精一', '精二', '拖拽调整位置', '缩放', '位置', '重置'];
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    const keys = Object.keys(pack.strings || pack);
    for (const w of literals) assert.ok(keys.includes(w), `${lang} is missing ${w}`);
  }
});
