// test/ui/settings-update.test.js — the settings modal renders at all, plus the room invite link
// (docs/START-MODES-PLAN.md).
//
// The modal is a hook component, so it cannot be called as a function the way test/ui/playtest3.test.js drives
// ChessDetail - it is rendered through preact into a minimal element stub instead. That render is the point: the
// section is an htm template, and only evaluating it proves the tags close and the hooks are used legally.
//
// The file used to guard the 版本与更新 section (the update button that handed /api/app/patch.zip to the Android
// host). That section no longer exists in public/js/ui/settings.js — the hot-update entry point lives on the native
// side only (MainActivity.kt AndroidBridge.downloadAndApplyPatch), and the server endpoint it called is still covered
// by test/app-api.test.js. The structural assertions here were therefore retired rather than left red; what replaced
// them is the guard the 画面质量 tiers need: the five labels must really reach the rendered dialog (a broken template
// or a sanitizer that drops 超清 / 极致 shows up here and nowhere else).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

/** The smallest element the settings modal's own code and preact's DOM diff touch. */
class El {
  constructor(tag) {
    this.tag = tag; this.children = []; this.props = {}; this.listeners = {}; this._text = '';
    this.dataset = {}; this.classList = { add() {}, remove() {}, contains: () => false, toggle: () => false };
    // a CSSStyleDeclaration enough for the module-level effects: ui/screenFit.js applyFit() runs at import time and
    // calls setProperty / removeProperty on <html>'s style (a bare {} threw "el.style.removeProperty is not a
    // function" and took every test in this file down with it).
    this.style = {
      setProperty(k, v) { this[k] = String(v); },
      removeProperty(k) { delete this[k]; },
      getPropertyValue(k) { return this[k] ?? ''; },
    };
  }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); c.parentNode = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.props[k] = v; } removeAttribute(k) { delete this.props[k]; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); } removeEventListener() {}
  get firstChild() { return this.children[0] || null; }
  get textContent() { return this._text + this.children.map((c) => c.textContent ?? '').join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this.children.map((c) => c.outerHTML ?? '').join(''); }
  get outerHTML() { return this.children.length ? this.innerHTML : String(this._text ?? ''); }
  get nodeType() { return 1; }
  querySelector() { return null; } querySelectorAll() { return []; } closest() { return null; } matches() { return false; }
  contains() { return false; } hasChildNodes() { return this.children.length > 0; } cloneNode() { return new El(this.tag); }
  focus() {} blur() {} scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
}

/** Install the stub as the page's DOM for one render. Returns the host element. */
async function renderSettings() {
  const had = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch, location: globalThis.location };
  const documentStub = {
    createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t),
    createTextNode: (s) => { const e = new El('#text'); e._text = String(s); return e; },
    body: new El('body'), documentElement: new El('html'),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  };
  globalThis.document = documentStub;
  globalThis.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  // 裸 `location`（modManagerModal.js 的 useState 初始化读它）在 Node 里不存在。
  globalThis.location = { origin: 'http://127.0.0.1:3000', pathname: '/', hostname: '127.0.0.1', href: 'http://127.0.0.1:3000/' };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  try {
    const preact = await import('../../public/vendor/preact.module.js');
    const { html } = await import('../../public/js/ui/components.js');
    const { SettingsModal } = await import('../../public/js/ui/settings.js');
    const host = new El('div');
    preact.render(html`<${SettingsModal} open=${true} onClose=${() => {}} />`, host);
    // The modal's effects (useEffect) call back into document and setState, which re-renders. Preact flushes effects
    // in `afterNextFrame` — a requestAnimationFrame, or a 100 ms timer where there is none (Node) — so a couple of
    // microtask turns is not enough: restoring the stubs first left that late re-render reading an undefined
    // `document`, and node:test reported it as an unhandledRejection (exit code 1 even with every test passing).
    await new Promise((r) => setTimeout(r, 250));
    return host;
  } finally {
    globalThis.document = had.document; globalThis.window = had.window; globalThis.fetch = had.fetch; globalThis.location = had.location;
  }
}

describe('the settings modal', () => {
  test('it renders (the htm template closes and the hooks are legal)', async () => {
    const host = await renderSettings();
    const text = host.textContent;
    assert.ok(text.length > 0, 'the modal rendered something');
    // 这一段只断言「渲染成功且关键区块都在」：模组仓库 / 版本与更新 之类的区块各自有专门的守卫。
    for (const s of ['设置', '画面质量', '机型兼容', '文字大小', '快捷键']) assert.ok(text.includes(s), `mentions ${s}`);
  });

  test('the five 画面质量 tiers reach the buttons (低 / 中 / 高 / 超清 / 极致)', async () => {
    const host = await renderSettings();
    const text = host.textContent;
    // 设置框能渲染 = 加档之后最重要的一道守卫：模板坏了、或 sanitizeSettings 把新档丢掉，这里就红。
    for (const label of ['低', '中', '高', '超清', '极致']) assert.ok(text.includes(label), `the ${label} button renders`);
    // 结构面（这个仓库对设置界面的既有手法）：五档 id 与显示顺序在源里一致，且三档以外没有残留的硬编码白名单。
    const src = read('public/js/ui/settings.js');
    assert.match(src, /const QUALITY = \[\['low', N_\('低'\)\], \['medium', N_\('中'\)\], \['high', N_\('高'\)\], \['ultra', N_\('超清'\)\], \['extreme', N_\('极致'\)\]\];/);
    assert.match(src, /aria-label=\$\{t\('画面质量'\)\}/, 'the tier group is a labelled radiogroup');
  });

  test('the sanitizer keeps the new tiers and the dialog can show them', () => {
    const logic = read('public/js/ui/gameLogic/settings.js');
    assert.match(logic, /const QUALITIES = \['high', 'medium', 'low', 'ultra', 'extreme'\];/);
    assert.match(logic, /quality: QUALITIES\.includes\(r\.quality\) \? r\.quality : DEFAULT_SETTINGS\.quality/);
    // 「只加表」陷阱的另一半：档位表在 render/app/host.js，且必须带超采样与机型 cap 乘子，否则新档等于 高。
    const host = read('public/js/render/app/host.js');
    assert.match(host, /const QUALITY_IDS = Object\.freeze\(\['low', 'medium', 'high', 'ultra', 'extreme'\]\)/);
    assert.match(host, /const TIER_SS = \{ low: 1, medium: 1, high: 1, ultra: 1\.25, extreme: 1\.5 \}/);
    assert.match(host, /const TIER_CAP_MUL = \{ low: 1, medium: 1, high: 1, ultra: 1\.5, extreme: 2 \}/);
    assert.match(host, /function tierPixelRatio\(/, 'the ratio formula lives in host.js');
  });

  test('the ratio formula: the three old tiers are unchanged, 超清 / 极致 really exceed the device DPR', async () => {
    const { tierPixelRatio, qualityAtLeast, QUALITY_RES, BOARD_RES } = await import('../../public/js/render/app/host.js');
    const had = globalThis.devicePixelRatio;
    const at = (q, dpr, cap, table) => {
      globalThis.devicePixelRatio = dpr;
      return tierPixelRatio(q, 1920, 1080, cap, table);
    };
    try {
      // 老的三档逐位等于今天的 min(devicePixelRatio, 表, 机型 cap)：加档不能改变老用户看到的画面
      for (const [q, want] of [['low', 1], ['medium', 2], ['high', 2]]) {
        assert.equal(at(q, 2, 2), want, `${q} at DPR 2 / cap 2`);
        assert.equal(at(q, 1, 2), Math.min(1, QUALITY_RES[q]), `${q} at DPR 1`);
      }
      assert.equal(at('medium', 3, 1.25), 1.25, 'an 小米 Dimensity cap still binds a low tier');
      // 超清 / 极致（审计 §2.6 的验收值）：DPR 2 桌面上 high 2 → ultra 2.5 → extreme 3
      assert.equal(at('high', 2, 2), 2);
      assert.equal(at('ultra', 2, 2), 2.5, 'ultra = min(2 × 1.25, 3.5, 2 × 1.5)');
      assert.equal(at('extreme', 2, 2), 3, 'extreme = min(2 × 1.5, 4.5, 2 × 2)');
      // 机型 cap 乘子：小米天玑（cap 1.25）上 ultra 停在 1.875、extreme 停在 2.5 —— 放开但不失控
      assert.equal(at('ultra', 3, 1.25), 1.875, 'ultra = min(3 × 1.25, 3.5, 1.25 × 1.5)');
      assert.equal(at('extreme', 3, 1.25), 2.5, 'extreme = min(3 × 1.5, 4.5, 1.25 × 2)');
      // 荣耀旧内核（cap 1）也不会因为选极致就黑屏：仍有 GPU/表的上限夹着
      assert.equal(at('extreme', 2, 1), 2);
      // 3D 棋盘用同一套乘子，只是表不同
      assert.equal(at('ultra', 2, 2, BOARD_RES), 2.5);
      assert.equal(at('extreme', 2, 2, BOARD_RES), 3);
      // 未知值按 高 处理（与 sanitizeSettings 的回落一致），并且永远 ≥ 1
      assert.equal(tierPixelRatio('nope', 800, 600, 2), 2);
      assert.ok(tierPixelRatio('low', 3840, 2160, 0.5) >= 1);
    } finally {
      if (had === undefined) delete globalThis.devicePixelRatio; else globalThis.devicePixelRatio = had;
    }
    // 档位阶梯：只有 超清 / 极致 算「高及以上」（pickClipping 与 :274 的 MSAA 条件用它）
    assert.equal(qualityAtLeast('high', 'high'), true);
    assert.equal(qualityAtLeast('ultra', 'high'), true);
    assert.equal(qualityAtLeast('extreme', 'high'), true);
    assert.equal(qualityAtLeast('medium', 'high'), false);
    assert.equal(qualityAtLeast('low', 'high'), false);
    assert.equal(qualityAtLeast('junk', 'high'), true, 'an unknown value behaves as 高');
  });
});

describe('the room invite link', () => {
  test('it is the current page URL plus ?room=<code>', async () => {
    // 这一条以前断言「APK 内用本机局域网地址而不是 127.0.0.1」，靠 globalThis.AndroidNative.getLocalIp() 实现。
    // getLocalIp 现在在 web 侧和 Kotlin 侧都不存在了（全仓 grep 无命中），那条分支已随发行形态一起下线：
    // 邀请链接回到 ui/screens/room.js inviteLink()，就是「当前页面的 origin + pathname + ?room=」。
    // 变化前这条一直是红的（文件在 import screenFit 时就崩），所以谁的实现也没被它守过。
    const { inviteLink } = await import('../../public/js/screens/room.js');
    const had = globalThis.location;
    try {
      globalThis.location = { origin: 'http://192.168.1.7:3000', pathname: '/' };
      assert.equal(inviteLink('ABCD'), 'http://192.168.1.7:3000/?room=ABCD');
      globalThis.location = { origin: 'http://100.100.5.5:3000', pathname: '/lobby' };
      assert.equal(inviteLink('WXYZ'), 'http://100.100.5.5:3000/lobby?room=WXYZ', 'the path it is called from survives');
      assert.equal(inviteLink('A B'), 'http://100.100.5.5:3000/lobby?room=A%20B', 'the code is URL-encoded');
      // no location at all (a unit test / a headless host) must not throw
      globalThis.location = undefined;
      assert.equal(inviteLink('ABCD'), '?room=ABCD');
    } finally {
      globalThis.location = had;
    }
  });
});
