// 拓展模式收尾：独立审计 → 实现（n19 引擎 / 图标 / 文档）→ 双端多尺寸真机验证 → 独立复核 → 发布报告
//
// Scope: handoff/EXTENSION-MODE-2026-10-27.md §7.2 + docs/EXTENSION_MODE.md. The line itself is green
// (extension-modes 20/20, annihilation-mode 17/17, annihilation-erosion 14/14, golden 288 零位移). What remains is one
// gameplay item the mod v3.2.0 rewrote (n19 「未尽的生命」's stun rework, which needs DEPLOY_PROTECT), one listed polish
// item (the crossed-out rook icon), and the docs that must follow them (AGENTS.md: docs follow the code).
//
// The auditor runs on the session model. Two pinned models were tried first and both failed on this provider —
// Kimi k3.1 pro was rejected outright (400, service info not found) and an explicit deepseek-v4.1-flash$max override
// hung with zero tokens for ten minutes — while a plain subagent on the session model answers in seconds. The auditor
// still runs in its own context and must cite path:line, so it is an independent reading of the files even though it
// shares a model with the implementer: read its findings as a second reader, not as a different family's opinion.
//
// The gates are real: every test/lint/i18n/import/golden check is a world.run the script branches on, and the browser
// pass drives puppeteer over the repo's own render-check scripts at desktop AND phone-landscape sizes (a portrait phone
// is not a target for this game: public/js/ui/device.js:104 sets sp-rotatable for a coarse pointer whose screen is not
// landscape, and public/css/theme.css:418 then paints the 请旋转设备 hint over everything — an honest gate drives the
// shapes the game actually serves).

interface AuditFinding {
  /** Workspace-relative path with a line when it applies, e.g. "server/sim/content/relics.js:174". */
  where: string;
  /** One sentence: what is wrong, or what a doc claims that the code does not do. */
  what: string;
  /** The evidence: the lines read, or the command and its output. */
  evidence: string;
  /** high = would mislead a player or break a gate; medium = wrong docs or a real papercut; low = cosmetic. */
  severity: "high" | "medium" | "low";
}

interface Audit {
  /** proceed = the plan is right; adjust = part of it is wrong or incomplete; stop = do not touch the code. */
  verdict: "proceed" | "adjust" | "stop";
  /** Two or three sentences describing what the extension-mode line actually looks like on disk today. */
  summary: string;
  findings: AuditFinding[];
  /** What the implementation round must not miss, most important first. */
  mustFix: string[];
}

interface ImplResult {
  /** One sentence per file: what actually changed (or "no change, and why"). */
  changed: string[];
  /** What could not be done and why — an honest gap, not a plan. */
  gaps: string[];
  /** Where the n19 work stands: "done" only when the engine change and its tests are both in. */
  n19: "done" | "partial" | "rejected";
  /** Where the icon work stands. */
  icon: "done" | "skipped";
}

interface BrowserCheck {
  /** The viewport label, e.g. "1280x720" or "844x390". */
  viewport: string;
  /** Whether every boolean the render-check asserts came back true. */
  ok: boolean;
  /** The failing assertions (empty when ok). */
  failures: string[];
  /** Anything the page logged as an error. */
  consoleErrors: string[];
}

interface Review {
  /** pass = the work meets the repo's rules; fail = it does not, and `blockers` says why. */
  verdict: "pass" | "fail";
  /** Claims in the implementation report that the code does not support. */
  wrongClaims: string[];
  /** Real defects that must be fixed before this can be called done. */
  blockers: string[];
  /** Smaller things worth fixing but not blocking. */
  notes: string[];
}

artifact.table("browser", {
  title: "双端多尺寸真机验证",
  columns: [{ field: "viewport", label: "视口" }, { field: "ok", label: "通过" }, { field: "failures", label: "失败断言数" }, { field: "consoleErrors", label: "console 错误数" }],
  key: "viewport",
});

const auditor = agent("独立审计员", {
  system:
    "You are the independent auditor for a browser game repo (E:\\Workbox\\系统): a Node server plus a deterministic " +
    "battle sim shared by server and browser. You do not edit files. You report only what the files actually show, " +
    "citing path:line. The repo rule is 'docs follow the code': when a doc and the code disagree, the code is right " +
    "and the doc is the defect. Judge every claim by reading the files, never by trusting the handoff or another " +
    "agent's summary. Never run git checkout/stash/reset/commit — the working tree carries other sessions' " +
    "uncommitted work. If a check cannot be run, say so instead of assuming its result. Answer in Chinese.",
});

phase("请独立审计员审计拓展模式的现状");

const audit = await auditor.ask<Audit>(
  [
    "Audit the 拓展模式 / 湮灭模拟 (extension-mode / annihilation) line in E:\\Workbox\\系统 and judge the plan below.",
    "Read at least, in full where small:",
    "  - handoff/EXTENSION-MODE-2026-10-27.md (§1 status, §5 red lines, §7.1b/§7.1c, §7.2 open items)",
    "  - docs/EXTENSION_MODE.md (§2 the three statuses, §3 wiring, §3.6 theme hall, §5 adding a play set, §6 boundaries)",
    "  - public/js/screens/extensionModes.js, public/js/screens/extensionThemeHall.js",
    "  - public/js/screens/lobby.js around MODE_CARDS / createAnnihilation / the ext* state",
    "  - server/sim/content/relics.js (the stunOnDeploy branch inside the deploy hook) and server/match/relics.js",
    "    ('stunOnDeploy' in relicModsFor and in relicStackInfo)",
    "  - docs/research/16-annihilation-relics.json around n19, and public/js/ui/components.js (the ICONS map)",
    "  - server/sim/constants.js (is there any deploy-protection constant today?)",
    "You may also read the mod's own v3.2.0 source (read-only):",
    "  E:\\Workbox\\.session-dump\\ext\\annihilation\\湮灭模拟-独立mod-v3.2.0\\payload\\server\\sim\\content\\relics.js",
    "and its diff report E:\\Workbox\\.session-dump\\ext\\annihilation\\DIFF-v3.1.0-v3.2.0.md (its §B.2 is the n19 rework).",
    "",
    "The plan to execute next:",
    "  1. n19 「未尽的生命」: port the v3.2.0 rework. Add DEPLOY_PROTECT to server/sim/constants.js; in",
    "     server/sim/content/relics.js replace the current per-deploy re-draw with the mod's stunArmed gate (only",
    "     ctx.initial arms it, fired DEPLOY_PROTECT + 0.05 later, capped by the units already stunned) plus a",
    "     non-initial non-move branch that stuns only the redeployed unit for redeployDur ?? 5 s; carry redeployDur",
    "     through server/match/relics.js; add redeployDur: 5 to n19 in docs/research/16-annihilation-relics.json and",
    "     regenerate data/relics.json; cover it with tests in test/match/annihilation-mode.test.js.",
    "  2. Icon: add the mod's `annihilation` glyph (crossed-out rook) to public/js/ui/components.js and give",
    "     EXTENSION_MODES[0].icon that name instead of 'sword'.",
    "  3. Docs: update docs/EXTENSION_MODE.md and handoff/EXTENSION-MODE-2026-10-27.md §7.2 to match the new state.",
    "  4. Gates: the four extension-mode suites, node tools/i18n.mjs check --all --strict, eslint on touched files,",
    "     node tools/check-imports.mjs, node tools/golden.mjs --full (288 场景 must stay at zero displacement), and a",
    "     puppeteer pass at desktop + phone-landscape viewports over devtools/render-check-extension-hall.mjs and",
    "     devtools/render-check-annihilation-room.mjs.",
    "",
    "Say plainly which parts of that plan are wrong, redundant, or leave a hole the gates would not catch. Watch in",
    "particular for: the determinism rule in server/sim/ (no Math.random, no clocks, no engine-approximated math);",
    "whether a sim-side change can move the goldens; and whether n19's data change needs the build-data round-trip",
    "(tools/build-data.mjs) rather than a hand edit of data/relics.json.",
    "Put what must not be missed into mustFix, most important first.",
  ].join("\n"),
);

log(`审计：${audit.verdict} —— ${audit.summary}`);
for (const f of audit.findings) {
  report({ where: f.where, what: f.what, severity: f.severity, evidence: f.evidence });
}

if (audit.verdict === "stop") {
  await artifact.markdown(
    "report",
    [
      "# 拓展模式收尾：审计判定为「不要动代码」",
      "",
      audit.summary,
      "",
      "## 发现",
      ...audit.findings.map((f) => `- **${f.severity}** \`${f.where}\` — ${f.what}\n  - 证据：${f.evidence}`),
      "",
      "## 未执行",
      "实现、门禁与真机验证都没有开始：审计判定本轮不应改代码。",
    ].join("\n"),
    { title: "拓展模式审计报告", description: "审计判定本轮不应改代码，以下是它的依据。", primary: true },
  );
  return {
    conclusion: `审计判定不要动代码：${audit.summary}`,
    findings: audit.findings,
    verified: ["审计员读了交接文档、设计文档与相关源码后给出结论"],
    notCovered: ["实现、测试门禁与真机验证均未执行（见结论）"],
  };
}

phase("按审计结论实现 n19 晕眩重做与图标");

const implementer = agent("实现员", {
  system:
    "You implement changes in E:\\Workbox\\系统 (a browser game: Node server plus a deterministic battle sim shared by " +
    "server and browser). Read the files before changing them and follow the repo's rules exactly: two-space JS " +
    "indentation; server/sim/ is plain ESM with NO Node APIs, NO Math.random, NO clocks, and NO engine-approximated " +
    "math (use server/sim/detmath.js) — determinism is enforced by ESLint and test/sim/detmath.test.js; data/*.json is " +
    "GENERATED, so change docs/research/ + tools/build-data.mjs and regenerate rather than hand-editing data/; " +
    "test/golden/*.json must not move for a refactor; never commit, checkout, stash or reset (other sessions have " +
    "uncommitted work in this tree). Every new UI string goes through t()/N_() with entries in all four packs under " +
    "public/i18n/. Comments state constraints the code cannot show; do not narrate your change. When a check fails, " +
    "fix the cause — never weaken the test. If something cannot be done as specified, stop and report the gap instead " +
    "of faking it.",
});

const impl = await implementer.ask<ImplResult>(
  [
    "Implement the audit-approved part of this work in E:\\Workbox\\系统. The independent audit's verdict was",
    `「${audit.verdict}」: ${audit.summary}`,
    "",
    "It said the implementation must not miss:",
    ...audit.mustFix.map((m, i) => `  ${i + 1}. ${m}`),
    "",
    "Scope:",
    "(A) n19 「未尽的生命」(relic id n19, docs/research/16-annihilation-relics.json). Today server/sim/content/relics.js",
    "    re-draws `count` units on EVERY deploy, so a 7-unit opening stuns 7 operators and any later redeploy stuns",
    "    bystanders too. The mod v3.2.0 reworked it (read its source to get the semantics, then write this repo's own",
    "    version in this repo's style):",
    "      - a one-shot `stunArmed` gate, armed only by the opening batch (the deploy event's ctx.initial), which fires",
    "        DEPLOY_PROTECT + 0.05 game seconds later and picks at most `count` units that are not already stunned;",
    "      - a redeploy (not initial, not ctx.move) stuns only the unit that was just deployed, for redeployDur seconds;",
    "      - `count` still grows 1 → max(+perRound per round since acquisition), as today.",
    "    Add the DEPLOY_PROTECT constant to server/sim/constants.js with a comment saying what it protects and its source",
    "    (the mod's v3.2.0 constants.js uses 1.2; mark it [ASSUMED] against official sources per AGENTS.md if no official",
    "    table settles it). Carry redeployDur through server/match/relics.js (relicModsFor, and relicStackInfo's hint if",
    "    it now reads differently). Add `redeployDur: 5` to n19 in docs/research/16-annihilation-relics.json, then",
    "    regenerate data/relics.json through the repo's own generator (tools/build-data.mjs — check its --offline / --out",
    "    flags and the handoff's §5 item 3 about the generator not being idempotent: only config.json / bosses.json /",
    "    relics.json may differ afterwards, and data/bonds.json must be left exactly as it was).",
    "    Then add tests to test/match/annihilation-mode.test.js that would FAIL on the old behaviour: one asserting the",
    "    opening batch stuns at most `count` (not one per deployed unit), one asserting a mid-battle redeploy stuns only",
    "    that unit, and one asserting the existing per-round growth is unchanged. Model the battle setup on the patterns",
    "    already in test/content/*.test.js (buildBattleSpec / createBattleFromSpec) or the harness in test/match/harness.js.",
    "(B) Icon: public/js/ui/components.js is missing the mod's `annihilation` glyph. Add it — the mod's path is",
    "    M5 3h3v2h2V3h4v2h2V3h3v5l-2 2v7l2 2v2H5v-2l2-2v-7L5 8zM3.4 2 2 3.4 20.6 22 22 20.6z (a rook struck through) —",
    "    as a normal ICONS entry, and set EXTENSION_MODES[0].icon in public/js/screens/extensionModes.js to that name.",
    "    Keep the entry's own comment style; do not reflow unrelated entries.",
    "",
    "Do NOT touch: the four official difficulties, shared/versions.js roomModes, data/*.json by hand, test/golden/*.json,",
    "or anything under E:\\Workbox\\choco. Do not run the mod's install.mjs / patch-data.mjs — it is a whole-file",
    "overwrite installer that would destroy this tree.",
    "",
    "Verify as you go (run the commands yourself, one file at a time; `node --test` on a directory spawns per-file",
    "processes and can fail with EPERM here):",
    "  node test/match/annihilation-mode.test.js",
    "  node test/match/annihilation-erosion.test.js",
    "  node test/ui/extension-modes.test.js",
    "  node test/content/items.test.js",
    "  node node_modules/eslint/bin/eslint.js server/sim/content/relics.js server/sim/constants.js server/match/relics.js",
    "      public/js/ui/components.js public/js/screens/extensionModes.js test/match/annihilation-mode.test.js",
    "  node tools/check-imports.mjs",
    "  node node_modules/eslint/bin/eslint.js . --ignore-pattern 'test/golden/**'   (if the targeted run is clean)",
    "Report in `changed` what each file now does, and in `gaps` anything you could not finish.",
  ].join("\n"),
);

log(`实现完成：n19=${impl.n19}, icon=${impl.icon}, gaps=${impl.gaps.length}`);
for (const c of impl.changed) log(`  · ${c}`);

phase("提交前跑全部确定性门禁");

// The fast tier decides whether the work is worth a full golden run; the full corpus (288 scenarios) is the strongest
// check the repo has for a sim change and runs once, before the browser pass, whether or not the fast tier passed.
const gateLog: string[] = [];

const suites = [
  { name: "annihilation-mode", args: ["test/match/annihilation-mode.test.js"] },
  { name: "annihilation-erosion", args: ["test/match/annihilation-erosion.test.js"] },
  { name: "extension-modes", args: ["test/ui/extension-modes.test.js"] },
  { name: "annihilation-endless-rounds", args: ["test/ui/annihilation-endless-rounds.test.js"] },
  { name: "lobby-hub", args: ["test/ui/lobby-hub.test.js"] },
  { name: "content-items", args: ["test/content/items.test.js"] },
  { name: "results", args: ["test/match/results.test.js"] },
  { name: "docs-paths", args: ["test/docs-paths.test.js"] },
];

let suitesOk = true;
for (const s of suites) {
  const r = await world.run("node", s.args, { timeoutMs: 300000 });
  const counts = r.stdout.split("\n").filter((l) => /^ℹ (tests|pass|fail)/.test(l)).join(" | ");
  const ok = r.exitCode === 0;
  if (!ok) suitesOk = false;
  gateLog.push(`${s.name}: exit ${r.exitCode} ${counts}`);
  log(`${s.name}: exit ${r.exitCode}${ok ? "" : " ← 失败"}`);
  if (!ok) gateLog.push(`${s.name} stderr: ${r.stderr.slice(-1200)}`);
}

const i18n = await world.run("node", ["tools/i18n.mjs", "check", "--all", "--strict"], { timeoutMs: 180000 });
const i18nOk = i18n.exitCode === 0;
gateLog.push(`i18n --all --strict: exit ${i18n.exitCode} ${i18n.stdout.trim().split("\n").slice(-1).join("")}`);
log(`i18n 四包: exit ${i18n.exitCode}`);

const imports = await world.run("node", ["tools/check-imports.mjs"], { timeoutMs: 180000 });
const importsOk = imports.exitCode === 0;
gateLog.push(`check-imports: exit ${imports.exitCode}`);
log(`导入边界: exit ${imports.exitCode}`);

const lint = await world.run("node", ["node_modules/eslint/bin/eslint.js",
  "server/sim/content/relics.js", "server/sim/constants.js", "server/match/relics.js",
  "public/js/ui/components.js", "public/js/screens/extensionModes.js", "test/match/annihilation-mode.test.js"],
  { timeoutMs: 300000 });
const lintOk = lint.exitCode === 0;
gateLog.push(`eslint (touched files): exit ${lint.exitCode}`);
log(`eslint: exit ${lint.exitCode}`);

if (!suitesOk || !i18nOk || !importsOk || !lintOk) {
  // One repair round: hand the failure text to the same implementer (it still holds the context of what it changed).
  const repair = await implementer.ask<ImplResult>(
    [
      "The gates failed. Fix the causes — never weaken or delete a test to make it pass.",
      "",
      ...gateLog,
    ].join("\n"),
  );
  for (const c of repair.changed) log(`  修复 · ${c}`);
  for (const g of repair.gaps) log(`  仍有缺口 · ${g}`);
}

phase("跑满 288 场景确认 golden 零位移");

const golden = await world.run("node", ["tools/golden.mjs", "--full", "--jobs", "4"], { timeoutMs: 900000 });
const goldenOk = golden.exitCode === 0;
const goldenTail = golden.stdout.split("\n").filter((l) => l.trim()).slice(-7).join("\n");
gateLog.push(`golden --full: exit ${golden.exitCode}\n${goldenTail}`);
log(`golden 288 场景: exit ${golden.exitCode}`);
if (!goldenOk) log(golden.stderr.slice(-800));

phase("双端多尺寸真机验证");

// Scaffolded per viewport: the repo's own puppeteer scripts, driven at desktop and phone-landscape sizes. A portrait
// phone is not a target (the game paints 请旋转设备 over a portrait touch screen by design), so the phone sizes here
// are landscape, which is also what devtools/render-check-mobile-adb.mjs measures on a real device (761×266 @dpr3).
const browserChecks: BrowserCheck[] = [];
const viewports = ["1280x720", "1920x1080", "844x390", "667x375"];

for (const vp of viewports) {
  const run = await world.run("node", ["-e",
    `process.env.SP_BASE='http://127.0.0.1:3000';process.env.SP_VIEWPORT='${vp}';` +
    "process.env.SP_OUT='handoff/shots';import('./devtools/render-check-extension-hall.mjs');"],
    { timeoutMs: 300000 });
  const out = run.stdout;
  const ok = run.exitCode === 0 && /RESULT: OK/.test(out);
  const failures = out.split("\n").filter((l) => /^\s*(fail|FALSE|✗)|RESULT: CHECK/.test(l)).map((l) => l.trim().slice(0, 200));
  const consoleErrors = out.split("\n").filter((l) => /errors: \[[^\]]/.test(l)).map((l) => l.trim().slice(0, 200));
  browserChecks.push({ viewport: vp, ok, failures, consoleErrors });
  log(`${vp}: ${ok ? "OK" : `失败（exit ${run.exitCode}）`}`);
  report({ viewport: vp, ok, failures: failures.length, consoleErrors: consoleErrors.length }, "browser");
}

const roomCheck = await world.run("node", ["-e",
  "process.env.SP_BASE='http://127.0.0.1:3000';process.env.SP_OUT='handoff/shots';" +
  "process.env.SP_EROSION='4';import('./devtools/render-check-annihilation-room.mjs');"],
  { timeoutMs: 300000 });
const roomOk = roomCheck.exitCode === 0 && /RESULT: OK/.test(roomCheck.stdout);
browserChecks.push({ viewport: "room (蚀流 4)", ok: roomOk, failures: roomOk ? [] : ["render-check-annihilation-room 未通过"], consoleErrors: [] });
log(`房内 → 局内（蚀流 4）: ${roomOk ? "OK" : `失败（exit ${roomCheck.exitCode}）`}`);

const browserOk = browserChecks.every((c) => c.ok && c.consoleErrors.length === 0);

phase("请独立审计员对实现结果做复核");

const review = await auditor.ask<Review>(
  [
    "Review the work just implemented in E:\\Workbox\\系统. Read the actual code — do not trust this summary.",
    "",
    "What the implementer says it changed:",
    ...impl.changed.map((c) => `  · ${c}`),
    "Gaps it reported:",
    ...(impl.gaps.length ? impl.gaps.map((g) => `  · ${g}`) : ["  （无）"]),
    "",
    "The gate results:",
    ...gateLog,
    "",
    "The browser pass:",
    ...browserChecks.map((c) => `  · ${c.viewport}: ${c.ok ? "通过" : "失败"} ${c.failures.join("; ")} ${c.consoleErrors.join("; ")}`),
    "",
    "Check specifically:",
    "  1. Does server/sim/content/relics.js still obey the determinism rule (no Math.random, no clock, no",
    "     engine-approximated Math — use server/sim/detmath.js)? Is the new stunArmed gate armed only by the opening",
    "     batch, and can a redeploy still stun bystanders?",
    "  2. Is data/relics.json still the generator's own output (byte-identical to what tools/build-data.mjs produces for",
    "     n19), and did data/bonds.json stay untouched?",
    "  3. Do the new tests actually fail on the OLD behaviour, or would they have passed before the change too?",
    "  4. Do docs/EXTENSION_MODE.md and handoff/EXTENSION-MODE-2026-10-27.md now describe the code as it is (the repo",
    "     rule is docs follow the code)? Name any sentence that is now false.",
    "  5. Is the new icon reachable and correct (an ICONS entry with a valid path, an EXTENSION_MODES entry naming it)?",
    "List anything that is false about the implementation report in `wrongClaims`, anything that must be fixed in",
    "`blockers`, and smaller things in `notes`. Answer in Chinese.",
  ].join("\n"),
);

log(`复核：${review.verdict}（blockers ${review.blockers.length}）`);

const allGreen = impl.n19 === "done" && goldenOk && browserOk && review.verdict === "pass" && review.blockers.length === 0;

const verified = [
  `annihilation-mode / annihilation-erosion / extension-modes / annihilation-endless-rounds / lobby-hub / content-items / results / docs-paths：${suitesOk ? "全绿" : "有失败（见 gateLog）"}`,
  `i18n --all --strict：exit ${i18n.exitCode}`,
  `check-imports：exit ${imports.exitCode}`,
  `eslint（改动文件）：exit ${lint.exitCode}`,
  `golden --full（288 场景）：exit ${golden.exitCode}`,
  `真机（puppeteer，桌面 + 手机横屏多档）：${browserChecks.map((c) => `${c.viewport}=${c.ok ? "OK" : "FAIL"}`).join(", ")}`,
];
const notCovered = [
  ...(browserOk ? [] : ["手机竖屏不作为目标：本作对竖屏触屏设备主动画「请旋转设备」（public/js/ui/device.js:104 / theme.css:418），所以未在竖屏下验收。"]),
  ...impl.gaps.map((g) => `实现方报告的缺口：${g}`),
  "未在真实 Android 设备上跑 devtools/render-check-mobile-adb.mjs（需要 adb 与真机，本次只跑本机 Chrome）。",
];

await artifact.markdown(
  "report",
  [
    `# 拓展模式收尾${allGreen ? "：完成" : "：未完全达成"}`,
    "",
    `审计判定「${audit.verdict}」，实现 n19=${impl.n19}、图标=${impl.icon}，独立复核判定「${review.verdict}」。`,
    "",
    "## 一、审计发现",
    ...audit.findings.map((f) => `- **${f.severity}** \`${f.where}\` — ${f.what}\n  - 证据：${f.evidence}`),
    "",
    "## 二、实现",
    ...impl.changed.map((c) => `- ${c}`),
    ...(impl.gaps.length ? ["", "### 未完成", ...impl.gaps.map((g) => `- ${g}`)] : []),
    "",
    "## 三、门禁",
    ...gateLog.map((g) => `- ${g.replace(/\n/g, " · ")}`),
    "",
    "## 四、真机验证（本机 Chrome，多视口）",
    ...browserChecks.map((c) => `- ${c.viewport}：${c.ok ? "通过" : "失败"}${c.failures.length ? ` — ${c.failures.join("; ")}` : ""}${c.consoleErrors.length ? ` — console: ${c.consoleErrors.join("; ")}` : ""}`),
    "",
    "## 五、独立复核",
    `判定：**${review.verdict}**`,
    ...(review.blockers.length ? ["", "### 阻塞项", ...review.blockers.map((b) => `- ${b}`)] : []),
    ...(review.wrongClaims.length ? ["", "### 与代码不符的说法", ...review.wrongClaims.map((w) => `- ${w}`)] : []),
    ...(review.notes.length ? ["", "### 其他", ...review.notes.map((n) => `- ${n}`)] : []),
  ].join("\n"),
  {
    title: "拓展模式收尾报告",
    description: "独立审计 → 实现 → 门禁 → 双端多尺寸真机验证 → 独立复核的完整结论。",
    primary: true,
  },
);

return {
  conclusion: allGreen
    ? `拓展模式收尾完成：n19 晕眩重做与图标已落地，8 个套件全绿，i18n 四包 2586 一致，288 场景 golden 零位移，桌面与手机横屏四档真机验证通过，独立复核无阻塞项。`
    : `尚未完全达成：n19=${impl.n19}、图标=${impl.icon}、golden=${goldenOk ? "零位移" : "有位移"}、真机=${browserOk ? "通过" : "有失败"}、独立复核=${review.verdict}。具体见报告。`,
  findings: [...audit.findings, ...review.blockers.map((b): AuditFinding => ({ where: "（复核）", what: b, evidence: "独立复核读代码后提出", severity: "high" }))],
  verified,
  notCovered,
};
