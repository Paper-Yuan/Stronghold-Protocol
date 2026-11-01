// S.W.E.E.P.报告 (screens/sweep.js) and the enemy codex's letter grades:
//   - factions.json `handbookLevels` is the official enemy handbook table (enemy_handbook_table levelInfoList, generated
//     by tools/build-data.mjs): ten grades E … SS, weakest first, every graded stat with a [min, max) band
//   - enemyGrade puts a value in its band (an edge belongs to the band that starts there; the attack interval runs the
//     other way); no value or no table reads '—'
//   - the codex lists one enemy per 图鉴 number and no summon-only enemy; a leader's keys are the leader, then its escorts
//   - the report is read-only and a full-screen Modal (focus trap, Esc, focus restored); the lobby opens it

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const factions = JSON.parse(read('data/factions.json'));
const enemies = JSON.parse(read('data/enemies.json'));

const { enemyGrade, codexEnemies, bossEnemyKeys, SWEEP_VARIANTS, DEFAULT_SWEEP_VARIANT, OVERLIMIT_PENDING_BONDS, OVERLIMIT_REWRITTEN_BONDS, bondDisplayName, overlimitBondView, overlimitBondPending, overlimitConfiguredCount, OVERLIMIT_MARK } = await import('../../public/js/screens/sweep.js');
// 数值分色（分词 + 渲染）已抽到共享模块 ui/overlimitBondText.js —— sweep 与局内的盟约弹窗渲染同一个组件，
// 那份模块自己的断言在 test/ui/overlimit-bond-text.test.js；这里只断言 sweep 侧「确实用的是它」。
const { overlimitValueSegments } = await import('../../public/js/ui/overlimitBondText.js');
const { richTextPlain } = await import('../../public/js/ui/richText.js');

const LEVELS = factions.handbookLevels;
const STATS = ['maxHp', 'atk', 'def', 'res', 'moveSpeed', 'interval', 'elementRes', 'elementDmgRes'];

test('handbookLevels: the official ten grades, weakest first, each stat a [min, max) band that meets the next', () => {
  assert.deepEqual(LEVELS.map((l) => l.level), ['E', 'D', 'C', 'B', 'B+', 'A', 'A+', 'S', 'S+', 'SS']);
  for (const l of LEVELS) for (const k of STATS) assert.ok(Array.isArray(l[k]) && l[k].length === 2, `${l.level} ${k}`);
  for (const k of STATS) {
    const bands = LEVELS.map((l) => l[k]);
    if (k === 'interval') {
      // shorter is stronger: SS starts at 0, E is open-ended
      assert.equal(bands.at(-1)[0], 0);
      assert.equal(bands[0][1], null);
      for (let i = 1; i < bands.length; i++) assert.equal(bands[i][1], bands[i - 1][0], `${k} ${LEVELS[i].level}`);
    } else {
      assert.equal(bands[0][0], 0);
      assert.equal(bands.at(-1)[1], null);
      for (let i = 1; i < bands.length; i++) assert.equal(bands[i][0], bands[i - 1][1], `${k} ${LEVELS[i].level}`);
    }
  }
  // spot checks against the table (enemy_handbook_table.json levelInfoList)
  assert.deepEqual(LEVELS.find((l) => l.level === 'B').maxHp, [5000, 8000]);
  assert.deepEqual(LEVELS.find((l) => l.level === 'A+').def, [1200, 2000]);
  assert.deepEqual(LEVELS.find((l) => l.level === 'S+').interval, [0.5, 0.8]);
});

test('enemyGrade: the band a value falls in; an edge starts the next band; the interval runs the other way', () => {
  assert.equal(enemyGrade('maxHp', 999, LEVELS), 'E');
  assert.equal(enemyGrade('maxHp', 1000, LEVELS), 'D');
  assert.equal(enemyGrade('maxHp', 7999, LEVELS), 'B');
  assert.equal(enemyGrade('maxHp', 500000, LEVELS), 'SS');
  assert.equal(enemyGrade('atk', 0, LEVELS), 'E');
  assert.equal(enemyGrade('res', 50, LEVELS), 'A');
  assert.equal(enemyGrade('moveSpeed', 1.9, LEVELS), 'S+');
  assert.equal(enemyGrade('interval', 0.4, LEVELS), 'SS');
  assert.equal(enemyGrade('interval', 1.7, LEVELS), 'B+');
  assert.equal(enemyGrade('interval', 9, LEVELS), 'E');
  assert.equal(enemyGrade('atk', null, LEVELS), '—', 'never attacks');
  assert.equal(enemyGrade('moveSpeed', undefined, LEVELS), '—');
  assert.equal(enemyGrade('atk', -5, LEVELS), '—', 'in no band');
  assert.equal(enemyGrade('atk', 300, undefined), '—', 'no table loaded');
  assert.equal(enemyGrade('nope', 300, LEVELS), '—');
});

test('enemyGrade grades every codex enemy\'s numbers (no gaps in the table)', () => {
  for (const e of codexEnemies(Object.values(enemies))) {
    for (const k of ['maxHp', 'atk', 'def', 'res', 'elementRes', 'elementDmgRes']) {
      const v = e.stats?.[k] ?? 0;
      assert.notEqual(enemyGrade(k, v, LEVELS), '—', `${e.key} ${k}=${v}`);
    }
  }
});

test('codexEnemies: one per 图鉴 number, no summon-only enemy, by number; bossEnemyKeys: the leader, then its escorts', () => {
  const list = codexEnemies(Object.values(enemies));
  assert.ok(list.length > 50);
  assert.ok(list.every((e) => !e.tokenOnly));
  const ids = list.map((e) => (e.handbookIndex ? `${e.handbookIndex}|${e.name}` : e.key));
  assert.equal(new Set(ids).size, ids.length);
  const boss = { enemyKey: 'a', escortsByTemplate: { t1: [{ key: 'b' }, { key: 'a' }], t2: [{ key: 'c' }, null] } };
  assert.deepEqual(bossEnemyKeys(boss), ['a', 'b', 'c']);
  assert.deepEqual(bossEnemyKeys(null), []);
});

test('the report is read-only and a full-screen Modal; the lobby opens it (source contract)', () => {
  const src = read('public/js/screens/sweep.js');
  assert.match(src, /<\$\{Modal\} open=\$\{true\} onClose=\$\{onClose\} class="sw"/);
  assert.match(src, /<\$\{Modal\} open=\$\{true\} onClose=\$\{onClose\} class="sw-codex"/);
  assert.doesNotMatch(src, /openLoadout|savePref\((?!TAB_PREF)|net\.|room\./, 'nothing but the remembered tab is written');
  assert.doesNotMatch(src, /name="box"|name="dice"/, 'only icons of the project\'s set');
  const lobby = read('public/js/screens/lobby.js');
  assert.match(lobby, /import \{ SweepReport \} from '\.\/sweep\.js';/);
  assert.match(lobby, /\$\{sweepOpen \? html`<\$\{SweepReport\} variant=\$\{overlimitCtx \? 'overlimit' : 'official'\} onClose=\$\{\(\) => setSweepOpen\(false\)\} \/>` : null\}/);
  assert.match(read('public/index.html'), /<link rel="stylesheet" href="\/css\/screens\/sweep\.css" \/>/);
});

// 业主 2026-10-30：「炸惊的 sweep 里没显示对应特色策略」。报告此前一律按**官方子集**过滤（`officialBands(…, null)`），
// 于是炸惊那两条 `zjOnly` 策略（山岸风花 / 祀）和 5 条 `zjOnly` 盟约都不出现；湮灭的 2 条 `annOnly` 盟约同理。
// 修法：主题大厅把玩法包 id 交进来，报告按它过滤 —— 大厅里那份（没有玩法包）保持原样。
test('the report follows the play set it is opened from (its own strategies and bonds)', async () => {
  const sweep = read('public/js/screens/sweep.js');
  const theme = read('public/js/screens/extensionThemeHall.js');
  assert.match(theme, /<\$\{SweepReport\} extension=\$\{mode\.id\} onClose=/, 'the theme hall hands its play set in');
  assert.match(sweep, /export function SweepReport\(\{ onClose, extension = null, variant = DEFAULT_SWEEP_VARIANT \}\)/);
  assert.match(sweep, /officialBonds\(data\.list\('bonds'\), modeId\)/);
  assert.match(sweep, /officialBands\(data\.list\('bands'\), modeId\)/);
  assert.match(sweep, /<\$\{BondsTab\} m=\$\{m\} modeId=\$\{modeId\}/);
  assert.match(sweep, /<\$\{BandsTab\} m=\$\{m\} modeId=\$\{modeId\}/);
  // 数据层面（同一套判据 ui/zjView.js）：炸惊专属策略只在炸惊档出现，湮灭专属盟约只在湮灭档出现
  const { officialBands, officialBonds } = await import('../../public/js/ui/zjView.js');
  const bands = Object.values(JSON.parse(read('data/bands.json')));
  const bonds = Object.values(JSON.parse(read('data/bonds.json')));
  const zjBands = bands.filter((b) => b.zjOnly === true).map((b) => b.bandId);
  assert.ok(zjBands.length > 0, 'the build has 炸惊-only strategies');
  for (const id of zjBands) {
    assert.equal(officialBands(bands, 'zhajing').some((b) => b.bandId === id), true, `${id} in a zhajing report`);
    assert.equal(officialBands(bands, null).some((b) => b.bandId === id), false, `${id} not in the lobby report`);
    assert.equal(officialBands(bands, 'annihilation').some((b) => b.bandId === id), false, `${id} not in an annihilation report`);
  }
  const annOnly = bonds.filter((b) => b.annOnly === true).map((b) => b.bondId);
  assert.ok(annOnly.length > 0, 'the build has 湮灭-only bonds');
  for (const id of annOnly) {
    assert.equal(officialBonds(bonds, 'annihilation').some((b) => b.bondId === id), true);
    assert.equal(officialBonds(bonds, null).some((b) => b.bondId === id), false);
  }
});

// 业主 2026-10-31：S.W.E.E.P. 加「原版 / 超限」视图切换壳 —— 强化数值与文案都还没定，这一轮只做壳、不改数据。
// 超限不是玩法包（`extension`），它是官方模式上的难度标记（`solo_infinite` / `flags.overlimit`），所以走 `variant`。
test('原版 / 超限: variant defaults to official, the header switch flips the view only, configured bonds show the inf text and unconfigured ones stay placeholders', async () => {
  assert.deepEqual(SWEEP_VARIANTS, ['official', 'overlimit'], 'two views');
  assert.equal(DEFAULT_SWEEP_VARIANT, 'official', 'the default view is the official one');
  assert.deepEqual([...OVERLIMIT_PENDING_BONDS], ['egirShip', 'lateranoShip', 'victoriaShip', 'sargonShip', 'siracusaShip'],
    'the five bonds 超限 rewrites (阿戈尔 / 拉特兰 / 维多利亚 / 萨尔贡 / 叙拉古)');
  // they are five of the official 23: the placeholders replace tiles, they never add rows
  const bonds = Object.values(JSON.parse(read('data/bonds.json')));
  const official = bonds.filter((b) => b && b.bondId && b.zjOnly !== true && b.annOnly !== true);
  assert.equal(official.length, 23);
  for (const id of OVERLIMIT_PENDING_BONDS) assert.ok(official.some((b) => b.bondId === id), `${id} is an official bond`);

  const sweep = read('public/js/screens/sweep.js');
  // a prop with the official default, and an internal state seeded from it (an outside caller picks the initial view)
  assert.match(sweep, /export function SweepReport\(\{ onClose, extension = null, variant = DEFAULT_SWEEP_VARIANT \}\)/);
  assert.match(sweep, /const \[view, setView\] = useState\(\(\) => \(SWEEP_VARIANTS\.includes\(variant\) \? variant : DEFAULT_SWEEP_VARIANT\)\);/);
  // the header's two pills: pressed state and a data hook, one click switches the view
  assert.match(sweep, /class=\$\{cx\('sw-var', value === it\.id && 'is-on'\)\}/);
  assert.match(sweep, /aria-pressed=\$\{value === it\.id \? 'true' : 'false'\} data-variant=\$\{it\.id\} onClick=\$\{\(\) => onChange\(it\.id\)\}/);
  assert.match(sweep, /<\$\{VariantSwitch\} value=\$\{view\} onChange=\$\{setView\} \/>/);
  // the view changes nothing about the data: same filter, same call, `modeId` is still the only argument besides the list
  assert.match(sweep, /const all = officialBonds\(data\.list\('bonds'\), modeId\)/);
  assert.match(sweep, /<\$\{BondsTab\} m=\$\{m\} modeId=\$\{modeId\} variant=\$\{view\} sel=\$\{bond\?\.bondId\}/);
  // the overlimit view: a factual banner (N counted from the `inf` blocks), and placeholders only where the overlay is missing
  assert.match(sweep, /\$\{view === 'overlimit' \? html`<\$\{OverlimitBanner\} live=\$\{live\} configured=\$\{configuredBonds\} \/>` : null\}/);
  assert.match(sweep, /return overlimitBondPending\(b, overlimit\)/);
  assert.match(sweep, /\? html`<\$\{PendingTile\} key=\$\{b\.bondId\} name=\$\{name\} \/>`/);
  // the banner is a fact now: never the old 'not configured' line, and N comes from the data
  assert.doesNotMatch(sweep, /尚未配置/);
  assert.match(sweep, /banner: \(n\) => `超限视图 · 已配置 \$\{n\} 条盟约强化`/);
  // 业主 2026-10-31（超限 V2 定稿）：被改写的盟约在超限视图里显示「XXX 超限」，官方视图不带后缀。
  // 名单 = 上一轮 5 条 + 本轮带 `inf` 覆盖块的 3 条（炎 / 卡西米尔 / 谢拉格）= data 里带 `inf` 块的 8 条。
  assert.deepEqual([...OVERLIMIT_REWRITTEN_BONDS],
    ['egirShip', 'lateranoShip', 'victoriaShip', 'sargonShip', 'siracusaShip', 'yanShip', 'kazimierzShip', 'kjeragShip'],
    'the eight bonds 超限 rewrites (5 placeholders + 炎 / 卡西米尔 / 谢拉格)');
  assert.equal(OVERLIMIT_REWRITTEN_BONDS.length, 8, 'eight rewritten bonds');
  for (const id of OVERLIMIT_REWRITTEN_BONDS) assert.ok(official.some((b) => b.bondId === id), `${id} is an official bond`);
  // exactly the records carrying the `inf` block — a name suffix must never appear without the overlimit text behind it
  const infBonds = official.filter((b) => b.inf && typeof b.inf === 'object').map((b) => b.bondId).sort();
  assert.deepEqual(infBonds, [...OVERLIMIT_REWRITTEN_BONDS].sort(), 'the eight `inf` overlay blocks == the eight renamed bonds');
  // the suffix is the existing 超限 literal (no new msgid): name + ' ' + OVERLIMIT_COPY.label, official view falls back to b.name
  assert.match(sweep, /export const bondDisplayName = \(b, overlimit\) => \(overlimit && REWRITTEN_BONDS\.has\(b\.bondId\) \? `\$\{b\.name\} \$\{OVERLIMIT_COPY\.label\}` : b\.name\);/);
  // 行为断言（不是源码正则）：超限视图带「超限」后缀，官方视图逐字节等于数据里的名字，未改写的盟约两种视图一样
  for (const id of OVERLIMIT_REWRITTEN_BONDS) {
    const rec = official.find((b) => b.bondId === id);
    assert.equal(bondDisplayName(rec, true), `${rec.name} 超限`, `${id}: 超限视图带后缀`);
    assert.ok(bondDisplayName(rec, true).endsWith('超限'), `${id}: name ends with 超限`);
    assert.equal(bondDisplayName(rec, false), rec.name, `${id}: 官方视图不带后缀`);
  }
  assert.equal(bondDisplayName({ bondId: 'preciShip', name: '精准' }, true), '精准', '未改写的盟约不带后缀');
  // both render paths go through it: the tile caption / title, and the detail panel's hero name
  assert.match(sweep, /const name = bondDisplayName\(b, overlimit\);/);
  assert.match(sweep, /<span class="sw-tile__cap">\$\{name\}<\/span>/);
  assert.match(sweep, /const ov = overlimitBondView\(bond, variant === 'overlimit'\);/);
  assert.match(sweep, /const name = ov\.name;/);
  // the panel shows the data's own text: the base description plus the inf block's 超限模拟 lines under the existing msgid
  assert.match(sweep, /<\$\{RichText\} as="p" text=\$\{ov\.descRaw\} \/>/);
  assert.match(sweep, /<section class="sw-inf" data-overlimit="bond">/);
  assert.match(sweep, /<h4 class="sw-text__h sw-inf__h">\$\{t\('超限模拟'\)\}<\/h4>/);
  assert.ok(JSON.parse(read('public/i18n/zh-TW.json'))['超限模拟'], 'the strengthening header is an existing msgid');
  assert.match(sweep, /<\$\{Hero\} src=\$\{bondIconUrl\(m, bond\.bondId\)\} glyph=\$\{true\} name=\$\{name\}/);
  assert.match(sweep, /<\$\{BondPanel\} key=\$\{bond\.bondId\} bond=\$\{bond\} m=\$\{m\} notOwned=\$\{notOwned\} variant=\$\{view\} \/>/);
  // the official pill reuses an existing msgid; the new copy is not a msgid this round (the owner forbade new ones), so it
  // is one marked block of literals — every line with Chinese in it carries `i18n-ignore`, ready to become t('…')
  assert.ok(JSON.parse(read('public/i18n/en.json'))['原版'], 'the official pill reuses the existing msgid 原版');
  const copyAt = sweep.indexOf('const OVERLIMIT_COPY');
  const copyBlock = sweep.slice(copyAt, sweep.indexOf('\n};', copyAt));
  const cjk = /[\u3400-\u9fff]/;
  const copyLines = copyBlock.split('\n').slice(1).filter((l) => cjk.test(l));
  assert.equal(copyLines.length, 4, 'four new literals');
  for (const l of copyLines) assert.match(l, /i18n-ignore/, `not a msgid, and marked: ${l.trim()}`);
  for (const s of ['超限', '超限视图 · 已配置', '当前对局使用超限数值', '超限专属：待定']) assert.ok(copyBlock.includes(s), s);
  // the lobby decides the initial view: an overlimit room (solo_infinite / coop_infinite) or the lobby's 超限 difficulty pick
  const lobby = read('public/js/screens/lobby.js');
  assert.match(lobby, /const overlimitCtx = isInfiniteMode\(liveRoom\?\.mode\) \|\| difficulty === INFINITE_OPTION;/);
  // the theme hall keeps handing in its play set only (炸惊 / 湮灭 are not 超限), so its report opens on the official view
  assert.match(read('public/js/screens/extensionThemeHall.js'), /<\$\{SweepReport\} extension=\$\{mode\.id\} onClose=/);
  // out of scope this round: briefing.js / bandDraft.js keep their own officialBonds call and know nothing of variant
  for (const f of ['public/js/screens/briefing.js', 'public/js/screens/bandDraft.js']) {
    const src = read(f);
    assert.match(src, /officialBonds\(gd\.list\('bonds'\)/, `${f} still filters by the match's mode`);
    assert.doesNotMatch(src, /SweepReport|sweep\.js/, `${f} does not open the report`);
  }
});

// 业主 2026-11-01：超限盟约强化早已落地（data/bonds.json 的 `inf` 覆盖块），报告这一侧把界面回填成真实内容：
// 五条改写盟约显示 inf 块里的超限行（不再「待定」），横幅说事实（N = 带 inf 块的条数），官方视图逐字节不变。
test('超限盟约回填: the five read the inf overlay, a record without inf stays a placeholder, the official view is untouched', async () => {
  const bonds = Object.values(JSON.parse(read('data/bonds.json')));
  const byId = new Map(bonds.map((b) => [b.bondId, b]));
  assert.equal(overlimitConfiguredCount(bonds), 8, 'eight inf overlays = eight configured strengthenings (the banner N)');
  for (const id of OVERLIMIT_PENDING_BONDS) {
    const rec = byId.get(id);
    const view = overlimitBondView(rec, true);
    assert.equal(view.configured, true, `${id}: inf block present -> configured`);
    assert.equal(overlimitBondPending(rec, true), false, `${id}: a real, clickable tile`);
    assert.equal(view.descRaw, rec.descRaw, `${id}: the panel keeps the base description`);
    assert.equal(view.descRaw, rec.inf.descRaw.split(OVERLIMIT_MARK)[0].trimEnd(), `${id}: read from the inf block (before its 超限 lines)`);
    assert.equal(view.changes.length, 1, `${id}: one 超限模拟 line`);
    assert.ok(/\d/.test(view.changes[0]), `${id}: the line states the strengthening with real numbers`);
    assert.ok(rec.inf.descRaw.includes(`${OVERLIMIT_MARK}${view.changes[0]}`), `${id}: the line is the inf block's own text`);
    // 描述面板 = inf 块原文的前半 + 抽出的超限行，合起来逐字等于 inf.descRaw
    assert.equal(`${view.descRaw}\n${OVERLIMIT_MARK}${view.changes[0]}`, rec.inf.descRaw, `${id}: base + 超限 line == inf.descRaw`);
    assert.ok(!view.descRaw.includes(OVERLIMIT_MARK), `${id}: the base part does not swallow the overlimit line`);
    // 未配置：同一条盟约在没有 `inf` 块的赛季版本里仍是占位，不是「已配置 0 字」
    const bare = { ...rec, inf: undefined };
    assert.equal(overlimitBondView(bare, true).configured, false, `${id}: no inf -> not configured`);
    assert.deepEqual(overlimitBondView(bare, true).changes, [], `${id}: no inf -> no strengthening text`);
    assert.equal(overlimitBondPending(bare, true), true, `${id}: no inf -> placeholder stays`);
  }
  // 官方视图（`official`）逐字节不变：名字 / 描述与数据里的字段相同，不读 inf，不出现占位
  const official = bonds.filter((b) => b && b.bondId && b.zjOnly !== true && b.annOnly !== true);
  assert.equal(official.length, 23);
  for (const rec of official) {
    const view = overlimitBondView(rec, false);
    assert.equal(view.name, rec.name, `${rec.bondId}: official name`);
    assert.equal(view.descRaw, rec.descRaw || rec.desc || '', `${rec.bondId}: official description`);
    assert.equal(view.configured, false, `${rec.bondId}: official view never reads inf`);
    assert.deepEqual(view.changes, [], `${rec.bondId}: no overlimit block in the official view`);
    assert.equal(overlimitBondPending(rec, false), false, `${rec.bondId}: official view never shows a placeholder`);
  }
  // 没有超限数据的赛季版本：0 条已配置，五条仍占位（横幅 N 用同一个函数算，不写死 8）
  for (const v of readdirSync(path.join(ROOT, 'data/versions'))) {
    const recs = Object.values(JSON.parse(read(`data/versions/${v}/bonds.json`)));
    assert.equal(overlimitConfiguredCount(recs), 0, `${v}: no inf overlays`);
    for (const id of OVERLIMIT_PENDING_BONDS) {
      const rec = recs.find((b) => b && b.bondId === id);
      if (rec) assert.equal(overlimitBondPending(rec, true), true, `${v}: ${id} keeps the placeholder`);
    }
  }
});

// 业主 2026-11-01：强化块里**只有涉及数值的片段**用强调色，纯描述文字保持正文色 —— 不整句染色。
// 切分规则在共享模块 ui/overlimitBondText.js 的 overlimitValueSegments（一个「值表达式」= 数值 / 括号式子 /
// `25→9999` 这类范围；「层数」只能当式子里的因子，单独出现不算数值），面板把 num 片段渲染成 `.olb-num` 强调节点，
// 非数值片段以纯文本节点渲染（没有类名，所以「整句都在强调节点里」在结构上不可能）。局内的盟约弹窗用同一套。
test('超限强化行：数值片段走强调节点、纯描述不染色（三条点名文案，固定期望值）', () => {
  const bonds = Object.values(JSON.parse(read('data/bonds.json')));
  const byId = new Map(bonds.map((b) => [b.bondId, b]));
  // 固定期望：每条点名文案的数值片段**原文与顺序**（不是「> 0」那种放宽断言）
  const EXPECT = [
    ['sargonShip', ['6', '25', '9999', '25', '+300%', '+12%', '25', '100', '5%']],
    ['lateranoShip', ['6', '1', '+8%', '100', '20%', '600', '100', '+0.4%', '+1%', '+1%', '600']],
    ['kazimierzShip', ['+40%', '+20%', '(100+2×层数)%', '(50+1×层数)%', '(1+0.25+0.01×层数) → 2×(1+0.25+0.01×层数)']],
  ];
  for (const [id, want] of EXPECT) {
    const line = overlimitBondView(byId.get(id), true).changes[0];
    const segs = overlimitValueSegments(line);
    const nums = segs.filter((s) => s.num);
    // 1) 强调片段的原文与顺序就是这几个（个数 = 面板里该条 `.sw-bond__num` 的节点数）
    assert.deepEqual(nums.map((s) => s.text), want, `${id}: 数值片段`);
    assert.ok(nums.length > 0, `${id}: 强调节点数 > 0`);
    // 2) 每个强调片段都含数字（单独出现的「层数」不算数值），且都短于整句
    for (const s of nums) {
      assert.match(s.text, /\d/, `${id}: 数值片段里有数字：${s.text}`);
      assert.ok(s.text.length < line.length, `${id}: 数值片段不是整句：${s.text}`);
    }
    // 3) 纯文字部分不在强调节点里：正文片段存在、非空、且一个数字都不含
    const plain = segs.filter((s) => !s.num);
    assert.ok(plain.length > 0 && plain.some((s) => s.text.trim()), `${id}: 有正文片段`);
    assert.ok(plain.every((s) => !/\d/.test(s.text)), `${id}: 正文片段不含数字：${JSON.stringify(plain.map((s) => s.text))}`);
    // 4) 只切不改字：片段拼回去逐字等于明文（官方样式标记已剥掉）
    assert.equal(segs.map((s) => s.text).join(''), richTextPlain(line), `${id}: 拼回去等于明文`);
    // 5) 不存在「整句都在强调节点内」：多于一段，且没有任何一段覆盖整句
    assert.ok(segs.length >= 3, `${id}: 至少 3 段`);
    assert.ok(segs.every((s) => s.text.length < line.length), `${id}: 没有一段等于整句`);
  }
});

test('超限强化行：八条文案逐条可切（固定个数），前缀不染、描述与官方视图不动、样式只用既有 token', () => {
  /** 明文里「（…）」形式的补充说明（全角括号，不跨括号）。 */
  const plainParens = (text) => [...String(text).matchAll(/（[^（）]*）/g)].map((m) => m[0]);
  const bonds = Object.values(JSON.parse(read('data/bonds.json')));
  const infBonds = bonds.filter((b) => b && b.inf);
  assert.equal(infBonds.length, 8, 'eight inf overlays');
  const counts = {};
  for (const rec of infBonds) {
    const line = overlimitBondView(rec, true).changes[0];
    const segs = overlimitValueSegments(line);
    const nums = segs.filter((s) => s.num);
    counts[rec.bondId] = nums.length;
    assert.ok(nums.length > 0, `${rec.bondId}: 至少一处数值`);
    assert.ok(nums.every((s) => /\d/.test(s.text)), `${rec.bondId}: 只有含数字的片段被染色`);
    assert.ok(segs.some((s) => !s.num), `${rec.bondId}: 有正文片段（不是整句都染）`);
    assert.equal(segs.map((s) => s.text).join(''), richTextPlain(line), `${rec.bondId}: 不丢字`);
    // `【超限模拟】` 前缀本身不染色：它在 overlimitBondView 里就被剥掉了，也不会被并进某个数值片段
    assert.ok(!line.includes(OVERLIMIT_MARK), `${rec.bondId}: the prefix is already gone`);
    assert.ok(nums.every((s) => !s.text.includes('【')), `${rec.bondId}: 数值片段不含盟约名`);
    // 括号里的补充说明不含数值时整段留在正文里（例如 维多利亚「（受层数影响，无需携带装备）」、阿戈尔「（最终加算…）」）；
    // 含数值的括号（炎「（受层数影响，即每层 +0.2%）」）才允许被染 —— 这里只查前者
    const plainText = segs.filter((s) => !s.num).map((s) => s.text).join('');
    for (const p of plainParens(line)) {
      if (!/\d/.test(p)) assert.ok(plainText.includes(p), `${rec.bondId}: 纯说明括号整段在正文里：${p}`);
    }
  }
  // 八条的数值片段个数（固定值 —— 改文案就得同步改这里）
  assert.deepEqual(counts, {
    egirShip: 5, lateranoShip: 11, victoriaShip: 4, sargonShip: 9, siracusaShip: 7, yanShip: 2, kazimierzShip: 5, kjeragShip: 3,
  }, '每条文案的数值片段个数');

  // 渲染链：分色逻辑只有一份 —— sweep 页不再自带分词 / 强调节点，它渲染共享模块的 OverlimitValueLine
  const sweep = read('public/js/screens/sweep.js');
  const shared = read('public/js/ui/overlimitBondText.js');
  assert.match(sweep, /import \{ OverlimitValueLine \} from '\.\.\/ui\/overlimitBondText\.js';/);
  assert.match(sweep, /<\$\{OverlimitValueLine\} text=\$\{text\} class="sw-inf__line" \/>/);
  assert.doesNotMatch(sweep, /class="olb-num"|OVERLIMIT_NUM_CLASS/, 'sweep.js 里没有第二个强调节点实现');
  assert.doesNotMatch(sweep, /export function overlimitValueSegments|const NUM_VALUE|OVERLIMIT_VALUE_RE/, 'sweep.js 不再自带分词');
  assert.doesNotMatch(sweep, /sw-bond__num/, '旧的私有强调类名已整个移除');
  assert.match(shared, /export function overlimitValueSegments\(line\)/);
  assert.match(shared, /export function OverlimitValueLine\(\{ text, class: cls = null \}\)/);
  assert.equal((shared.match(/class=\$\{OVERLIMIT_NUM_CLASS\}/g) || []).length, 1, '强调节点只在共享模块里渲染一处');
  assert.match(sweep, /<\$\{ValueLine\} key=\$\{i\} text=\$\{line\} \/>/);
  // 强化行不再整句走 RichText；描述仍是 RichText（官方视图逐字节不变）
  assert.doesNotMatch(sweep, /<\$\{RichText\}[^>]*sw-inf__line/, 'the 强化 line is not a RichText any more');
  assert.match(sweep, /<\$\{RichText\} as="p" text=\$\{ov\.descRaw\} \/>/);
  // 样式：颜色规则只有一份，是与上下文无关的共享类 .olb-num（components.css）；sweep.css 只引用类名，不再声明颜色
  assert.match(read('public/css/components.css'), /\.olb-num \{ color: var\(--mint-400\); \}/);
  assert.doesNotMatch(read('public/css/screens/sweep.css'), /sw-bond__num|^\.olb-num\s*\{/m, 'sweep.css 不声明第二条颜色规则');
  assert.match(read('public/css/theme.css'), /--mint-400: #59f4ca;/);
});

