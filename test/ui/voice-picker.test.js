// test/ui/voice-picker.test.js — 每干员语音（public/js/voicePrefs.js + ui/voicePicker.js）。
//
// 数据模型：一条全局语言（默认日语）+ 一张按 charId 的覆盖表；选择器在桌面是原生 select、
// 手机（sp-coarse）是「整行按钮 → 底部弹出的大按钮列表」（44px 命中区）。纯视图 VoiceView 直接调，
// 不需要 DOM；覆盖表的读写与清洗走 voicePrefs.js 的纯函数。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const V = await import('../../public/js/voicePrefs.js');
const { VoiceView, voiceOptions } = await import('../../public/js/ui/voicePicker.js');

/** 收集 vnode 树里所有节点的 props（htm 产物是普通对象），便于按属性断言。 */
function collect(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) collect(n, out); return out; }
  if (node.props) out.push(node.props);
  const kids = node.props && node.props.children;
  if (kids != null) collect(kids, out);
  return out;
}
const tree = (v) => collect(v);
const hasClass = (props, cls) => String(props.class || '').split(/\s+/).includes(cls);

describe('voicePrefs', () => {
  test('VOICE_LANGS is the only vocabulary; the names are the two dubs', () => {
    assert.deepEqual([...V.VOICE_LANGS], ['cn', 'jp']);
    assert.equal(V.VOICE_LANG_NAMES.jp, '日本語');
    assert.equal(V.VOICE_LANG_NAMES.cn, '中文');
  });

  test('sanitizeVoiceOverrides keeps only real charIds and known languages, capped at 512', () => {
    assert.deepEqual(V.sanitizeVoiceOverrides({ char_102_texas: 'cn', char_263_skadi: 'jp' }), { char_102_texas: 'cn', char_263_skadi: 'jp' });
    assert.deepEqual(V.sanitizeVoiceOverrides({ char_102_texas: 'kr' }), {}, 'a language outside VOICE_LANGS');
    assert.deepEqual(V.sanitizeVoiceOverrides({ chess_char_102_texas: 'cn' }), {}, 'a chess id is not a charId');
    assert.deepEqual(V.sanitizeVoiceOverrides({ nope: 'cn', '': 'jp' }), {});
    assert.deepEqual(V.sanitizeVoiceOverrides(null), {});
    assert.deepEqual(V.sanitizeVoiceOverrides(['cn']), {}, 'an array is not a map');
    const many = {};
    for (let i = 0; i < 600; i++) many[`char_${100 + i}_op${i}`] = 'cn';
    assert.equal(Object.keys(V.sanitizeVoiceOverrides(many)).length, 512, 'the 512-entry cap');
  });

  test('voiceLangFor: the per-operator override wins, otherwise the global (non-jp normalises to cn)', () => {
    assert.equal(V.voiceLangFor('char_102_texas', 'jp', {}), 'jp');
    assert.equal(V.voiceLangFor('char_102_texas', 'cn', {}), 'cn');
    assert.equal(V.voiceLangFor('char_102_texas', 'jp', { char_102_texas: 'cn' }), 'cn');
    assert.equal(V.voiceLangFor('char_102_texas', 'cn', { char_102_texas: 'jp' }), 'jp');
    assert.equal(V.voiceLangFor('char_102_texas', 'jp', { char_263_skadi: 'cn' }), 'jp', 'another operator\'s entry');
    assert.equal(V.voiceLangFor('char_102_texas', 'weird', {}), 'cn', 'an unknown global normalises to cn');
    assert.equal(V.voiceLangFor('char_102_texas', 'jp', undefined), 'jp');
  });
});

describe('VoiceView', () => {
  const base = { charId: 'char_102_texas', globalLang: 'jp', own: '', effective: 'jp', coarse: false, open: false, onPick() {}, onOpen() {}, onClose() {} };

  test('desktop: a native select with 跟随全局 + both languages, the section names the charId', () => {
    const t = tree(VoiceView(base));
    assert.ok(t.some((p) => p['data-testid'] === 'voice-section' && p['data-voice-char'] === 'char_102_texas'));
    const sel = t.find((p) => p['data-voice-select'] !== undefined);
    assert.ok(sel, 'the select is there on a fine pointer');
    assert.equal(sel.value, '', 'no override ⇒ follow the global');
    assert.ok(!t.some((p) => p['data-voice-open'] !== undefined), 'no mobile pick button');
    const opts = tree(sel.children).filter((p) => 'value' in p && typeof p.children !== 'undefined');
    assert.equal(opts.length, 3, '跟随全局 + 中文 + 日本語');
    assert.deepEqual(opts.map((p) => p.value), ['', 'cn', 'jp']);
    assert.ok(t.some((p) => p['data-testid'] === 'voice-section'), 'the section header');
  });

  test('desktop: an existing override is the select\'s value and the header says so', () => {
    const t = tree(VoiceView({ ...base, own: 'cn', effective: 'cn' }));
    assert.equal(t.find((p) => p['data-voice-select'] !== undefined).value, 'cn');
    assert.ok(JSON.stringify(t).includes('此干员单独设置'));
  });

  test('mobile (sp-coarse): a whole-row button, no select; the sheet lists the options with 44px rows', () => {
    const closed = tree(VoiceView({ ...base, coarse: true }));
    assert.ok(!closed.some((p) => p['data-voice-select'] !== undefined), 'no native select on a coarse pointer');
    const btn = closed.find((p) => p['data-voice-open'] !== undefined);
    assert.ok(btn, 'the pick button');
    assert.ok(hasClass(btn, 'lo-voice__pick'), 'styled as the row button (min-height: var(--tap-min))');
    assert.equal(btn['aria-expanded'], 'false');
    assert.ok(!closed.some((p) => p['data-voice-sheet'] !== undefined), 'the sheet is closed');

    const open = tree(VoiceView({ ...base, coarse: true, open: true, own: 'jp', effective: 'jp' }));
    const sheet = open.find((p) => p['data-voice-sheet'] !== undefined);
    assert.ok(sheet, 'the bottom sheet');
    assert.equal(sheet['aria-modal'], 'true');
    const rows = open.filter((p) => typeof p['data-voice-opt'] === 'string');
    assert.deepEqual(rows.map((p) => p['data-voice-opt']), ['global', 'cn', 'jp']);
    assert.ok(rows.every((p) => hasClass(p, 'lo-sheet__opt')), 'every row is the sheet option (min-height: var(--tap-min))');
    assert.equal(rows.find((p) => p['data-voice-opt'] === 'jp')['aria-selected'], 'true', 'the current pick is marked');
    assert.equal(rows.find((p) => p['data-voice-opt'] === 'cn')['aria-selected'], 'false');
  });

  test('the effective language is shown next to the picker (the fallback is visible, not silent)', () => {
    const t = tree(VoiceView({ ...base, coarse: true, own: 'cn', effective: 'cn' }));
    assert.ok(JSON.stringify(t).includes('实际使用：中文'));
    const t2 = tree(VoiceView({ ...base, own: '', effective: 'jp' }));
    assert.ok(JSON.stringify(t2).includes('跟随全局（日本語）'), 'the follow-global option names the global language');
  });

  test('voiceOptions: the follow-global row names the global language', () => {
    assert.deepEqual(voiceOptions('jp').map((o) => o.value), ['', 'cn', 'jp']);
    assert.equal(voiceOptions('cn')[0].sub, '当前全局：中文');
    assert.equal(voiceOptions('jp')[0].sub, '当前全局：日本語');
  });

  test('no charId: nothing renders (a 自选 / PRESET record without one)', () => {
    assert.equal(VoiceView({ ...base, charId: '' }), null);
  });
});
