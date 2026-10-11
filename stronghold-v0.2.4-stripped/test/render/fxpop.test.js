// test/render/fxpop.test.js — user playtest #4 item 13 ("屏幕很偶尔的情况下会有个巨大的ui的一部分遮挡一两秒": once in a while a
// huge piece of UI covered the screen for a second or two). The first in-battle bond layer gain of each bond (b.ev
// 'layer' → render/app.js → FxSystem.pop) popped that bond's icon 46 times too big — ~5000 px, the whole screen, for
// the pop's 1.4 s. The icon is PIXI.Texture.from(url): a 1×1 placeholder until its image has loaded (then the real size
// and an 'update' event, Pixi 7.4), and pop() sized the sprite from the placeholder (46 / 1). Reproduced in headless
// Chrome (test/render/flash.browser.test.js); here against a fake PIXI with the same Texture semantics.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxSystem } from '../../public/js/render/fx.js';

class Emitter {
  constructor() { this._on = new Map(); }
  on(e, f, ctx) { if (!this._on.has(e)) this._on.set(e, []); this._on.get(e).push({ f, ctx, once: false }); return this; }
  once(e, f, ctx) { if (!this._on.has(e)) this._on.set(e, []); this._on.get(e).push({ f, ctx, once: true }); return this; }
  off(e, f) { const l = this._on.get(e); if (l) this._on.set(e, l.filter((x) => x.f !== f)); return this; }
  emit(e, ...a) { const l = this._on.get(e) || []; this._on.set(e, l.filter((x) => !x.once)); for (const x of l) x.f.apply(x.ctx, a); return true; }
}
/** Pixi 7.4 Texture of an image: 1×1 and invalid until its base texture has loaded, then its size + 'update'. */
class Tex extends Emitter {
  constructor(w, h, loaded = true) {
    super();
    this._size = [w, h];
    this.baseTexture = { valid: loaded, width: loaded ? w : 1, height: loaded ? h : 1 };
    this.orig = { width: loaded ? w : 1, height: loaded ? h : 1 };
    this.valid = loaded;
  }
  get width() { return this.orig.width; }
  get height() { return this.orig.height; }
  load() {
    [this.orig.width, this.orig.height] = this._size;
    Object.assign(this.baseTexture, { valid: true, width: this._size[0], height: this._size[1] });
    this.valid = true;
    this.emit('update', this);
  }
}
class Point { constructor(x = 1, y = x) { this.x = x; this.y = y; } set(x, y = x) { this.x = x; this.y = y; } }
class Sprite {
  constructor(tex) { this.texture = tex; this.visible = true; this.scale = new Point(1); this.anchor = new Point(0); this.position = new Point(0); this.tint = 0xffffff; this.destroyed = false; }
  destroy() { this.destroyed = true; }
}
class Container {
  constructor() { this.children = []; this.position = new Point(0); this.scale = new Point(1); this.alpha = 1; this.destroyed = false; }
  addChild(...c) { this.children.push(...c); return c[0]; }
  destroy() { this.destroyed = true; for (const c of this.children) c.destroy?.(); }
}
class BitmapText { constructor(text) { this.text = text; this.anchor = new Point(0); this.position = new Point(0); this.tint = 0xffffff; } destroy() {} }

function fx() {
  const f = Object.create(FxSystem.prototype);
  Object.assign(f, {
    P: { Sprite, Container, BitmapText, BLEND_MODES: { ADD: 1 } },
    tex: { glow: new Tex(64, 64) }, pops: [],
    ctx: { screenSize: () => ({ width: 1920, height: 1080 }), fieldTop: () => 200, layers: { screen: { addChild() {} } } },
  });
  return f;
}
/** Screen px of the icon sprite's longer side as drawn (0 while hidden). */
const drawn = (sp) => (sp.visible ? Math.max(sp.texture.width * Math.abs(sp.scale.x), sp.texture.height * Math.abs(sp.scale.y)) : 0);
const iconOf = (f, icon) => f.pops.at(-1).c.children.find((c) => c.texture === icon);

describe('FxSystem.pop: the bond icon is 46 px whenever its image loads (user playtest #4 item 13)', () => {
  test('an icon still loading is sized when it has loaded — never from its 1×1 placeholder', () => {
    const f = fx();
    const icon = new Tex(110, 98, false); // bond/yanShip.png
    f.pop(icon, '+2', 0xffffff, 0);
    const sp = iconOf(f, icon);
    assert.ok(drawn(sp) <= 46.5, `nothing big while loading (${drawn(sp)} px)`);
    icon.load();
    assert.ok(Math.abs(drawn(sp) - 46) < 0.5, `46 px once loaded (was 110 × 46 = 5060 px): ${drawn(sp)}`);
    f._updatePops(0.5);
    assert.ok(drawn(sp) * f.pops[0].c.scale.x < 60, 'with the pop\'s own scale-in');
  });

  test('an icon already loaded: 46 px along its longer side at once', () => {
    const f = fx();
    const icon = new Tex(102, 100);
    f.pop(icon, '+1', 0xffffff, 1);
    assert.ok(Math.abs(drawn(iconOf(f, icon)) - 46) < 0.5);
  });

  test('a pop that ended before its image loaded stays gone', () => {
    const f = fx();
    const icon = new Tex(110, 98, false);
    f.pop(icon, '+3', 0xffffff, 0);
    const sp = iconOf(f, icon);
    f._updatePops(2);
    assert.equal(f.pops.length, 0);
    assert.doesNotThrow(() => icon.load());
    assert.ok(sp.destroyed);
  });
});
