// test/ui/multi-hud.test.js — 多人房局内 HUD（8 / 12 人）的客户端契约：
//   * helpers：分队、队名、席位状态、掉线/倒下原因、联防剩余敌人、出手方
//   * markup：8 人 = 2 个队伍框；12 人 = 3 个；一框 = 一队（队色条 + 队名 + `n/4`），收起态只有框头
//   * 点开：只有那一框展开（4 行 = 大名单的一行：头像 + AI 角标 + 名字 + 状态图标 + 我方血量；空位是邀请态），另外
//     两框 [hidden]；再点收起（aria-expanded）
//   * 行的美工是单一来源：直接复用 `.team__row` / `.team__ai` / `.team__info` / `.team__name` / `.team__line` /
//     `.team__status`（game.css），multi-hud.css 只有容器与队列布局；头像只为塞进 88 宽按比例缩到 .6rem（24 / 60）
//   * 血量数字只在我方那一队（信息不对称；开关在 multiHud.js 的一行 `i === mine &&`）
//   * 可点：框头按钮 88×32（视觉尺寸 = 热区），≥32
//   * 4 人房：m.public 没有 maxSeats ⇒ multiHudView 返回 null（局内渲染逐字节不变）
//   * 多人房（maxSeats > 4）不再挂载左侧大名单 .team（TeamPanel）：game.js 的三元一支返回 null —— 不是 display:none
//     藏起来；4 人房仍是同一个 TeamPanel、同一串 props（isMultiRoom 是 has-multi 与 TeamPanel 的同一个门）
//   * 交叠契约：队伍框贴边 x8、列右缘永远在最宽时的联防条左缘左边、三号框展开不越左下角键（792×360 / 1920×1080 的算术）
//   * 联防条的外观（业主 2026-11-01「太遮视野」→ 收窄，同日「移到下侧居中、高一点」）：屏幕底部正中（left 50% +
//     translateX(-50%)、bottom .2rem = 792 下 8）、宽度按内容自适应且上限 9rem（792 下 360）、高 .8rem（792 下 32，
//     上一版 .6rem = 24）、半透明底 + 1px 细边框；名字过长时 `.gm-unite__txt` 出省略号，`.gm-unite__count`
//     （剩余敌人 N）flex:none 不截断
//   * 联防条的门（uniteLive）：只有 `phase === UNITE` **且** `unite.stage` 是 team / cross 之一才**挂载**；
//     PREP / COMBAT / SETTLE / 选卡浮层 / 4 人房的 {helpers, leakers} / 两段走完后 stage 为 null / 服务端那个零长度的
//     `watch`（m.public 永远不会带它）—— 全部不挂载（不是 display:none、不是 visibility:hidden），联防一结束就消失
//   * 「观战中」挂在 team 段上：本队没有场（teams[mine] 不存在或 helpers 为空）⇒ 阶段字「观看其他队的联防」+ 状态字
//     「观战中」+ is-done；cross 段仍画跨队那两位、读作「跨队联防 / 联防中」（业主 2026-11-01 口径）
//   * CSS / index.html：新类一律 gm- 前缀、字号走 --t、样式表被 index.html 引入、上一版芯片/名单没有残留
//   * 文案：不新增 msgid（multiHud.js 里每个 t('…') 都是既有条目；队名是内联中文 i18n-ignore）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE } from '../../shared/constants.js';
import {
  MultiHud, multiHudView, teamSeats, teamLabelOf, seatStateOf, offReasonOf, uniteLeftTotal, uniteWho, uniteWatching,
  isMultiRoom, uniteLive, UNITE_STAGES,
} from '../../public/js/ui/multiHud.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CSS = readFileSync(path.join(ROOT, 'public/css/screens/multi-hud.css'), 'utf8');
const INDEX = readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const GAME = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
const SRC = readFileSync(path.join(ROOT, 'public/js/ui/multiHud.js'), 'utf8');
const EN = JSON.parse(readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));

/** The text of a vnode tree in document order. */
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return typeof v === 'object' ? textOf(v.props?.children) : '';
};
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  // a function component (PlayerAvatar, SeatStatus, …) is its own vnode: render it once so the classes it draws
  // (.pavatar, .team__status) are visible to the walker. A component that needs a render context (hooks) throws —
  // its own vnode was yielded above, which is all these tests need.
  if (typeof v.type === 'function') {
    const out = (() => { try { return v.type(v.props); } catch { return null; } })();
    yield* walk(out);
    return;
  }
  yield* walk(v.props?.children);
}
const cls = (v) => (typeof v.props?.class === 'string' ? v.props.class.split(/\s+/) : []);
const byClass = (v, c) => [...walk(v)].filter((x) => cls(x).includes(c));
const visibleTeams = (v) => byClass(v, 'gm-team').filter((x) => x.props.hidden !== true);
/** The player ids of the avatars in a vnode subtree, in document order — PlayerAvatar's own vnode carries `player`. */
const avatarIds = (v) => [...walk(v)]
  .filter((x) => typeof x.type === 'function' && x.props?.player)
  .map((x) => x.props.player.playerId);

/** A 12-seat m.public: p_0…p_11 on seats 0…11, 4 per team; p_5 is down (hp 0), p_6 is disconnected (hp 15). */
function pub12(extra = {}) {
  const players = Array.from({ length: 12 }, (_, i) => ({
    playerId: `p_${i}`, seat: i, name: `P${i}`, team: Math.floor(i / 4),
    alive: i !== 5, connected: i !== 6, isBot: false, hp: i === 5 ? 0 : Math.max(1, 20 - i), hpMax: 30,
  }));
  return { t: 'm.public', phase: PHASE.PREP, maxSeats: 12, teams: 3, players, ...extra };
}

/** A 12-seat m.public inside one 联防 stage — m.public.unite exactly as views.js `_multiUniteView` publishes it. */
function pubUnite(stage) {
  return pub12({
    phase: PHASE.UNITE,
    unite: {
      stage,
      teams: [
        { index: 0, helpers: ['p_1', 'p_2'], leakers: ['p_0'], watching: false },
        { index: 1, helpers: [], leakers: ['p_4'], watching: true },
        { index: 2, helpers: ['p_9'], leakers: ['p_8'], watching: false },
      ],
      helpers: ['p_1', 'p_2', 'p_9'],
      leakers: ['p_0', 'p_4', 'p_8'],
      left: { p_0: 2, p_4: 1, p_8: 3 },
      // views.js only carries `cross` while that stage runs: the pair of the team that fully held (p_5 / p_6)
      ...(stage === 'cross' ? { cross: { source: 1, helpers: ['p_5', 'p_6'], leakers: ['p_8'] } } : {}),
    },
  });
}

test('teamSeats / teamLabelOf / seatStateOf / offReasonOf: 3 队 × 4 席，队名沿用第一层内联口径', () => {
  const players = pub12().players;
  assert.deepEqual(teamSeats(players, 0).map((p) => p.playerId), ['p_0', 'p_1', 'p_2', 'p_3']);
  assert.deepEqual(teamSeats(players, 2).map((p) => p.playerId), ['p_8', 'p_9', 'p_10', 'p_11']);
  // a team with fewer doctors still shows four slots (a null seat is an empty one)
  const short = teamSeats(players.slice(0, 6), 1);
  assert.equal(short.length, 4);
  assert.deepEqual(short.slice(2), [null, null]);
  assert.equal(teamLabelOf(0, 3), '我方同盟');
  assert.equal(teamLabelOf(1, 2), '对方同盟');
  assert.equal(teamLabelOf(1, 3), '蓝方同盟');
  assert.equal(teamLabelOf(2, 3), '红方同盟');
  assert.equal(seatStateOf(null), 'gap');
  assert.equal(seatStateOf({ alive: true, connected: true }), 'on');
  assert.equal(seatStateOf({ alive: false }), 'off');
  assert.equal(seatStateOf({ alive: true, connected: false, isBot: false }), 'off');
  assert.equal(seatStateOf({ alive: true, connected: false, isBot: true }), 'on', 'an AI seat is never "disconnected"');
  // 掉线 / 倒下 是两种不同的 off（框里那一格写哪一种字）
  assert.equal(offReasonOf({ alive: false }), 'down');
  assert.equal(offReasonOf({ alive: true, connected: false }), 'conn');
});

test('uniteLeftTotal / uniteWho / uniteWatching: 剩余敌人求和；出手方只取我方那一队（cross 段才取跨队）', () => {
  const unite = {
    stage: 'team',
    teams: [
      { index: 0, helpers: ['p_1', 'p_2'], leakers: ['p_0'], watching: false },
      { index: 1, helpers: [], leakers: ['p_4'], watching: true },
      { index: 2, helpers: ['p_9'], leakers: ['p_8'], watching: false },
    ],
    helpers: ['p_1', 'p_2', 'p_9'],
    leakers: ['p_0', 'p_4', 'p_8'],
    left: { p_0: 2, p_4: 1, p_8: 3 },
  };
  assert.equal(uniteLeftTotal(unite), 6);
  assert.equal(uniteLeftTotal({ left: {} }), 0);
  assert.equal(uniteLeftTotal(null), null);
  // 只取我方那一队的 helpers：0 队两位 / 2 队一位 / 1 队全漏一位都没有（不借别队的）
  assert.deepEqual(uniteWho(unite, 0), ['p_1', 'p_2']);
  assert.deepEqual(uniteWho(unite, 1), [], 'a team with no helper of its own shows nobody (never another team)');
  assert.deepEqual(uniteWho(unite, 2), ['p_9']);
  assert.deepEqual(uniteWho(unite, 9), [], 'an unknown team index (spectator) shows nobody');
  // 服务端 planTeamUnite 保证 ≤2；帧里万一是 3 位，条上也只画 2 个
  assert.deepEqual(uniteWho({ ...unite, teams: [{ index: 0, helpers: ['p_1', 'p_2', 'p_3'] }] }, 0), ['p_1', 'p_2']);
  // 观看语义：team 段本队没有场（全漏 / 没漏都不出场）⇒ 观看；cross 段不算观看（它画的是跨队的场）
  assert.equal(uniteWatching(unite, 1), true);
  assert.equal(uniteWatching(unite, 0), false);
  // 零长度的 watch 段不是观看的入口：m.public 收不到它，收到了也不认（观看只挂在 team 段，见 uniteWatching）
  assert.equal(uniteWatching({ ...unite, stage: 'watch' }, 0), false);
  assert.equal(uniteWatching({ ...unite, stage: 'watch' }, 1), false);
  // 本队整支不在 unite.teams 里（缺帧）也读作没有场
  assert.equal(uniteWatching({ ...unite, teams: [] }, 0), true);
  // cross 段：跨队那两位（唯一会画别队 helpers 的阶段）
  const cross = { ...unite, stage: 'cross', teams: [], cross: { source: 1, helpers: ['p_5', 'p_6'], leakers: ['p_8'] } };
  assert.deepEqual(uniteWho(cross, 0), ['p_5', 'p_6']);
  assert.equal(uniteWatching(cross, 0), false);
  assert.deepEqual(uniteWho({ ...cross, cross: undefined }, 0), [], 'cross stage without the cross pair draws nobody');
});

test('4 人房：没有 maxSeats ⇒ 这一层不存在（multiHudView 返回 null，game.js 仍挂载 TeamPanel）', () => {
  assert.equal(multiHudView({ pub: { phase: PHASE.PREP, players: [], maxSeats: 4 }, myId: 'p_0' }), null);
  assert.equal(multiHudView({ pub: { phase: PHASE.PREP, players: [] }, myId: 'p_0' }), null);
  assert.equal(multiHudView({ pub: null, myId: null }), null);
  assert.equal(typeof MultiHud, 'function');
  // 唯一的门：容量本身（8 / 12 才 > 4；4 与缺省都是 4 人房）
  assert.equal(isMultiRoom({ maxSeats: 12 }), true);
  assert.equal(isMultiRoom({ maxSeats: 8 }), true);
  assert.equal(isMultiRoom({ maxSeats: 4 }), false);
  assert.equal(isMultiRoom({}), false);
  assert.equal(isMultiRoom(null), false);
  // 局内接入口：`.gm` 根的 has-multi 与 TeamPanel 的挂载共用同一个判据
  assert.ok(/\$\{isMultiRoom\(pub\) \? null : html`<\$\{TeamPanel\}/.test(GAME), 'game.js mounts TeamPanel only outside a multi room');
  assert.match(GAME, /isMultiRoom\(pub\) && 'has-multi'/);
  assert.ok(/\$\{MultiHud\}/.test(GAME) || /<\\?\$\{MultiHud\}/.test(GAME), 'game.js mounts MultiHud');
});

test('联防条只在真的处于联防阶段时挂载：phase UNITE + unite.stage ∈ team/cross，其余任何一帧都没有', () => {
  const bar = (pub) => byClass(multiHudView({ pub, myId: 'p_0' }), 'gm-unite').length;
  const unite = pubUnite('team').unite;
  // 全部都不是联防帧：这条横条**不挂载**（不是 display:none / visibility:hidden）
  const none = [
    ['PREP（休整期，没有 unite 键）', pub12()],
    ['COMBAT（本回合战斗）', pub12({ phase: PHASE.COMBAT })],
    ['SETTLE（结算）', pub12({ phase: PHASE.SETTLE })],
    ['选卡浮层（SP_DRAFT）', pub12({ phase: PHASE.SP_DRAFT })],
    ['UNITE 阶段但 m.public 没有 unite 键', pub12({ phase: PHASE.UNITE })],
    ['4 人房的 unite 形状（只有 helpers / leakers，没有 stage）', pub12({ phase: PHASE.UNITE, unite: { helpers: ['p_1'], leakers: ['p_0'] } })],
    ['stage 为空串', pub12({ phase: PHASE.UNITE, unite: { ...unite, stage: '' } })],
    ['stage 是未知值（settle）', pub12({ phase: PHASE.UNITE, unite: { ...unite, stage: 'settle' } })],
    ['stage 是零长度的 watch（服务端同一个 tick 就进 cross，m.public 收不到它）', pub12({ phase: PHASE.UNITE, unite: { ...unite, stage: 'watch' } })],
    ['stage 为 null（两段走完、服务端已清空 uniteStage）', pub12({ phase: PHASE.UNITE, unite: { ...unite, stage: null } })],
    ['PREP 里残留一份带 stage 的 unite（不认对象，只认 UNITE 阶段 + stage）', pub12({ unite: { ...unite, stage: 'team' } })],
  ];
  for (const [what, pub] of none) {
    assert.equal(bar(pub), 0, `no .gm-unite: ${what}`);
    assert.equal(uniteLive(pub), false, `uniteLive false: ${what}`);
  }
  // 只有这两段才是「真的在联防」
  assert.deepEqual(UNITE_STAGES, ['team', 'cross']);
  for (const stage of UNITE_STAGES) {
    assert.equal(uniteLive(pubUnite(stage)), true, `uniteLive true: ${stage}`);
    assert.equal(bar(pubUnite(stage)), 1, `one .gm-unite: ${stage}`);
  }
  // 不靠样式藏：.gm-unite 自己的规则里没有 display:none / visibility:hidden（不挂载才是判据）
  const cssCode = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = cssCode.match(/\.gm-unite \{[^}]*\}/)[0];
  assert.equal(/display:\s*none|visibility:\s*hidden/.test(rule), false, '.gm-unite is never hidden by CSS');
});

test('team / cross 两段 + team 段本队没有场 = 观看：阶段字 / 出手干员头像 / 剩余敌人 / 状态字都对', () => {
  const cases = [['team', '队内联防', '联防中'], ['cross', '跨队联防', '联防中']];
  for (const [stage, txt, state] of cases) {
    const v = multiHudView({ pub: pubUnite(stage), myId: 'p_0' });
    const bars = byClass(v, 'gm-unite');
    assert.equal(bars.length, 1, `one bar: ${stage}`);
    assert.equal(bars[0].props.role, 'status');
    assert.equal(bars[0].props['aria-label'], '联防阶段');
    assert.deepEqual(byClass(v, 'gm-unite__phase').map(textOf), ['联防阶段']);
    assert.deepEqual(byClass(v, 'gm-unite__txt').map(textOf), [txt]);
    assert.deepEqual(byClass(v, 'gm-unite__state').map(textOf), [state]);
    assert.equal(cls(byClass(v, 'gm-unite__state')[0]).includes('is-done'), false, 'a team that fields somebody is never 观战中');
    // 剩余敌人 = uniteLeftTotal（2 + 1 + 3）
    assert.deepEqual(byClass(v, 'gm-unite__count').map(textOf), ['剩余敌人 6']);
    // 出手的干员头像 = uniteWho（我为 0 队：team 段是 p_1 / p_2；cross 段是跨队那两位；4 人房里没有的 id 不画）
    const who = byClass(v, 'gm-unite__who');
    assert.equal(who.length, 1);
    assert.equal(byClass(who[0], 'pavatar').length, 2, `two helper avatars: ${stage}`);
    assert.deepEqual(avatarIds(who[0]), stage === 'cross' ? ['p_5', 'p_6'] : ['p_1', 'p_2'], `who: ${stage}`);
  }
  // 观看态：**stage === 'team' + 本队没有场**（teams[mine].helpers 为空）——「观战中」就挂在这一帧上，因为服务端的 watch
  // 阶段长度为 0、m.public 永远收不到 `stage === 'watch'`
  const viewing = pubUnite('team');
  viewing.unite.teams[0] = { index: 0, helpers: [], leakers: ['p_0', 'p_1', 'p_2', 'p_3'], watching: true };
  const vw = multiHudView({ pub: viewing, myId: 'p_0' });
  assert.equal(byClass(vw, 'gm-unite').length, 1, 'the bar is still there while my team watches');
  assert.deepEqual(byClass(vw, 'gm-unite__txt').map(textOf), ['观看其他队的联防']);
  assert.deepEqual(byClass(vw, 'gm-unite__state').map(textOf), ['观战中']);
  assert.ok(cls(byClass(vw, 'gm-unite__state')[0]).includes('is-done'), '观战中 is the done state');
  assert.equal(byClass(vw, 'gm-unite__who').length, 0, 'no teammate avatar and no empty slot');
  assert.deepEqual(byClass(vw, 'gm-unite__count').map(textOf), ['剩余敌人 6']);
  assert.equal(uniteWatching(viewing.unite, 0), true);
  assert.equal(uniteWatching(viewing.unite, 2), false, 'the same frame, read from a team that does field one: not viewing');
  // 同一帧换一个「本队整支不在 teams 里」的形状，也读作观看
  const missing = pubUnite('team');
  missing.unite.teams = missing.unite.teams.filter((t) => t.index !== 0);
  assert.deepEqual(byClass(multiHudView({ pub: missing, myId: 'p_0' }), 'gm-unite__state').map(textOf), ['观战中']);
  // left 未知（没有 left 键）时不出「剩余敌人」这一格
  const noLeft = pubUnite('cross');
  delete noLeft.unite.left;
  assert.equal(byClass(multiHudView({ pub: noLeft, myId: 'p_0' }), 'gm-unite__count').length, 0);
});

test('联防条只画我方那一队的 helpers（1–2 位）：三队各 2 位 → 2 个；我方 1 位 → 1 个；我方全漏 → 0 个 + 观看；cross → 跨队那两位', () => {
  const base = pub12();
  const bar = (pub) => byClass(multiHudView({ pub, myId: 'p_0' }), 'gm-unite')[0];
  const whoOf = (v) => byClass(v, 'gm-unite__who')[0] || null;
  const idsOf = (v) => avatarIds(whoOf(v));
  const teamOf = (id) => base.players.find((p) => p.playerId === id).team;

  // ① team 段：三队同时各打各的场（每队 2 位、合计 6）→ 条上只有我方（0 队）那两位，id 全属 0 队
  const six = pubUnite('team');
  six.unite.teams = [
    { index: 0, helpers: ['p_1', 'p_2'], leakers: ['p_0'], watching: false },
    { index: 1, helpers: ['p_4', 'p_5'], leakers: ['p_6'], watching: false },
    { index: 2, helpers: ['p_9', 'p_10'], leakers: ['p_8'], watching: false },
  ];
  six.unite.helpers = ['p_1', 'p_2', 'p_4', 'p_5', 'p_9', 'p_10']; // 旧实现读的那份全局合并字段
  const v6 = bar(six);
  assert.equal(byClass(whoOf(v6), 'pavatar').length, 2, '2 avatars — not the 6 of the three teams, not 3 or 4');
  assert.deepEqual(idsOf(v6), ['p_1', 'p_2']);
  for (const id of idsOf(v6)) assert.equal(teamOf(id), 0, `own team only: ${id} is team 0`);

  // ② 我方只有 1 位没漏：只画 1 个（不补位、不占位留空）
  const one = pubUnite('team');
  one.unite.teams = [
    { index: 0, helpers: ['p_3'], leakers: ['p_0'], watching: false },
    { index: 1, helpers: ['p_4', 'p_5'], leakers: ['p_6'], watching: false },
    { index: 2, helpers: ['p_9', 'p_10'], leakers: ['p_8'], watching: false },
  ];
  const v1 = bar(one);
  assert.equal(byClass(whoOf(v1), 'pavatar').length, 1, 'one helper → one avatar');
  assert.deepEqual(idsOf(v1), ['p_3']);
  assert.equal([].concat(whoOf(v1).props.children).filter(Boolean).length, 1, 'no placeholder avatar / empty slot');

  // ③ 我方全漏（teams[mine].helpers 为空、watching: true）：一个队友头像都不画，读作观看（全部是既有文案）
  const leaked = pubUnite('team');
  leaked.unite.teams[0] = { index: 0, helpers: [], leakers: ['p_0', 'p_1', 'p_2', 'p_3'], watching: true };
  const vl = bar(leaked);
  assert.equal(byClass(vl, 'pavatar').length, 0, 'no teammate avatars');
  assert.equal(byClass(vl, 'gm-unite__who').length, 0, 'no empty avatar slot either');
  assert.deepEqual(byClass(vl, 'gm-unite__txt').map(textOf), ['观看其他队的联防'], 'the stage reads as watching');
  assert.deepEqual(byClass(vl, 'gm-unite__state').map(textOf), ['观战中'], 'existing msgid: 观战中');
  assert.ok(cls(byClass(vl, 'gm-unite__state')[0]).includes('is-done'));
  assert.equal(uniteWatching(leaked.unite, 0), true);
  // 剩余敌人那格照旧（不是「没有头像就少了内容」）
  assert.deepEqual(byClass(vl, 'gm-unite__count').map(textOf), ['剩余敌人 6']);

  // ④ cross 段：画跨队出手的那两位（不是本队），语义由「跨队联防」区分
  const cross = pubUnite('cross');
  const vc = bar(cross);
  assert.equal(byClass(whoOf(vc), 'pavatar').length, 2, 'the cross pair, still ≤2');
  assert.deepEqual(idsOf(vc), ['p_5', 'p_6']);
  assert.deepEqual(byClass(vc, 'gm-unite__txt').map(textOf), ['跨队联防']);
  assert.deepEqual(byClass(vc, 'gm-unite__state').map(textOf), ['联防中']);
  // 跨队段里本队全漏也仍画跨队那两位（这一帧人人都在看跨队的场，不是「观看」）
  const crossLeaked = pubUnite('cross');
  crossLeaked.unite.teams[0] = { index: 0, helpers: [], leakers: ['p_0'], watching: true };
  assert.deepEqual(idsOf(bar(crossLeaked)), ['p_5', 'p_6']);
  assert.equal(byClass(bar(crossLeaked), 'gm-unite__who').length, 1);
  // 门没变：非联防帧依旧一个头像都不画（这一层整个不挂载）
  assert.equal(byClass(multiHudView({ pub: pub12(), myId: 'p_0' }), 'pavatar').length, 0);
});

test('联防结束后立即消失：unite 变回 undefined 或 stage 变 null ⇒ 再次不存在；下一回合再联防又出现', () => {
  const bar = (pub) => byClass(multiHudView({ pub, myId: 'p_0' }), 'gm-unite').length;
  const running = pubUnite('cross');
  assert.equal(bar(running), 1, '联防守在场');
  // ① 三段走完、服务端把 uniteStage 清空（views.js 现在发 stage: null，不再回落成 'team'）
  assert.equal(bar({ ...running, unite: { ...running.unite, stage: null } }), 0);
  // ② settle 帧：m.public 不再带 unite
  assert.equal(bar({ ...running, phase: PHASE.SETTLE, unite: undefined }), 0);
  // ③ 下一回合 PREP
  assert.equal(bar(pub12({ round: 2 })), 0);
  // ④ 第二回合再联防：门是阶段状态，不是一次性开关
  assert.equal(bar(pubUnite('team')), 1);
});

test('联防条出现时的几何：屏幕底部正中、按内容自适应（下限 4rem / 上限 9rem）、不压顶栏 / 盟约条 / 队伍框 / 角落键 / 效果列 / 商店（792 与 1920 的算术）', () => {
  for (const { rem, vw, vh, cornerRight, teamsBottom } of [
    { rem: 40, vw: 792, vh: 360, cornerRight: 157.59, teamsBottom: 202.39 }, // 角落键本次实测 148 宽（右缘 157.59）
    { rem: 100, vw: 1920, vh: 1080, cornerRight: 278.00, teamsBottom: 506.00 }, // 同一套 rem 等比放大（1920 下 1rem = 100px）
  ]) {
    // multi-hud.css `.gm-unite { left: 50%; bottom: .2rem; transform: translateX(-50%); height: max(.8rem, …); min-width: 4rem; max-width: 9rem }`
    const maxWidth = 9 * rem; // 792 下 360（= 屏宽的 45%），1920 下 900
    const minWidth = 4 * rem; // 只画 1–2 位后内容会变窄：下限（792 下 160、1920 下 400）
    const left = (vw - maxWidth) / 2; // 最宽那一帧的左缘（居中 ⇒ 内容更窄的帧只会更靠里）
    const height = 0.8 * rem; // 792 下 32（上一版 .6rem = 24）
    const bottom = vh - 0.2 * rem; // 贴屏底 .2rem：792 下 8、1920 下 20
    const top = bottom - height;
    assert.equal(maxWidth, rem === 40 ? 360 : 900, `最宽 ${maxWidth}（rem 等比）`);
    assert.ok(maxWidth <= 0.5 * vw, `最宽 ${maxWidth} ≤ 半个屏宽（不横贯屏幕）`);
    // 头像从 6 位降到 1–2 位：4rem 下限保证条不会缩成细缝；最窄那一帧同样居中、同样让开角落键
    assert.equal(minWidth, rem === 40 ? 160 : 400, `下限 ${minWidth}（rem 等比）`);
    assert.ok(minWidth < maxWidth, '下限窄于上限');
    assert.equal((vw - minWidth) / 2 + minWidth / 2, vw / 2, '最窄那一帧也在水平正中');
    assert.ok((vw - minWidth) / 2 > cornerRight, `最窄时条左缘 ${(vw - minWidth) / 2} > 角落键右缘 ${cornerRight}`);
    assert.equal(height, 0.8 * rem, `条高 .8rem = ${height}（上一版 .6rem = ${0.6 * rem}）`);
    if (rem === 40) assert.equal(height, 32, '792×360 下的目标高度 32');
    assert.equal(vh - bottom, 0.2 * rem, `距屏底 .2rem = ${0.2 * rem}`);
    // 居中：条心正好是屏心
    assert.equal(left + maxWidth / 2, vw / 2, '条在水平正中');
    assert.ok(top > teamsBottom, `队伍框列底 ${teamsBottom} < 条顶 ${top}`);
    // 底部正中与左下角落键同一条带子：横向必须分开，交叠才是 0
    assert.ok(left > cornerRight, `最宽时条左缘 ${left} > 角落键右缘 ${cornerRight}（横向分开）`);
    assert.ok(bottom < vh && top >= 8, 'inside the viewport');
    assert.ok(top >= 8 && vh - bottom >= 8 && left >= 8 && left + maxWidth <= vw - 8, '8 px margins on every side');
  }
  // 条本身不吃点击：盖在棋盘上也不挡任何可点元素
  assert.match(CSS, /\.gm-unite \{[^}]*pointer-events: none/);
  assert.match(CSS, /\.gm-unite \{[^}]*left: 50%; bottom: \.2rem; transform: translateX\(-50%\)/);
  // 宽度按内容自适应（下限 4rem、上限 9rem）、1px 细边框 + 半透明底（能透出棋盘）、不再有 3px 左边条
  assert.match(CSS, /\.gm-unite \{[^}]*min-width: 4rem; width: max-content; max-width: 9rem/);
  assert.match(CSS, /\.gm-unite \{[^}]*width: max-content; max-width: 9rem/);
  assert.match(CSS, /\.gm-unite \{[^}]*border: 1px solid rgba\(79, 232, 192, \.42\)/);
  assert.match(CSS, /\.gm-unite \{[^}]*background: rgba\(8, 11, 10, \.72\)/);
  assert.match(CSS, /\.gm-unite \{[^}]*box-shadow: inset 2px 0 0 var\(--rs-lit, #4fe8c0\)/);
  assert.match(CSS, /\.gm-unite \{[^}]*height: max\(\.8rem, calc\(\.24 \* var\(--t\) \+ \.12rem\)\)/);
  const uniteRule = CSS.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.gm-unite \{[^}]*\}/)[0];
  assert.equal(/left: 3\.6rem/.test(uniteRule), false, 'the 600-wide left anchor is gone');
  assert.equal(/height: 1\.2rem/.test(uniteRule), false, 'the 48-high bar is gone');
  assert.equal(/height: max\(\.6rem/.test(uniteRule), false, 'the 24-high bar is gone');
  assert.equal(/right: 1\.2rem/.test(uniteRule), false, 'the top-right anchor is gone');
  assert.equal(/top: 2\.46rem/.test(uniteRule), false, 'the top-right anchor is gone');
  assert.equal(/border-left:/.test(uniteRule), false, '1px uniform border, no 3px accent bar');
  // 文字不截断的契约：只有阶段名让位（省略号），头像 / 阶段字 / 剩余敌人 / 状态都是 flex:none（不被挤掉）
  assert.match(CSS, /\.gm-unite__txt \{[^}]*min-width: 0[^}]*text-overflow: ellipsis/);
  assert.match(CSS, /\.gm-unite__count \{[^}]*flex: none[^}]*white-space: nowrap/);
  assert.match(CSS, /\.gm-unite__who \{[^}]*flex: none/);
  assert.match(CSS, /\.gm-unite__state \{[^}]*flex: none[^}]*white-space: nowrap/);
  // 状态胶囊的高度跟着 --t（特大文字档 = 21px 字号时 18.4 的胶囊装不下）
  assert.match(CSS, /\.gm-unite__state \{[^}]*height: max\(\.46rem, calc\(\.24 \* var\(--t\) \+ \.06rem\)\)/);
});

test('8 人房：2 个队伍框（收起态只有框头 = 队名 + n/4），上一版芯片 / 名单 / 状态条都不在', () => {
  const v = multiHudView({ pub: pub12({ maxSeats: 8, teams: 2, players: pub12().players.slice(0, 8) }), myId: 'p_0' });
  assert.equal(byClass(v, 'gm-strip').length, 0, '.gm-strip 已删除');
  assert.equal(byClass(v, 'gm-mate').length, 0, '.gm-mates 已删除');
  assert.equal(byClass(v, 'gm-chips').length, 0, '.gm-chips 已删除');
  assert.equal(byClass(v, 'gm-panel').length, 0, '.gm-panel 已删除');
  const wrap = byClass(v, 'gm-teams')[0];
  assert.ok(wrap, 'the 队伍框 column exists');
  assert.equal(wrap.props.role, 'group');
  assert.equal(visibleTeams(v).length, 2);
  const boxes = byClass(v, 'gm-team');
  assert.deepEqual(boxes.map((b) => cls(b).filter((x) => x.startsWith('is-'))), [['is-mine', 'is-full'], ['is-off']]);
  assert.deepEqual(byClass(v, 'gm-team__title').map(textOf), ['我方同盟', '对方同盟']);
  assert.deepEqual(byClass(v, 'gm-team__num').map(textOf), ['4/4', '4/4']);
  // 收起态没有展开出来的名单
  assert.equal(byClass(v, 'gm-team__list').length, 0);
  assert.equal(byClass(v, 'gm-unite').length, 0, 'no 联防 bar outside the UNITE phase');
});

test('12 人房：3 个框（我方薄荷 / 蓝方 / 红方），掉线或倒下的一队描边变红、有空位的是邀请态', () => {
  const v = multiHudView({ pub: pub12(), myId: 'p_0' });
  assert.equal(byClass(v, 'gm-teams').length, 1);
  const boxes = byClass(v, 'gm-team');
  assert.equal(boxes.length, 3);
  assert.deepEqual(boxes.map((c) => cls(c).find((x) => x === 'is-mine' || x === 'is-blue' || x === 'is-red')), ['is-mine', 'is-blue', 'is-red']);
  assert.deepEqual(byClass(v, 'gm-team__title').map(textOf), ['我方同盟', '蓝方同盟', '红方同盟']);
  assert.deepEqual(byClass(v, 'gm-team__head').map((h) => h.props['aria-label']), ['我方同盟 4/4', '蓝方同盟 4/4', '红方同盟 4/4']);
  // 队级状态：p_5 倒下 + p_6 掉线 → 蓝方 is-off；三队都满员 → 没有 is-gap
  assert.deepEqual(boxes.map((c) => cls(c).includes('is-off')), [false, true, false]);
  assert.deepEqual(boxes.map((c) => cls(c).includes('is-gap')), [false, false, false]);
  // 收起态：三框都露着（没有 [hidden]），全部 aria-expanded=false
  assert.equal(visibleTeams(v).length, 3);
  assert.deepEqual(byClass(v, 'gm-team__head').map((h) => h.props['aria-expanded']), ['false', 'false', 'false']);
  // 每框自带 --slot（展开时「原地」用它补位）
  assert.deepEqual(boxes.map((c) => c.props.style), ['--slot:0', '--slot:1', '--slot:2']);
  const gapTeam = multiHudView({ pub: pub12({ players: pub12().players.slice(0, 9) }), myId: 'p_0' });
  assert.equal(cls(byClass(gapTeam, 'gm-team')[2]).includes('is-gap'), true, '红方 1/4 → 邀请态');
  assert.equal(byClass(gapTeam, 'gm-team__num').map(textOf)[2], '1/4');
});

test('点开某一框：只有它展开 4 行，另外两框 [hidden]；每行 = 大名单那一行（头像 + 名字 + 状态图标）', () => {
  const v = multiHudView({ pub: pub12(), myId: 'p_0', openTeam: 1 });
  const boxes = byClass(v, 'gm-team');
  assert.equal(boxes.length, 3);
  assert.deepEqual(boxes.map((b) => b.props.hidden === true), [true, false, true], '另外两框暂时隐藏');
  assert.equal(visibleTeams(v).length, 1);
  assert.deepEqual(byClass(v, 'gm-team__head').map((h) => h.props['aria-expanded']), ['false', 'true', 'false']);
  const list = byClass(v, 'gm-team__list')[0];
  assert.ok(list, 'the roster is open');
  assert.equal(list.props.id, 'gm-team-1');
  assert.equal(byClass(v, 'gm-team__head')[1].props['aria-controls'], 'gm-team-1');
  const rows = byClass(list, 'gm-team__row');
  assert.equal(rows.length, 4, '4 行 = 该队 4 席');
  // 行的内容来自大名单：.team__name / pavatar / .team__status 都是那一套
  assert.deepEqual(byClass(list, 'team__name').map(textOf), ['P4', 'P5', 'P6', 'P7']);
  assert.equal(byClass(list, 'pavatar').length, 4, 'every row carries the roster avatar');
  assert.equal(byClass(list, 'team__info').length, 4);
  assert.equal(byClass(list, 'team__line').length, 4);
  assert.equal(byClass(list, 'team__status').length, 4, 'every row carries the roster status glyph');
  // aria-label：队伍 + 玩家名
  assert.deepEqual(rows.map((r) => r.props['aria-label']), ['蓝方同盟 P4', '蓝方同盟 P5', '蓝方同盟 P6', '蓝方同盟 P7']);
  // 掉线 / 倒下 现在画在大名单那颗状态图标上（倒下 tone red、掉线 is-offline）
  assert.deepEqual(rows.map((r) => cls(r).includes('is-dead')), [false, true, false, false]);
  assert.equal(rows.filter((r) => cls(r).includes('is-off')).length, 2);
  const tones = byClass(list, 'team__status').map((s) => cls(s));
  assert.ok(tones[1].includes('is-red'), '倒下 = .team__status.is-red');
  assert.ok(tones[2].includes('is-offline'), '掉线 = .team__status.is-offline');
  // 空位：一行「空位 + 邀请」
  const gap = multiHudView({ pub: pub12({ players: pub12().players.slice(0, 9) }), myId: 'p_0', openTeam: 2 });
  const gapRows = byClass(byClass(gap, 'gm-team__list')[0], 'gm-team__row');
  assert.equal(gapRows.length, 4);
  assert.equal(gapRows.filter((r) => cls(r).includes('is-empty')).length, 3);
  assert.deepEqual(byClass(gap, 'gm-team__invite').map(textOf), ['邀请', '邀请', '邀请']);
  assert.match(textOf(gapRows[1]), /空位/);
  // 三号框展开 → 列上挂 is-tail（行高按视口收紧，见 CSS 契约）
  assert.equal(cls(byClass(gap, 'gm-teams')[0]).includes('is-tail'), true);
  assert.equal(cls(byClass(v, 'gm-teams')[0]).includes('is-tail'), false, '二队房 / 非最后一框不收行高');
});

test('展开行复用大名单 .team__* 的美工（单一来源）：AI 角标、头像缩放、行高与框宽不变', () => {
  // 行本身就是大名单的行（.team__row）：is-self 的薄荷描边环、is-dead 的删除线都来自 game.css
  const v = multiHudView({ pub: pub12(), myId: 'p_0', openTeam: 0 });
  for (const r of byClass(v, 'gm-team__row')) assert.ok(cls(r).includes('team__row'), 'a roster row');
  // AI 角标：bot 席位用大名单那颗 .team__ai；纯真人一队一个都不出
  assert.equal(byClass(v, 'team__ai').length, 0);
  const bots = multiHudView({ pub: pub12({ players: pub12().players.map((p) => ({ ...p, isBot: true })) }), myId: 'nobody', openTeam: 0 });
  assert.deepEqual(byClass(bots, 'team__ai').map(textOf), ['AI', 'AI', 'AI', 'AI']);
  // 单一来源：multi-hud.css 没有第二份大名单行样式（规则不能以 .team__* / .pavatar 自己开头）
  const cssCode = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/(^|\n)\s*\.(team__[a-z]+|pavatar)\s*[,{]/.test(cssCode), false, 'no second copy of the roster row CSS');
  const gameCss = readFileSync(path.join(ROOT, 'public/css/screens/game.css'), 'utf8');
  assert.match(gameCss, /\.pavatar \{\s*--pa: \.8rem;/, 'the roster avatar size is untouched');
  // 头像只为塞进 88 宽按比例缩：.6rem = 24 @792 / 60 @1920（大名单 .8rem 的 75%）
  assert.match(CSS, /\.gm-team__row \.pavatar \{ --pa: \.6rem; \}/);
  const rem = 40; // 792×360
  const rowW = 2.2 * rem - 0.18 * rem - 0.1 * rem; // 76.8：框宽减左右内边距
  const avatar = 0.6 * rem; // 24
  const info = rowW - avatar - 0.08 * rem; // 49.6
  assert.ok(avatar < 0.85 * rem, 'the avatar fits the 34-high row (24 < 34)');
  assert.ok(info - 0.18 * rem >= 6 * 0.15 * rem, 'the info column still holds the six-glyph AI·华法琳 at .15rem');
  // 行高 / 框宽与大名单无关，仍由队伍框定：34（.85rem）/ 88（2.2rem）
  assert.match(CSS, /\.gm-team__row \{[^}]*height: \.85rem/);
  assert.match(CSS, /\.gm-team \{[^}]*width: 2\.2rem; height: \.8rem/);
  // 空位那两行仍是纯文字（没有头像 / 状态图标）
  const gap = multiHudView({ pub: pub12({ players: pub12().players.slice(0, 9) }), myId: 'p_0', openTeam: 2 });
  const empty = byClass(gap, 'gm-team__row').filter((r) => cls(r).includes('is-empty'));
  assert.equal(empty.length, 3);
  for (const r of empty) {
    assert.equal(byClass(r, 'pavatar').length, 0);
    assert.equal(byClass(r, 'team__status').length, 0);
  }
});

test('血量数字：只在我方那一队（max(1, floor)）；别队只出名字与状态', () => {
  const mine = multiHudView({ pub: pub12(), myId: 'p_0', openTeam: 0 });
  const myRows = byClass(byClass(mine, 'gm-team__list')[0], 'gm-team__row');
  assert.deepEqual(byClass(mine, 'gm-team__hp').map(textOf), ['20', '19', '18', '17']);
  assert.equal(byClass(mine, 'team__status').length, 4, '每行都有状态图标');
  assert.equal(myRows.filter((r) => cls(r).includes('is-self')).length, 1, '自己那一行 is-self');
  // 别队：4 人都在，但一个数字都不出（信息不对称）
  const other = multiHudView({ pub: pub12(), myId: 'p_0', openTeam: 1 });
  assert.equal(byClass(other, 'gm-team__hp').length, 0);
  assert.deepEqual(byClass(other, 'team__name').map(textOf), ['P4', 'P5', 'P6', 'P7']);
  // 倒下那一行不写数字（队友掉线仍活着 → 数字照写）
  const down = pub12();
  down.players[1].alive = false;
  down.players[1].hp = 0;
  const d = multiHudView({ pub: down, myId: 'p_0', openTeam: 0 });
  assert.deepEqual(byClass(d, 'gm-team__hp').map(textOf), ['20', '18', '17']);
  const downRows = byClass(byClass(d, 'gm-team__list')[0], 'gm-team__row');
  assert.ok(cls(downRows[1]).includes('is-dead'));
  assert.ok(cls(byClass(d, 'team__status')[1]).includes('is-red'));
});

test('再点收起：openTeam=-1 三框回到收起态；Esc 收起、Enter/Space 由框头按钮原生给出', () => {
  const open = multiHudView({ pub: pub12(), myId: 'p_0', openTeam: 2 });
  assert.equal(visibleTeams(open).length, 1);
  const closed = multiHudView({ pub: pub12(), myId: 'p_0', openTeam: -1 });
  assert.equal(visibleTeams(closed).length, 3);
  assert.equal(byClass(closed, 'gm-team__list').length, 0);
  assert.deepEqual(byClass(closed, 'gm-team__head').map((h) => h.props['aria-expanded']), ['false', 'false', 'false']);
  // 框头 = <button type="button">（Enter / Space 原生激活），点它就是 onPick(i)
  const heads = byClass(closed, 'gm-team__head');
  assert.equal(heads.length, 3);
  for (const h of heads) assert.equal(h.props.type, 'button');
  const seen = [];
  multiHudView({ pub: pub12(), myId: 'p_0', onPick: (i) => seen.push(i) });
  const picked = byClass(multiHudView({ pub: pub12(), myId: 'p_0', onPick: (i) => seen.push(i) }), 'gm-team__head');
  picked[1].props.onClick();
  assert.deepEqual(seen, [1]);
  // Esc 收起：组件里的 keydown 监听
  assert.match(SRC, /addEventListener\('keydown'/);
  assert.match(SRC, /e\.key === 'Escape'/);
  assert.match(SRC, /removeEventListener\('keydown'/);
});

test('可点最小边 ≥32：框头 88×32（视觉尺寸 = 热区，整块按钮）', () => {
  // 视觉：.gm-team 2.2rem × .8rem = 88 × 32 @792（1rem = 40px）；框头按钮撑满整块
  assert.match(CSS, /\.gm-team \{[^}]*width: 2\.2rem; height: \.8rem/);
  assert.match(CSS, /\.gm-team__head \{[^}]*width: 100%; height: \.8rem/);
  const rem = 40; // 792×360 下的 rem
  assert.ok(2.2 * rem >= 32 && 0.8 * rem >= 32, 'visual box 88×32 ≥ 32');
  // 边框是 inset 阴影（不占布局）：按钮的 rect 就是整块 88×32，与视觉尺寸一致
  const teamRule = CSS.match(/\.gm-team \{[^}]*\}/)[0];
  assert.ok(!/border:/.test(teamRule), 'box border drawn with box-shadow (button keeps the full 88×32)');
});

test('CSS / index.html 契约：gm- 前缀、字号走 --t、贴边 x8 与框间距、展开防越底、多人房不再让位', () => {
  for (const sel of ['.gm-unite', '.gm-unite__count', '.gm-teams', '.gm-team', '.gm-team__head', '.gm-team__num', '.gm-team__row']) {
    assert.ok(CSS.includes(sel), `multi-hud.css defines ${sel}`);
  }
  // 上一版：芯片 / 名单 / 状态条 / 队友条一条不剩（只看代码，不看注释里的历史说明）
  const cssCode = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const srcCode = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const dead of ['.gm-strip', '.gm-mate', '.gm-chip', '.gm-panel']) {
    assert.ok(!cssCode.includes(dead), `no ${dead} left in the stylesheet`);
    assert.ok(!srcCode.includes(dead), `no ${dead} left in the component`);
  }
  // 收起态：贴边 .2rem（8）、盟约栏下沿 2.36rem 起、列间距 .15rem（6）、框 2.2rem × .8rem（88×32）
  assert.match(CSS, /\.gm-teams \{[^}]*left: \.2rem; top: 2\.36rem/);
  assert.match(CSS, /\.gm-teams \{[^}]*flex-direction: column; gap: \.15rem/);
  // 展开：另外两框 [hidden]；这一框用 --slot 补回自己那一格（原地），父盒不虚长
  assert.match(CSS, /\.gm-team\[hidden\] \{ display: none; \}/);
  assert.match(CSS, /\.gm-team\.is-open \{ top: calc\(var\(--slot, 0\) \* \(\.8rem \+ \.15rem\)\)/);
  // 展开防越底：三号框的行高按视口收（34 会压住 .gm__corner 316.41）
  assert.match(CSS, /\.gm-teams\.is-tail \.gm-team__row \{ height: min\(\.85rem, calc\(\(100vh - 6\.3rem\) \/ 4\)\)/);
  // 多人房不再为 `.team` 让位：大名单整个不挂载，队伍框真正贴边 x8；联防条 2026-11-01 起在屏幕底部正中（不是 3.6rem 起）
  assert.equal(/\.gm\.has-multi \.team/.test(cssCode), false, 'no .team rule under .has-multi');
  assert.equal(cssCode.includes('5.8rem'), false, 'the 5.8rem 联防条 shift is gone');
  assert.equal(cssCode.includes('left: 3.6rem'), false, 'the 3.6rem left anchor of the old bar is gone');
  assert.match(CSS, /\.gm-unite \{[^}]*left: 50%; bottom: \.2rem; transform: translateX\(-50%\)/);
  assert.equal(/\.gm\.has-multi \.gm-teams/.test(cssCode), false, '.gm-teams keeps its own left (.2rem)');
  // 字号统一 calc(N * var(--t))：不允许裸 rem 字号
  const plain = [...CSS.matchAll(/font-size:\s*([.\d]+)rem/g)].map((m) => m[0]);
  assert.deepEqual(plain, [], 'no plain rem font-size');
  assert.ok(/href="\/css\/screens\/multi-hud.css"/.test(INDEX), 'index.html links the stylesheet');
  // 只有 gm- 前缀的类（不与既有 .gm__ 块命名冲突）
  const classes = new Set([...CSS.matchAll(/\.(gm-[a-z0-9_-]+)/g)].map((m) => m[1]));
  assert.ok(classes.size >= 10);
  for (const c of classes) assert.ok(c.startsWith('gm-'));
});

test('多人房不挂载左侧大名单 .team（不是 display:none）；4 人房仍是同一个 TeamPanel', () => {
  // 8 / 12 人房：TeamPanel 整个不挂载（三元的一支是 null）
  assert.match(GAME, /isMultiRoom\(pub\) \? null : html`<\$\{TeamPanel\}/);
  assert.equal(GAME.match(/\$\{TeamPanel\}/g).length, 1, 'the only TeamPanel mount is the 4-seat one');
  // 不再有「把 .team 挪开」的补偿规则，也不再有「把 .team 藏起来」的规则
  const cssCode = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/\.gm\.has-multi \.team/.test(cssCode), false);
  assert.equal(/\.team\s*\{[^}]*display:\s*none/.test(cssCode), false);
  // 4 人房的挂载分支原样保留：同一个 TeamPanel、同一串 props（少一个就等于 4 人房掉了功能）
  for (const prop of [
    'pub=${pub}', 'myId=${myId}', 'watching=${watchingNow}', 'bubbles=${bubbles}', 'onWatch=${watchPlayer}',
    'cap=${gd.config?.lpCapPerRound ?? 10}', 'uniteLocal=${uniteLocal}',
    'spMarks=${sp ? spMarks(sp, { solo }) : null}',
    'self=${Number.isFinite(priv?.lp) ? { lp: priv.lp, pending: liveLpNow.pending, unite: liveLpNow.unite, left: liveLpNow.left } : null}',
    'observe=${cc ? { canObserve: (p) => observeTarget(p, pub, myId, { observing: watchingOther, ownDone: localDone }), observing: watchingOther, onBack: backHome } : null}',
  ]) {
    assert.ok(GAME.includes(prop), `TeamPanel prop kept: ${prop}`);
  }
});

test('交叠契约：队伍框贴边 x8、列右缘在最宽时的联防条左缘左边、三号框展开不越左下角键', () => {
  // 两档视口各算一遍（rem 由视口决定：792 = 40 / 1920 = 100；几何与实测一致到 0.01）
  for (const { rem, vw, vh, cornerTop } of [
    { rem: 40, vw: 792, vh: 360, cornerTop: 316.41 },
    { rem: 100, vw: 1920, vh: 1080, cornerTop: 1000 },
  ]) {
    // 联防条现在底部居中、最宽 9rem：它最宽的那一帧的左缘 = (屏宽 − 9rem) / 2
    const uniteLeft = (vw - 9 * rem) / 2;
    const left = 0.2 * rem;
    const width = 2.2 * rem;
    const boxH = 0.8 * rem;
    const gap = 0.15 * rem;
    const right = left + width;
    assert.ok(left >= 8 - 0.2, `贴边 x8: left ${left}`);
    assert.ok(right < uniteLeft, `队伍框列右缘 ${right} < 联防条最宽时的左缘 ${uniteLeft}`);
    assert.ok(right < vw, 'the column is inside the viewport');
    // 一列总高（收起）：3 框 + 2 间距
    const columnH = 3 * boxH + 2 * gap;
    assert.ok(2.36 * rem + columnH < vh, 'the column fits the viewport');
    // 三号框展开：行高按视口收紧后的框底仍在左下角键之上
    const rowH = Math.min(0.85 * rem, (vh - 6.3 * rem) / 4);
    const tailBottom = 2.36 * rem + 2 * (boxH + gap) + boxH + 4 * rowH;
    assert.ok(tailBottom <= cornerTop + 0.01, `tail bottom ${tailBottom} ≤ corner top ${cornerTop}`);
    assert.ok(tailBottom <= vh, 'inside the viewport');
  }
  // 792×360：三框一列 3 × 32 + 2 × 6 = 108（与实测 94.39 → 202.39 相同）
  assert.equal(0.8 * 40 * 3 + 0.15 * 40 * 2, 108);
});

test('无新 msgid：每个 t(…) 都是既有条目，队名是内联中文（i18n-ignore）', () => {
  const literals = [...SRC.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(literals.length >= 8, 'the HUD still reads its状态字 from the packs');
  for (const s of literals) assert.ok(Object.prototype.hasOwnProperty.call(EN, s), `existing msgid: ${s}`);
  // 队名沿用第一层房间界面的内联口径：不许包进 t()
  for (const label of ['我方同盟', '对方同盟', '蓝方同盟', '红方同盟']) {
    assert.ok(!SRC.includes(`t('${label}')`), `inline team label, not a msgid: ${label}`);
    const line = SRC.split('\n').find((l) => l.includes(`'${label}'`));
    assert.ok(line && /\/\/ i18n-ignore/.test(line), `inline team label marked i18n-ignore: ${label}`);
  }
  // 联防三段的读法也仍是内联中文
  assert.ok(/STAGE_TEXT = \{[^\n]*\}; \/\/ i18n-ignore/.test(SRC));
});
