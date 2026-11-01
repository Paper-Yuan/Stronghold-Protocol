// test/ui/room-seats.test.js — 房间人数 (room.state.maxSeats, room.setSeats; the owner's decision 2026-10-31) on the
// client: the capacity helper, the wide-room team split, the ⚙ 同盟设置 row and its three inline notes, and the source /
// CSS contract of the three main screens.
//
// The iron rule: a room without `maxSeats` (or with 4) must read exactly as before — 4 seat slots, the tall-card
// `.rs-seats` path, no 8/12 markup, no top-bar count. The wide branches are additive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as roomMod from '../../public/js/screens/room.js';
import {
  seatCapacity, teamCountOf, seatTeams, teamNameOf, seatsNote, seatsOption, seatsOption as seatsOptionFn,
  normalizeSeats, roomFacts, SEATS_LABEL, SEAT12_TEAM_TONES,
} from '../../public/js/screens/room.js';
// 第二层拆闸后 startGate 不再导出：这里保留一个名字，让「它确实没了」这条断言读得出来（undefined）
const startGate = roomMod.startGate;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'public/css/screens/room.css'), 'utf8');

/** A co-op room with `n` seats, seats 0..n-1 filled by p0..p(n-1) (humans, ready except the host). */
const room = (maxSeats, n = Math.min(maxSeats || 4, 4)) => {
  const cap = maxSeats || 4;
  return {
    code: '7K2Q',
    mode: 'coop',
    hostId: 'p0',
    inMatch: false,
    ...(cap > 4 ? { maxSeats: cap } : {}),
    seats: Array.from({ length: cap }, (_, i) => (i < n
      ? { seat: i, playerId: `p${i}`, name: `P${i}`, isBot: false, ready: i !== 0, connected: true }
      : null)),
  };
};

test('seatCapacity: absent / 4 / malformed = MAX_SEATS (4); 8 and 12 pass through; nothing else does', () => {
  for (const r of [null, undefined, {}, { maxSeats: 4 }, { maxSeats: 5 }, { maxSeats: 6 }, { maxSeats: 16 }, { maxSeats: '12' }]) {
    assert.equal(seatCapacity(r), 4, JSON.stringify(r));
  }
  assert.equal(seatCapacity({ maxSeats: 8 }), 8);
  assert.equal(seatCapacity({ maxSeats: 12 }), 12);
  assert.equal(teamCountOf({ maxSeats: 4 }), 1);
  assert.equal(teamCountOf({ maxSeats: 8 }), 2);
  assert.equal(teamCountOf({ maxSeats: 12 }), 3);
});

test('normalizeSeats / seatTeams: 4 seats stay exactly 4; 8 and 12 open one four-doctor team per capacity', () => {
  const four = room(4, 4);
  assert.equal(normalizeSeats(four).length, 4, '默认房仍是 4 个座位');
  assert.equal(seatTeams(four).length, 1);
  assert.deepEqual(normalizeSeats(four).map((s) => s.playerId), ['p0', 'p1', 'p2', 'p3']);

  const eight = room(8, 8);
  assert.equal(normalizeSeats(eight).length, 8);
  const t8 = seatTeams(eight);
  assert.equal(t8.length, 2);
  assert.deepEqual(t8.map((team) => team.map((s) => s?.playerId || null)), [
    ['p0', 'p1', 'p2', 'p3'],
    ['p4', 'p5', 'p6', 'p7'],
  ]);

  const twelve = room(12, 12);
  assert.equal(normalizeSeats(twelve).length, 12);
  const t12 = seatTeams(twelve);
  assert.equal(t12.length, 3);
  assert.deepEqual(t12.map((team) => team.map((s) => s?.playerId || null)), [
    ['p0', 'p1', 'p2', 'p3'],
    ['p4', 'p5', 'p6', 'p7'],
    ['p8', 'p9', 'p10', 'p11'],
  ]);
  // an empty slot keeps its position (an invite row, never a shift)
  const gap = room(8, 3);
  assert.equal(seatTeams(gap)[1].filter(Boolean).length, 0);
  assert.equal(seatTeams(gap)[0][3], null);
});

test('teamNameOf: 我方同盟 / 对方同盟 (8) and 我方同盟 / 蓝方同盟 / 红方同盟 (12)', () => {
  assert.equal(teamNameOf(0, 4), '我方同盟');
  assert.equal(teamNameOf(0, 8), '我方同盟');
  assert.equal(teamNameOf(1, 8), '对方同盟');
  assert.equal(teamNameOf(1, 12), '蓝方同盟');
  assert.equal(teamNameOf(2, 12), '红方同盟');
  assert.deepEqual([...SEAT12_TEAM_TONES], ['mine', 'blue', 'red']);
});

test('seatsNote: the three approved inline notes switch with the room state', () => {
  assert.equal(SEATS_LABEL, '房间人数');
  assert.equal(seatsNote({ mode: 'coop', maxSeats: 4 }, true), '可随时提高人数；降低人数需先让其他博士离开');
  assert.equal(seatsNote({ mode: 'coop', maxSeats: 8 }, true), '将变成 2 队 × 4 人');
  assert.equal(seatsNote({ mode: 'coop', maxSeats: 12 }, true), '将变成 3 队 × 4 人');
  // already started: two existing msgids joined
  assert.equal(seatsNote({ mode: 'coop', maxSeats: 8, inMatch: true }, true), '模拟已开始 · 不可更改');
  // everybody else reads it
  assert.equal(seatsNote({ mode: 'coop', maxSeats: 8 }, false), '由创建者设置');
});

test('seatsOption: the host before the match may edit; everybody else / a started room / solo may not', () => {
  const r = room(8, 2);
  assert.deepEqual(seatsOption(r, 'p0'), { value: 8, editable: true });
  assert.deepEqual(seatsOption(r, 'p1'), { value: 8, editable: false });
  assert.deepEqual(seatsOption({ ...r, inMatch: true }, 'p0'), { value: 8, editable: false });
  assert.equal(seatsOption({ ...r, mode: 'solo' }, 'p0'), null);
  assert.equal(seatsOptionFn({ ...r, mode: 'solo_infinite' }, 'p0'), null);
  assert.equal(seatsOption(null, 'p0'), null);
});

test('roomFacts: a 8/12 seat room counts every occupied slot and keeps 4 unfilled teams empty', () => {
  const r8 = roomFacts(room(8, 5), 'p0');
  assert.equal(r8.seats.length, 8);
  assert.equal(r8.occupied.length, 5);
  assert.equal(r8.emptySeats, 3);
  assert.equal(r8.isHost, true);

  const r12 = roomFacts(room(12, 8), 'p0');
  assert.equal(r12.seats.length, 12);
  assert.equal(r12.occupied.length, 8);
  assert.equal(r12.emptySeats, 4);

  // the four-seat room is the old room (no maxSeats key on the wire)
  const r4 = roomFacts(room(4, 4), 'p0');
  assert.equal(r4.seats.length, 4);
  assert.equal(r4.occupied.length, 4);
  assert.equal(r4.emptySeats, 0);
});

test('room.js wiring: the ⚙ 房间人数 row, its note, the top count, the room.setSeats request', () => {
  assert.ok((/data-testid="room-opt-seats"/).test(SRC), "/data-testid=\"room-opt-seats\"/");
  assert.ok((/role="group" aria-label=\$\{SEATS_LABEL\}/).test(SRC), "/role=\"group\" aria-label=\\$\\{SEATS_LABEL\\}/");
  assert.ok((/ROOM_SEAT_CAPS\.map\(\(n\)/).test(SRC), "/ROOM_SEAT_CAPS\\.map\\(\\(n\\)/");
  assert.ok((/seatsNote\(room, seatsOption\.editable\)/).test(SRC), "/seatsNote\\(room, seatsOption\\.editable\\)/");
  assert.ok((/data-testid="room-opt-seats-note"/).test(SRC), "/data-testid=\"room-opt-seats-note\"/");
  assert.ok((/net\.request\('room\.setSeats', \{ maxSeats \}\)/).test(SRC), "/net\\.request\\('room\\.setSeats', \\{ maxSeats \\}\\)/");
  // top bar count only in the wide branch: n/maxSeats, never n/4
  assert.ok((/data-testid="room-count"/).test(SRC), "/data-testid=\"room-count\"/");
  assert.ok((/\$\{facts\.occupied\.length\}<i>\/<\/i>\$\{cap\}/).test(SRC), "/\\$\\{facts\\.occupied\\.length\\}<i>\\/<\\/i>\\$\\{cap\\}/");
  // the 8-seat two-column branch and the 12-seat chips / 40 px bar
  assert.ok((/teamNameOf\(0, cap\)/).test(SRC), "/teamNameOf\\(0, cap\\)/");
  assert.ok((/teamNameOf\(1, cap\)/).test(SRC), "/teamNameOf\\(1, cap\\)/");
  assert.ok((/rs-seat8__col/).test(SRC), "/rs-seat8__col/");
  assert.ok((/rs-seat12__chip/).test(SRC), "/rs-seat12__chip/");
  assert.ok((/rs-seat12__bar/).test(SRC), "/rs-seat12__bar/");
  assert.ok((/rs-seat12__team/).test(SRC), "/rs-seat12__team/");
  assert.ok((/onOpenTeam\(team\)/).test(SRC), "/onOpenTeam\\(team\\)/");
  assert.ok((/‹<\/span>\$\{t\('返回'\)\}/).test(SRC), "/‹<\\/span>\\$\\{t\\('返回'\\)\\}/");
});

test('the 4-seat main screen is still the original tall-card branch (zero wide markup)', () => {
  // the original map over facts.seats with <SeatCard> is intact, and only `wide` takes the other branch
  assert.ok((/const wide = coop && cap > MAX_SEATS;/).test(SRC), "/const wide = coop && cap > MAX_SEATS;/");
  assert.ok((/\$\{wide\s*\n?\s*\? html`<\$\{WideRoom\}/).test(SRC), "/\\$\\{wide\\s*\\n?\\s*\\? html`<\\$\\{WideRoom\\}/");
  assert.ok((/: facts\.seats\.map\(\(s, i\) => \{/).test(SRC), "/: facts\\.seats\\.map\\(\\(s, i\\) => \\{/");
  assert.ok((/<\$\{SeatCard\} key=\$\{s \? `p\$\{s\.playerId\}` : `e\$\{i\}`\}/).test(SRC), "/<\\$\\{SeatCard\\} key=\\$\\{s \\? `p\\$\\{s\\.playerId\\}` : `e\\$\\{i\\}`\\}/");
  assert.ok((/<main class=\$\{`seats rs-seats\$\{coop \? '' : ' seats--solo'\}\$\{wide \? ` rs-seats--wide rs-seats--\$\{cap\}/).test(SRC), "/<main class=\\$\\{`seats rs-seats\\$\\{coop \\? '' : ' seats--solo'\\}\\$\\{wide \\? ` rs-seats--wide rs-seats--\\$\\{cap\\}/");
});

// 第二层已把闸拆掉 (docs/TWELVE_PLAYER_MODE.md): 房间层 4 / 8 / 12 与对局层现在是同一件事，所以 8 / 12 人房全员
// 就绪就该能开局（canStart true），客户端不再有 暂不可用 这条闸 / 提示 / 状态行分支；4 人房的一切照旧。
test('拆闸：8 / 12 人房不再有开局闸，canStart 只看就绪与房主（4 人房回归）', () => {
  assert.equal(typeof startGate, 'undefined', 'startGate 已随第二层删除（export 也没了）');
  for (const [cap, n] of [[8, 5], [12, 8]]) {
    const facts = roomFacts(room(cap, n), 'p0');
    assert.equal(Object.hasOwn(facts, 'startGate'), false, 'the gate fact is gone');
    assert.equal(facts.canStart, true, cap + ' 人房全员就绪 ⇒ 可以开始');
    assert.equal(roomFacts(room(cap, n), 'p1').canStart, false, 'a non-host still cannot start');
  }
  const four = roomFacts(room(4, 4), 'p0');
  assert.equal(four.canStart, true, '4 人房全员就绪：开始按钮可用（回归）');
  // a value outside ROOM_SEAT_CAPS is not a capacity: it reads as MAX_SEATS (a 4-seat room)
  assert.equal(seatCapacity({ maxSeats: 5 }), 4);
  assert.equal(seatCapacity({ maxSeats: 16 }), 4);
});

test('拆闸 wiring: 开始模拟 的按钮 / tooltip / 状态行回到 4 人房那份，源码里不再有闸', () => {
  // 开始模拟 的 disabled 表达式逐字节没动（与 test/ui/version-vote.test.js 的同一条断言，即「4 人房零改动」的见证）
  assert.ok((/disabled=\$\{!facts\.canStart \|\| !online \|\| busy === 'start' \|\| !!vote\}/).test(SRC),
    "disabled=${!facts.canStart || !online || busy === 'start' || !!vote}/");
  // the gate's prefix, its fact and its two branches are gone
  assert.equal(/startGate/.test(SRC), false, 'no startGate left in room.js');
  assert.equal(/gatesStart/.test(SRC), false, 'no gatesStart left in room.js');
  assert.ok((/canStart: isHost && othersReady && !!mine && contentReady &&/).test(SRC), 'canStart: isHost && othersReady && !!mine && contentReady &&');
  // the tooltip chain is the original one (no gate prefix)
  assert.ok((/text=\$\{facts\.canStart \? null : vote \?/).test(SRC), 'the original tooltip chain');
});


test('room.css: 54/46 and 64/36 columns, 44 px rows, 32 px avatars, 65%→35% veil, 40 px bar with 26 px avatars', () => {
  assert.ok((/\.rs-seats--8 \{ grid-template-columns: 54% 46%; \}/).test(CSS), "/\\.rs-seats--8 \\{ grid-template-columns: 54% 46%; \\}/");
  assert.ok((/\.rs-seats--12 \{ grid-template-columns: 64% 36%; \}/).test(CSS), "/\\.rs-seats--12 \\{ grid-template-columns: 64% 36%; \\}/");
  assert.ok((/\.rs-seats--12\.is-expanded \{ grid-template-columns: 40px minmax\(0, 1fr\); \}/).test(CSS), "/\\.rs-seats--12\\.is-expanded \\{ grid-template-columns: 40px minmax\\(0, 1fr\\); \\}/");
  assert.ok((/\.rs-seat12__bar \{[\s\S]{0,600}width: 40px;/).test(CSS), "/\\.rs-seat12__bar \\{[\\s\\S]{0,600}width: 40px;/");
  assert.ok((/\.rs-seat12__barav \{[\s\S]{0,300}width: 26px;\s*\n\s*height: 26px;/).test(CSS), "/\\.rs-seat12__barav \\{[\\s\\S]{0,300}width: 26px;\\s*\\n\\s*height: 26px;/");
  assert.ok((/\.rs-namecard \{[\s\S]{0,400}height: 44px;/).test(CSS), "/\\.rs-namecard \\{[\\s\\S]{0,400}height: 44px;/");
  assert.ok((/\.rs-avatar \{[\s\S]{0,300}width: 32px;\s*\n\s*height: 32px;/).test(CSS), "/\\.rs-avatar \\{[\\s\\S]{0,300}width: 32px;\\s*\\n\\s*height: 32px;/");
  assert.ok((/linear-gradient\(90deg, rgba\(6, 9, 8, \.65\), rgba\(6, 9, 8, \.35\)\)/).test(CSS), "/linear-gradient\\(90deg, rgba\\(6, 9, 8, \\.65\\), rgba\\(6, 9, 8, \\.35\\)\\)/");
  assert.ok((/filter: saturate\(\.66\) brightness\(\.72\)/).test(CSS), "/filter: saturate\\(\\.66\\) brightness\\(\\.72\\)/");
  assert.ok((/\.rs-namecard--empty::before \{[\s\S]{0,300}border: 1px dashed #3d4642;/).test(CSS), "/\\.rs-namecard--empty::before \\{[\\s\\S]{0,300}border: 1px dashed #3d4642;/");
  // the segmented control: mint selection, and only the UNSELECTED segment dims when disabled
  assert.ok((/\.rs-opts__segbtn\.is-on \{[\s\S]{0,300}background: var\(--mint-500\);/).test(CSS), "/\\.rs-opts__segbtn\\.is-on \\{[\\s\\S]{0,300}background: var\\(--mint-500\\);/");
  assert.ok((/\.rs-opts__segbtn:disabled:not\(\.is-on\) \{ opacity: \.42; \}/).test(CSS), "/\\.rs-opts__segbtn:disabled:not\\(\\.is-on\\) \\{ opacity: \\.42; \\}/");
  assert.ok((/\.rs-opts__segbtn \{[\s\S]{0,800}height: max\(32px, calc\(36px \* var\(--sp-ui, 1\)\), \.36rem\);/).test(CSS), "/\\.rs-opts__segbtn \\{[\\s\\S]{0,800}height: max\\(32px, calc\\(36px \\* var\\(--sp-ui, 1\\)\\), \\.36rem\\);/");
});
