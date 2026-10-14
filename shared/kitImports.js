// shared/kitImports.js — the IMPORT SURFACE of a workshop behaviour-layer kit (`<pack>/kits/<chessId>.js`).
// (i18n-ignore-file: 作者/加载器/编辑器共用的规则文本 —— 给作者、编辑器与 AI 读的错误说明，不是客户端界面文案)
//
// WHY THIS FILE EXISTS (gap ④, docs/design/mod-layer.md §28.12)
//
// A kit is one file that is loaded TWICE from two different roots:
//   * the SERVER, by real path  — `server/workshop.js loadWorkshopKits()`: `import(pathToFileURL(file))`
//   * the BROWSER, by URL       — `public/js/battle/runner.js loadSpecKits()`: `import('/workshop-kits/<pack>/<id>.js?v=…')`
// A relative specifier cannot be right for both: `../shared/tier1.js` means `server/sim/content/kits/shared/tier1.js` to
// the server and `/workshop-kits/shared/tier1.js` to the browser. That is the whole reason `KIT_IMPORT` used to reject
// every import (`shared/kitAuthoring.js`).
//
// The fix is a WHITELIST plus a prefix that resolves in BOTH worlds — `@kit/tier1.js`:
//   * server: `rewriteKitImports()` turns each whitelisted specifier into the real `file:` URL before the import;
//   * browser: `kitImportMap()` is declared in `public/index.html`'s import map, so no rewriting happens there.
// One table (`KIT_IMPORT_FILES`) feeds both, so the two ends cannot drift — and `test/kitImports.test.js` reads
// `public/index.html` and requires it to agree with the table.
//
// THE SECOND FORM: a kit may import its OWN siblings with a downward relative specifier (`./helpers.js`,
// `./lib/bonds.js`, `isPackRelativeSpecifier` below — DESIGN §28.18). The geometry is the whole reason this works:
//   * on disk a kit is `<packDir>/kits/<id>.js`, so `./lib/util.js` is `<packDir>/kits/lib/util.js`;
//   * the browser fetches it as `/workshop-kits/<pack>/<id>.js` (the `kits/` segment is NOT in the URL), so `./lib/util.js`
//     is `/workshop-kits/<pack>/lib/util.js` — and `server/http/static.js` maps that URL back to `<packDir>/kits/lib/util.js`.
// Same file, two native resolutions, no rewriting needed on the browser end. A `..` specifier can never agree the same
// way (the URL has no `kits/` segment to walk back out of), so `..` stays refused — see `kitImportUnavailableReason`.
//
// WHAT IS *NOT* ALLOWED, and why the rule is narrow: only the files below plus the kit's own `kits/` subtree. A kit may
// reach the engine's kit SDK and the three pure helpers that SDK itself is built on. It may not reach the match, the
// lobby, the HTTP entry, the net layer, the file system, or anything under `public/` — the same boundary
// `tools/check-imports.mjs` draws for `server/sim`, applied to third-party code.
//
// The scan/parse/rewrite primitives live here, not in `shared/kitAuthoring.js`, because the LOADER must reach the same
// verdict as the VALIDATOR: `server/workshop.js` imports `kitImportIssues()` from this file, so the editor cannot pass
// something the loader then refuses (docs/design/mod-layer.md §28.3).

/** The only prefixes a kit may import through. A specifier that starts with neither is refused. */
export const KIT_IMPORT_PREFIXES = Object.freeze(['@kit/', '@sim/']);

/**
 * 包**战斗逻辑**模块（`pack.json.server.battle`, DESIGN §28.17）允许的两个前缀：`@battle/`（战斗内容层的辅助函数，
 * 官方 `content/bonds/custom.js` 之类用的就是这一套）与 `@sim/`（三个纯函数模块）。
 *
 * 与 kit 的关系：kit 是**一个干员**的代码，战斗模块是**整场**的代码 —— 两者需要的东西不同（kit 要 tier1..6 那套
 * 构造器，战斗模块要 `bondActive` / `isMember` / `passiveBuff` / `battleStore` 这类战场级读法），所以是两份名单、
 * 两个前缀，而不是把 kit 的名单撑大。
 */
export const BATTLE_IMPORT_PREFIXES = Object.freeze(['@battle/', '@sim/']);

/**
 * The whitelist. `specifier` is what the author writes; `file` is the real path, workspace-relative and POSIX — the
 * server resolves it against the repository root and the browser resolves the same string through the import map.
 * Adding a line here is the ONLY way to open a new module, and it opens it on both ends at once.
 */
export const KIT_IMPORT_FILES = Object.freeze([
  // the kit SDK: the same helpers the official kits are written against
  { specifier: '@kit/tier1.js', file: 'server/sim/content/kits/shared/tier1.js' },
  { specifier: '@kit/tier2.js', file: 'server/sim/content/kits/shared/tier2.js' },
  { specifier: '@kit/tier3.js', file: 'server/sim/content/kits/shared/tier3.js' },
  { specifier: '@kit/tier4.js', file: 'server/sim/content/kits/shared/tier4.js' },
  { specifier: '@kit/tier5.js', file: 'server/sim/content/kits/shared/tier5.js' },
  { specifier: '@kit/tier6.js', file: 'server/sim/content/kits/shared/tier6.js' },
  { specifier: '@kit/summoner.js', file: 'server/sim/content/kits/shared/summoner.js' },
  // the three pure engine helpers the SDK is built on (and the ones a community kit already imported by relative path)
  { specifier: '@sim/constants.js', file: 'server/sim/constants.js' },
  { specifier: '@sim/dir.js', file: 'server/sim/dir.js' },
  { specifier: '@sim/targeting.js', file: 'server/sim/targeting.js' },
  // 战斗逻辑模块的 SDK：**战斗内容层的辅助函数**（`server/sim/content/support/index.js`）—— 官方内容模块
  // （`content/bonds/*.js`、`content/garrisons/*.js`）用的同一份。它已经在浏览器侧被服务（`/sim/content/support/`，
  // 客户端战斗本来就要加载它），所以两端都能解。
  { specifier: '@battle/index.js', file: 'server/sim/content/support/index.js' },
]);

/** 战斗逻辑模块允许的名单（它不比 kit 多一个前缀，只是指向另一组文件）。 */
export const BATTLE_IMPORT_FILES = Object.freeze(KIT_IMPORT_FILES.filter((e) => BATTLE_IMPORT_PREFIXES.some((p) => e.specifier.startsWith(p))));

/** specifier → file, for the loader and the import-map generator. */
export const KIT_IMPORT_TARGETS = Object.freeze(new Map(KIT_IMPORT_FILES.map((e) => [e.specifier, e.file])));

/** 战斗逻辑模块的 specifier → file。 */
export const BATTLE_IMPORT_TARGETS = Object.freeze(new Map(BATTLE_IMPORT_FILES.map((e) => [e.specifier, e.file])));

/**
 * 房间级钩子模块（`pack.json.server.room`, DESIGN §28.20）允许的名单：**只有 `@sim/`**。
 *
 * 为什么这一份比 kit 与战斗逻辑模块都窄，而且**刻意不加 `@room/` 前缀**：
 *   * 房间钩子只跑在服务端（没有浏览器那一半），所以它不需要一个「两端都成立」的前缀 —— 但加一个 `@room/` 的代价
 *     恰恰是它必须两端都成立：`public/index.html` 的 import map 与 `kitImportMap()` 是从同一张表生成的
 *     （`test/kitImports.test.js` 把它们钉在一起），凭空多一个服务端专用前缀就等于在浏览器侧也开一个命名空间，
 *     只为了一个永远不在那里加载的模块。**复用 `@sim/`** 是这一刀的选择。
 *   * 三个纯函数（constants / dir / targeting）是引擎里唯一一类「没有状态、没有对局句柄、两端逐字相同」的模块，
 *     拿它们做常量表与几何计算是房间钩子的正当需要。
 *   * `@kit/` 与 `@battle/` **都不在**这一份里：那两个前缀通向的是**战斗里**的东西（一个够到 `battleStore` /
 *     战场写法的辅助函数），而房间钩子的契约是「观察与声明」——它拿不到战场是有意的（见 §28.20 的成员表）。
 *
 * 名单从 `KIT_IMPORT_FILES` 里**筛**出来，不抄第二份：一条更窄的视图不该是另一份会漂的真相。
 */
export const ROOM_IMPORT_PREFIXES = Object.freeze(['@sim/']);

/** 房间钩子模块允许的名单（`@sim/` 那几行）。 */
export const ROOM_IMPORT_FILES = Object.freeze(KIT_IMPORT_FILES.filter((e) => e.specifier.startsWith('@sim/')));

/** 房间钩子模块的 specifier → file。 */
export const ROOM_IMPORT_TARGETS = Object.freeze(new Map(ROOM_IMPORT_FILES.map((e) => [e.specifier, e.file])));

/** The list a reason/hint quotes, so the message and the table can never disagree. */
export const KIT_IMPORT_ALLOWED = Object.freeze(KIT_IMPORT_FILES.map((e) => e.specifier));

/** 战斗逻辑模块那份可写清单。 */
export const BATTLE_IMPORT_ALLOWED = Object.freeze(BATTLE_IMPORT_FILES.map((e) => e.specifier));

/** 房间钩子模块那份可写清单（`@sim/`）。 */
export const ROOM_IMPORT_ALLOWED = Object.freeze(ROOM_IMPORT_FILES.map((e) => e.specifier));

/** One line naming every allowed specifier — the "here is what you may write instead" half of an error. */
export const kitImportAllowedText = () => KIT_IMPORT_ALLOWED.join(', ');

/**
 * 包**相对**模块那半句话（§28.18）：每个拒绝理由的末尾都要说一遍，作者才知道除了白名单之外**自己包里**的文件也能
 * import（只说「不行」的理由会让人以为唯一的出路是把代码塞进一个文件 —— 那正是这一刀要修的 1138 行巨石）。
 */
export const kitImportRelativeText = '也可以用 ./… 开头的相对路径 import 本包 kits/ 下的文件（如 ./lib/util.js），'
  + '不得含 ".."、不得带 %、必须 .js';

/** 同上，战斗逻辑模块那份。 */
export const battleImportAllowedText = () => BATTLE_IMPORT_ALLOWED.join(', ');

/** 同上，房间钩子模块那份。 */
export const roomImportAllowedText = () => ROOM_IMPORT_ALLOWED.join(', ');

/**
 * 一个 specifier 是不是「向下相对」形式（§28.18）：`./` 开头、`.js` 结尾、没有任何 `..` 段、没有反斜杠、没有 `%`
 * （`%2e%2e` 就是这样变成 `..` 的，所以整个百分号编码一律拒绝）、没有 NUL、没有 `?` / `#`、没有空段（`./`）。
 *
 * 两端各解析成什么，见文件头的几何说明：**它们指向同一个文件**，前提是路由把 `/workshop-kits/<包>/<rel>` 映射到
 * `<packDir>/kits/<rel>`（server/http/static.js），以及加载器把同一个 specifier 解到 `file:` URL
 * （server/workshop.js loadWorkshopKits 的 rewriteKitImports 调用）。
 *
 * 这个判定函数同时是**编辑器**（shared/kitAuthoring.js validateKit）与**加载器**的判据，所以只写一遍。
 */
export function isPackRelativeSpecifier(specifier) {
  const s = String(specifier ?? '');
  if (!s.startsWith('./')) return false;
  if (!s.endsWith('.js')) return false;
  if (s.length <= 3) return false;                                        // "./" 或 "./.js" 都不是文件
  if (s.includes('\\') || s.includes('%') || s.includes('\0')) return false;
  if (s.includes('?') || s.includes('#')) return false;
  for (const seg of s.split('/')) {
    // 第一段永远是空串（specifier 以 "./" 开头，`'./x.js'.split('/')` 是 `['', '.', 'x.js']`），所以从第二段开始判：
    // 剩下的每一段都必须非空、且不是 `.` / `..`（空段 = `./x//y.js`，`..` = 任何形式的向上一级）。
    if (seg === '.') continue;                                            // 只可能是开头那一段 "./"
    if (!seg || seg === '..') return false;
  }
  return true;
}

/**
 * 把一条**已被接受**的包相对 specifier 解成包内相对路径（`./lib/util.js` → `lib/util.js`），供加载器拼真实路径。
 * 只在这个 specifier 走完 `isPackRelativeSpecifier` 之后调用 —— 它不做任何安全判定。
 */
export const packRelativePath = (specifier) => String(specifier ?? '').slice(2);

/**
 * Blank out comments, keeping string literals AND the newlines (so an index into the result is an index into the input).
 * A char-wise scan rather than a regex: a `//` inside a string (`'https://…'`) must not start a comment, and an import
 * specifier is itself a string literal that has to survive.
 */
function maskComments(src) {
  const text = String(src || '');
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += c;
      for (i++; i < text.length; i++) {
        out += text[i];
        if (text[i] === '\\') { i++; out += text[i] ?? ''; continue; }
        if (text[i] === q) break;
      }
      continue;
    }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') { out += ' '; i++; } out += '\n'; continue; }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++; }
      i++;
      out += ' ';
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Every STATIC import/export-from of a source, in source order.
 *
 * `specifier` is the raw text between the quotes, `specStart` its index in the SOURCE (so a rewrite is a slice), `quote`
 * the quote character the author used, and `declStart` the index of the statement's first character (for `import` that
 * is the `i` itself; for `export … from` it is the `export`, which is what `declaration` starts at).
 *
 * The statement regex is anchored to `(?:^|[;}\s])` so a line comment cannot reach it, and the preceding character is
 * put back with `m[0].slice(0, m[0].length - m[1].length)`. Dynamic `import(` is deliberately NOT matched here (its
 * specifier is an expression); `kitImportIssues` reports it separately.
 * @param {string} src
 * @returns {Array<{ specifier: string, specStart: number, quote: string, declaration: string, declStart: number }>}
 */
export function kitImportDeclarations(src) {
  const text = String(src || '');
  const code = maskComments(text);
  const re = /(?:^|[;}\s])((?:import|export)\s(?:[\s\S]*?)\sfrom\s*(['"])([^'"\n]+)\2)/g;
  const out = [];
  for (const m of code.matchAll(re)) {
    const declaration = m[1];
    const prefix = m[0].length - declaration.length;
    const declStart = m.index + prefix;
    const quote = m[2];
    const specifier = m[3];
    const from = declaration.lastIndexOf(' from ');
    const at = from < 0 ? -1 : declaration.indexOf(quote, from);
    if (at < 0) continue;
    out.push({ specifier, specStart: declStart + at + 1, quote, declaration, declStart });
  }
  return out;
}

/** Dynamic `import(…)` expressions (a specifier that is not a static string, and therefore not checkable). */
export function kitDynamicImports(src) {
  const text = String(src || '');
  const code = maskComments(text);
  const re = /(?:^|[^.\w$])import\s*\(/g;
  const out = [];
  for (const m of code.matchAll(re)) {
    const at = m.index + (m[0].startsWith('import') ? 0 : 1);
    out.push({ at });
  }
  return out;
}

/** `require(…)` calls — a CommonJS call neither the browser nor an ESM loader can serve. */
export function kitRequireCalls(src) {
  const text = String(src || '');
  const code = maskComments(text);
  const re = /(?:^|[^.\w$])require\s*\(/g;
  const out = [];
  for (const m of code.matchAll(re)) out.push({ at: m.index + (m[0].startsWith('require') ? 0 : 1) });
  return out;
}

/**
 * The import problems of one kit source, in the SAME shape for the validator and the loader: `code` is the machine-
 * readable verdict, `reason` the Chinese sentence a player/maintainer reads. Nothing else about a kit is judged here —
 * this is only the import surface.
 *
 * `decls` is an optional pre-computed `kitImportDeclarations(src)` — the loader already has it (it decides from it
 * whether the source needs rewriting), so passing it in keeps the scan to one per file.
 *
 * `allowRelative` is what separates the two payloads (§28.18): a KIT may import its own `kits/` siblings with `./…`,
 * a **battle module may not** — it is loaded on the server through a `data:` URL, which has no base directory for a
 * relative specifier to resolve against (see `kitImportUnavailableReason`).
 * @param {string} src
 * @param {ReturnType<typeof kitImportDeclarations>} [decls]
 * @param {{ targets?: Map<string, string>, allowedText?: () => string, allowRelative?: boolean }} [opts]
 * @returns {Array<{ code: string, reason: string }>}
 */
export function kitImportIssues(src, decls = null, { targets = KIT_IMPORT_TARGETS, allowedText = kitImportAllowedText, allowRelative = true } = {}) {
  const out = [];
  if (kitDynamicImports(src).length) {
    out.push({
      code: 'KIT_IMPORT',
      reason: `禁止动态 import()：它无法被双端静态解析（服务端按真实路径、浏览器按 URL），只允许写在文件顶部的静态 import；白名单：${allowedText()}`,
    });
  }
  if (kitRequireCalls(src).length) {
    out.push({
      code: 'KIT_IMPORT',
      reason: `禁止 require()：kit 两端都按 ES 模块加载（服务端 import()、浏览器 import），CommonJS 在两端都不存在；白名单：${allowedText()}`,
    });
  }
  for (const d of (decls || kitImportDeclarations(src))) {
    if (targets.has(d.specifier)) continue;
    // 包相对：kit 放行（§28.18），战斗逻辑模块拒绝 —— 两份载荷的装载方式不同，理由见 kitImportUnavailableReason。
    if (allowRelative && isPackRelativeSpecifier(d.specifier)) continue;
    out.push({ code: 'KIT_IMPORT', reason: `import "${d.specifier}" 不在白名单里：${kitImportUnavailableReason(d.specifier, { allowedText, allowRelative })}` });
  }
  return out;
}

/**
 * Why one specifier is refused, with the reason that fits it — a path that escapes, an absolute path, a whitelisted
 * module the author misspelled, a malformed pack-relative path, or a module that simply is not on the list. Every
 * branch ends by naming the whitelist AND the pack-relative form, because "you may not do this" without "here is what
 * you may do" is what makes an author guess (and, for the reference community mod, what makes one file per operator
 * impossible: without the relative form the only way to share a helper is to paste it into all of them).
 *
 * `allowRelative` mirrors `kitImportIssues`': the battle table passes `false`, so `./x.js` gets the asymmetry reason
 * (a `data:` module has no base directory) that points at `@battle/` instead of an acceptance it cannot honour.
 */
export function kitImportUnavailableReason(specifier, { allowedText = kitImportAllowedText, allowRelative = true } = {}) {
  const s = String(specifier ?? '');
  const allowed = `白名单：${allowedText()}`;
  const allowedBoth = `${allowed}；${kitImportRelativeText}`;
  if (s.startsWith('..') || s.includes('/../') || s === '..') {
    return `相对路径（含 ".."）无法同时在服务端与浏览器成立，且路径穿越一律拒绝；${allowedBoth}`;
  }
  if (s.startsWith('./')) {
    // 形式对（向下相对）但这一条不合法：说清是哪一条 —— 「相对路径不行」在 §28.18 之后是**错的**说明。
    if (!allowRelative) {
      return `包相对路径 ${JSON.stringify(s)} 在**战斗逻辑模块**里不成立：服务端把这类模块当 data: URL 加载，而 data: 没有目录，相对路径无从解析；`
        + `战斗内容层的辅助函数请走 @battle/（与官方 content/bonds/*.js 用的同一份）与 @sim/；白名单：${allowedText()}`;
    }
    if (s.split('/').some((seg) => seg === '..')) {
      // "../" 与 "./../" 都落到这里：它会被服务端解成 kits/ 之外的路径，而浏览器的 URL 里没有 "kits/" 这一层可退回，
      // 两端必然指向不同文件（§28.18 的几何）。所以含 ".." 的包相对路径一律拒绝，不试图「归一化后放行」。
      return `包相对路径不得含 ".." 段：".." 会走出 kits/，而浏览器的 URL 里没有 "kits/" 这一层可以退回来，两端必然指向不同文件；${allowedBoth}`;
    }
    if (s.includes('%')) return `包相对路径不得含 "%"：百分号编码（如 %2e%2e）会在解析后变成 ".."，一律拒绝；${allowedBoth}`;
    if (s.includes('\\')) return `包相对路径不得用反斜杠（工程路径一律 "/"）；${allowedBoth}`;
    if (s.includes('?') || s.includes('#')) return `包相对路径不得带查询串或片段（"?" / "#"）：它们不是文件名的一部分；${allowedBoth}`;
    if (s.endsWith('.mjs') || s.endsWith('.cjs') || s.endsWith('.css') || s.endsWith('.json')) return `包相对 import 只支持 .js（浏览器把那一段 URL 当 ES 模块取）；${allowedBoth}`;
    if (!s.endsWith('.js')) return `包相对路径必须以 ".js" 结尾（写全扩展名）；${allowedBoth}`;
    return `不是可用的包相对路径：必须以 "./" 开头、没有空段、逐段可拼成 kits/ 下的一个 .js；${allowedBoth}`;
  }
  if (s.startsWith('.')) return `相对路径无法同时在服务端与浏览器成立（只有 "./…" 这种向下的包相对形式可以，见 §28.18）；${allowedBoth}`;
  if (s.startsWith('/')) return `绝对路径无法同时在服务端与浏览器成立；${allowedBoth}`;
  if (s.startsWith('@kit/') || s.startsWith('@sim/') || s.startsWith('@battle/')) {
    return `模块名 "${s.slice(s.indexOf('/') + 1)}" 未开放（前缀合法，但这个文件不在白名单里）；${allowedBoth}`;
  }
  if (s.startsWith('@')) return `未知前缀 "${s.slice(0, s.indexOf('/') + 1 || undefined)}"；${allowedBoth}`;
  return `裸模块名 "${s}" 未开放（只能 import 引擎给出的 SDK 与那几个纯函数模块）；${allowedBoth}`;
}

/** The allowed file for a specifier, or null. */
export const kitImportTarget = (specifier) => KIT_IMPORT_TARGETS.get(String(specifier)) || null;

/**
 * The import map a browser needs so the SAME source works there — `{"@kit/": "/sim/content/kits/shared/", "@sim/": "/sim/"}`.
 *
 * It is PREFIX-ONLY on purpose. The obvious alternative — one entry per specifier, `"@kit/tier1.js": "/sim/content/
 * kits/shared/tier1.js"` — duplicates the table into `public/index.html` and rots the moment a file moves; a prefix map
 * says "this namespace is this served subtree" once. The file a specifier resolves to is still checked, but in
 * `test/kitImports.test.js`: it resolves every whitelisted specifier through this map and requires the served URL to
 * exist on disk under the `/sim/` mount, so a typo in the table is a red test rather than a 404 at runtime.
 * @returns {Record<string, string>}
 */
export function kitImportMap() {
  /** @type {Record<string, string>} */
  const map = {};
  const prefixes = [...new Set([...KIT_IMPORT_PREFIXES, ...BATTLE_IMPORT_PREFIXES])];
  for (const prefix of prefixes) {
    const first = KIT_IMPORT_FILES.find((e) => e.specifier.startsWith(prefix));
    if (!first) continue;
    const tail = first.specifier.slice(prefix.length);
    map[prefix] = kitImportBrowserUrl(first.file.slice(0, first.file.length - tail.length));
  }
  return map;
}

/**
 * The URL a browser fetches a whitelisted module from — the `/sim/` mount (`server/http/static.js`: `/sim/` →
 * `server/sim/`, `.js` only). The server uses the real path instead; both come from the same table row, which is what
 * makes `@kit/tier1.js` mean the same file on both ends.
 */
export const kitImportBrowserUrl = (file) => `/${String(file).replace(/^server\/sim\//, 'sim/')}`;

/**
 * The NARROW rewrite the server performs before importing a kit: every whitelisted specifier becomes the real URL the
 * server would have resolved, and every other byte of the file is left alone (so a hash taken from the author's source
 * is still a hash of what the author wrote — §28.2 hashes `kits/*.js` bytes, never this output).
 *
 * Only whitelisted specifiers are touched. A refused specifier is NOT rewritten: the loader reports it instead, so a
 * broken import fails with the reason rather than with a module-resolution stack trace.
 *
 * `resolveRelative` (optional) is the §28.18 half: given the package-relative specifier the caller's verdict accepted
 * (`./lib/util.js`), it returns the URL the specifier must become in this file's own directory. The loader passes a
 * resolver rooted at the kit file (`pathToFileURL(dirname(file))`), because a `data:` module has no base directory of
 * its own — without this the accepted relative specifier would resolve nowhere. A caller that omits it (the battle
 * table, whose verdict refuses the form outright) keeps the pre-§28.18 behaviour byte for byte.
 *
 * The resolved URLs depend on the FILE the specifier appears in, not on the file being loaded: a helper that is itself
 * reached through `./…` may import its own siblings, and both ends resolve those against the helper's own directory
 * (server: this resolver; browser: the URL of the helper). That is why the loader calls this once per source it loads,
 * with that source's own directory.
 * @param {string} src
 * @param {(file: string) => string} urlOf workspace-relative file → URL (the loader passes `pathToFileURL`)
 * @param {{ targets?: Map<string, string>, resolveRelative?: (specifier: string) => string|null }} [opts]
 * @returns {string}
 */
export function rewriteKitImports(src, urlOf, { targets = KIT_IMPORT_TARGETS, resolveRelative = null } = {}) {
  const text = String(src || '');
  const decls = kitImportDeclarations(text);
  if (!decls.length) return text;
  let out = '';
  let at = 0;
  for (const d of decls) {
    const file = targets.get(d.specifier);
    // 白名单那一半优先：一个 specifier 要么是白名单条目，要么是包相对路径，两种判定互斥（`@` 开头 vs `./` 开头）。
    const url = file
      ? String(urlOf(file))
      : (resolveRelative && isPackRelativeSpecifier(d.specifier) ? resolveRelative(d.specifier) : null);
    if (!url) continue;                                    // refused: left for the loader to report
    out += text.slice(at, d.specStart) + url;
    at = d.specStart + d.specifier.length;
  }
  return out + text.slice(at);
}
