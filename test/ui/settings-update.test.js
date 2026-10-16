// test/ui/settings-update.test.js — the settings modal's 版本与更新 section and the native invite link
// (docs/START-MODES-PLAN.md): the update button that hands /api/app/patch.zip to the Android host, and the room
// invite link that must NOT be http://127.0.0.1:3000 inside the APK.
//
// The modal is a hook component, so it cannot be called as a function the way test/ui/playtest3.test.js drives
// ChessDetail - it is rendered through preact into a minimal element stub instead. That render is the point: the
// section is an htm template, and only evaluating it proves the tags close and the hooks are used legally.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

/** The smallest element the settings modal's own code and preact's DOM diff touch. */
class El {
  constructor(tag) {
    this.tag = tag; this.children = []; this.props = {}; this.style = {}; this.listeners = {}; this._text = '';
    this.dataset = {}; this.classList = { add() {}, remove() {}, contains: () => false, toggle: () => false };
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
    return host;
  } finally {
    globalThis.document = had.document; globalThis.window = had.window; globalThis.fetch = had.fetch; globalThis.location = had.location;
  }
}

describe('the 版本与更新 section', () => {
  test('the settings modal renders it (the htm template closes and the hooks are legal)', async () => {
    const host = await renderSettings();
    const text = host.textContent;
    assert.ok(text.length > 0, 'the modal rendered something');
    for (const s of ['版本与更新', '检测更新', '模组仓库', '设置']) assert.ok(text.includes(s), `mentions ${s}`);
  });

  test('it asks the server-side app api and hands the patch to the native host', () => {
    // 结构断言（这个仓库对设置界面的既有手法）：按钮必须真的问 /api/app/version，并把 patchUrl 交给原生桥。
    const src = read('public/js/ui/settings.js');
    assert.match(src, /fetch\('\/api\/app\/version'/);
    assert.match(src, /AndroidNative\?\.downloadAndApplyPatch/);
    assert.match(src, /__onHotUpdateProgress/);
    assert.match(src, /__onHotUpdateResult/);
    assert.match(src, /import \{ fetchBuild \} from '\.\/buildGuard\.js'/, 'the page build it compares against comes from buildGuard');
  });
});

describe('the room invite link', () => {
  test('inside the APK it names this machine on the LAN, not 127.0.0.1', async () => {
    const { inviteLink } = await import('../../public/js/screens/room.js');
    const had = globalThis.AndroidNative;
    try {
      globalThis.AndroidNative = { getLocalIp: () => '192.168.1.7' };
      assert.equal(inviteLink('ABCD'), 'http://192.168.1.7:3000/?room=ABCD');
      globalThis.AndroidNative = { getLocalIp: () => '100.100.5.5' };
      assert.equal(inviteLink('WXYZ'), 'http://100.100.5.5:3000/?room=WXYZ', 'a Tailscale/UU address works too');
      globalThis.AndroidNative = { getLocalIp: () => '127.0.0.1' };
      assert.match(inviteLink('ABCD'), /\?room=ABCD$/, 'loopback is no better than location.origin, fall back');
      globalThis.AndroidNative = undefined;
      assert.match(inviteLink('ABCD'), /\?room=ABCD$/);
    } finally {
      if (had === undefined) delete globalThis.AndroidNative; else globalThis.AndroidNative = had;
    }
  });
});
