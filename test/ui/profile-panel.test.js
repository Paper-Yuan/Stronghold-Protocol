// test/ui/profile-panel.test.js — 大厅个人条 + 个人资料面板（头像 / 名片两分区）+ 名片索引
// （业主 2026-10-28 B 项：public/js/ui/accounts.js、public/js/ui/namecards.js、
//  public/css/screens/profile.css，以及 lobby.js / room.js 的接线）。
//
// 验收口径：
//   1. 名片索引读 `data/namecards.json`（tools/import-namecards.py 生成）：34 条、id 唯一且 ascii slug、每条都有
//      `preview` 且指向 `/assets/namecard/<id>/*.webp`；`{ cards: [...] }` 与裸数组两种形状都认；坏输入
//      （null / {} / 缺 id 的记录）一律空数组 —— 绝不把没 src 的记录喂给图层。
//      （实测磁盘上 public/assets/namecard/ 有 68 个目录 / 552 webp，其中只有 34 个目录、276 webp 进了索引，
//       另外 34 个 `card_` / `card__2…34` 目录没有任何记录能指向它们 —— 见回报里的导入器问题，测试只钉索引这一侧。）
//   2. 索引缺失时**不画破图**：`namecardOf` 返回 null ⇒ `NameCardLayer` 返回 null（面板只剩头像区）；
//      8 张手绘（旧存档里可能在用）仍然画得出来，选择器也退回这 8 张。
//   3. 面板是两分区（个人资料 = 头像 / 名片 = 预览 + 选择名片），入口是大厅 topbar__right 里的 `.me-chip`；
//      房间座位牌只在自己那一张上回显本机名片（别人的名片是别人的本机数据，这里拿不到）。
//   4. 样式地板同其它新面板：字号 `max(<px>, …)`、触摸 24px、无 `!important` / `:has()`、有 prefers-reduced-motion。
//
// 浏览器里的真断言在 devtools/lib/zhajing-panels.mjs 的 `profile` 步骤（真机/桌面四档）；这里钉住纯函数、源码接线与
// 样式地板，不需要 Chrome。Node 里 `data` 没载入，所以真实名片 id 的 vnode 形状留给巡检脚本 —— 这里只断 namecardOf
// 的注入路径与 null 路径。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NAMECARDS, namecardIndex, namecardOf, namecardChoices, NameCardLayer } from '../../public/js/ui/namecards.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/**
 * data/namecards.json 原样（`{ _doc, version, count, cards: [...] }`）。这份索引由 tools/import-namecards.py 从本机
 * 客户端抽出，**不入库**（同 public/assets，AGENTS.md「No game art in git」）：没有它的机器就是「服务器没生成过索引」
 * 那一档，所以缺文件时这几条 skip（照 test/assets.test.js 的写法），而不是把整条线判红。
 */
const CARDS_PATH = path.join(ROOT, 'data/namecards.json');
const HAVE_CARDS = existsSync(CARDS_PATH);
const SKIP = HAVE_CARDS ? false : 'data/namecards.json not generated (run tools/import-namecards.py)';
const CARDS_FILE = HAVE_CARDS ? JSON.parse(readFileSync(CARDS_PATH, 'utf8')) : null;
const CARDS = CARDS_FILE ? CARDS_FILE.cards : [];
/** 一个「索引在、但里面没有这张 id」的小索引：用来断「不画破图」那条路，不依赖真文件 */
const SYNTH = { cards: [{ id: 'card_test01', name: 'TEST', preview: '/assets/namecard/card_test01/preview.webp' }] };
/** 索引 id 的形状：ascii slug（card_00465a33），与 public/assets/namecard/<id>/ 目录同名 */
const ID_RE = /^[a-z0-9_]+$/;

test('the real index: 34 cards, unique ascii slugs, and a preview webp under /assets/namecard/<id>/', { skip: SKIP }, () => {
  const list = namecardIndex(CARDS_FILE);
  assert.equal(list.length, 34);
  assert.equal(new Set(list.map((c) => c.id)).size, 34, 'ids are unique');
  assert.equal(CARDS_FILE.count, list.length, 'the file\'s own count agrees with what the index reads');
  for (const c of list) {
    assert.match(c.id, ID_RE, `ascii slug: ${c.id}`);
    assert.match(c.preview, new RegExp(`^/assets/namecard/${c.id}/[a-z0-9_]+\\.webp$`), `preview of ${c.id}`);
    assert.ok(typeof c.name === 'string' && c.name, `${c.id} carries a display name`);
  }
});

test('the { cards: [...] } wrapper, a bare array, and an id → record map are all accepted', { skip: SKIP }, () => {
  const bare = namecardIndex(CARDS);
  const wrapped = namecardIndex({ cards: CARDS });
  assert.equal(bare.length, 34);
  assert.deepEqual(bare.map((c) => c.id), wrapped.map((c) => c.id));
  const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  assert.equal(namecardIndex(byId).length, 34, 'a map of id → record');
  // 真文件的 _doc / version / count 不该被当成记录（cards 分支先命中，不会走 Object.values）
  assert.equal(namecardIndex({ ...CARDS_FILE }).length, 34);
});

test('bad input never throws and never yields a record: null / {} / a record without an id → []', () => {
  for (const bad of [null, undefined, {}, 0, '', 'namecards', [], { cards: null }, { cards: 'no' }]) {
    assert.deepEqual(namecardIndex(bad), [], JSON.stringify(bad));
  }
  // 缺 id、或 id 之外一个图片字段都没有的记录都丢掉（否则图层拿到空 src，就是一张破图）
  assert.deepEqual(namecardIndex([{ name: 'x', preview: '/a.webp' }]), []);
  assert.deepEqual(namecardIndex([{ id: 'ok' }]), []);
  assert.deepEqual(namecardIndex([{ id: 7, preview: '/b.webp' }]), [], 'a numeric id is not an index key');
  assert.deepEqual(namecardIndex([{ id: 'ok', preview: '/a.webp' }, { id: 7, preview: '/b.webp' }]).map((c) => c.id), ['ok']);
});

test('namecardOf: the index record by id, null when the index is missing it, null for an empty id', () => {
  assert.equal(namecardOf('card_test01', SYNTH).id, 'card_test01');
  assert.equal(namecardOf('card_00000000', SYNTH), null, 'a card the index does not list');
  for (const empty of ['', null, undefined, 0]) assert.equal(namecardOf(empty, SYNTH), null);
  // 旧手绘 id 不在索引里（它们只活在 NAMECARDS 里）
  assert.equal(namecardOf('yan_sui', SYNTH), null);
  // 真索引：命中返回原记录（同一个对象，不改写）
  if (HAVE_CARDS) assert.deepEqual(namecardOf(CARDS[0].id, CARDS_FILE), CARDS[0]);
});

test('namecardChoices(real index): 34 art cards, every shot is the room-sized preview', { skip: SKIP }, () => {
  const choices = namecardChoices(CARDS);
  assert.equal(choices.length, 34);
  assert.ok(choices.every((c) => c.art === true), 'index cards are drawn from the webp, not the gradients');
  assert.deepEqual(choices.map((c) => c.id), CARDS.map((c) => c.id), 'same order as the file');
  for (const c of choices) {
    assert.equal(c.shot, namecardOf(c.id, CARDS).preview, `${c.id} shows its preview`);
    assert.match(c.shot, /^\/assets\/namecard\//);
    assert.ok(c.name, `${c.id} has a label`);
    assert.equal(c.theme, null, 'no gradient theme for an indexed card');
  }
});

test('namecardChoices(null): the 8 hand-drawn cards survive the fallback (art:false)', () => {
  assert.equal(NAMECARDS.length, 8, 'the hand-drawn set is 8'); // 文件头注释里的「9 张」是过时文字
  const fallback = namecardChoices(null);
  assert.equal(fallback.length, 8);
  assert.deepEqual(fallback.map((c) => c.id), NAMECARDS.map((c) => c.id));
  assert.ok(fallback.every((c) => c.art === false));
  assert.ok(fallback.every((c) => c.shot === null), 'no webp to show: the layer paints the gradient');
  assert.ok(fallback.every((c) => c.theme && c.code), 'theme / code still there for the gradient card');
  // 空索引 / 空对象同样走回退（服务器没生成过 namecards.json 时就是这个形状）
  assert.equal(namecardChoices({}).length, 8);
  assert.equal(namecardChoices([]).length, 8);
});

test('a card the index does not know draws nothing — the 「只显示头像区」mechanism', () => {
  // 索引在、但这张 id 不在里面：namecardOf 给 null ⇒ NameCardLayer 返回 null（不是一张破图）
  assert.equal(namecardOf('card_deadbeef', SYNTH), null);
  assert.equal(NameCardLayer({ card: 'card_deadbeef' }), null);
  assert.equal(NameCardLayer({}), null, 'no card chosen: no layer at all');
  // 8 个手绘 id 仍然画得出来（vnode 是 .nc-layer，没有 --art 变体）
  const vnode = NameCardLayer({ card: 'yan_sui' });
  assert.ok(vnode && typeof vnode === 'object', 'the hand-drawn ids still draw');
  assert.equal(vnode.props.class, 'nc-layer');
  // Node 里 data 没载入 ⇒ 真索引拿不到 ⇒ 图层返回 null；命中时的 DOM 形状由巡检脚本在浏览器里断
  assert.equal(NameCardLayer({ card: 'card_test01' }), null, 'no namecards index loaded in Node → nothing to draw');
});

test('the picker it opens: a 默认制式 tile + one tile per choice (35 tiles with the index, 9 without)', () => {
  const js = read('public/js/ui/namecards.js');
  assert.match(js, /<div class="nc-pick" data-testid="namecard-picker"/);
  assert.match(js, /<div class="nc-pick__grid">/);
  // 「默认制式（无名片）」那一张：data-card="" ⇒ 选中即清空 card
  assert.match(js, /class=\$\{`nc-pick__card\$\{!selected \? ' is-on' : ''\}`\} data-card="" onClick=\$\{\(\) => handleSelect\(''\)\}/);
  assert.match(js, /data-card=\$\{c\.id\}/);
  assert.match(js, /<\$\{NameCardLayer\} card=\$\{c\.id\} \/>/, 'each tile draws its own layer');
  assert.match(js, /setLocalCard\(cardId\)/, 'a pick is stored on this browser');
  // 瓦片总数 = 1（默认制式）+ choices：巡检脚本数的是 35（有索引）/ 9（回退 8 张）
  if (HAVE_CARDS) assert.equal(1 + namecardChoices(CARDS).length, 35);
  assert.equal(1 + namecardChoices(null).length, 9);
});

test('accounts.js: one panel, two zones, a card preview and the chip that opens it (lazy stylesheet)', () => {
  const acct = read('public/js/ui/accounts.js');
  // 根 + 两分区 + 预览：巡检脚本按这四个 testid 走
  assert.match(acct, /<div class="lacct" data-testid="profile">/);
  assert.match(acct, /<section class="lacct__sec" data-testid="profile-avatar">/);
  assert.match(acct, /<section class="lacct__sec" data-testid="profile-card">/);
  assert.match(acct, /data-testid="profile-card-preview"/);
  // 分区标题与按钮走 t()（最后一条核对四包里有这三个 msgid）
  assert.match(acct, /<h3 class="lacct__sec-title">\$\{t\('个人资料'\)\}<\/h3>/);
  assert.match(acct, /<h3 class="lacct__sec-title">\$\{t\('名片'\)\}<\/h3>/);
  assert.match(acct, /onClick=\$\{\(\) => openNamecardPicker\(\)\}>\$\{t\('选择名片'\)\}/);
  // 头像区：图片 / 说明 / 按钮组；名片区：预览用 NameCardLayer 画本机名片，画不出来（没选 / 索引里没有这张）
  // 就给「选择名片」占位 —— 业主口径：名片只影响个人名片页与房内名字条，且不留空框
  assert.match(acct, /class="lacct__pic"/);
  assert.match(acct, /class="lacct__note"/);
  assert.match(acct, /class="lacct__btns"/);
  assert.match(acct, /const cardKnown = namecardKnown\(me\.card\)/);
  assert.match(acct, /lacct__cardview\$\{cardKnown \? '' : ' lacct__cardview--none'\}/);
  assert.match(acct, /cardKnown \? html`<\$\{NameCardLayer\} card=\$\{me\.card\} \/>` : html`<span>\$\{t\('选择名片'\)\}<\/span>`/);
  assert.match(acct, /import \{ openNamecardPicker, NameCardLayer, NamecardVariantSwitch, namecardKnown \} from '\.\/namecards\.js'/);
  // 差分切换（业主 2026-10-29）：点了就重画预览（NameCardLayer 每次渲染从本机 pref 读序号）
  assert.match(acct, /<\$\{NamecardVariantSwitch\} card=\$\{me\.card\} onChange=\$\{\(\) => setVariantTick\(\(n\) => n \+ 1\)\} \/>/);
  // 业主 2026-10-28：名片底图**只**出现在个人名片页与房内名字条 —— 大厅个人条（chip）不画面片图层
  const chip = acct.slice(acct.indexOf('export function AccountMeChip'), acct.indexOf('export function startAccounts'));
  assert.doesNotMatch(chip, /NameCardLayer/, 'the chip must not paint the name card');
  // 索引载入后自动重画（useData），样式表懒加载（不进 index.html）
  assert.match(acct, /useData\('namecards'\)/);
  assert.match(acct, /export function ensureProfileCss\(\)/);
  assert.match(acct, /link\.href = '\/css\/screens\/profile\.css'/);
  assert.match(acct, /link\.dataset\.profile = '1'/);
  assert.match(acct, /if \(document\.querySelector\('link\[data-profile\]'\)\) return;/);
  // 入口：大厅右上角的个人条（AccountMeChip 之前没有任何调用点）
  assert.match(acct, /<button type="button" class="me-chip me-chip--btn stats-entry" data-testid="profile-entry"/);
  assert.match(acct, /onClick=\$\{\(\) => openAccountPanel\(\{ onStats \}\)\}/);
});

test('lobby.js mounts the chip in topbar__right; room.js replays my own card on my seat plate only', () => {
  const lobby = read('public/js/screens/lobby.js');
  assert.match(lobby, /import \{ AccountMeChip \} from '\.\.\/ui\/accounts\.js'/);
  // 只在大厅顶栏右侧那一段里挂一次
  const rightStart = lobby.indexOf('<div class="topbar__right">');
  assert.ok(rightStart > 0, 'the topbar right block exists');
  const right = lobby.slice(rightStart, lobby.indexOf('</header>', rightStart));
  assert.match(right, /<\$\{AccountMeChip\} \/>/, 'the chip sits in topbar__right');
  assert.equal(lobby.split('<${AccountMeChip} />').length - 1, 1, 'mounted exactly once');

  const room = read('public/js/screens/room.js');
  assert.match(room, /import \{ NameCardLayer \} from '\.\.\/ui\/namecards\.js'/);
  assert.match(room, /const \{ me: acct \} = useCurrentAccount\(\)/);
  assert.match(room, /nameCard=\$\{acct\?\.card \|\| null\}/, 'RoomScreen passes this browser\'s card down');
  // 只有自己那一张（isMe）回显
  assert.match(room, /\$\{isMe && nameCard \? html`<\$\{NameCardLayer\} card=\$\{nameCard\} \/>` : null\}/);
  const plateStart = room.indexOf('<div class="rseat__plate">');
  assert.ok(plateStart > 0, 'the seat plate block exists');
  const plate = room.slice(plateStart, room.indexOf('</div>', plateStart));
  assert.match(plate, /<\$\{NameCardLayer\} card=\$\{nameCard\} \/>/, 'the layer is inside .rseat__plate');
});

test('差分（业主 2026-10-29 修订）：比例与素材一致不裁切、选择器里也能切、切完立即换图', () => {
  const js = read('public/js/ui/namecards.js');
  const css = read('public/css/screens/profile.css');
  // 比例：entry 素材是 640×224 = 20:7；旧框 600×186（3.23:1）配 cover 会裁掉上下
  assert.match(css, /\.lacct__cardview\s*\{[^}]*aspect-ratio: 20 \/ 7/s);
  assert.match(css, /\.nc-pick__shot\s*\{[^}]*aspect-ratio: 20 \/ 7/s);
  // 差分序号：按卡存在本机 pref，读的时候夹在范围内
  assert.match(js, /export const NAMECARD_VARIANT_PREF = 'sp\.pref\.namecardVariant'/);
  assert.match(js, /export function namecardVariantCount\(card, raw\)/);
  assert.match(js, /export function namecardVariantOf\(card, raw\)/);
  assert.match(js, /export function setVariantOf\(card, index\)/);
  // 图层按序号取图（entry 优先，没有 entry 退 side）
  assert.match(js, /const i = namecardVariantOf\(real\.id\)/);
  assert.match(js, /data-variant=\$\{i\}/);
  // 切换器自己持有状态（换完立即换图），并在选择器里也出现
  assert.match(js, /const \[i, setI\] = useState\(\(\) => namecardVariantOf\(card\)\)/);
  assert.match(js, /data-testid="nc-variant-next"/);
  assert.match(js, /data-testid="nc-variant-pos"/);
  assert.match(js, /class="nc-pick__varrow"/);
  assert.match(js, /data-variants=\$\{c\.variants \|\| 0\}/);
  // 瓦片数量徽（有几张差分一眼可见）
  assert.match(css, /\.nc-pick__var\s*\{/);
  assert.match(css, /\.nc-var__dots i\.is-on/);
});

test('profile.css: every font size carries a px floor (max(<px>, …))', () => {
  const css = read('public/css/screens/profile.css').replace(/\/\*[\s\S]*?\*\//g, ''); // 注释里可以提到这两条禁令
  // 口径一：以 font-size 开头的行
  const lines = css.split('\n').filter((l) => /^\s*font-size:/.test(l));
  assert.ok(lines.length >= 8, `found the font sizes: ${lines.length}`);
  for (const line of lines) assert.match(line, /max\(\d+px,/, `every font-size carries a px floor: ${line.trim()}`);
  // 口径二：单行规则里的 font-size（`^\s*font-size:` 看不见它们）
  // .acct-tag 用相对 .8em（跟着父级字号缩放）—— 已知例外，单独钉住；它若改成 px 地板也接受
  assert.match(css, /\.acct-tag\s*\{[^}]*font-size:\s*(\.8em|max\(\s*\d+px)/, 'the one relative size stays a size, not a hole');
  const rest = css.replace(/\.acct-tag\s*\{[^}]*\}/g, '');
  const decls = [...rest.matchAll(/font-size\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(decls.length >= 10, `found the declarations: ${decls.length}`);
  for (const d of decls) assert.match(d, /^(max\(\s*\d+px\s*,|inherit$)/, `a px floor: ${d}`);
});

test('profile.css: 24px touch floors on the small keys, no !important / :has(), reduced motion honoured', () => {
  const css = read('public/css/screens/profile.css').replace(/\/\*[\s\S]*?\*\//g, '');
  /** 一条规则的整段（选择器按字面匹配，`.` 不当通配符） */
  const rule = (sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(`${esc}\\s*\\{[^}]*\\}`));
    assert.ok(m, `rule ${sel} exists`);
    return m[0];
  };
  /** min-height / min-width 的 px 地板（`max(.6rem, 40px)` 与裸 `24px` 都算） */
  const floor = (sel, prop) => {
    const m = rule(sel).match(new RegExp(`${prop}:\\s*(?:max\\([^,]+,)?\\s*(\\d+)px`));
    assert.ok(m, `${sel} has ${prop} with a px value`);
    return Number(m[1]);
  };
  // 个人条 40px、选择器关闭键 32px、面板按钮 24px —— 手机上都点得中
  assert.ok(floor('.me-chip', 'min-height') >= 24, 'the lobby chip is a 24px+ target');
  assert.ok(floor('.nc-pick__x', 'min-height') >= 24, 'the picker close key is a 24px+ target');
  assert.ok(floor('.nc-pick__x', 'min-width') >= 24);
  assert.ok(floor('.lacct__btns button', 'min-height') >= 24, 'the panel buttons are 24px+ targets');
  assert.ok(!/!important/.test(css), 'no !important');
  assert.ok(!/:has\(/.test(css), 'no :has()');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  // 选择器网格与图层：瓦片 35 / 9 与「底图不抢名字对比度」都靠这几条
  assert.match(css, /\.nc-pick__grid\s*\{[^}]*grid-template-columns: repeat\(auto-fill/s);
  assert.match(css, /\.nc-layer\s*\{[^}]*position: absolute/s);
  assert.match(css, /\.nc-layer img\s*\{[^}]*object-fit: cover/s);
  assert.match(css, /\.rseat__plate \.nc-layer\s*\{[^}]*opacity/s, 'the seat plate only gets a faint pattern');
});

test('every literal the panel shows exists in all four i18n packs', () => {
  const literals = ['个人资料', '名片', '选择名片'];
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    const dict = pack.strings || pack;
    for (const w of literals) assert.ok(Object.hasOwn(dict, w), `${lang} is missing ${w}`);
  }
});
