// tools/fetch-illusts.mjs — 下载官方「全幅立绘」并内置到本地（最高清版本）
//
// 官方 skin_table.json 的 charSkins[] 给出每套外观的 portraitId；社区 dump（yuanyan3060/ArknightsGameResource）
// 的 `skin/{portraitId}b.png` 就是原始全幅立绘（通常 ≥1024px，远大于 180×360 的半身像）。
//
// 输出（git 忽略，构建期由 tools/inject-skins-assets.mjs 写进 data/assets.json）：
//   public/assets/char/illust/{charId}.png              干员默认外观（优先 E2：charId_2b，回退 charId_1b）
//   public/assets/char/illust/{charId}_1.png            干员的**精一**全幅立绘（charId_1b，`--phases=1|both` 才下载）
//   public/assets/char/illust/skin/{stem}.png           一套皮肤的立绘（stem 来自 docs/research/08-skins.json）
//
// 只下载已安装清单（data/skins-installed.json）里的皮肤；干员覆盖 manifest 里现有的全部 chars。
// 幂等：>1KB 且 PNG 头/IEND 通过的已有文件跳过。失败不写坏文件（临时文件 + 原子重命名）。
//
//   node tools/fetch-illusts.mjs [--ops-only|--skins-only] [--phases=best|1|both] [--concurrency=6] [--dry-run]
//   node tools/fetch-illusts.mjs --ops-only --ids=char_219_meteo,char_002_amiya   # 定向：只处理这些 id
//   node tools/fetch-illusts.mjs --ops-only --phases=1 --ids=…                    # 只补 <id>_1.png（精一全图）
//
// `--phases`：`best`（缺省）= 每个干员最高精英阶段的立绘 → `<id>.png`（历史行为，一个干员一张）；
// `1` = 只要 `#1` 默认外观（精一）→ `<id>_1.png`；`both` = 两种都下。三种走**同一套 URL 规则**
// （`portraitId` + `b.png`，同一个镜像表），不另拼地址。
//
// 说明：这是「原始全幅图」，不做上采样；小图（avatar / portrait）仍用于列表、棋盘和名片。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIN_TABLE = path.join(ROOT, '.cache', 'gamedata', 'excel', 'skin_table.json');
const RESEARCH = path.join(ROOT, 'docs', 'research', '08-skins.json');
const INSTALLED = path.join(ROOT, 'data', 'skins-installed.json');
const ASSETS = path.join(ROOT, 'data', 'assets.json');
const OUT_OPS = path.join(ROOT, 'public', 'assets', 'char', 'illust');
const OUT_SKINS = path.join(OUT_OPS, 'skin');

const args = new Set(process.argv.slice(2));
const wantOps = !args.has('--skins-only');
const wantSkins = !args.has('--ops-only');
const dryRun = args.has('--dry-run');
const concurrencyArg = process.argv.find((a) => a.startsWith('--concurrency='));
const CONCURRENCY = Math.max(1, Math.min(16, Number(concurrencyArg?.split('=')[1]) || 6));
// --max=N: process at most N tasks this run (resume-friendly: existing files are skipped next time)
const maxArg = process.argv.find((a) => a.startsWith('--max='));
const MAX = Number(maxArg?.split('=')[1]) > 0 ? Math.floor(Number(maxArg.split('=')[1])) : Infinity;
// --export=path: write the pending tasks as JSON (id / dest / urls) for an external parallel downloader, then exit.
const exportArg = process.argv.find((a) => a.startsWith('--export='));
// --ids=a,b: only these ids (operator charIds; a skin task matches its skinId). Keeps a targeted run from
// planning the whole pending set, which is what trips the mirror's circuit breaker on a slow line.
const idsArg = process.argv.find((a) => a.startsWith('--ids='));
const ONLY_IDS = idsArg ? new Set(idsArg.slice('--ids='.length).split(',').map((s) => s.trim()).filter(Boolean)) : null;
// --phases=best|1|both: which operator illustration(s) to fetch. 'best' is the historical behaviour (one file per
// operator, the highest elite phase). '1' fetches only the #1 default appearance → `<id>_1.png` (the 精一 full art,
// which the seat card reads); 'both' does each operator's 精一 and that highest phase. Same URL rule for all three.
const phasesArg = process.argv.find((a) => a.startsWith('--phases='));
const PHASES = phasesArg ? phasesArg.slice('--phases='.length).trim() : 'best';
if (!['best', '1', 'both'].includes(PHASES)) {
  console.error(`[illusts] --phases must be best | 1 | both (got "${PHASES}")`);
  process.exit(2);
}

// 同一份文件的几套取法（都只是传输层，路径/文件名规则只有一份：`portraitId` + `b.png`）。
// 本机实测（2026-10）：`cdn.jsdelivr.net` 与 raw 直连 TLS 重置；`ghfast.top` 也常 reset；
// jsDelivr 的 **gcore 边缘**能通且最快（8 并发约 0.7 MB/s，gh-proxy 只有 ~32 KB/s），所以它排第一，
// 第三方 GitHub 代理（gh-proxy）收在后面兜底。
const CDN_HOSTS = [
  'https://gcore.jsdelivr.net/gh/yuanyan3060/ArknightsGameResource@main/skin/',
  'https://cdn.jsdelivr.net/gh/yuanyan3060/ArknightsGameResource@main/skin/',
];
const RAW = 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/skin/';
const PROXIES = ['https://gh-proxy.com/', 'https://ghfast.top/'];

function pngOk(buf) {
  if (!buf || buf.length < 1024) return false;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) return false;
  return buf.includes(Buffer.from('IEND', 'ascii'));
}

const existsOk = (file) => {
  try { return fs.statSync(file).size > 1024; } catch { return false; }
};

function illoUrl(portraitId) {
  const name = encodeURIComponent(`${portraitId}b.png`);
  return [...CDN_HOSTS.map((c) => `${c}${name}`), ...PROXIES.map((p) => `${p}${RAW}${name}`), `${RAW}${name}`];
}

async function downloadOne(task) {
  if (existsOk(task.dest)) return 'skipped';
  if (dryRun) return 'planned';
  fs.mkdirSync(path.dirname(task.dest), { recursive: true });
  let sawOther = false;
  for (const url of task.urls) {
    try {
      // 每个 URL 都有硬超时：镜像偶尔建立连接后不再发正文，没有超时就会永远挂住（本次 meteo 就这样停过一次）。
      const res = await fetch(url, { headers: { 'User-Agent': 'Stronghold-Assets-Sync/1.0' }, signal: AbortSignal.timeout(180000) });
      if (res.status === 404 || res.status === 410) continue; // absent upstream, try the next mirror
      if (!res.ok) { sawOther = true; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!pngOk(buf)) { sawOther = true; continue; }
      const tmp = `${task.dest}.part`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, task.dest);
      return 'downloaded';
    } catch { sawOther = true; /* next mirror */ }
  }
  // 两个镜像都 404：官方 dump 没有这张图（无立绘的皮肤/干员），不是本轮的失败。
  return sawOther ? 'failed' : 'miss';
}

async function main() {
  if (!fs.existsSync(SKIN_TABLE)) {
    console.error(`missing ${path.relative(ROOT, SKIN_TABLE)} — run tools/build-data.mjs (or fetch-assets --refresh-index) first`);
    process.exit(1);
  }
  const table = JSON.parse(fs.readFileSync(SKIN_TABLE, 'utf8'));
  const charSkins = table.charSkins || {};
  const research = JSON.parse(fs.readFileSync(RESEARCH, 'utf8'));
  const installed = fs.existsSync(INSTALLED) ? new Set(JSON.parse(fs.readFileSync(INSTALLED, 'utf8'))) : null;
  const assets = JSON.parse(fs.readFileSync(ASSETS, 'utf8'));

  const tasks = [];

  if (wantOps) {
    // 每个干员的默认外观按阶段收：`charId#1` = 精一（charId_1b），`#2` = 精二（charId_2b）。同一阶段重复（`#1` / `#1+`）
    // 取先出现的那个。`best` / `1` / `both` 决定把哪几条变成任务，URL 一律走 illoUrl(portraitId)。
    const byPhase = new Map();
    for (const [skinId, s] of Object.entries(charSkins)) {
      if (!s || !s.portraitId) continue;
      const m = /^(.*)#(\d+)$/.exec(skinId);
      if (!m || m[1] !== s.charId) continue; // 只认默认外观（skinId 前缀就是 charId）
      if (!assets.chars?.[s.charId]) continue;
      const phase = Number(m[2]) || 1;
      let phases = byPhase.get(s.charId);
      if (!phases) byPhase.set(s.charId, phases = new Map());
      if (!phases.has(phase)) phases.set(phase, s.portraitId);
    }
    for (const [charId, phases] of byPhase) {
      const top = Math.max(...phases.keys());
      if (PHASES === 'best' || PHASES === 'both') {
        tasks.push({ kind: 'operator', id: charId, dest: path.join(OUT_OPS, `${charId}.png`), urls: illoUrl(phases.get(top)) });
      }
      if ((PHASES === '1' || PHASES === 'both') && phases.has(1)) {
        tasks.push({ kind: 'operator1', id: charId, dest: path.join(OUT_OPS, `${charId}_1.png`), urls: illoUrl(phases.get(1)) });
      }
    }
  }

  if (wantSkins) {
    for (const [charId, list] of Object.entries(research.skins || {})) {
      if (!assets.chars?.[charId]) continue;
      for (const s of list || []) {
        if (installed && !installed.has(s.skinId)) continue;
        const row = charSkins[s.skinId];
        if (!row || !row.portraitId || !s.stem) continue;
        tasks.push({ kind: 'skin', id: s.skinId, dest: path.join(OUT_SKINS, `${s.stem}.png`), urls: illoUrl(row.portraitId) });
      }
    }
  }

  const seen = new Set();
  const uniqAll = tasks.filter((t) => (!ONLY_IDS || ONLY_IDS.has(t.id)) && (seen.has(t.dest) ? false : (seen.add(t.dest), true)));
  const already = uniqAll.filter((t) => existsOk(t.dest));
  const pending = uniqAll.filter((t) => !existsOk(t.dest));
  const uniq = pending.slice(0, MAX);
  const skipped = already.length;
  if (exportArg) {
    const file = path.resolve(ROOT, exportArg.slice('--export='.length));
    fs.writeFileSync(file, JSON.stringify(uniq.map((t) => ({ id: t.id, dest: t.dest, urls: t.urls })), null, 1));
    console.log(`[illusts] exported ${uniq.length} pending tasks → ${path.relative(ROOT, file)}`);
    return;
  }
  const plannedOps = uniq.filter((t) => t.kind === 'operator').length;
  const plannedOps1 = uniq.filter((t) => t.kind === 'operator1').length;
  console.log(`[illusts] ${plannedOps} operators`
    + `${PHASES === '1' || PHASES === 'both' ? ` + ${plannedOps1} 精一 (<id>_1.png)` : ''} + `
    + `${uniq.filter((t) => t.kind === 'skin').length} skins → ${path.relative(ROOT, OUT_OPS)}` +
    `${dryRun ? ' (dry run)' : ''}; ${skipped} already on disk, ${pending.length - uniq.length} left for later runs`);

  let cursor = 0, downloaded = 0, planned = 0, failed = 0, missed = 0;
  const failedList = [];
  async function worker() {
    while (cursor < uniq.length) {
      const task = uniq[cursor++];
      const status = await downloadOne(task);
      if (status === 'downloaded') downloaded++;
      else if (status === 'planned') planned++;
      else if (status === 'miss') missed++;
      else if (status === 'skipped') { /* raced with another run: already on disk */ }
      else { failed++; failedList.push(task.id); }
      const done = downloaded + planned + failed + missed;
      if (done % 25 === 0 || done === uniq.length) {
        process.stdout.write(`\r[illusts] ${done}/${uniq.length} (new ${downloaded}, skip ${skipped}${dryRun ? `, plan ${planned}` : ''}, absent ${missed}, fail ${failed})`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  process.stdout.write('\n');
  if (failedList.length) {
    console.log(`[illusts] failed ${failedList.length}: ${failedList.slice(0, 12).join(', ')}${failedList.length > 12 ? ' …' : ''}`);
  }
  if (missed) console.log(`[illusts] ${missed} without an upstream illustration (reported, not an error)`);
  console.log(`[illusts] done.`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error(e?.stack || e); process.exitCode = 1; });
