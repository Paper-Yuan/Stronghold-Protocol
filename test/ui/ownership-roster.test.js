// 干员持有名册的包过滤（ui/ownershipModel.js ownershipRoster，task-11）：
//
//   1. 判据只可能因为调用方**显式**给了集合而生效：`null`（默认，也是今天唯一的生产调用
//      screens/ownership.js `ownershipRoster(data.list('chess'))`）= 调用方不限制；空 Set = 一个包都没启用。
//      曾经的写法 `!enabledModIds || !enabledModIds.has(pId)` 把「没传」读成空集 —— 数据一有 packId 就会悄悄
//      把整批棋子从持有页删掉。
//   2. 这里的 packId 是**插件/模组包**（public/js/roomMods.js registerPackOperators → chessToPackMap），不是炸惊/
//      湮灭这种玩法包：玩法干员靠「房间内容集 + visible」进出持有页，与 packId 无关。
//   3. 「两个玩法特色内容不外溢」：默认数据下炸惊记录全部 visible:false、湮灭 mod 自带的 13 名干员也是 visible:false
//      （持有页 53 条一条都不含它们），持有页始终只列官方可见棋 —— 玩法干员在**干员调配**的炸惊档名册
//      （ui/loadoutModel.js zhajingRosterOf，99 条）与湮灭档名册（ui/loadoutModel.js annihilationRosterOf，
//      官方 112 + mod 自带 13 个干员位，按房间 annMods 收窄）里，不进持有页。
import { test, describe } from 'node:test';
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

const { data } = await import('../../public/js/data.js');
const M = await import('../../public/js/ui/ownershipModel.js');
const { isDroppableChess } = await import('../../shared/standIn.js');
const { zhajingRosterOf } = await import('../../public/js/ui/loadoutModel.js');

await data.loadAll('chess');

const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const ids = (list) => list.map((c) => c.chessId);
const sorted = (a) => [...a].sort();

/** A record that passes isDroppableChess (NORMAL, base form, its own stand-in) and is listed unless a filter drops it. */
const fakeChess = (chessId, extra = {}) => ({
  chessId, baseId: chessId, chessType: 'NORMAL', isGolden: false, isDiy: false, isHidden: false,
  visible: true, tier: 3, shopSortId: 1, charId: 'char_fake_a', backup: { charId: 'char_fake_b' }, ...extra,
});

describe('ownershipRoster: the pack filter (task-11)', () => {
  test('a packId record: no set → kept; an empty Set → dropped; a set naming its pack → kept', () => {
    const packed = fakeChess('chess_fake_pack_a', { packId: 'pack_alpha' });
    const plain = fakeChess('chess_fake_plain_a');
    // (a) 不传 / 显式 null：调用方不限制 —— 带 packId 的棋子必须留下（回归点：原来会被整批剔除）
    assert.deepEqual(ids(M.ownershipRoster([packed])), ['chess_fake_pack_a']);
    assert.deepEqual(ids(M.ownershipRoster([packed], null)), ['chess_fake_pack_a']);
    assert.deepEqual(ids(M.ownershipRoster([packed], undefined)), ['chess_fake_pack_a']);
    // (b) 空 Set：一个包都没启用 → 该棋子所属包不在集合里，剔除
    assert.deepEqual(ids(M.ownershipRoster([packed], new Set())), []);
    // (c) 集合里有这个包 → 保留；有别的包但没它 → 剔除
    assert.deepEqual(ids(M.ownershipRoster([packed], new Set(['pack_alpha']))), ['chess_fake_pack_a']);
    assert.deepEqual(ids(M.ownershipRoster([packed], new Set(['pack_beta']))), []);
    assert.deepEqual(ids(M.ownershipRoster([packed], new Set(['pack_alpha', 'pack_beta']))), ['chess_fake_pack_a']);
    // 不带包的棋子：任何调用方式都不受影响
    for (const set of [undefined, null, new Set(), new Set(['pack_beta'])]) {
      assert.deepEqual(ids(M.ownershipRoster([plain, packed], set)).includes('chess_fake_plain_a'), true, `plain kept under ${set}`);
    }
  });

  test('the registered chess → pack resolver (roomMods.setPackIdResolver) goes through the same test', () => {
    const rec = fakeChess('chess_fake_resolved_a'); // the record itself carries no packId
    M.setPackIdResolver((id) => (id === 'chess_fake_resolved_a' ? 'pack_gamma' : null));
    try {
      assert.deepEqual(ids(M.ownershipRoster([rec])), ['chess_fake_resolved_a'], 'no set → unrestricted');
      assert.deepEqual(ids(M.ownershipRoster([rec], new Set())), [], 'an empty Set still means "nothing enabled"');
      assert.deepEqual(ids(M.ownershipRoster([rec], new Set(['pack_gamma']))), ['chess_fake_resolved_a']);
      assert.deepEqual(ids(M.ownershipRoster([rec], new Set(['pack_alpha']))), []);
    } finally {
      M.setPackIdResolver(null); // unregistered = the resolver never reports a pack (the module's default)
    }
    assert.deepEqual(ids(M.ownershipRoster([rec])), ['chess_fake_resolved_a']);
  });

  test('the real data is not touched: 53 records, exactly the non-packId ones; an empty Set drops none of them', () => {
    const list = data.list('chess');
    assert.equal(list.filter((c) => c && c.packId).length, 0, '今天的数据 0 条带 packId（所以这条判据在默认数据上不触发）');
    const expected = sorted(list.filter((c) => isDroppableChess(c) && c.visible !== false && !c.isHidden).map((c) => c.chessId));
    const roster = M.ownershipRoster(list);
    assert.equal(roster.length, 53);
    assert.deepEqual(sorted(ids(roster)), expected, '与「非 packId 记录」逐项一致：一条都没被误删');
    assert.deepEqual(ids(M.ownershipRoster(list, null)), ids(roster), 'production call (one argument) = null = 不限制');
    // 空 Set 只会剔除带 packId 的棋子；默认数据里一条都没有，所以名册不变 —— 语义安全，不是「空名册」。
    assert.deepEqual(ids(M.ownershipRoster(list, new Set())), ids(roster));
  });
});

describe('两个玩法特色内容不外溢 (炸惊 / 湮灭)', () => {
  test('default data: the 持有 page lists official visible chess only; 炸惊 records are all hidden and live in 干员调配', () => {
    const list = data.list('chess');
    const roster = M.ownershipRoster(list);
    assert.equal(list.length, 500);
    assert.equal(list.filter((c) => c.visible === true).length, 224, '500 条里 224 条可见（= 112 名干员的基础 + 精英两形）');
    assert.equal(list.filter((c) => c.zhajing === true && !c.isGolden).length, 99, '炸惊档名册的 99 条');
    assert.equal(list.filter((c) => c.zhajing === true && c.visible !== false).length, 0, '炸惊记录默认全部 visible:false');
    assert.equal(list.filter((c) => c.annihilation === true && !c.isGolden).length, 13, '湮灭 mod 自带的 13 个干员位');
    assert.equal(list.filter((c) => c.annihilation === true && c.visible !== false).length, 0, '湮灭 mod 干员默认全部 visible:false');
    assert.ok(roster.every((c) => c.visible === true && c.zhajing !== true && c.annihilation !== true && !c.isDiy && !c.isGolden), '持有页 = 官方可见棋');
    const shown = new Set(ids(roster));
    // 炸惊干员只在自己的名册里（ui/loadoutModel.js zhajingRosterOf —— 干员调配的炸惊档，不认 visible）
    const zj = zhajingRosterOf(list);
    assert.equal(zj.length, 99);
    assert.ok(zj.some((c) => c.chessId === 'chess_zj_01_a'), '能天使的炸惊记录在名册里');
    assert.equal(zj.filter((c) => shown.has(c.chessId)).length, 0, '炸惊记录一条都不在持有页');
    // 湮灭：名册 = 官方可见棋（去掉只由已关闭的 mod 带进来的），默认数据下与官方逐项相同 —— 它的判据里 visible 与
    // zhajing 的条件与上面 every() 一致（server/match/gamedata.js isOfficialVisibleChess），所以持有页里没有玩法记录。
    const official = list.filter((c) => c && !c.isGolden && !c.isDiy && !c.isHidden && c.grantOnly !== true
      && Number.isInteger(c.tier) && c.visible === true && c.zhajing !== true);
    assert.ok(sorted(ids(roster)).every((id) => official.some((c) => c.chessId === id)), '持有页 ⊂ 官方可见棋');
  });

  test('the gate is the room content set + visible, not packId: flipped-visible records enter the page, gone again with the set', () => {
    const raw = data.getRaw('chess');
    const flipped = {};
    for (const [id, c] of Object.entries(raw)) flipped[id] = c && c.zhajing === true ? { ...c, visible: true } : c;
    data.setContent({ id: 'cs-test-ownership', values: new Map([['chess', flipped]]) });
    try {
      assert.equal(data.contentId(), 'cs-test-ownership');
      const roster = M.ownershipRoster(data.list('chess'));
      assert.ok(roster.length > 53, '内容集把这些记录设成 visible 后，持有页列出它们（证明门是 visible，不是 packId）');
      assert.ok(roster.some((c) => c.chessId === 'chess_zj_01_a'));
    } finally {
      data.setContent(null);
    }
    assert.equal(data.contentId(), null);
    assert.equal(M.ownershipRoster(data.list('chess')).length, 53, '撤销内容集（默认房）后回到 53 条');
  });

  test('the wiring behind it: play-set rooms pin the base data set; their pool keys on zhajing, the 持有 page on visible', () => {
    // 炸惊/湮灭房钉 DEFAULT_VERSION，玩法记录就住在基础数据里（server/lobby.js playSetVersion 的注释）
    assert.match(read('server/lobby.js'), /difficulty === ZHAJING_DIFFICULTY \|\| difficulty === ANNIHILATION_DIFFICULTY \? DEFAULT_VERSION : null;/);
    // 炸惊的池子按 zhajing === true，官方/湮灭按 visible === true —— 持有页也按 visible（含 zhajing !== true 的官方判据）
    assert.match(read('server/match/gamedata.js'), /return zhajing \? c\.zhajing === true : \(c\.visible === true && c\.zhajing !== true\);/);
    assert.match(read('server/match/gamedata.js'), /export const isOfficialVisibleChess = \(c\) => !!c && !c\.isGolden && !c\.isDiy && !c\.isHidden && c\.grantOnly !== true\s*\n\s*&& Number\.isInteger\(c\.tier\) && c\.visible === true && c\.zhajing !== true;/);
    // 持有页的生产调用：一个参数（第二个参数默认 null = 不按插件包限制），且不随房型换名册
    assert.match(read('public/js/screens/ownership.js'), /ownershipRoster\(data\.list\('chess'\)\)/);
  });
});
