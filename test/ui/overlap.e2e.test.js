// Phone-only layout-overlap E2E. OFF by default: it never runs in a normal `node --test` or in CI.
//
//   SP_MOBILE_E2E=1 node --test test/ui/overlap.e2e.test.js
//   SP_MOBILE_E2E=1 SP_MOBILE_DEVICES=vivo-2376 node --test test/ui/overlap.e2e.test.js
//   Windows (Edge is enough — the repo already depends on puppeteer-core):
//     SP_MOBILE_E2E=1 CHROME_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" node --test test/ui/overlap.e2e.test.js
//
// These are the four collisions found by hand on a real phone (2376x1080, Android 16, WebView 153). They are pure
// geometry, so no state assertion catches them. This file is deliberately phone-only and deliberately off by default:
// the thresholds describe the mobile breakpoints (public/css/devices.css and the @media rules in screens/game.css),
// so running it while tuning the desktop layout would only produce false alarms. A device is skipped outright unless
// the page really is in touch layout (html.sp-touch / html.sp-coarse) — that gate is what keeps desktop work clear.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');

const DEFAULT_CHROME = process.platform === 'win32'
  ? ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
     'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
     'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
     `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`].find((p) => p && existsSync(p))
  : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME = process.env.CHROME_PATH || DEFAULT_CHROME;

// Phone-only: a separate switch from SP_E2E / SP_REAL_E2E so desktop runs never pick this up.
const ENABLED = process.env.SP_MOBILE_E2E === '1' && !!CHROME && existsSync(CHROME);
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

// minSlot / minBadge are CSS-px floors for the phone breakpoints only; TOL allows two boxes to touch (shared border,
// sub-pixel rounding) without overlapping.
const TOL = Number(process.env.SP_OVERLAP_TOL || 4);
const ALL_DEVICES = {
  'vivo-v2520a': { viewport: { width: 761, height: 360, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: ANDROID_UA, minSlot: 16 },
  'vivo-2376': { viewport: { width: 2376, height: 1080, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: ANDROID_UA, minSlot: 20 },
  'pixel7': { viewport: { width: 915, height: 412, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: ANDROID_UA, minSlot: 18 },
  'phone-min': { viewport: { width: 640, height: 360, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: ANDROID_UA, minSlot: 16 },
};
const DEVICES = Object.fromEntries(
  (process.env.SP_MOBILE_DEVICES || Object.keys(ALL_DEVICES).join(','))
    .split(',').map((s) => s.trim()).filter((k) => ALL_DEVICES[k]).map((k) => [k, ALL_DEVICES[k]]),
);

const overlapArea = (a, b) => {
  if (!a || !b) return 0;
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
};

describe('phone layout overlaps (briefing stage line, bond badges, bond strip, shop price)', { skip: !ENABLED && 'phone-only: set SP_MOBILE_E2E=1 (and CHROME_PATH) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
  });

  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  /**
   * Open the in-match mock on a phone viewport. Returns null (not a failure) when the page did not land in touch
   * layout — that is the phone-only gate: desktop CSS must never be judged by these thresholds.
   */
  async function openPhoneMock(dev, query) {
    const d = DEVICES[dev];
    const page = await browser.newPage();
    await page.emulate({ viewport: d.viewport, userAgent: d.userAgent });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&${query}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.screen:not(.gload)'), { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1600));
    const cls = await page.evaluate(() => document.documentElement.className);
    if (!/\bsp-touch\b/.test(cls) || !/\bsp-coarse\b/.test(cls)) {
      await page.close();
      return null; // not in phone layout — skip this device instead of failing on desktop rules
    }
    return { page, problems };
  }

  async function rects(page, sels) {
    return page.evaluate((list) => {
      const out = {};
      for (const s of list) {
        const el = document.querySelector(s);
        if (!el) { out[s] = null; continue; }
        const r = el.getBoundingClientRect();
        out[s] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
      }
      return out;
    }, sels);
  }

  async function hitSelf(page, sel) {
    return page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return 'missing';
      const r = el.getBoundingClientRect();
      if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return 'offscreen';
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit) return 'no-hit';
      return el.contains(hit) ? 'ok' : `covered-by:${hit.className || hit.tagName}`;
    }, sel);
  }

  for (const dev of Object.keys(DEVICES)) {
    test(`${dev}: briefing — the stage pool label never paints over the stage name`, async (t) => {
      // Use the real longest stage from data/stages.json (max by [...name].length)
      const stagesRaw = JSON.parse(readFileSync(path.join(ROOT, 'data', 'stages.json'), 'utf8'));
      const stageList = Array.isArray(stagesRaw) ? stagesRaw : Object.values(stagesRaw);
      const longest = stageList.slice().sort((a, b) => [...(b.name || '')].length - [...(a.name || '')].length)[0];
      const longestId = longest?.stageId || longest?.id || 'act1autochess_m05';

      const h = await openPhoneMock(dev, `phase=INFO_CHECK&stage=${longestId}`);
      if (!h) return t.skip('not in touch layout');
      const { page, problems } = h;

      // Verify the longest stage name is really loaded on page
      const renderedName = await page.$eval('.brief-stage__name', (el) => el.textContent.trim());
      assert.ok(renderedName.includes(longest.name), `briefing must test with longest stage name "${longest.name}", got "${renderedName}"`);

      const r = await rects(page, ['.brief-stage', '.brief-stage__pool', '.brief-stage__name']);
      await page.screenshot({ path: path.join(OUT, `overlap-${dev}-briefing.png`) });

      if (r['.brief-stage__pool'] && r['.brief-stage__pool'].w > 0) {
        const area = overlapArea(r['.brief-stage__pool'], r['.brief-stage__name']);
        assert.ok(area <= TOL, `.brief-stage__pool overlaps .brief-stage__name by ${area.toFixed(1)}px^2 (briefing.css:61-64 — nowrap pool with no min-width:0)`);
        assert.ok(r['.brief-stage__pool'].right <= r['.brief-stage'].right + 1, 'the pool label escapes the .brief-stage box');
      }

      // Typography floors in briefing
      const typo = await page.evaluate(() => {
        const out = [];
        const poolEl = document.querySelector('.brief-stage__pool');
        const nameEl = document.querySelector('.brief-stage__name');
        if (poolEl) {
          const px = parseFloat(getComputedStyle(poolEl).fontSize);
          if (px < 10) out.push(`pool font-size ${px.toFixed(1)}px < 10px`);
        }
        if (nameEl) {
          const px = parseFloat(getComputedStyle(nameEl).fontSize);
          if (px < 13) out.push(`name font-size ${px.toFixed(1)}px < 13px`);
        }
        for (const ban of document.querySelectorAll('.brief-bond__ban')) {
          const cs = getComputedStyle(ban);
          const px = parseFloat(cs.fontSize);
          const w = parseFloat(cs.width);
          if (px < 10) out.push(`ban font-size ${px.toFixed(1)}px < 10px`);
          if (w < 18) out.push(`ban width ${w.toFixed(1)}px < 18px`);
        }
        return out;
      });
      assert.deepEqual(typo, [], `${dev} briefing typography floors`);

      // Phone contract (user report 2026-10-04): the count sits ON the disc's top-right corner — an overlap with the
      // disc is now expected. What must never happen is covering the disc's centre (the emblem becomes unreadable) or
      // lifting out of the row onto the 核心盟约 / CORE BONDS heading above it, which is what the old -16px offset did.
      const bans = await page.$$eval('.brief-bond__ban', (els) => els.map((e) => {
        const g = (x) => x ? { left: x.left, top: x.top, right: x.right, bottom: x.bottom } : null;
        const b = e.getBoundingClientRect();
        const disc = e.closest('.brief-bond')?.querySelector('.bond__core')?.getBoundingClientRect();
        const row = e.closest('.brief-bonds__row')?.getBoundingClientRect();
        const panel = e.closest('.brief-bonds')?.getBoundingClientRect();
        return { ban: g(b), disc: g(disc), row: g(row), panel: g(panel) };
      }));
      for (const [i, x] of bans.entries()) {
        if (x.disc) {
          const cx = (x.disc.left + x.disc.right) / 2, cy = (x.disc.top + x.disc.bottom) / 2;
          assert.ok(!(cx > x.ban.left && cx < x.ban.right && cy > x.ban.top && cy < x.ban.bottom),
            `ban badge #${i} covers the bond disc's centre — it must sit on the corner only`);
        }
        // The heading sits above .brief-bonds' own padding, so staying inside the panel is what proves the badge did
        // not lift onto it — a few px of overhang past the row is intended (it clears the disc's centre).
        if (x.panel) assert.ok(x.ban.top >= x.panel.top - 1 && x.ban.left >= x.panel.left - 1, `ban badge #${i} is clipped by .brief-bonds padding (negative offsets)`);
      }
      if (bans.length) assert.equal(await hitSelf(page, '.brief-bond__ban'), 'ok', 'the first ban badge is not hittable (covered or clipped)');

      // Same label-collision rule as the in-game strip: .brief-bond is sized by its name, and the ban badge keeps the
      // disc's corner instead of the cell's right edge.
      const cells = await page.evaluate(() => [...document.querySelectorAll('.brief-bond')].map((c) => {
        const r = (sel) => c.querySelector(sel)?.getBoundingClientRect();
        const name = r('.bond__name'), disc = r('.bond__disc'), ban = r('.brief-bond__ban');
        return { text: c.querySelector('.bond__name')?.textContent.trim() || '', left: name?.left ?? 0, right: name?.right ?? 0, top: name?.top ?? 0,
          discRight: disc?.right ?? null, banRight: ban?.right ?? null };
      }));
      const cellCollide = [];
      for (let i = 1; i < cells.length; i++) {
        const a = cells[i - 1], b = cells[i];
        if (Math.abs(a.top - b.top) > 2) continue;
        const over = a.right - b.left;
        if (over > 0) cellCollide.push(`"${a.text}" / "${b.text}" overlap by ${over.toFixed(1)}px`);
      }
      assert.deepEqual(cellCollide, [], `${dev} briefing bond labels collide — .brief-bond must be sized by its name`);
      const banOff = cells.filter((c) => c.banRight != null && c.discRight != null)
        .map((c) => +(c.banRight - c.discRight).toFixed(1))
        .filter((d) => !(d >= -2 && d <= 6));
      assert.deepEqual(banOff, [], `${dev} .brief-bond__ban walked off the disc's corner (badge − disc right edge must stay in −2..6px)`);
      assert.deepEqual(problems, [], `${dev} briefing page errors`);
      await page.close();
    });

    test(`${dev}: prep — the bond strip stays legible and centred`, async (t) => {
      const h = await openPhoneMock(dev, 'phase=PREP');
      if (!h) return t.skip('not in touch layout');
      const { page, problems } = h;
      const slots = await page.$$eval('.gm__bonds .bslot', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, right: r.right }; }));
      const host = await page.$eval('.gm__bonds', (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, w: r.width, vw: window.innerWidth }; });
      await page.screenshot({ path: path.join(OUT, `overlap-${dev}-bstrip.png`) });

      if (slots.length) {
        const min = Math.min(...slots.map((s) => Math.min(s.w, s.h)));
        assert.ok(min >= DEVICES[dev].minSlot, `.bslot shrinks to ${min.toFixed(1)}px on ${dev} — phone floor is ${DEVICES[dev].minSlot}px (game.css .bslot{min-width:max(.74rem,27px)})`);
        const group = { left: Math.min(...slots.map((s) => s.left)), right: Math.max(...slots.map((s) => s.right)) };
        // Measured against the VIEWPORT, not the host box: .gm__bonds used to carry asymmetric insets
        // (left 1.56rem / right 5.2rem), so a strip perfectly centred inside it still read as off-centre
        // on screen by ~1.8rem, and centring-in-host could never notice.
        const drift = Math.abs((group.left + group.right) / 2 - host.vw / 2);
        assert.ok(drift <= Math.max(4, host.vw * 0.02), `bond strip centre is ${drift.toFixed(1)}px from the viewport centre on ${dev} (>2%) — .gm__bonds insets must stay symmetric`);

        // Check bond dimensions & typography floor: --disc >= 21px, name font >= 10px, slot width >= 27px
        const bondMetrics = await page.evaluate(() => {
          const out = [];
          const slot = document.querySelector('.gm__bonds .bslot');
          if (slot) {
            const r = slot.getBoundingClientRect();
            if (r.width < 27) out.push(`slot width ${r.width.toFixed(1)}px < 27px`);
            const nameEl = slot.querySelector('.bond__name');
            if (nameEl) {
              const px = parseFloat(getComputedStyle(nameEl).fontSize);
              if (px < 10) out.push(`bond__name font-size ${px.toFixed(1)}px < 10px`);
            }
            const discEl = slot.querySelector('.bond__core') || slot.querySelector('.bond__disc');
            if (discEl) {
              const rDisc = discEl.getBoundingClientRect();
              if (rDisc.width < 20) out.push(`bond disc width ${rDisc.width.toFixed(1)}px < 21px`);
            }
          }
          return out;
        });
        assert.deepEqual(bondMetrics, [], `${dev} bond strip dimensions and typography`);

        // User report 2026-10-04: names run to 4 CJK glyphs (~44 px at the 11 px phone floor) while .bslot was a fixed
        // 27 px box, so every label spilled into its neighbour's and the strip read as overlapping text. Adjacent
        // labels on the same row must have clear space, and the counter still has to sit on its disc's corner now that
        // the slot grows with the label.
        const labels = await page.evaluate(() => [...document.querySelectorAll('.gm__bonds .bslot')].map((s) => {
          const r = (sel) => s.querySelector(sel)?.getBoundingClientRect();
          const name = r('.bond__name'), disc = r('.bond__disc'), badge = r('.bslot__count');
          return { text: s.querySelector('.bond__name')?.textContent.trim() || '', left: name?.left ?? 0, right: name?.right ?? 0, top: name?.top ?? 0,
            discRight: disc?.right ?? null, badgeRight: badge?.right ?? null };
        }));
        const collide = [];
        for (let i = 1; i < labels.length; i++) {
          const a = labels[i - 1], b = labels[i];
          if (Math.abs(a.top - b.top) > 2) continue; // wrapped onto a second row
          const over = a.right - b.left;
          if (over > 0) collide.push(`"${a.text}" / "${b.text}" overlap by ${over.toFixed(1)}px`);
        }
        assert.deepEqual(collide, [], `${dev} bond labels collide — .bslot must be sized by its label (game.css .bslot{min-width})`);
        const offCorner = labels.filter((l) => l.badgeRight != null && l.discRight != null)
          .map((l) => +(l.badgeRight - l.discRight).toFixed(1))
          .filter((d) => !(d >= -2 && d <= 6));
        assert.deepEqual(offCorner, [], `${dev} .bslot__count walked off the disc's corner (badge right edge − disc right edge must stay in −2..6px)`);
      }
      assert.deepEqual(problems, [], `${dev} prep page errors`);
      await page.close();
    });

    test(`${dev}: prep — the shop price hexagon never collides with pips, skill or the card edge`, async (t) => {
      const h = await openPhoneMock(dev, 'phase=PREP');
      if (!h) return t.skip('not in touch layout');
      const { page, problems } = h;
      const cards = await page.$$eval('.shopbar__cards .scard', (els) => els.slice(0, 6).map((e) => {
        const g = (s) => { const x = (s === '.scard' ? e : e.querySelector(s))?.getBoundingClientRect(); return x ? { left: x.left, top: x.top, right: x.right, bottom: x.bottom } : null; };
        return { card: g('.scard'), price: g('.scard__price'), pips: g('.scard__pips'), skill: g('.scard__skill'), free: g('.scard__free') };
      }));
      await page.screenshot({ path: path.join(OUT, `overlap-${dev}-shop.png`) });

      for (const [i, c] of cards.entries()) {
        if (!c.price) continue;
        for (const [k, other] of [['pips', c.pips], ['skill', c.skill], ['free', c.free]]) {
          const area = overlapArea(c.price, other);
          assert.ok(area <= TOL, `card #${i}: .scard__price overlaps .scard__${k} by ${area.toFixed(1)}px^2 (game-shop.css:106-107 — the price is both a flex child and absolutely centred)`);
        }
        assert.ok(c.price.left >= c.card.left - 1 && c.price.right <= c.card.right + 1 && c.price.top >= c.card.top - 1,
          `card #${i}: .scard__price escapes the card frame (top:0 bites the border)`);
      }
      assert.deepEqual(problems, [], `${dev} shop page errors`);
      await page.close();
    });

    test(`${dev}: phone typography floors and no text overflow (reward)`, async (t) => {
      const h = await openPhoneMock(dev, 'phase=PREP&variant=reward');
      if (!h) return t.skip('not in touch layout');
      const { page, problems } = h;
      const bad = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.shopbar__reward *')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || !el.textContent.trim()) continue;
          if (el.children.length) continue;                       // leaves only
          const px = parseFloat(cs.fontSize);
          const b = el.getBoundingClientRect(), p = el.parentElement?.getBoundingClientRect();
          if (px < 8) out.push(`small ${px.toFixed(1)}px: ${el.className} "${el.textContent.trim().slice(0, 10)}"`);
          if (p && (b.right > p.right + 1.5 || b.bottom > p.bottom + 1.5)) out.push(`overflow: ${el.className} "${el.textContent.trim().slice(0, 10)}"`);
          if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis') out.push(`clipped: ${el.className}`);
        }
        return out;
      });
      assert.deepEqual(bad, [], `${dev} reward typography`);
      // Also verify that .shopbar__reward does not overlap .lvcard
      const r = await rects(page, ['.shopbar__reward', '.lvcard']);
      if (r['.shopbar__reward'] && r['.lvcard']) {
        const collision = overlapArea(r['.shopbar__reward'], r['.lvcard']);
        assert.ok(collision <= TOL, `.shopbar__reward overlaps .lvcard by ${collision.toFixed(1)}px^2`);
      }
      assert.deepEqual(problems, [], `${dev} reward typography errors`);
      await page.close();
    });

    test(`${dev}: detail panel — 8 stats without ellipsis and no collision with bond strip`, async (t) => {
      const h = await openPhoneMock(dev, 'phase=PREP&variant=detail');
      if (!h) return t.skip('not in touch layout');
      const { page, problems } = h;
      await page.waitForSelector('.dpanel', { timeout: 8000 });
      // Typography floors & overflow inside dpanel
      const bad = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.dpanel *')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || !el.textContent.trim()) continue;
          if (el.children.length) continue;
          const px = parseFloat(cs.fontSize);
          const b = el.getBoundingClientRect(), p = el.parentElement?.getBoundingClientRect();
          if (px < 8) out.push(`small ${px.toFixed(1)}px: ${el.className} "${el.textContent.trim().slice(0, 10)}"`);
          if (p && (b.right > p.right + 1.5 || b.bottom > p.bottom + 1.5)) out.push(`overflow: ${el.className} "${el.textContent.trim().slice(0, 10)}"`);
          if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis') out.push(`clipped: ${el.className}`);
        }
        return out;
      });
      assert.deepEqual(bad, [], `${dev} detail panel typography`);

      // Check that none of the 8 stats has ellipsis (...)
      const statLabels = await page.$$eval('.dpanel .dstat__k', (els) => els.map((e) => ({
        text: e.textContent.trim(),
        hasEllipsis: e.scrollWidth > e.clientWidth + 1 || e.textContent.includes('…')
      })));
      for (const st of statLabels) {
        assert.equal(st.hasEllipsis, false, `stat label "${st.text}" is truncated with ellipsis`);
      }
      // Check that .dpanel does not overlap .gm__bonds
      const dpanelBox = await page.$eval('.dpanel', (e) => {
        const b = e.getBoundingClientRect();
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      });
      const bondsBox = await page.$eval('.gm__bonds', (e) => {
        const b = e.getBoundingClientRect();
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      });
      const collision = overlapArea(dpanelBox, bondsBox);
      assert.ok(collision <= TOL, `.dpanel overlaps .gm__bonds by ${collision.toFixed(1)}px^2`);

      // Test click empty field closes the panel (x: 450, y: 160 is empty ground on the board)
      await page.mouse.click(450, 160);
      await new Promise((r) => setTimeout(r, 200));
      const closed = await page.$('.dpanel');
      assert.equal(closed, null, '.dpanel should close after tapping empty field area');

      assert.deepEqual(problems, [], `${dev} detail panel page errors`);
      await page.close();
    });

    test(`${dev}: deploy operator does not trigger voice_missing_ in audio.warned`, async (t) => {
      const h = await openPhoneMock(dev, 'phase=PREP');
      if (!h) return t.skip('not in touch layout');
      const { page, problems } = h;
      await page.waitForSelector('.screen:not(.gload)', { timeout: 8000 });

      // Find an operator piece in hand
      const pieceUid = await page.evaluate(() => {
        const p = globalThis.__SP__?.store?.get()?.match?.private;
        const hc = (p?.hand || []).find((x) => x && x.kind === 'chess');
        return hc?.uid ?? null;
      });
      assert.ok(pieceUid != null, 'must have a chess piece in hand');

      // Clear any prior audio warnings before deployment
      await page.evaluate(() => {
        globalThis.__SP__?.audio?.warned?.clear();
      });

      // Find a free board tile and drop the piece from hand onto board
      await page.evaluate(async (uid) => {
        const store = globalThis.__SP__?.store;
        const priv = store?.get()?.match?.private;
        const occupied = new Set((priv?.board || []).map((x) => `${x.row},${x.col}`));
        const free = [[9, 9], [9, 8], [12, 6], [11, 7], [10, 7], [9, 7], [10, 4], [11, 4]].find(([r, c]) => !occupied.has(`${r},${c}`));
        if (!free) return false;

        const pieceEl = document.querySelector(`.ff-piece[data-uid="${uid}"]`);
        const tileEl = document.querySelector(`.ff-tile[data-row="${free[0]}"][data-col="${free[1]}"]`);
        if (pieceEl && tileEl) {
          const r1 = pieceEl.getBoundingClientRect();
          const r2 = tileEl.getBoundingClientRect();
          pieceEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r1.left + 5, clientY: r1.top + 5, pointerId: 1, button: 0 }));
          window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r2.left + 5, clientY: r2.top + 5, pointerId: 1 }));
          window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r2.left + 5, clientY: r2.top + 5, pointerId: 1 }));
          return true;
        }
        return false;
      }, pieceUid);

      await new Promise((r) => setTimeout(r, 600));

      // Read audio.warned via globalThis.__SP__.audio
      const warned = await page.evaluate(() => {
        const a = globalThis.__SP__?.audio;
        return a?.warned ? Array.from(a.warned) : [];
      });

      const missing = warned.filter((w) => w.startsWith('voice_missing_'));
      assert.deepEqual(missing, [], `${dev}: audio.warned must not contain voice_missing_ after deploying operator`);

      assert.deepEqual(problems, [], `${dev} operator deploy page errors`);
      await page.close();
    });
  }
});
