// test/content/jibian-bonds.test.js — 惊变羁绊（server/sim/content/jibianBonds.js）的行为规格。
//
// 移植自参考包（0.3.1-mod.4）的 test/mujica-jibian-rewards.test.mjs 的羁绊部分 + test/jibian-cengshu-nostack.test.mjs
// 里对 activeBonds 的用法。原包那两条用例挂在完整的 Match 上（Match + GameData + choices.applyCard），本仓的
// Match 侧接线属于 engine-core 的写域，所以这里只测**纯函数**契约：ownedJibianIdsOf / activeBonds / bondHintsFor。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  activeBonds, bondHintsFor, bondsOfCard, jibianBonds, ownedJibianIdsOf, WILD_CARD,
} from '../../server/sim/content/jibianBonds.js';

const GALAXY = 'jibian_yinhezhanjian';
const GODDESS = 'jibian_yiwangnvshen';
const BEAST = 'jibian_duoshouyeshou';

test('ownedJibianIdsOf: 认 effects（匹配赛阶段的 EffectRef）', () => {
  const ps = { effects: [{ key: `jibian:${GALAXY}` }, { key: `item:x` }, { key: `jibian:${GODDESS}` }] };
  assert.deepEqual([...ownedJibianIdsOf(ps)].sort(), [GALAXY, GODDESS].sort());
});

// ★ 来源 mujica-jibian-rewards.test.mjs 的 snapshot 用例：战斗快照里的玩家只有 playerEffects，
//   只读 effects 会让对应羁绊在战斗内静默失效。
test('ownedJibianIdsOf: 认 playerEffects（战斗快照），且 effects 优先', () => {
  const snapshot = { playerEffects: [{ key: `jibian:${BEAST}` }] };
  assert.deepEqual([...ownedJibianIdsOf(snapshot)], [BEAST]);
  const both = { effects: [{ key: `jibian:${GALAXY}` }], playerEffects: [{ key: `jibian:${BEAST}` }] };
  assert.deepEqual([...ownedJibianIdsOf(both)], [GALAXY]);
  assert.equal(ownedJibianIdsOf(null).size, 0);
});

// ★ 来源 mujica-jibian-rewards.test.mjs：Ave Mujica 需要 2/3 张**不同**的卡。
test('同卡重复不加进度；不同卡按 tiers 升档（2 → 3）', () => {
  const t1 = () => activeBonds([GALAXY]).find((b) => b.def.id === 'ave_mujica');
  assert.equal(t1(), undefined, '只有 1 张时不激活');

  // 同一张卡的重复 ref（Set 去重）永远凑不齐
  assert.equal(activeBonds([GALAXY, GALAXY]).find((b) => b.def.id === 'ave_mujica'), undefined);

  const tier2 = activeBonds([GALAXY, GODDESS]).find((b) => b.def.id === 'ave_mujica');
  assert.equal(tier2.tier, 2);
  assert.equal(tier2.have, 2);

  const tier3 = activeBonds([GALAXY, GODDESS, BEAST]).find((b) => b.def.id === 'ave_mujica');
  assert.equal(tier3.tier, 3);
  assert.equal(tier3.have, 3);
});

test('档位是阈值不是序号：tiers [2,3] 的人在 4 人时仍是 3 档', () => {
  const all = jibianBonds().find((b) => b.id === 'ave_mujica').members;
  const extra = ['jibian_jibangzhili'];   // 万能卡：每个羁绊 +1 人
  const act = activeBonds([...all, ...extra]).find((b) => b.def.id === 'ave_mujica');
  assert.equal(act.tier, 3);
  assert.equal(act.have, 4);
});

test('「羁绊之力」给每个羁绊 +1 人，自己没有独立效果', () => {
  // steady 需要 2 人（jingzhun + xunjie 各 1 张），万能卡再 +1
  const one = activeBonds(['jibian_jingzhun']).find((b) => b.def.id === 'steady');
  assert.equal(one, undefined, '1 人不到 2 档');
  const wild = activeBonds(['jibian_jingzhun', WILD_CARD]).find((b) => b.def.id === 'steady');
  assert.equal(wild.have, 2);
  assert.equal(wild.tier, 2);
  // 万能卡本身不属于任何「专属」羁绊之外的东西：bondsOfCard 返回全部羁绊
  assert.equal(bondsOfCard(WILD_CARD).length, jibianBonds().length);
});

test('bondHintsFor: have = 已拥有的成员数、need = 最低档、tier = 已达成的阈值个数', () => {
  const h0 = bondHintsFor(BEAST, [GALAXY])[0];
  assert.equal(h0.name, '开始吧，今夜的假面舞会');
  assert.equal(h0.have, 1);
  assert.equal(h0.need, 2);
  assert.equal(h0.tier, 0);
  assert.deepEqual(h0.tiers, [2, 3]);

  const h2 = bondHintsFor(BEAST, [GALAXY, GODDESS])[0];
  assert.equal(h2.tier, 1);
  const h3 = bondHintsFor(BEAST, [GALAXY, GODDESS, BEAST])[0];
  assert.equal(h3.tier, 2, '第三档要求 3 人（这张卡自己已经拥有）');
  assert.equal(h3.have, 3);
});

test('全部 18 条羁绊的元数据自洽（id 唯一、成员存在、tiers 升序、冻结）', () => {
  const bonds = jibianBonds();
  assert.equal(bonds.length, 18);
  assert.equal(new Set(bonds.map((b) => b.id)).size, 18);
  for (const b of bonds) {
    assert.ok(b.name && b.effect, `${b.id} 有名字与效果文案`);
    assert.ok(b.members.length >= 2, `${b.id} 至少 2 名成员`);
    for (const m of b.members) assert.match(m, /^jibian_/, `${b.id} 的成员 ${m} 是惊变卡 id`);
    assert.deepEqual(b.tiers.slice().sort((x, y) => x - y), b.tiers, `${b.id} 的 tiers 已升序`);
    assert.ok(Object.isFrozen(b) && Object.isFrozen(b.members) && Object.isFrozen(b.tiers), `${b.id} 冻结`);
  }
  // 羁绊表本身只读（防内容模块改数据）
  assert.ok(Object.isFrozen(bonds));
});

test('13 条「盟约惊变」成员表与战斗侧实际用到的卡 id 一致', () => {
  const byId = new Map(jibianBonds().map((b) => [b.id, b]));
  // 极容易写错的一处：出老千的成员包含 大乱斗 / 薛定谔的猫 / 神秘商店 / 高卢银行支票
  for (const id of ['jibian_daluandou', 'jibian_xuedingedemao', 'jibian_shenmishangdian', 'jibian_gaoluzhipiao']) {
    assert.ok(byId.get('cheat').members.includes(id), `cheat 含 ${id}`);
  }
  assert.ok(byId.get('modern_strongest').members.includes('jibian_qingpaibeibu'));
  assert.ok(byId.get('dmg2dmg').members.includes('jibian_mofazhuanwuli'));
  assert.ok(byId.get('great_seal').members.includes('jibian_sanyuewuri'));
});

// 参考包用 data/jibianBonds.json（人类可读镜像）做 deepEqual 校验：这是引擎表与数据镜像之间**唯一**的纽带，
// 镜像由数据层生成，漂了就是两条真源。18 条逐字段比较，不是抽样。
test('data/jibianBonds.json 镜像与运行时惊变羁绊表逐条 deepEqual（18 条）', () => {
  const mirror = JSON.parse(readFileSync(new URL('../../data/jibianBonds.json', import.meta.url), 'utf8'));
  assert.equal(mirror.bonds.length, 18, '镜像 18 条');
  assert.deepEqual(mirror.bonds, jibianBonds());
  // 逐条再点一遍，失败时能一眼看出是哪条漂了
  const runtime = new Map(jibianBonds().map((b) => [b.id, b]));
  for (const row of mirror.bonds) {
    const rt = runtime.get(row.id);
    assert.ok(rt, `运行时缺 ${row.id}`);
    assert.deepEqual(row.tiers, [...rt.tiers], `${row.id} 的 tiers`);
    assert.deepEqual(row.members, [...rt.members], `${row.id} 的 members`);
    assert.equal(row.effect, rt.effect, `${row.id} 的 effect`);
  }
});
