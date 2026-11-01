// test/ui/ban-picker.test.js — 炸惊模拟 · 卡池预选（业主 2026-10-28 C 项，public/js/ui/banPicker.js + room.js 接线）。
//
// 服务端那一半已经有 test/match/zhajing-bans.test.js（配额 / 列 / 去重 / 只认炸惊房 / 已开局拒绝）；这里钉住**客户端**：
//   1. 配额从 `data/config.json` 的 `bans.ZHAJING` 现算（3 / 4），不写死 —— 数据一改，这一页跟着改；
//   2. 两列的判据与服务端 `pick(list, wantCore, …)` 完全一致（`isCore === true` 进核心，其余进附加），
//      所以客户端画不出服务端会拒掉的组合；
//   3. 点一下的语义：已选取消、没满才加、**满了原样返回**（不发请求）；
//   4. 发出去的 `room.bans` 通过 shared/protocol.js 的形状校验（`mode` 是 loadout mode，两个 id 列表都合法）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BAN_MODE, banQuota, banLists, seatBans, toggleBan, sameBans } from '../../public/js/ui/banPicker.js';
import { isBondIdList, isLoadoutMode } from '../../shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const CFG = JSON.parse(read('data/config.json'));
const BONDS = Object.values(JSON.parse(read('data/bonds.json')));

test('the quota comes from config.bans.ZHAJING (3 core / 4 addon), with the server\'s own fallback', () => {
  assert.deepEqual(banQuota(CFG), { core: 3, addon: 4 });
  assert.deepEqual(CFG.bans.ZHAJING, { core: 3, addon: 4 });
  assert.deepEqual(banQuota({}), { core: 3, addon: 4 }, 'a build without the table falls back like server/lobby.js');
  assert.deepEqual(banQuota({ bans: { ZHAJING: { core: 1 } } }), { core: 1, addon: 4 });
});

test('the two columns use exactly the server\'s predicate: isCore === true → core, the rest → addon', () => {
  const { core, addon } = banLists(BONDS);
  assert.ok(core.length > 0 && addon.length > 0);
  assert.ok(core.every((b) => b.isCore === true), 'core: only isCore records');
  assert.ok(addon.every((b) => b.isCore !== true), 'addon: never an isCore record');
  // every bond in the zhajing view is offered exactly once (no record lost, no duplicate)
  const ids = [...core, ...addon].map((b) => b.bondId);
  assert.deepEqual(new Set(ids).size, ids.length);
  assert.deepEqual(new Set(ids), new Set(BONDS.map((b) => b.bondId)));
  // data order (identifier desc, then id) — the same normalisation the server applies to its echo
  const sorted = (list) => list.every((b, i) => i === 0
    || ((Number(list[i - 1].identifier) || 99) > (Number(b.identifier) || 99))
    || (((Number(list[i - 1].identifier) || 99) === (Number(b.identifier) || 99)) && String(list[i - 1].bondId) < String(b.bondId)));
  assert.ok(sorted(core) && sorted(addon), 'sorted by identifier then bondId');
});

test('my lists are the server echo (room.state.seats[].bans.zhajing), never a guess', () => {
  const room = { seats: [{ playerId: 'a' }, { playerId: 'me', bans: { zhajing: { core: ['x'], addon: ['y', 'z'] } } }] };
  assert.deepEqual(seatBans(room, 'me'), { core: ['x'], addon: ['y', 'z'] });
  assert.deepEqual(seatBans(room, 'a'), { core: [], addon: [] }, 'no bans yet');
  assert.deepEqual(seatBans(room, 'nobody'), { core: [], addon: [] });
  assert.deepEqual(seatBans(null, 'me'), { core: [], addon: [] });
  // a malformed echo never reaches the UI as junk
  assert.deepEqual(seatBans({ seats: [{ playerId: 'me', bans: { zhajing: { core: [1, 'ok', null], addon: 'no' } } }] }, 'me'),
    { core: ['ok'], addon: [] });
});

test('clicking: selected → removed, room left → added, full column → unchanged (no request at all)', () => {
  const quota = { core: 3, addon: 4 };
  let sel = { core: [], addon: [] };
  sel = toggleBan(sel, 'bondA', 'core', quota);
  assert.deepEqual(sel.core, ['bondA']);
  sel = toggleBan(sel, 'bondB', 'core', quota);
  sel = toggleBan(sel, 'bondC', 'core', quota);
  assert.equal(sel.core.length, 3);
  // full: the 4th is a no-op — the very same object value, so the caller can tell "nothing changed"
  const full = toggleBan(sel, 'bondD', 'core', quota);
  assert.deepEqual(full, sel);
  assert.ok(sameBans(full, sel));
  // ... but removing still works
  sel = toggleBan(sel, 'bondB', 'core', quota);
  assert.deepEqual(sel.core, ['bondA', 'bondC']);
  // the addon column has its own quota and is not affected by core
  sel = toggleBan(sel, 'addonA', 'addon', quota);
  assert.deepEqual(sel, { core: ['bondA', 'bondC'], addon: ['addonA'] });
  assert.equal(sameBans(sel, { core: ['bondC', 'bondA'], addon: ['addonA'] }), false, 'order counts');
});

test('the message this panel sends is a valid `room.bans` (mode is a loadout mode, both lists are bond id lists)', () => {
  assert.equal(BAN_MODE, 'zhajing');
  assert.ok(isLoadoutMode(BAN_MODE));
  const quota = banQuota();
  const one = toggleBan({ core: [], addon: [] }, BONDS.find((b) => b.isCore === true).bondId, 'core', quota);
  const next = toggleBan(one, BONDS.find((b) => b.isCore !== true && !one.core.includes(b.bondId)).bondId, 'addon', quota);
  assert.ok(isBondIdList(next.core) && isBondIdList(next.addon));
  assert.ok(isBondIdList([]), 'an empty list is legal (it clears the column)');
  // the wire shape the server validates against
  const proto = read('shared/protocol.js');
  assert.match(proto, /'room\.bans': \{ mode: isLoadoutMode, core: isBondIdList, addon: isBondIdList/);
});

test('room.js wiring: 炸惊 only, opens the picker, sends room.bans through the one-request-at-a-time runner', () => {
  const room = read('public/js/screens/room.js');
  assert.match(room, /import \{ ZhajingBansButton, ZhajingBanPicker \} from '\.\.\/ui\/banPicker\.js'/);
  assert.match(room, /room\.difficulty === ZHAJING_DIFFICULTY \? html`<\$\{ZhajingRulesButton\}[^`]*?<\$\{ZhajingBansButton\}/s,
    'the entry sits next to 规则 and only in a 炸惊 room');
  assert.match(room, /<\$\{ZhajingBanPicker\} room=\$\{room\} myId=\$\{me\.playerId\} busy=\$\{busy === 'bans'\}/);
  assert.match(room, /run\('bans', \(\) => net\.request\('room\.bans', \{ mode: 'zhajing', core: next\.core, addon: next\.addon \}\)\)/);
});

test('the DOM the e2e panel drives: zj-ban-picker root, per-column counts, aria-pressed chips', () => {
  const js = read('public/js/ui/banPicker.js');
  assert.match(js, /data-testid="zj-ban-picker"/);
  assert.match(js, /data-testid=\$\{`zj-ban-count-\$\{kind\}`\}/);
  assert.match(js, /aria-pressed=\$\{on \? 'true' : 'false'\}/);
  assert.match(js, /data-testid="zj-bans-open"/);
  assert.match(js, /link\.href = '\/css\/screens\/ban-picker\.css'/, 'the stylesheet is injected by the module');
});

test('the CSS keeps the floors (24px touch, px floors on every font-size, no !important / :has)', () => {
  const css = read('public/css/screens/ban-picker.css').replace(/\/\*[\s\S]*?\*\//g, ''); // 注释里可以提到这两条禁令
  assert.ok(!/!important/.test(css) && !/:has\(/.test(css));
  assert.match(css, /\.zjban__chip\s*\{[^}]*min-height: 24px/s);
  for (const line of css.split('\n').filter((l) => /^\s*font-size:/.test(l) && !/inherit/.test(l))) {
    assert.match(line, /max\(\d+px,/, `every font-size carries a px floor: ${line.trim()}`);
  }
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('every literal the panel shows exists in all four i18n packs', () => {
  const literals = ['卡池预选', '核心盟约', '附加盟约', '重置', '关闭',
    '禁选的盟约只影响你自己的干员池：队友的池子不受影响，没填满的槽位由系统随机补。'];
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    for (const w of literals) assert.ok(Object.hasOwn(pack, w), `${lang} is missing ${w}`);
  }
});
