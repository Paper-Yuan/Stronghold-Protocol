// Regression tests (Node) of user playtest #6, client-UI items (workstream WD):
//   6  the 机变 道具补给 overlay showed only icon, name and tier on each card — no effect text (the user's Android,
//      756×366 CSS px: the description sat below the fold of a 105 px card and was clipped). The cards now use the
//      official layout (research 06 §11.5 / the official 机变 screenshots): a framed icon with the name beside it, the
//      description across the card under both, left-aligned; the description is the item's / effect's official rich text
//      (the same text as the detail card: items.json / effects.json `descRaw`), even when the server card carries the
//      plain `desc`. The taker's badge is the round avatar alone (official) and a taken card's name keeps clear of it.
//      The on-screen check (every card's text inside its card, taken or not, no name under the badge, at the phone
//      viewports down to 640×360 and on desktop) is the browser test test/ui/playtest6-ui.e2e.test.js.
//  10  on phones the second tap on the armed shop card's 确认购买 strip did nothing: the card's ⓘ corner (invisible on
//      touch, opacity 0 without hover) had a 44 px touch hit area (css/devices.css — its 30 px override lost on
//      specificity) over the bottom-right quarter of the 67 × 97 px card, right half of the strip included; a tap there
//      re-opened the detail (stopPropagation) instead of buying. The ⓘ is gone (official cards have none: the first tap
//      selects and shows the detail, the second confirms); a tap anywhere on a card is the card's tap, and a card that
//      cannot be bought now (bar not editable) opens its detail instead.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// the browser data store reads the real data files from disk
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { ChoiceView, resolveSpCard, cardText } = await import('../../public/js/ui/choiceOverlay.js');
const { ChessCard, ItemCard } = await import('../../public/js/ui/shopBar.js');
const { normalizeSp } = await import('../../public/js/ui/gameLogic.js');
const { richTextPlain } = await import('../../public/js/ui/richText.js');
const { cardView } = await import('../../server/match/choices.js');
const { data } = await import('../../public/js/data.js');

/** Every vnode of a preact tree (htm output), depth first. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const children = (v) => [v.props?.children].flat(Infinity).filter((x) => x && typeof x === 'object');

await data.loadAll('items', 'effects', 'choices', 'assets', 'chess', 'bonds');

// ---- 6: 机变 cards show their effect text ----------------------------------------------------------------------------

describe('6: 机变 cards (道具补给 / 机密商店 / 悬赏 / 战术) show the effect text in the official layout', () => {
  const players = [{ playerId: 'me', seat: 0, name: 'Me' }, { playerId: 'p2', seat: 1, name: 'P2' }];
  // server-shaped public cards (server/match/choices.js itemCard → cardView): the plain `desc` of the item
  const shopItems = data.list('items').filter((i) => i.itemType === 'EQUIP' && !i.isGolden && !i.shopExcluded);
  const longest = [...shopItems].sort((a, b) => b.descRaw.length - a.descRaw.length).slice(0, 6);
  const serverSp = (family, cards) => normalizeSp({ family, cards: cards.map((c, idx) => cardView({ ...c, idx })), order: ['me', 'p2'], turn: 'me', picks: { p2: 5 } }, players);
  const itemCards = longest.map((it) => ({ kind: 'item', id: it.id, name: it.name, desc: it.desc, tier: it.tier }));

  for (const family of ['supply', 'shop']) {
    test(`${family}: every item card carries the item's official rich description (the detail card's text), beside nothing`, () => {
      const sp = serverSp(family, itemCards);
      const nodes = [...walk(ChoiceView({ pub: { players, deadline: 0 }, sp, myId: 'me', solo: false }))];
      const cards = nodes.filter((n) => hasClass(n, 'spcard'));
      assert.equal(cards.length, 6);
      cards.forEach((card, i) => {
        const it = longest[i];
        const desc = [...walk(card)].find((n) => hasClass(n, 'spcard__desc'));
        assert.ok(desc, `${it.name}: a description`);
        // RichText renders descRaw (ba.vup numbers, ba.acrem set bonus, line breaks) — the plain server text lost them
        assert.equal(desc.props.text, it.descRaw, `${it.name}: the rich text, as ItemDetail shows it`);
        assert.equal(richTextPlain(desc.props.text).replace(/\s/g, ''), it.desc.replace(/\s/g, ''));
      });
    });
  }

  test('bounty / tactic cards: the effect\'s rich text too (numbers and 下场作战 highlighted like the official cards)', () => {
    const ch = data.get('choices');
    for (const [family, list] of [['bounty', ch.cards.bounty], ['tactic', ch.cards.tactic]]) {
      const src = list.slice(0, 6);
      const sp = serverSp(family, src.map((c) => ({ kind: family, id: c.effectId, name: c.name, desc: c.desc, tier: c.tier ?? null, team: c.team, tacticKind: c.kind, enemyKey: c.enemyKey, coin: c.coin })));
      sp.cards.forEach((card, i) => {
        const r = resolveSpCard(card, family);
        const eff = data.lookup('effects', src[i].effectId);
        assert.equal(r.desc, eff.descRaw, `${family} ${src[i].name}`);
        assert.match(r.desc, /<@ba\.v(up|down)>/, `${family} ${src[i].name}: highlighted parts`);
      });
    }
  });

  test('cardText: the data\'s rich text only while it says what the server says; a server-side wording wins', () => {
    const rich = '为自身<@ba.vup>下场作战</>添加1只A，将其击倒者获得<@ba.vup>2</>资金';
    assert.equal(cardText({ desc: '为自身下场作战添加1只A，将其击倒者获得2资金' }, rich), rich);
    assert.equal(cardText({}, rich), rich, 'no server text (the mock harness): the data');
    const changed = '为自身之后2场作战添加1只A，将其击倒者获得2资金';
    assert.equal(cardText({ desc: changed }, rich), changed, 'a different server wording is shown as sent');
    assert.equal(cardText({ descRaw: '<@ba.vup>x</>', desc: 'x' }, rich), '<@ba.vup>x</>', 'the card\'s own rich text first');
    assert.equal(cardText({ desc: 'plain' }, ''), 'plain');
  });

  test('layout: a head row (framed icon + name, tags under the name), the description under it across the card', () => {
    const sp = serverSp('supply', itemCards);
    const v = ChoiceView({ pub: { players, deadline: 0 }, sp, myId: 'me', solo: false });
    for (const card of [...walk(v)].filter((n) => hasClass(n, 'spcard'))) {
      const kids = children(card);
      const head = kids.find((n) => hasClass(n, 'spcard__head'));
      assert.ok(head, 'a head row is a direct child of the card');
      const headNodes = [...walk(head)];
      assert.ok(headNodes.some((n) => hasClass(n, 'spcard__icon')) && headNodes.some((n) => hasClass(n, 'spcard__name')), 'icon + name in the head');
      const desc = kids.find((n) => hasClass(n, 'spcard__desc'));
      assert.ok(desc, 'the description is a direct child of the card');
      assert.ok(kids.indexOf(desc) > kids.indexOf(head), 'under the head');
    }
    // the taker's badge and the two-tap strip stay (DESIGN §18.2); the badge is the round avatar alone, as in the
    // official screenshots — the taker's name is the badge's tooltip and part of the card's accessible name (the
    // avatar + name pill ran under long card names once the name moved into the top row)
    const taken = [...walk(v)].filter((n) => hasClass(n, 'spcard') && hasClass(n, 'is-taken'));
    assert.equal(taken.length, 1);
    const badge = [...walk(taken[0])].find((n) => hasClass(n, 'spcard__taker'));
    assert.ok(badge, 'the taker\'s badge');
    assert.equal(children(badge).length, 1, 'avatar only');
    assert.equal(children(badge)[0].type?.name, 'PlayerAvatar');
    assert.equal(badge.props.title, 'P2 已选择');
    assert.match(taken[0].props['aria-label'], /，P2已选择$/);
    const armed = [...walk(ChoiceView({ pub: { players, deadline: 0 }, sp, myId: 'me', solo: false, armed: 0 }))];
    assert.ok(armed.some((n) => hasClass(n, 'spcard__confirm')));
  });

  test('CSS: left-aligned official card; the description is clamped by lines, larger on desktop, ≥ .18rem on short phones', () => {
    const css = read('public/css/screens/game-panels.css');
    const rule = (sel, src = css) => {
      const m = src.match(new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
      return m ? m[1] : null;
    };
    assert.match(rule('.spcard'), /text-align: left/);
    assert.match(rule('.spcard__head'), /display: flex/);
    const desc = rule('.spcard__desc');
    assert.match(desc, /-webkit-line-clamp: \d/);
    const size = (r) => Number(r.match(/font-size: (\.\d+)rem/)[1]);
    assert.ok(size(desc) >= 0.19, `desktop description ${size(desc)}rem`);
    // short landscape phones (height < 10.8rem because the root size is clamped at 40 px)
    const phone = css.match(/@media \(max-height: 431\.98px\) \{([\s\S]*?)\n\}/);
    assert.ok(phone, 'a short-screen block');
    const pdesc = rule('.spcard__desc', phone[1]);
    assert.ok(pdesc && size(pdesc) >= 0.18, 'phones keep a readable description');
    assert.doesNotMatch(pdesc, /line-clamp/, 'phones show as many lines as 16:9 (信标 takes 7 below ≈ 740 px wide)');
    assert.ok(rule('.spcard__icon', phone[1]), 'phones use a smaller icon');
    assert.match(rule('.spov__inner', phone[1]) || '', /top: \.\d+rem/, 'phones: a tighter header gives the grid more height');
    // a taken card's head keeps clear of the taker's badge (top-right corner), on phones too
    assert.match(rule('.spcard.is-taken .spcard__head'), /padding-right: calc\(var\(--tk\) \+ var\(--tk-at\) - var\(--sp-px\)/);
    assert.match(rule('.spcard__taker'), /right: var\(--tk-at\); top: var\(--tk-at\)/);
    assert.match(rule('.spcard', phone[1]), /--sp-px: [^;]+; --tk: [^;]+; --tk-at:/);
  });
});

// ---- 10: the armed shop card confirms wherever it is tapped --------------------------------------------------------

describe('10: a tap anywhere on the armed shop card buys (no inner target swallows the confirm)', () => {
  const chess = data.list('chess').find((c) => c.visible && !c.isGolden && c.tier === 3);
  const item = data.list('items').find((i) => i.itemType === 'EQUIP' && !i.isGolden && !i.shopExcluded);
  const priv = { funds: 20, hand: [], board: [], temp: [], loadout: {} };
  const clickables = (v) => [...walk(v)].filter((n) => typeof n.props?.onClick === 'function');

  for (const [kind, Card, slot] of [['operator', ChessCard, { kind: 'chess', id: chess.chessId, price: 3, basePrice: 3 }], ['item', ItemCard, { kind: 'item', id: item.id, price: 2, basePrice: 2 }]]) {
    test(`${kind} card: armed, the card is the only tap target in it (no ⓘ corner) and its tap confirms`, () => {
      const taps = [];
      const v = Card({ slot, idx: 2, priv, armed: true, onTap: (i) => taps.push(['tap', i]), onBuy: (i) => taps.push(['buy', i]), onDetail: (id) => taps.push(['detail', id]) });
      const nodes = [...walk(v)];
      assert.ok(!nodes.some((n) => hasClass(n, 'scard__detail')), 'no ⓘ corner on the card');
      const cl = clickables(v);
      assert.equal(cl.length, 1, 'one click handler: the card itself');
      assert.ok(hasClass(cl[0], 'scard') && hasClass(cl[0], 'is-armed'));
      assert.ok(nodes.some((n) => n.type?.name === 'ArmedTag'), 'the 确认购买 strip');
      cl[0].props.onClick();
      assert.deepEqual(taps, [['tap', 2]], 'the second tap goes to the two-tap handler (ShopBar buys)');
    });

    test(`${kind} card: not armed, no inner target either; a card that cannot be bought now opens its detail`, () => {
      const taps = [];
      const idle = Card({ slot, idx: 1, priv, onTap: (i) => taps.push(['tap', i]), onBuy: (i) => taps.push(['buy', i]), onDetail: (id) => taps.push(['detail', id]) });
      assert.equal(clickables(idle).length, 1);
      clickables(idle)[0].props.onClick();
      // not editable (ready / round start): no two-tap, a reason — the tap shows the detail (the ⓘ did before)
      const locked = Card({ slot, idx: 1, priv, reason: '已准备就绪，取消准备后才能操作', onBuy: (i) => taps.push(['buy', i]), onDetail: (id) => taps.push(['detail', id]) });
      const lockedNodes = [...walk(locked)];
      assert.ok(!lockedNodes.some((n) => hasClass(n, 'scard__detail')));
      const btn = lockedNodes.find((n) => hasClass(n, 'scard'));
      assert.notEqual(btn.props['aria-disabled'], 'true', 'its tap does something: not announced as disabled');
      btn.props.onClick();
      assert.deepEqual(taps, [['tap', 1], ['detail', slot.id]]);
    });
  }

  test('CSS: no hit area of an ⓘ corner is left (it covered the bottom-right quarter of a phone card)', () => {
    assert.doesNotMatch(read('public/css/devices.css'), /scard__detail/);
    assert.doesNotMatch(read('public/css/screens/game-shop.css'), /scard__detail/);
    assert.doesNotMatch(read('public/js/ui/shopBar.js'), /scard__detail/);
    // a locked bar's card opens its detail: a help cursor, not "not allowed"
    assert.match(read('public/css/screens/game-shop.css'), /\.shopbar\.is-locked \.scard:not\(\.scard--sold\) \{ cursor: help; \}/);
  });
});
