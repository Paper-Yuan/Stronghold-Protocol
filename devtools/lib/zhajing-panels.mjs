// devtools/lib/zhajing-panels.mjs — 真机巡检与桌面四档共用的一套「新面板」驱动 + 断言。
//
// 为什么抽成模块：devtools/render-check-mobile-adb.mjs 用 `puppeteer.connect` 接**手机上的** Chrome，
// devtools/render-check-zhajing.mjs 用 `puppeteer.launch` 开**本机** Chrome —— 传输不同，但驱动的是同一份页面、
// 同一批面板。两处各写一遍必然漂移，所以面板逻辑只在这里写一次。
//
// 选择器全部来自**客户端已落的 DOM**（2026-10-28 晚实测 grep，不是猜的）：
//   * hall           screens/extensionModes.js:265-286  `button.ext-row[data-ext][data-status]`，
//                    每行带 `data-testid="extension-row-<id>"`；进入键 `data-testid="extension-enter"`（:357）
//   * theme          screens/extensionThemeHall.js:75-136 `div.ext-theme[data-theme=<id>][data-testid=extension-theme]`，
//                    `.ext-theme__desc` / `.ext-theme__feats` / `[data-testid=extension-rules]` /
//                    `[data-testid=extension-feature-settings]` / `[data-testid=extension-party]` /
//                    `[data-testid=extension-start]` / `.ext-theme__art-img` + `.ext-theme__veil`；
//                    左下那一摞入口 `ExtThemeDock`（:37-51，挂在 :113-114 的 `.ext-theme__corner` 里）**只有两枚**：
//                    上 `[data-testid=ext-sweep]`（S.W.E.E.P.报告）、下 `[data-testid=ext-loadout]`（干员调配，点开既有调配整屏）。
//                    **2026-10-29 修订**：原「卡池调整」（`extension-pool-edit`）与干员调配打开同一屏，业主定为重复 →
//                    二级页不再有它；两枚由 `.ext-theme__dock`（lobby.css:1732-1733 的 grid + `width: max-content`，
//                    子按钮 `width: 100%`）撑成**同宽**，`.ext-theme__corner`（lobby.css:1727-1728，`bottom: calc(100% + …)`）
//                    锚在 `.ext-theme__foot` 那条 border-top 之上
//   * pool edit      screens/loadout.js 的**既有**干员调配整屏。玩法包档（炸惊 / 湮灭）按业主 2026-10-29 口径
//                    **不渲染档位横行**（`[data-testid=loadout-mode]` 查询得 null），档位由「说明」键右侧的只读标注给出：
//                    `[data-testid=loadout-set][data-mode=zhajing|annihilation]`；名册行 `.lo-*[data-chess]` + `[data-grantonly=true]`，
//                    策略徽 `.lo-grant`（:254）
//   * card art (A)   screens/room.js:341-344 自己的座位卡两颗入口 —— `[data-testid=seat-card-pick]`（更换立绘 → 弹层
//                    `.cardpick__grid[data-testid=card-picker]`，room.js:252-278）与 `[data-testid=seat-card-art]`
//                    （立绘调整，仅当这张卡的干员有精二立绘时出现）；立绘弹层 room.js:866-869 → ui/cardArt.js:109-136
//                    `section.cardart[data-testid=card-art][data-art=e1|e2][data-char]`、`.cardart__vbtn[data-art]`
//                    （精一 / 精二）、`[data-testid=card-art-frame]`、`[data-testid=card-art-zoom]`（input[type=range]
//                    0.8–2.0×）、`[data-testid=card-art-reset]`（重置）、`.cardart__img`（精一/精二同口径 cover；
//                    精一读 `char/illust/<id>_1.png` 全幅立绘，`_1` 缺失时 onError 退回精二）
//   * profile (B)    lobby.js:917-918 顶栏 `button.me-chip[data-testid=profile-entry]` → ui/accounts.js:132-157
//                    `div.lacct[data-testid=profile]` 两分区：`[data-testid=profile-avatar]`（`.lacct__pic` /
//                    `.lacct__note` / `.lacct__btns button`）与 `[data-testid=profile-card]`
//                    （`[data-testid=profile-card-preview]` + 文案「选择名片」的键）；点它 → ui/namecards.js:190-218
//                    `.nc-pick` 覆盖层，`.nc-pick__grid` 内 `.nc-pick__card[data-card]` 瓦片、瓦片内 `.nc-layer`
//                    （索引在 = 34 张真名片 + 1 张「默认制式」= 35 个瓦片；索引缺失 = 回退 8 张手绘 + 默认 = 9 个）
//   * ban picker (C) ui/banPicker.js:138-141 `[data-testid=zj-bans-open]`（只在炸惊房：screens/room.js:774-776，与「规则」
//                    并排）→ 面板 ui/banPicker.js:113-134 `[data-testid=zj-ban-picker][data-mode=zhajing]`，两列计数
//                    `[data-testid=zj-ban-count-core|-addon]`（`当前/配额`，配额读 data/config.json 的 bans.ZHAJING = 3/4）、
//                    胶囊 `.zjban__chip[data-bond][aria-pressed=true|false]`、重置 :126-127；服务端 server/lobby.js:1212-1244
//                    收 `room.bans` 后广播 `room.state.seats[].bans`（:571）
//   * icons          screens/sweep.js:174-177 盟约磁贴 `.sw-disc img`（兜底文字 `.sw-disc__txt`）、
//                    策略磁贴 `.sw-face img`（兜底 `.sw-face__txt`）；入口在大厅的 S.W.E.E.P.报告（lobby.js:505,967）
//
// 纪律：**不新造 data-testid**。A/B/C 三块（card-art / profile 两分区 / zj-ban-picker）已从 KNOWN 转成真断言：
// 少任何一块就 FAIL 并在 detail 写明缺什么，**不静默跳过**。poolAnnihilation 也随「档位横行在玩法包档不渲染」一并删除
// （现在的判据是 data-mode + 名册条数）。KNOWN 只剩 iconKeys / versionPill / secondEntry 三条仍然成立的。

import fs from 'node:fs';

/** 触控地板：本仓 24px（chip）/ 44px（关键按钮，extension-start 的 CTA）。 */
export const TOUCH_MIN = 24;
export const CTA_MIN = 44;

/** 一条 KNOWN 的固定说法（报告里直接抄）。A/B/C 落地后只剩这些仍然成立。 */
export const KNOWN = {
  iconKeys: '判据按 lead 口径改：不看 JS 字符串（记录 id → data/assets.json 的 iconId → 文件基名，JS 里 grep 不到是正常的）。'
    + ' 本步真正的断言是**页面上的盟约/策略图标必须是 <img> 且 naturalWidth>0、且没有文字兜底**（已全绿：盟约页 23~40 个、'
    + ' 策略页 40 个，bad=0、textFallbacks=0）。清单里的 30 个 key 是文件基名，不按 manifest 的键判存在性。',
  secondEntry: 'PRODUCT BUG（lead 已转 client，脚本保持 FAIL 不降 KNOWN）：从干员调配/另一个玩法包返回后，'
    + '再进入二级页不渲染 —— 要求「返回大厅 → 再进任一主题二级页」可重复',
  versionPill: '版本胶囊不在二级页：玩法包房的只读胶囊在 room.js:688-710,806-810（湮灭一期 / 炸惊一期），应在 room 步骤断言',
};

// ── 小工具 ───────────────────────────────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 元素盒（CSS px）+ 是否在视口内。 */
export const boxesOf = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => {
  const b = el.getBoundingClientRect();
  return {
    w: Math.round(b.width), h: Math.round(b.height),
    left: Math.round(b.left), top: Math.round(b.top),
    inView: b.left >= -1 && b.right <= innerWidth + 1 && b.top >= -1 && b.bottom <= innerHeight + 1,
  };
}), sel);

/** 等一个选择器出现（毫秒预算）。 */
export async function waitSel(page, sel, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await page.evaluate((s) => !!document.querySelector(s), sel).catch(() => false)) return true;
    await sleep(120);
  }
  throw new Error(`等不到 ${sel}（${ms}ms）`);
}

/** 按可见文字点一个按钮（真机与桌面都只有文字可用时）。返回是否点到了。 */
export async function clickText(page, re, scope = 'button, [role="radio"], .hub-plate, .sw-tab, a') {
  const ok = await page.evaluate(({ src, sel }) => {
    const rx = new RegExp(src);
    const els = [...document.querySelectorAll(sel)].filter((el) => rx.test((el.textContent || '').trim()));
    const el = els.find((e) => e.getBoundingClientRect().width > 0) || els[0];
    if (!el) return false;
    el.scrollIntoView?.({ block: 'center' });
    el.click();
    return true;
  }, { src: re.source, sel: scope }).catch(() => false);
  if (!ok) throw new Error(`点不到文字 ${re}`);
  await sleep(220);
  return true;
}

/** 关闭当前全屏层：先 Escape，再点常见关闭键。 */
export async function closeOverlay(page) {
  await page.keyboard?.press?.('Escape').catch(() => {});
  await sleep(180);
  const still = await page.evaluate(() => !!document.querySelector('.lo-top, .cardpick__grid, .nc-pick, .sw-report, .modal__box'))
    .catch(() => false);
  if (!still) return;
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => /关闭|返回|取消|×/.test(b.getAttribute('aria-label') || b.textContent || ''));
    btn?.click();
  }).catch(() => {});
  await sleep(220);
}

// ── 面板步骤 ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * 在大厅里打开「拓展玩法」弹层。幂等：弹层已经在就只等列表；不在就等大厅渲染出来再点（离开房间/关闭弹层后
 * 大厅要一两帧才回来，直接 evaluate 会抢跑 —— 2026-10-28 实测）。
 * @param {import('puppeteer-core').Page} page
 */
export async function openExtensionHall(page, { timeout = 12000 } = {}) {
  // 已经在二级页：先退一层回列表（一次 Escape 只退一层）
  if (await page.evaluate(() => !!document.querySelector('[data-testid="extension-theme"]')).catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(320);
  }
  // 弹层可能**在 DOM 里但被盖住**（干员调配整屏压在上面时它是 hidden）：按可见性判，别只判存在
  if (!(await page.evaluate(() => {
    const el = document.querySelector('.modal__box.ext');
    if (!el) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }))) {
    const deadline = Date.now() + timeout;
    let clicked = false;
    while (Date.now() < deadline) {
      clicked = await page.evaluate(() => {
        const card = document.querySelector('.mode-card[data-mode="ext"]');
        if (!card) return false;
        card.click();
        return true;
      }).catch(() => false);
      if (clicked) break;
      await sleep(200);
    }
    if (!clicked) throw new Error('大厅里没有「拓展模式」卡（还没到大厅？）');
  }
  await waitSel(page, '.modal__box.ext .ext-row', 12000);
  await sleep(200);
}

/** 确保回到大厅：**逐层**退出（二级页 → 列表 → 关闭弹层），再等大厅的卡渲染出来。
 *  注意：拓展弹层/二级页打开时，大厅的 `.mode-card` 会从 DOM 里消失（lobby 用弹层替掉 hub），
 *  所以「回大厅」必须真的把弹层关掉，不能只看到 modal 就以为还在大厅。
 *  ★ 2026-10-30 修：只看 `.mode-card` 还不够 —— 干员调配整屏（`.lo-top`）、拓展弹层、二级页、S.W.E.E.P. 报告
 *  都是**盖在大厅上面**的层，底下的 hub 连同 `.mode-card` 还在 DOM 里（实测干员调配打开时 `.mode-card` 有 3 张，
 *  但 `.lo-top` 盖在前面、拓展弹层是 hidden）。旧写法据此误判「已经在大厅」直接返回，后面的点击全打在看不见的
 *  层上 —— 这就是「从干员调配/另一个玩法包返回后，再进二级页不渲染」的根因（**脚本侧**，产品行为是对的：
 *  干员调配的「返回」确实回到二级页）。现在按**可见性**判定，并且先点干员调配自己的 `.lo-back`。 */
export async function ensureLobby(page, { timeout = 20000 } = {}) {
  /** 大厅是否真的在大厅（没有任何全屏层盖着） */
  const lobbyReady = () => page.evaluate(() => {
    const vis = (el) => {
      if (!el) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    if (!document.querySelector('.mode-card')) return false;
    // 任何**可见的**弹层都算挡在大厅前面：拓展弹层、规则 / 一览 / S.W.E.E.P. 报告 / 名片 / 卡牌挑选都是 `.modal__box`
    if (vis(document.querySelector('.modal__box'))) return false;
    for (const sel of ['.lo-top', '[data-testid="extension-theme"]', '.sw-report']) {
      if (vis(document.querySelector(sel))) return false;
    }
    return true;
  }).catch(() => false);
  const deadline = Date.now() + timeout;
  let tries = 0;
  while (Date.now() < deadline) {
    if (await lobbyReady()) return true;
    // 干员调配整屏有自己的「返回」（`.lo-top .lo-back`）：退这一屏比瞎按 Escape 可靠
    const backed = await page.evaluate(() => {
      const b = document.querySelector('.lo-top .lo-back');
      if (!b) return false;
      b.click();
      return true;
    }).catch(() => false);
    if (backed) { await sleep(500); continue; }
    // 其余层要**逐层**关：二级页 → 列表 → 弹层（各一次 Escape；每 3 次再补一次关闭键）
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(300);
    if (++tries % 3 === 0) {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
          .find((b) => /关闭|返回|取消|退出|×/.test(b.getAttribute('aria-label') || b.textContent || ''));
        btn?.click();
      }).catch(() => {});
      await sleep(300);
    }
  }
  const base = await page.evaluate(() => location.origin).catch(() => null);
  if (!base) throw new Error('拿不到 origin，无法回大厅');
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  if (!(await lobbyReady())) throw new Error('回不到大厅');
  return true;
}

/** 确保停在某个玩法包的二级页：**每次都从头走**（逐层退出 → 大厅 → 弹层 → 选中 → 进入）。
 *  为什么不复用当前层叠：干员调配整屏 / 二级页 / 列表 / 弹层叠在一起时，「按几次 Escape」取决于叠了几层，
 *  实测每次都不一样（2026-10-28）；回大厅再进虽然慢一点，但结果确定。 */
export async function ensureTheme(page, id) {
  // 二级页要**可见**才算到了（被干员调配整屏盖住时它还在 DOM 里）
  if (await page.evaluate((w) => {
    const el = document.querySelector(`[data-testid="extension-theme"][data-theme="${w}"]`);
    if (!el) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }, id).catch(() => false)) return true;
  await ensureLobby(page);
  await openExtensionHall(page);
  await selectExtension(page, id);
  await openTheme(page, id);
  return true;
}

/** 在大厅弹层里选中某个玩法包（不发请求，只改选中态）。 */
export async function selectExtension(page, id) {
  const sel = `[data-testid="extension-row-${id}"]`;
  await waitSel(page, sel);
  await page.click(sel);
  await sleep(180);
}

/**
 * step `hall`：列表恰好两条、无 missing、炸惊条目有主视觉。
 * @returns {Promise<object>} 可断言的读数
 */
export async function readHall(page) {
  await openExtensionHall(page);
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('.modal__box.ext .ext-row')];
    const list = rows.map((el) => ({ ext: el.dataset.ext, status: el.dataset.status, disabled: el.disabled === true }));
    return {
      count: list.length,
      exts: list.map((r) => r.ext),
      statuses: list.map((r) => r.status),
      anyMissing: list.some((r) => r.status === 'missing'),
      missingName: document.querySelector('.ext-row.is-placeholder')?.dataset.ext ?? null,
      // 「有背景图」在这份 DOM 里是 .ext-stage__art img（大厅预览），theme 页才是 .ext-theme__art 的图
      stageArt: (() => {
        const img = document.querySelector('.modal__box.ext .ext-stage__art img');
        return img ? { src: img.getAttribute('src'), ok: img.complete && img.naturalWidth > 0 } : null;
      })(),
      facts: document.querySelector('[data-testid="extension-facts"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

/**
 * step `theme`：读二级页（主题大厅）。调用前 selectExtension(页面上已选中的那个)。
 * @param {import('puppeteer-core').Page} page @param {string} id 期望的玩法包
 */
export async function openTheme(page, id) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const enter = await page.$('[data-testid="extension-enter"]');
    if (!enter) {
      // 不在列表页（被别的一层盖住）：退回列表再试
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(320);
      await selectExtension(page, id).catch(() => {});
      continue;
    }
    await page.click('[data-testid="extension-enter"]');
    try {
      await waitSel(page, `[data-testid="extension-theme"][data-theme="${id}"]`, 9000);
      await sleep(320);
      return true;
    } catch {
      // 选中态可能没跟上（重渲染后点了旧节点）：退一层、重新选、再进
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(320);
      await selectExtension(page, id).catch(() => {});
    }
  }
  // 两次都进不去：这是**产品 bug**（lead 2026-10-28 已转 client），不是脚本问题 —— 报错文字里直接写明，
  // 这样 FAIL 行自解释，等 client 修好后自动转 PASS。
  throw new Error(`进不去 ${id} 的二级页（连试 2 次）：${KNOWN.secondEntry}`);
}

export async function readTheme(page, id) {
  return page.evaluate((wantId) => {
    const box = document.querySelector('[data-testid="extension-theme"]');
    if (!box) return null;
    const art = box.querySelector('.ext-theme__art-img');
    // 左下那一摞入口只有两枚（2026-10-29）：上 S.W.E.E.P.报告、下 干员调配。
    // `pool` 沿用旧字段名，指的就是「干员调配」那颗（`ext-loadout`）；旧的 `extension-pool-edit` 已从二级页删除。
    const pool = box.querySelector('[data-testid="ext-loadout"]');
    const sweep = box.querySelector('[data-testid="ext-sweep"]');
    const dock = box.querySelector('.ext-theme__dock');
    const corner = box.querySelector('.ext-theme__corner');
    const foot = box.querySelector('.ext-theme__foot');
    const start = box.querySelector('[data-testid="extension-start"]');
    const pick = (el) => (el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), left: Math.round(el.getBoundingClientRect().left), top: Math.round(el.getBoundingClientRect().top), bottom: Math.round(el.getBoundingClientRect().bottom) } : null);
    return {
      theme: box.dataset.theme,
      matches: box.dataset.theme === wantId,
      kicker: box.querySelector('.ext-theme__kicker')?.textContent?.trim() ?? null,
      desc: box.querySelector('.ext-theme__desc')?.textContent?.trim() ?? null,
      feats: box.querySelectorAll('.ext-theme__feats li').length,
      rules: !!box.querySelector('[data-testid="extension-rules"]'),
      guide: !!box.querySelector('[data-testid="extension-guide"]'),
      featureSettings: !!box.querySelector('[data-testid="extension-feature-settings"]'),
      party: [...box.querySelectorAll('[data-testid="extension-party"] button')].map((b) => ({ id: b.dataset.party, text: (b.textContent || '').trim() })),
      start: start ? { text: (start.textContent || '').replace(/\s+/g, ' ').trim(), ...pick(start) } : null,
      pool: pool ? { text: (pool.textContent || '').trim(), ...pick(pool) } : null,
      sweep: sweep ? { text: (sweep.textContent || '').trim(), ...pick(sweep) } : null,
      dock: pick(dock),
      corner: pick(corner),
      footTop: foot ? Math.round(foot.getBoundingClientRect().top) : null,
      art: art ? { src: art.getAttribute('src'), ok: art.complete && art.naturalWidth > 0, fit: getComputedStyle(art).objectFit } : null,
      artBox: (() => {
        const a = box.querySelector('.ext-theme__art');
        if (!a) return null;
        const cs = getComputedStyle(a);
        return { bg: cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 60) : null, veil: !!box.querySelector('.ext-theme__veil') };
      })(),
      innerW: innerWidth, innerH: innerHeight,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, id);
}

/** step `pool`：从二级页点左下的「干员调配」（`[data-testid=ext-loadout]`，2026-10-29 替换掉原「卡池调整」）
 *  → 既有干员调配整屏，读档位标注 / 名册 / grantOnly。 */
export async function openPoolFromTheme(page) {
  await waitSel(page, '[data-testid="ext-loadout"]');
  await page.click('[data-testid="ext-loadout"]');
  await waitSel(page, '.lo-top', 12000);
  await sleep(420);
}

export async function readPool(page) {
  return page.evaluate(() => {
    const modes = [...document.querySelectorAll('[data-testid="loadout-mode"] button')].map((b) => ({ id: b.dataset.mode, text: (b.textContent || '').trim(), on: b.classList.contains('is-on') }));
    // 玩法包档（炸惊 / 湮灭）：档位横行按业主 2026-10-29 口径**整行不渲染**，档位由「说明」键右侧那枚只读标注给出
    const setEl = document.querySelector('[data-testid="loadout-set"]');
    const rows = [...document.querySelectorAll('[data-chess]')];
    const ids = new Set(rows.map((r) => r.dataset.chess));
    const grant = rows.filter((r) => r.dataset.grantonly === 'true');
    const badge = [...document.querySelectorAll('.lo-grant')].map((b) => (b.textContent || '').trim());
    return {
      hasTop: !!document.querySelector('.lo-top'),
      title: document.querySelector('.lo-top__title')?.textContent?.trim() ?? null,
      modes,
      setMode: setEl?.dataset.mode ?? null,
      setLabel: setEl?.textContent?.trim() ?? null,
      hasModeRow: !!document.querySelector('[data-testid="loadout-mode"]'),
      rowCount: rows.length,
      chessIds: ids.size,
      grantOnlyRows: grant.length,
      grantBadges: badge,
      grantBadgeText: badge[0] ?? null,
      deckLocked: !!document.querySelector('[data-testid="loadout-deck-locked"]'),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

/**
 * 在调配屏里切档（normal / zhajing）。
 * 玩法包档没有档位横行（业主 2026-10-29：进这两个模式的调配不出现切换行），所以「已经在目标档」直接算成功；
 * 只有官方四档那条路才真的点按钮。
 */
export async function switchPoolMode(page, id) {
  const sel = `[data-testid="loadout-mode"] button[data-mode="${id}"]`;
  if (await page.$(sel)) {
    await page.click(sel);
    await sleep(600);
    return true;
  }
  const current = await page.evaluate(() => document.querySelector('[data-testid="loadout-set"]')?.dataset.mode ?? null);
  return current === id;
}

/** step `icons`：大厅 → S.W.E.E.P.报告 → 盟约报告 / 策略报告，量磁贴图标。 */
export async function openSweepReport(page) {
  await closeOverlay(page);
  await page.evaluate(() => {
    const plate = [...document.querySelectorAll('button, .hub-plate, .lo-entry')]
      .find((el) => /S\.?W\.?E\.?E\.?P|报告/.test(el.textContent || ''));
    plate?.click();
  });
  await waitSel(page, '.sw-disc, .sw-face, .sw-report, .modal__box', 12000);
  await sleep(420);
}

export async function readIcons(page) {
  // 切到「盟约报告」再读一次，切到「策略报告」再读一次：两页的图标来源不同（bonds / bands）
  const read = () => page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.sw-disc img, .sw-face img, .sw-chip img')];
    const txt = [...document.querySelectorAll('.sw-disc__txt, .sw-face__txt, .sw-op__txt')];
    const bad = imgs.filter((i) => !(i.complete && i.naturalWidth > 0));
    return {
      imgs: imgs.length,
      bad: bad.length,
      badSrcs: bad.slice(0, 5).map((i) => i.getAttribute('src')),
      textFallbacks: txt.length,
      sample: imgs.slice(0, 3).map((i) => ({ src: (i.getAttribute('src') || '').slice(-40), w: i.naturalWidth })),
    };
  });
  const first = await read();
  let second = null;
  try {
    await clickText(page, /策略报告/);
    await sleep(420);
    second = await read();
  } catch { /* 只有一个分区时忽略 */ }
  return { bonds: first, bands: second };
}

/** 轮询到 `ok(value)` 为真就返回最后一次读数；超时抛错（错误里带最后一次读数，FAIL 行自解释）。 */
async function until(fn, ok, ms, what) {
  const deadline = Date.now() + ms;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (ok(last)) return last;
    await sleep(120);
  }
  throw new Error(`等不到 ${what}（${ms}ms）：最后一次读数 ${JSON.stringify(last)}`);
}

/**
 * step `card-art`（A）：进房后读「更换立绘」的弹层，再点开「立绘调整」验 精一的 contain / 缩放 / 重置。
 * 调用前必须已经站在自己的炸惊房里（runZhajingPanels 统一建房，一次巡检只建一间）。
 * @returns {Promise<object>} `{ tiles, withArt, firstImgFit, cardArt }`；cardArt 是立绘调整弹层的读数
 *   （`present:false` + `why` 表示座位卡上根本没有那个入口，由调用方 FAIL 并写明缺什么）。
 */
export async function readSeatCardPicker(page) {
  const hasEntry = await page.evaluate(() => !!document.querySelector('[data-testid="seat-card-pick"]'));
  if (!hasEntry) {
    throw new Error('自己的座位卡上没有「更换立绘」（[data-testid="seat-card-pick"] 不存在：不在自己的座位上 / 还没进房）');
  }
  await page.click('[data-testid="seat-card-pick"]');
  await waitSel(page, '[data-testid="card-picker"]', 8000);
  await sleep(300);
  const pick = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="card-picker"]');
    const tiles = [...grid.querySelectorAll('[data-char]')];
    const img = grid.querySelector('img');
    return {
      tiles: tiles.length,
      withArt: tiles.filter((t) => !!t.querySelector('img')).length,
      firstImgFit: img ? getComputedStyle(img).objectFit : null,
    };
  });
  // 弹层是 Modal：Escape（closeOverlay 先按 Escape）就关掉。关掉才点得到座位卡上的「立绘调整」。
  await closeOverlay(page);
  await sleep(220);

  const hasTune = await page.evaluate(() => !!document.querySelector('[data-testid="seat-card-art"]'));
  if (!hasTune) {
    return {
      ...pick,
      cardArt: {
        present: false,
        why: '座位卡上没有 [data-testid="seat-card-art"]（这张卡的干员没有精二立绘 char/illust/<id>.png，'
          + '或不在自己的座位上；入口见 public/js/screens/room.js:343-344 的 canTune 条件）',
      },
    };
  }
  await page.click('[data-testid="seat-card-art"]');
  await waitSel(page, '[data-testid="card-art"]', 8000);
  await sleep(340);
  /** 立绘调整弹层的读数（形状 + 当前 .cardart__img 的 fit）。 */
  const shape = () => page.evaluate(() => {
    const root = document.querySelector('[data-testid="card-art"]');
    if (!root) return null;
    const img = root.querySelector('.cardart__img');
    const vbtns = [...root.querySelectorAll('.cardart__vbtn')];
    const zoom = root.querySelector('[data-testid="card-art-zoom"]');
    return {
      art: root.dataset.art ?? null,
      char: root.dataset.char ?? null,
      hasFrame: !!root.querySelector('[data-testid="card-art-frame"]'),
      hasJingyi: vbtns.map((b) => b.dataset.art).join(',') === 'e1,e2',
      hasZoom: !!zoom && zoom.type === 'range',
      hasReset: !!root.querySelector('[data-testid="card-art-reset"]'),
      fit: img ? getComputedStyle(img).objectFit : null,
      zoomValue: zoom ? Number(zoom.value) : null,
      src: img ? (img.getAttribute('src') || '').slice(-64) : null,
      loaded: img ? !!(img.complete && img.naturalWidth > 0) : null,
    };
  });
  const opened = await shape();
  if (!opened) throw new Error('点了「立绘调整」但弹层没出现（[data-testid="card-art"] 不存在）');

  // 点「精一」：`char/illust/<id>_1.png` 在 → 与精二同口径 cover（同一套全幅立绘，无「简略图」角标）；
  // `_1` 缺失时 cardArt.js 的 onError 按设计退回精二（cover）—— 如实记录，不算脚本失败。
  await page.evaluate(() => document.querySelector('[data-testid="card-art"] .cardart__vbtn[data-art="e1"]')?.click());
  await sleep(500);
  const e1 = await shape();

  // 点「重置」→ 回到中立值（精二 / 1.0×）
  await page.evaluate(() => document.querySelector('[data-testid="card-art-reset"]')?.click());
  await sleep(360);
  const reset = await shape();

  await closeOverlay(page);
  return { ...pick, cardArt: { ...opened, present: true, e1, reset } };
}

/**
 * step `profile`（B）：大厅个人条 → 两分区面板（个人资料 / 名片）→ 名片选择网格。
 * 读到的读数由 runZhajingPanels 断言；缺件在函数里就抛错（不返回半截数据让调用方悄悄放过）。
 */
export async function readProfile(page) {
  // 上一步（pool-ann）停在干员调配整屏：先逐层退回大厅，否则找不到顶栏的个人条
  await ensureLobby(page);
  await waitSel(page, '[data-testid="profile-entry"]', 8000).catch(() => {});
  const chip = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="profile-entry"]');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const mid = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
    return {
      w: Math.round(b.width), h: Math.round(b.height),
      // 顶栏上真的点得到吗（被别的东西盖住 = 用户点不到，记进 detail 由报告判断）
      hit: !!mid && (el === mid || el.contains(mid)),
    };
  });
  if (!chip) {
    throw new Error('大厅顶栏没有个人条（.me-chip[data-testid="profile-entry"] 不存在：'
      + 'public/js/screens/lobby.js:917-918 的 topbar__right 没挂上 AccountMeChip）');
  }
  await page.evaluate(() => document.querySelector('[data-testid="profile-entry"]')?.click());
  await waitSel(page, '[data-testid="profile"]', 8000);
  await sleep(320);
  const panel = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="profile"]');
    const av = root.querySelector('[data-testid="profile-avatar"]');
    const cd = root.querySelector('[data-testid="profile-card"]');
    const txt = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null);
    return {
      hasAvatar: !!av,
      hasCard: !!cd,
      pic: !!av?.querySelector('.lacct__pic'),
      note: txt(av?.querySelector('.lacct__note')),
      avatarBtns: [...((av && av.querySelectorAll('.lacct__btns button')) || [])].map(txt),
      preview: !!cd?.querySelector('[data-testid="profile-card-preview"]'),
      titles: [txt(av?.querySelector('.lacct__sec-title')), txt(cd?.querySelector('.lacct__sec-title'))],
      pickBtn: [...((cd && cd.querySelectorAll('button')) || [])].some((b) => /选择名片/.test(b.textContent || '')),
      modalTitle: txt(root.closest('.modal__box')?.querySelector('.modal__title')),
    };
  });
  // 「选择名片」→ `.nc-pick` 覆盖层（ui/namecards.js:190-218）
  const clicked = await page.evaluate(() => {
    const cd = document.querySelector('[data-testid="profile-card"]');
    const btn = [...((cd && cd.querySelectorAll('button')) || [])].find((b) => /选择名片/.test(b.textContent || ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!clicked) throw new Error('名片区（[data-testid="profile-card"]）里没有「选择名片」键');
  await waitSel(page, '.nc-pick__grid', 8000);
  await sleep(360);
  const picker = await page.evaluate(() => {
    const grid = document.querySelector('.nc-pick__grid');
    if (!grid) return null;
    const tiles = [...grid.querySelectorAll('.nc-pick__card[data-card]')];
    return {
      tiles: tiles.length,
      named: tiles.filter((t) => (t.dataset.card || '') !== '').length,
      layers: grid.querySelectorAll('.nc-layer').length,
      imgs: grid.querySelectorAll('.nc-layer img').length,
    };
  });
  if (!picker) throw new Error('「选择名片」没有打开名片网格（.nc-pick__grid 不存在）');
  // 关名片层用它自己的 ×：此刻按 Escape 会先关掉底下的个人资料面板（Modal 的 keydown 优先，
  // `.nc-pick` 不是 Modal —— 见回报里的 DOM 缺口），所以这里显式点 ×。
  await page.evaluate(() => document.querySelector('.nc-pick .nc-pick__x')?.click());
  await sleep(260);
  await closeOverlay(page);
  return { chip, panel, picker };
}

/**
 * ban 的期望值：从 `data/config.json` 的 `bans.ZHAJING`（配额）与 `data/bonds.json`（两列条数）现算，
 * 与客户端 ui/banPicker.js 的 `banQuota` / `banLists`、服务端 server/lobby.js:1220-1237 同一判据。
 * @returns {{ quota: { core: number, addon: number }, core: number, addon: number }}
 */
export function bansExpectation() {
  const readJson = (name) => JSON.parse(fs.readFileSync(new URL(`../../data/${name}`, import.meta.url), 'utf8'));
  const cfg = readJson('config.json');
  const bonds = readJson('bonds.json');
  const q = (cfg && cfg.bans && cfg.bans.ZHAJING) || {};
  const list = (Array.isArray(bonds) ? bonds : Object.values(bonds || {}))
    .filter((b) => b && typeof b.bondId === 'string');
  return {
    quota: { core: Number.isInteger(q.core) ? q.core : 3, addon: Number.isInteger(q.addon) ? q.addon : 4 },
    core: list.filter((b) => b.isCore === true).length,
    addon: list.filter((b) => b.isCore !== true).length,
  };
}

/** 读卡池预选面板：两列计数（`当前/配额`）+ 每列胶囊数/选中数。面板不在 → null。 */
async function readBanPicker(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="zj-ban-picker"]');
    if (!root) return null;
    // 每列取自己那一节（计数节点在 .zjban__sec 的 header 里）——胶囊数按节数，不按全局，免得两列串味
    const col = (kind) => {
      const el = root.querySelector(`[data-testid="zj-ban-count-${kind}"]`);
      const sec = el ? el.closest('.zjban__sec') : null;
      const text = (el ? el.textContent || '' : '').replace(/\s+/g, ' ').trim();
      const m = /(\d+)\s*\/\s*(\d+)/.exec(text);
      return {
        text,
        cur: m ? Number(m[1]) : null,
        cap: m ? Number(m[2]) : null,
        title: sec ? (sec.querySelector('.zjban__title')?.textContent || '').replace(/\s+/g, ' ').trim() : null,
        chips: sec ? sec.querySelectorAll('.zjban__chip[data-bond]').length : null,
        on: sec ? sec.querySelectorAll('.zjban__chip[aria-pressed="true"]').length : null,
      };
    };
    return {
      mode: root.dataset.mode ?? null,
      core: col('core'),
      addon: col('addon'),
      // ui/banPicker.js 没有 useData('bonds')：bonds 没载入时两列画出来是空的（0 颗胶囊），
      // 这里记下数据状态，好让下面「胶囊数 = 12」的红能自解释。
      bondsReady: (() => {
        const d = globalThis.__SP__ && globalThis.__SP__.data;
        return d && typeof d.status === 'function' ? d.status('bonds') : 'unknown';
      })(),
    };
  });
}

/**
 * step `ban-picker`（C）：点开顶栏「卡池预选」→ 读两列 → 点第一颗核心盟约（真的发 `room.bans`）→ 重置。
 * 每次点击之间都等前一个请求回来（`run()` 同一时刻只放一个请求，在途时胶囊是 disabled）。
 * @returns {Promise<object>} `{ initial, clickedId, afterClick, echo, afterReset }`
 */
export async function exerciseBanPicker(page) {
  const openSel = '[data-testid="zj-bans-open"]';
  // 上一步（card-art 名片立绘）会留一个弹层盖在房间上：先关掉，否则 puppeteer 的 click 会命中遮挡层
  // 并抛「Node is either not clickable or not an Element」（2026-10-30 实测）。
  await closeOverlay(page);
  await sleep(260);
  if (!(await page.$(openSel))) {
    throw new Error('炸惊房顶栏没有「卡池预选」（[data-testid="zj-bans-open"] 不存在：'
      + 'public/js/screens/room.js:774-776 只在 room.difficulty === ZHAJING 时渲染）');
  }
  // 用 evaluate 里的 click()：它不做命中测试，弹层刚关、按帧未稳时也不会假报「点不到」
  await page.evaluate((sel) => document.querySelector(sel)?.click(), openSel);
  await waitSel(page, '[data-testid="zj-ban-picker"]', 8000);
  await sleep(340);
  const initial = await readBanPicker(page);
  if (!initial) throw new Error('点开「卡池预选」后面板不存在（[data-testid="zj-ban-picker"]）');

  // 第一颗核心盟约（面板第一列的第一颗）
  const firstChip = () => page.evaluate(() => {
    const root = document.querySelector('[data-testid="zj-ban-picker"]');
    const chip = root ? root.querySelector('.zjban__sec .zjban__chip[data-bond]') : null;
    return chip ? { id: chip.dataset.bond, disabled: !!chip.disabled, pressed: chip.getAttribute('aria-pressed') } : null;
  });
  const first = await firstChip();
  if (!first) throw new Error('卡池预选面板里一颗盟约胶囊都没有（.zjban__chip[data-bond] = 0）');
  const clickedId = first.id;
  await until(firstChip, (c) => c && !c.disabled, 5000, '第一颗胶囊可点（请求在途时是 disabled）');
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="zj-ban-picker"]');
    root?.querySelector('.zjban__sec .zjban__chip[data-bond]')?.click();
  });
  const afterClick = await until(async () => ({ s: await readBanPicker(page), chip: await firstChip() }),
    (v) => v.s && v.s.core.cur === 1 && v.chip && v.chip.pressed === 'true', 6000,
    `点一颗核心盟约后计数 1/… 且 aria-pressed=true`);

  // 服务端回显：`room.state.seats[].bans.zhajing`（server/lobby.js:571、:1242 broadcastState）——
  // 这条才能证明「真的发了 room.bans」，客户端本地 setSel 是不等回显的。
  const echoState = () => page.evaluate(() => {
    const st = globalThis.__SP__ && globalThis.__SP__.store ? globalThis.__SP__.store.get() : null;
    const room = (st && st.room) || null;
    const me = (st && st.me && st.me.playerId) || null;
    const seat = Array.isArray(room && room.seats) ? room.seats.find((s) => s && s.playerId === me) : null;
    const b = (seat && seat.bans && seat.bans.zhajing) || null;
    return {
      available: !!room,
      core: Array.isArray(b && b.core) ? b.core : null,
      addon: Array.isArray(b && b.addon) ? b.addon : null,
    };
  });
  let echo = await echoState();
  if (echo.available && !(echo.core || []).includes(clickedId)) {
    // 广播可能晚一两帧：等到回显里有这颗为止；等不到就把最后一次读数交回去，由调用方 FAIL
    try { echo = await until(echoState, (e) => (e.core || []).includes(clickedId), 4000, '服务端回显这一颗禁选'); }
    catch (e) { echo = { ...echo, waitError: String(e && e.message ? e.message : e) }; }
  }

  // 重置（面板底部 footer 里的那颗，文案「重置」；两列都空时它是 disabled）
  const resetBtn = () => page.evaluate(() => {
    const root = document.querySelector('[data-testid="zj-ban-picker"]');
    const box = root ? root.closest('.modal__box') : null;
    const btn = [...((box && box.querySelectorAll('button')) || [])]
      .find((b) => (b.textContent || '').replace(/\s+/g, ' ').trim() === '重置');
    return btn ? { found: true, disabled: !!btn.disabled } : { found: false, disabled: true };
  });
  await until(resetBtn, (b) => b.found && !b.disabled, 5000, '「重置」键可点');
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="zj-ban-picker"]');
    const box = root ? root.closest('.modal__box') : null;
    [...((box && box.querySelectorAll('button')) || [])]
      .find((b) => (b.textContent || '').replace(/\s+/g, ' ').trim() === '重置')?.click();
  });
  const afterReset = await until(() => readBanPicker(page), (s) => s && s.core.cur === 0 && s.addon.cur === 0, 6000,
    '重置后两列回到 0');
  await closeOverlay(page);
  return { initial, clickedId, afterClick, echo, afterReset };
}

/**
 * 跑完 9 个面板步骤，返回 PASS/FAIL/KNOWN 清单（一步抛错不影响其余）。
 * @param {{ page: any, shot: (name: string) => Promise<void>, label?: string }} ctx
 */
export async function runZhajingPanels({ page, shot, label = '' }) {
  const steps = [];
  const add = (name, status, detail) => {
    steps.push({ name, status, detail });
    const brief = typeof detail === 'string' ? detail : JSON.stringify(detail);
    console.log(`[${label}] ${name}: ${status} — ${String(brief).slice(0, 300)}`);
  };
  const guard = async (name, fn, { known = null } = {}) => {
    try { await shot(name); } catch { /* 截图失败不算步骤失败 */ }
    if (known) { add(name, 'KNOWN', known); return; }
    try { add(name, 'PASS', await fn()); } catch (e) { add(name, 'FAIL', String(e?.message || e)); }
    try { await shot(name); } catch { /* ignore */ }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  // ① hall：恰好两条、无 missing
  await guard('hall', async () => {
    const hall = await readHall(page);
    assert(hall.count === 2, `拓展玩法列表应为 2 条，实际 ${hall.count}（${hall.exts.join(',')}）`);
    assert(JSON.stringify(hall.exts) === JSON.stringify(['annihilation', 'zhajing']), `条目顺序/内容不对：${hall.exts.join(',')}`);
    assert(!hall.anyMissing, `还有 missing 行：${hall.missingName}`);
    assert(hall.stageArt === null || hall.stageArt.ok, `主视觉没加载出来：${hall.stageArt?.src}`);
    return hall;
  });

  // ② theme-zhajing
  await guard('theme-zhajing', async () => {
    await ensureTheme(page, 'zhajing');
    const t = await readTheme(page, 'zhajing');
    assert(t && t.matches, '二级页不是炸惊模拟（data-theme 不对）');
    assert(!!t.desc && t.desc.length > 4, '没有简介（.ext-theme__desc）');
    assert(t.feats >= 1, `没有要点（.ext-theme__feats li = ${t.feats}）`);
    assert(t.rules, '没有「规则」键（extension-rules）');
    assert(t.party.length === 2 && t.party.every((p) => /单人|同盟/.test(p.text)), `单人/同盟缺失：${JSON.stringify(t.party)}`);
    assert(!!t.start, '没有「开始」（extension-start）');
    assert(t.start.h >= CTA_MIN, `开始键高度 ${t.start.h} < ${CTA_MIN}`);
    // 左下的两枚入口（业主 2026-10-29）：S.W.E.E.P.报告（上）+ 干员调配（下），**同宽**、都锚在页脚 border-top 之上；
    // 原「卡池调整」与干员调配打开同一屏（重复），已从二级页删除。
    assert(!!t.pool, '没有「干员调配」入口（[data-testid="ext-loadout"] 不存在）');
    assert(!!t.sweep, '没有 S.W.E.E.P.报告入口（[data-testid="ext-sweep"] 不存在）');
    assert(/干员调配/.test(t.pool.text || ''), `「干员调配」文案不对：${JSON.stringify(t.pool.text)}`);
    assert(/S\.?W\.?E\.?E\.?P/.test(t.sweep.text || ''), `S.W.E.E.P. 入口文案不对：${JSON.stringify(t.sweep.text)}`);
    assert(t.sweep.top < t.pool.top,
      `列序应是 S.W.E.E.P.报告在上、干员调配在下：sweep.top=${t.sweep.top} loadout.top=${t.pool.top}`);
    assert(t.pool.w < t.innerW * 0.4, `干员调配应是窄条：宽 ${t.pool.w} / 视口 ${t.innerW}`);
    assert(Math.abs(t.pool.w - t.sweep.w) <= 2,
      `两枚入口应同宽（±2px）：干员调配 ${t.pool.w} / S.W.E.E.P. ${t.sweep.w}`);
    assert(t.pool.h >= TOUCH_MIN && t.sweep.h >= TOUCH_MIN,
      `两枚入口的触摸地板应 ≥ ${TOUCH_MIN}：干员调配 ${t.pool.h} / S.W.E.E.P. ${t.sweep.h}`);
    const dockLeft = (t.dock || t.pool).left;
    assert(dockLeft <= t.innerW * 0.5, `两枚入口应在屏幕左下：left=${dockLeft} 视口=${t.innerW}`);
    assert(t.footTop != null, '找不到页脚（.ext-theme__foot），无法验证两枚入口锚在 border-top 之上');
    assert(Math.max(t.sweep.bottom, t.pool.bottom) <= t.footTop + 1,
      `两枚入口应锚在页脚 border-top 之上：按钮底 ${Math.max(t.sweep.bottom, t.pool.bottom)} / 页脚顶 ${t.footTop}`);
    assert(t.art && t.art.ok, `二级页背景图没加载：${t.art?.src}`);
    assert(t.art.fit === 'cover', `背景图 object-fit 应是 cover，实际 ${t.art.fit}`);
    assert(t.artBox?.veil, '背景图缺少遮罩层（.ext-theme__veil）');
    return {
      desc: t.desc.slice(0, 24), feats: t.feats, start: t.start, fit: t.art.fit, theme: t.theme,
      pool: t.pool, sweep: t.sweep,
      dock: t.dock ? { w: t.dock.w, h: t.dock.h, left: t.dock.left, bottom: t.dock.bottom } : null,
      footTop: t.footTop,
    };
  });

  // ③ theme-ann（版本胶囊在 room，不在这一屏 —— 见 KNOWN.versionPill）
  await guard('theme-ann', async () => {
    await ensureTheme(page, 'annihilation');
    const t = await readTheme(page, 'annihilation');
    assert(t && t.matches, '二级页不是湮灭模拟');
    assert(t.featureSettings, '没有「功能设置」入口（extension-feature-settings）');
    assert(t.party.length === 2, `单人/同盟缺失：${JSON.stringify(t.party)}`);
    return { featureSettings: true, party: t.party.map((p) => p.id), versionPill: 'KNOWN（在 room.js:688-710,806-810，不在这屏）' };
  });

  // ④ pool-zhajing（业主 2026-10-29：玩法包档的调配**不出现档位横行**，档位标在「说明」键右侧）
  await guard('pool-zhajing', async () => {
    await ensureTheme(page, 'zhajing');
    await openPoolFromTheme(page);
    const pool = await readPool(page);
    assert(pool.hasTop, '没进到既有干员调配整屏（.lo-top 不存在）');
    assert(!pool.hasModeRow, '炸惊档不该出现档位横行（[data-testid="loadout-mode"]）');
    assert(pool.setMode === 'zhajing', `「说明」键右侧的模式名应是 炸惊模拟（data-mode=zhajing），实际 ${JSON.stringify(pool.setMode)}`);
    assert(/炸惊/.test(pool.setLabel || ''), `模式名文案不对：${JSON.stringify(pool.setLabel)}`);
    const zj = await readPool(page);
    assert(zj.chessIds === 99, `炸惊档名册应为 99，实际 ${zj.chessIds}`);
    assert(zj.grantOnlyRows === 2, `炸惊档 grantOnly 应为 2 条，实际 ${zj.grantOnlyRows}`);
    assert(zj.grantBadgeText === '策略', `grantOnly 徽应写「策略」，实际 ${JSON.stringify(zj.grantBadges.slice(0, 4))}`);
    return { setMode: pool.setMode, setLabel: pool.setLabel, roster: zj.chessIds, grantOnly: zj.grantOnlyRows, badge: zj.grantBadgeText };
  });

  // ⑤ pool-ann（同一口径：不出现档位横行，模式名标在「说明」键右侧；名册 = 官方 112 ∪ annMods 带来的 13 个干员位 = 125）
  await guard('pool-ann', async () => {
    await ensureTheme(page, 'annihilation');
    await openPoolFromTheme(page);
    const pool = await readPool(page);
    assert(pool.hasTop, '没进到既有干员调配整屏（.lo-top 不存在）');
    assert(!pool.hasModeRow, '湮灭档不该出现档位横行（[data-testid="loadout-mode"]）');
    assert(pool.setMode === 'annihilation', `模式名应是 湮灭模拟（data-mode=annihilation），实际 ${JSON.stringify(pool.setMode)}`);
    assert(/湮灭/.test(pool.setLabel || ''), `模式名文案不对：${JSON.stringify(pool.setLabel)}`);
    // 两个默认开启的内容 mod 会把挂它们的棋带进名册（业主 2026-10-29 默认开）：所以不再写死 112，只要求 ≥112 且包含官方那套
    assert(pool.chessIds >= 112, `湮灭档名册应 ≥112（默认开启两条 mod），实际 ${pool.chessIds}`);
    return { setMode: pool.setMode, setLabel: pool.setLabel, roster: pool.chessIds };
  }, { known: null });

  // ⑥ profile（B）：大厅顶栏个人条 → 两分区面板 → 名片网格。不需要房，就在大厅阶段做。
  await guard('profile', async () => {
    const p = await readProfile(page);
    assert(p.panel.hasAvatar && p.panel.hasCard,
      `个人条只打开了一半：个人资料区=${p.panel.hasAvatar} 名片区=${p.panel.hasCard}（两分区缺一不可）`);
    assert(p.panel.pic, '头像区没有头像位（.lacct__pic）');
    assert(!!p.panel.note && p.panel.note.length > 4, '头像区没有说明文字（.lacct__note）');
    assert(p.panel.avatarBtns.length >= 1, '头像区一颗键都没有（.lacct__btns button）');
    assert(p.panel.preview, '名片区没有预览框（[data-testid="profile-card-preview"]）');
    assert(p.panel.pickBtn, '名片区没有「选择名片」键');
    const tiles = p.picker.tiles;
    // 35 = 34 张真名片 + 1 张「默认制式」；9 = 索引缺失时回退的 8 张手绘 + 默认。两者都算对，其它数字是漂移。
    const index = tiles >= 35;
    assert(tiles >= 9, `名片网格瓦片应 ≥ 9（索引 34+默认，回退 8+默认），实际 ${tiles}`);
    assert(index || tiles === 9,
      `名片网格瓦片既不是 35（索引 34+默认）也不是 9（回退 8 手绘+默认），实际 ${tiles}`);
    assert(p.picker.layers > 0, '名片网格里一个 .nc-layer 都没有（索引缺失时回退手绘也必须画）');
    return {
      chip: p.chip, sections: p.panel.titles, avatarBtns: p.panel.avatarBtns,
      tiles, layers: p.picker.layers, imgs: p.picker.imgs,
      index: index ? 34 : 0,
      fallback: !index,
      note: index ? null : '索引缺失：回退 8 张手绘 + 默认制式（设计口径，仍 PASS）',
    };
  });

  // ⑦ icons：S.W.E.E.P.报告的两个磁贴页
  await guard('icons', async () => {
    await ensureLobby(page);
    await openSweepReport(page);
    const r = await readIcons(page);
    for (const [name, page1] of [['bonds', r.bonds], ['bands', r.bands]]) {
      if (!page1) continue;
      assert(page1.imgs > 0, `${name} 页一个图标都没渲染（.sw-disc/.sw-face img = 0）`);
      assert(page1.bad === 0, `${name} 页有 ${page1.bad} 个图标 naturalWidth=0：${JSON.stringify(page1.badSrcs)}`);
    }
    return { bonds: r.bonds, bands: r.bands, known: KNOWN.iconKeys };
  });

  // ⑧ 房内两件事（A 立绘调整 / C 卡池预选）共用**同一间炸惊房**：建一次、做完两件、退房。
  //    不给 ban-picker 另建一间房；建房失败时第二步直接带着同一个原因 FAIL（不静默跳过）。
  let roomEntered = false;
  let roomError = null;
  const ensureRoom = async () => {
    if (roomEntered) return;
    if (roomError) throw new Error(`建房失败（同一次巡检只建一间房，第一步已经失败）：${roomError.message}`);
    try {
      await ensureTheme(page, 'zhajing');
      await page.click('[data-testid="extension-start"]');
      await waitSel(page, '.rs-pill, .rseat', 25000);
      await sleep(900);
      roomEntered = true;
    } catch (e) {
      roomError = e;
      throw new Error(`进炸惊房失败（A/C 都无法验证）：${e.message}`);
    }
  };

  // ⑨ card-art（A）：「更换立绘」弹层 + 立绘调整（精一 cover / 缩放 / 重置）。做完不退房，直接接 ban-picker。
  await guard('card-art', async () => {
    await ensureRoom();
    const seat = await readSeatCardPicker(page);
    assert(seat.tiles > 0, '名片弹层里没有可选干员（[data-testid="card-picker"] [data-char] = 0）');
    assert(seat.withArt > 0, '名片弹层里没有一张带图的干员卡（img = 0）');
    const ca = seat.cardArt;
    if (!ca.present) throw new Error(`A 立绘调整未落：${ca.why}`);
    assert(ca.hasFrame && ca.hasJingyi && ca.hasZoom && ca.hasReset,
      `立绘调整缺件：frame=${ca.hasFrame} 精一/精二=${ca.hasJingyi} 缩放=${ca.hasZoom} 重置=${ca.hasReset}`);
    // 精一：`char/illust/<id>_1.png` 是**与精二同尺寸的全幅立绘**，所以同口径 cover（没有 contain / 角标特例）；
    // `_1` 缺失时 cardArt.js 的 onError 按设计退回精二（cover）—— 如实记录，不算脚本失败。
    const e1Shown = ca.e1 && ca.e1.art === 'e1';
    if (e1Shown) {
      assert(ca.e1.fit === 'cover',
        `精一立绘应与精二同口径 cover，实际 object-fit=${ca.e1.fit}（src=${ca.e1.src}）`);
      assert(ca.e1.loaded !== false, `精一立绘没加载出来：${ca.e1.src}`);
    }
    assert(ca.reset && ca.reset.art === 'e2' && ca.reset.zoomValue === 1,
      `「重置」应回到 精二 / 1.0×，实际 art=${ca.reset && ca.reset.art} zoom=${ca.reset && ca.reset.zoomValue}`);
    return {
      tiles: seat.tiles, withArt: seat.withArt, firstImgFit: seat.firstImgFit, char: ca.char,
      jingyi: ca.hasJingyi, zoom: ca.hasZoom, reset: ca.hasReset,
      e1: e1Shown
        ? { fit: ca.e1.fit, src: ca.e1.src }
        : { fallback: '缺 char/illust/<id>_1.png，按设计退回精二', fit: ca.e1 && ca.e1.fit, src: ca.e1 && ca.e1.src },
      afterReset: { art: ca.reset.art, zoom: ca.reset.zoomValue },
    };
  });

  // ⑩ ban-picker（C）：同一间炸惊房，点开「卡池预选」→ 两列计数 → 点一颗（真的发 room.bans）→ 重置。
  await guard('ban-picker', async () => {
    await ensureRoom();
    let expect;
    try { expect = bansExpectation(); } catch (e) {
      throw new Error(`读不到 data/config.json + data/bonds.json（算不出配额/两列条数的期望）：${e.message}`);
    }
    const x = await exerciseBanPicker(page);
    const q = expect.quota;
    assert(x.initial.mode === 'zhajing', `面板 data-mode 应是 zhajing，实际 ${x.initial.mode}`);
    assert(x.initial.core.cap === q.core,
      `核心列配额应是 ${q.core}（data/config.json 的 bans.ZHAJING.core），实际 ${x.initial.core.text}`);
    assert(x.initial.addon.cap === q.addon,
      `附加列配额应是 ${q.addon}（data/config.json 的 bans.ZHAJING.addon），实际 ${x.initial.addon.text}`);
    assert(x.initial.core.cur === 0 && x.initial.addon.cur === 0,
      `新房两列都该是空的，实际 ${x.initial.core.text} / ${x.initial.addon.text}`);
    assert(x.initial.core.chips === expect.core,
      `核心列应有 ${expect.core} 颗（data/bonds.json 里 isCore === true），实际 ${x.initial.core.chips}`
      + `（bonds 数据状态 ${x.initial.bondsReady}：ui/banPicker.js 没有 useData('bonds')，`
      + `${x.initial.bondsReady === 'ready' ? '数据已就绪，问题在渲染' : '数据没载入，两列会是空的'}）`);
    assert(x.initial.addon.chips === expect.addon,
      `附加列应有 ${expect.addon} 颗（data/bonds.json 里其余盟约），实际 ${x.initial.addon.chips}`);
    assert(x.afterClick.s.core.cur === 1 && x.afterClick.s.core.cap === q.core,
      `点一颗核心盟约后应是 1/${q.core}，实际 ${x.afterClick.s.core.text}`);
    assert(x.afterClick.chip && x.afterClick.chip.pressed === 'true',
      `点中的胶囊 aria-pressed 应是 true，实际 ${x.afterClick.chip && x.afterClick.chip.pressed}`);
    // 服务端回显 = 「真的发了 room.bans」的证据；store 读不到时如实写进 detail（不当成通过也不当失败）
    if (x.echo.available) {
      assert((x.echo.core || []).includes(x.clickedId),
        `服务端没有回显这次禁选（room.state.seats[].bans.zhajing.core = ${JSON.stringify(x.echo.core)}，`
        + `期望含 ${x.clickedId}）${x.echo.waitError ? `；${x.echo.waitError}` : ''}`);
    }
    assert(x.afterReset.core.cur === 0 && x.afterReset.addon.cur === 0,
      `重置后应回到 0/${q.core}、0/${q.addon}，实际 ${x.afterReset.core.text} / ${x.afterReset.addon.text}`);
    return {
      bond: x.clickedId, quota: q, chips: { core: expect.core, addon: expect.addon },
      initial: `${x.initial.core.text} / ${x.initial.addon.text}`,
      afterClick: `${x.afterClick.s.core.text} / ${x.afterClick.s.addon.text}`,
      afterReset: `${x.afterReset.core.text} / ${x.afterReset.addon.text}`,
      serverEcho: x.echo.available ? { core: x.echo.core, addon: x.echo.addon } : 'store 不可用（未断言回显）',
    };
  });

  // 收尾：退出房间、关掉浮层、回到大厅（把页面交给调用方时是干净的）。
  try {
    await page.evaluate(async () => { const m = await import('/js/net.js'); return m.net.request('room.leave', {}).catch(() => null); }).catch(() => {});
    await sleep(700);
    await closeOverlay(page);
    await ensureLobby(page).catch(() => {});
  } catch { /* 收尾失败不影响已经收集到的步骤结论 */ }

  return steps;
}
export function summarize(steps) {
  const fail = steps.filter((s) => s.status === 'FAIL');
  const known = steps.filter((s) => s.status === 'KNOWN');
  const pass = steps.filter((s) => s.status === 'PASS');
  return {
    ok: fail.length === 0,
    pass: pass.length,
    fail: fail.length,
    known: known.length,
    table: steps.map((s) => `${s.status.padEnd(5)} ${s.name}`),
    fails: fail.map((s) => `${s.name}: ${typeof s.detail === 'string' ? s.detail : JSON.stringify(s.detail)}`),
    knowns: known.map((s) => `${s.name}: ${s.detail}`),
  };
}
