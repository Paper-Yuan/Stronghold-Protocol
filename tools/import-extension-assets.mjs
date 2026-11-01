// tools/import-extension-assets.mjs — import the art that ships INSIDE an extension mod package, and report what the
// play sets still lack on this machine.
//
// Why a separate tool: `tools/fetch-assets.mjs` downloads the whole art/audio/font set of the official client (gigabytes)
// and rewrites the committed `data/assets.json`. The play sets (炸惊模拟 / 湮灭模拟) additionally need a handful of files
// that only exist inside the mod packages we ported from, plus per-operator art that the base pipeline already covers.
// This tool copies the former from `modref/` (git-ignored, never committed) and prints a coverage table for the latter —
// it never downloads anything and never rewrites `data/`.
//
//   node tools/import-extension-assets.mjs            # report only (no writes)
//   node tools/import-extension-assets.mjs --apply    # copy the mod-package art into public/assets/
//   node tools/import-extension-assets.mjs --apply --zip="D:\…\炸惊模拟整合包公开版v2.1.zip"
//                                                     # read the skill icons straight out of the package archive
//
// Source layout it understands (see docs/ANNIHILATION-MODS.md, docs/ZHAJING.md):
//   modref/mods/<mod>/.../payload/packs/<pack>/art/bond_<bondId>.png     → public/assets/bond/<bondId>.png
//   modref/v2.1/public/{img,icons}/**/bond_<bondId>.png                  → public/assets/bond/<bondId>.png
//   modref/v2.1/public/assets/skill/<iconId>.png                        → public/assets/skill/<iconId>.png
//   modref/mods/**/skill/<iconId>.png                                    → public/assets/skill/<iconId>.png
//   <package>.zip  …/public/assets/skill/<iconId>.png                    → public/assets/skill/<iconId>.png  (--zip)
//
// Skill icons are never keyed by the chess id: the client asks for a skill ICON id and reads it out of the manifest
// (`skills[iconId]` / `skillsById[skillId]`, public/js/ui/assetUrls.js). The chain of the official tables is
//   charId → character_table[charId].skills[].skillId → skill_table[skillId].iconId (else prefabId, else skillId)
// and that is what this tool resolves, with the play set's own records (data/chess.json skills[].iconId / assets.
// skillIcon) filling whatever the local table cache does not list. Copying the file is only half the job: the entry in
// data/assets.json is what the client actually consults, and `tools/patch-assets-local.mjs --write --slots skills`
// merges the icons that are on disk into it (it also syncs public/data/).
//
// `public/assets/` is git-ignored (AGENTS.md "No game art in git"), so this only ever fills the working tree.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const rel = (p) => path.relative(ROOT, p).split('\\').join('/');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const readJsonIf = (p) => { try { return readJson(p); } catch { return null; } };
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/** All files under `dir` (relative to ROOT) whose basename matches `test`. */
function walk(dirAbs, test, out = []) {
  let entries;
  try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const abs = path.join(dirAbs, e.name);
    if (e.isDirectory()) walk(abs, test, out);
    else if (test(e.name)) out.push(abs);
  }
  return out;
}

// ── what the play sets need ────────────────────────────────────────────────────────────────────────────────────────
const data = readJson('data/chess.json');
const bonds = readJson('data/bonds.json');

const zjRecords = Object.values(data).filter((r) => r.zhajing === true && !r.isGolden);
const zjCharIds = [...new Set(zjRecords.map((r) => r.charId).filter(Boolean))].sort();
const annBondIds = Object.keys(bonds).filter((id) => bonds[id] && bonds[id].annOnly === true).sort();

/**
 * The 炸惊-exclusive operators: the ones whose kit was ported from the package (server/sim/content/kits/ops/
 * chess_zj_*.js — every port note names its charId in parentheses). The rest of `zjCharIds` are official operators the
 * base pipeline already serves, so the report marks the exclusive ones instead of drowning them in 100 rows.
 * @returns {Set<string>} charIds
 */
function exclusiveCharIds() {
  const out = new Set();
  const dirAbs = path.join(ROOT, 'server', 'sim', 'content', 'kits', 'ops');
  for (const abs of walk(dirAbs, (n) => /^chess_zj_.+\.js$/.test(n))) {
    let head;
    try { head = fs.readFileSync(abs, 'utf8').slice(0, 800); } catch { continue; }
    const m = head.match(/\((char_\d+_[a-z0-9_]+)\)/);
    if (m) out.add(m[1]);
  }
  return out;
}
const exclusive = exclusiveCharIds();

// ── phase A: art that ships inside the mod packages (offline, copy) ───────────────────────────────────────────────
const modsRoot = path.join(ROOT, 'modref');
const bondSources = new Map();               // bondId -> absolute source file
for (const abs of walk(modsRoot, (n) => /^bond_[A-Za-z0-9]+\.png$/.test(n))) {
  const id = path.basename(abs).replace(/^bond_/, '').replace(/\.png$/, '');
  if (!bondSources.has(id)) bondSources.set(id, abs);
}
for (const abs of walk(path.join(ROOT, 'modref', 'v2.1', 'public'), (n) => /^bond_[A-Za-z0-9]+\.png$/.test(n))) {
  const id = path.basename(abs).replace(/^bond_/, '').replace(/\.png$/, '');
  if (!bondSources.has(id)) bondSources.set(id, abs);
}

const copies = [];
for (const [id, src] of bondSources) {
  const dest = path.join(ROOT, 'public', 'assets', 'bond', `${id}.png`);
  const already = fs.existsSync(dest);
  const wanted = annBondIds.includes(id) || Object.hasOwn(bonds, id);
  if (already || !wanted) continue;
  copies.push({ id, src, dest });
}
if (APPLY) {
  for (const c of copies) {
    fs.mkdirSync(path.dirname(c.dest), { recursive: true });
    fs.copyFileSync(c.src, c.dest);
  }
}

// ── phase C: skill icons (charId → skills[] → skill_table.iconId → the package's skill_icon file) ─────────────────
const SKILL_DIR = 'public/assets/skill';

/** Local file name of an icon id — the same sanitizer tools/assets/versions.mjs uses for `skill/<iconId>.png`. */
const iconFile = (iconId) => `${String(iconId).replace(/[^a-zA-Z0-9._-]/g, '_')}.png`;

/**
 * charId → Map(skillId → iconId) for every 炸惊 operator. The official table chain comes first; the play set's own chess
 * records then fill in whatever the local `.cache/gamedata` copy does not know (a null `iconId` in skill_table is normal
 * for these rows — the icon file is then named by the skillId, exactly like tools/assets/plan.mjs:491 does it).
 * @returns {Map<string, Map<string, string>>}
 */
function zhajingSkills() {
  const ct = readJsonIf('.cache/gamedata/excel/character_table.json');
  const st = readJsonIf('.cache/gamedata/excel/skill_table.json');
  const rows = new Map();
  const put = (charId, skillId, iconId) => {
    if (!charId || !skillId) return;
    if (!rows.has(charId)) rows.set(charId, new Map());
    const m = rows.get(charId);
    if (!m.get(skillId)) m.set(skillId, iconId || skillId);
  };
  for (const id of zjCharIds) {
    for (const s of ct?.[id]?.skills || []) {
      const t = st?.[s.skillId] || {};
      put(id, s.skillId, t.iconId || t.prefabId || s.skillId);
    }
  }
  for (const rec of zjRecords) {
    for (const s of [...(rec.skills || []), ...(rec.skill ? [rec.skill] : [])]) {
      put(rec.charId, s.skillId, s.iconId || s.prefabId);
    }
  }
  return rows;
}

const skillMap = zhajingSkills();
const charName = new Map();
for (const rec of zjRecords) if (rec.charId && rec.name && !charName.has(rec.charId)) charName.set(rec.charId, rec.name);

const iconIds = [...new Set([...skillMap.values()].flatMap((m) => [...m.values()]))].sort();
const wantedFiles = new Map(iconIds.map((id) => [iconFile(id), id]));

/** Extracted package trees: skill icon id → absolute file (either the unpacked 2.1 tree or a mod's payload). */
const treeHits = new Map();
for (const sub of ['modref/v2.1/public', 'modref/mods']) {
  for (const abs of walk(path.join(ROOT, sub), (n) => wantedFiles.has(n))) {
    const iconId = wantedFiles.get(path.basename(abs));
    if (!treeHits.has(iconId)) treeHits.set(iconId, abs);
  }
}

/** `--zip=<path>` | `--zip <path>` | $SP_MOD_ZIP. A missing archive only costs the zip source; the report says so. */
function zipArg() {
  const argv = process.argv;
  const i = argv.findIndex((a) => a === '--zip' || a.startsWith('--zip='));
  let p = '';
  if (i >= 0) p = argv[i].includes('=') ? argv[i].slice(argv[i].indexOf('=') + 1) : (argv[i + 1] || '');
  if (!p && process.env.SP_MOD_ZIP) p = process.env.SP_MOD_ZIP;
  return p ? path.resolve(p) : '';
}

/**
 * Index a ZIP archive without a dependency: read the end-of-central-directory record, walk the central directory once
 * and keep only the entries whose basename is a skill icon we want. The bytes of an entry are read on demand (stored or
 * deflated), so a 1 GB package only ever has a few small PNGs pulled through. ZIP64 (an archive > 4 GB) is refused with
 * a message that names the fallback (the extracted tree).
 * @param {string} absPath
 * @returns {{path:string, fd:number, size:number, entries:Map<string,{method:number, compSize:number, localOffset:number, name:string}>}}
 */
function openZip(absPath) {
  const size = fs.statSync(absPath).size;
  const fd = fs.openSync(absPath, 'r');
  const close = (e) => { fs.closeSync(fd); throw e; };
  const tailLen = Math.min(size, 132 * 1024);
  const tail = Buffer.alloc(tailLen);
  fs.readSync(fd, tail, 0, tailLen, size - tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) close(new Error(`${absPath}: no end-of-central-directory record (not a zip?)`));
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    close(new Error(`${absPath}: ZIP64 archives are not supported (use the extracted tree instead)`));
  }
  const cd = Buffer.alloc(cdSize);
  fs.readSync(fd, cd, 0, cdSize, cdOffset);
  const entries = new Map();
  for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const localOffset = cd.readUInt32LE(p + 42);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/(^|\/)public\/assets\/skill\//.test(name)) continue;
    const iconId = wantedFiles.get(name.slice(name.lastIndexOf('/') + 1));
    if (iconId) entries.set(iconId, { method, compSize, localOffset, name });
  }
  return { path: absPath, fd, size, entries };
}

/** The bytes of one indexed ZIP entry (stored or deflated). */
function zipBytes(zip, entry) {
  const lfh = Buffer.alloc(30);
  fs.readSync(zip.fd, lfh, 0, 30, entry.localOffset);
  if (lfh.readUInt32LE(0) !== 0x04034b50) throw new Error(`${entry.name}: bad local file header`);
  const nameLen = lfh.readUInt16LE(26);
  const extraLen = lfh.readUInt16LE(28);
  const raw = Buffer.alloc(entry.compSize);
  fs.readSync(zip.fd, raw, 0, entry.compSize, entry.localOffset + 30 + nameLen + extraLen);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`${entry.name}: unsupported compression method ${entry.method}`);
}

const zipPath = zipArg();
if (zipPath && !fs.existsSync(zipPath)) console.error(`[warn] --zip 指向的包不在磁盘上：${zipPath}（本次不读包内文件）`);
const zip = zipPath && fs.existsSync(zipPath) ? openZip(zipPath) : null;

const skillState = new Map();          // iconId -> 'present' | 'tree' | 'zip' | 'missing'
for (const iconId of iconIds) {
  const file = `${SKILL_DIR}/${iconFile(iconId)}`;
  if (exists(file)) skillState.set(iconId, 'present');
  else if (treeHits.has(iconId)) skillState.set(iconId, 'tree');
  else if (zip?.entries.has(iconId)) skillState.set(iconId, 'zip');
  else skillState.set(iconId, 'missing');
}
const skillCopies = [...skillState]
  .filter(([, state]) => state === 'tree' || state === 'zip')
  .map(([iconId, via]) => ({
    iconId, via,
    dest: path.join(ROOT, SKILL_DIR, iconFile(iconId)),
    src: via === 'tree' ? treeHits.get(iconId) : zip.entries.get(iconId),
  }));

const PNG_SIG = 0x89504e47;
if (APPLY) {
  for (const c of skillCopies) {
    const buf = c.via === 'zip' ? zipBytes(zip, c.src) : fs.readFileSync(c.src);
    // A mis-named entry (an HTML error page cached as .png) must never land in public/assets/.
    if (buf.length < 8 || buf.readUInt32BE(0) !== PNG_SIG) throw new Error(`${c.iconId}: source is not a PNG`);
    fs.mkdirSync(path.dirname(c.dest), { recursive: true });
    fs.writeFileSync(c.dest, buf);
  }
}
if (zip) fs.closeSync(zip.fd);

// The manifest is what the client consults: a file on disk with no entry is an icon that still renders as the empty
// skill glyph. Reported here (never written here — data/ belongs to the generators).
// The primary lookup is `skills[iconId]` (public/js/ui/assetUrls.js skillIconUrl); `skillsById[skillId]` is the second
// path the same module falls back to (skillRecordIconUrl), so both are counted and both must exist.
const manifest = readJsonIf('data/assets.json') || {};
const inManifest = (iconId) => !!manifest.skills?.[iconId];
const inManifestById = (skillId) => !!manifest.skillsById?.[skillId];
const manifestGap = [...skillMap.values()].flatMap((m) => [...m.entries()]).filter(([sid, icon]) => !inManifest(icon) || !inManifestById(sid));

// ── phase B: per-operator art the play sets use, by the layout public/assets/char actually has ────────────────────
const CHAR_KINDS = ['avatar', 'portrait', 'illust', 'illustration', 'skin_avatar', 'skin_portrait'];
const charKindFiles = {};
for (const kind of CHAR_KINDS) {
  try { charKindFiles[kind] = fs.readdirSync(path.join(ROOT, 'public', 'assets', 'char', kind)); } catch { charKindFiles[kind] = []; }
}
const countFiles = (dirAbs) => walk(dirAbs, () => true).length;
/** Files of one operator per kind: `char/avatar/<charId>.png`, `char/portrait/<charId>_1.png`, … (prefix, `_` or `.`). */
function charCoverage(charId) {
  const own = new RegExp(`^${charId}[._]`);
  const out = {};
  for (const kind of CHAR_KINDS) out[kind] = charKindFiles[kind].filter((n) => n.startsWith(`${charId}.`) || own.test(n)).length;
  out.spine = countFiles(path.join(ROOT, 'public', 'assets', 'spine', 'op', charId));
  out.voice = countFiles(path.join(ROOT, 'public', 'assets', 'audio', 'voice', 'cn', charId));
  return out;
}
const charRows = zjCharIds.map((id) => ({ id, kinds: charCoverage(id) }));
const charMissing = charRows.filter((r) => Object.values(r.kinds).every((n) => n === 0)).map((r) => r.id);

const zjItems = Object.values(readJson('data/items.json')).filter((i) => i.zjOnly === true);
const itemMissing = zjItems.filter((i) => !exists(`public/assets/item/${i.id}.png`)).map((i) => i.id);

const bondMissing = annBondIds.filter((id) => !exists(`public/assets/bond/${id}.png`) && !copies.some((c) => c.id === id));

// ── report ───────────────────────────────────────────────────────────────────────────────────────────────────────
const line = (label, value) => console.log(`${label.padEnd(34)} ${value}`);
console.log(`mode  ${APPLY ? 'apply' : 'report'}   (public/assets is git-ignored; nothing is committed)`);
console.log('');
console.log('A · 来自 mod 包的美术（本工具唯一的写入动作）');
line('候选 bond 图（modref/**）', bondSources.size);
line('需要拷贝', copies.length);
for (const c of copies) line(`  ${c.id}`, `${rel(c.src)} → public/assets/bond/`);
if (!APPLY && copies.length) console.log('  （加 --apply 才真的复制）');
console.log('');
console.log('C · 技能图标（charId → skills[] → skill_table.iconId → skill_icon 文件）');
line('炸惊干员位 charId', zjCharIds.length);
line('  其中有 kit 的专属干员', exclusive.size);
line('需要的技能 iconId', iconIds.length);
line('  已在 public/assets/skill', [...skillState.values()].filter((s) => s === 'present').length);
line('  可从包里拷贝', skillCopies.length);
line('  包内也没有', [...skillState.values()].filter((s) => s === 'missing').length);
line('  清单里没有（data/assets.json）', manifestGap.length);
line('包 zip 来源', zip ? `${zip.path}（${zip.entries.size} 个 icon 命中）` : '未提供（--zip=<path> 或 $SP_MOD_ZIP）');
for (const c of skillCopies) line(`  ${c.iconId}`, `${c.via === 'zip' ? 'zip' : rel(c.src)} → public/assets/skill/`);
console.log('');
console.log('  · 专属干员逐项（kinds = public/assets/char/<kind> 下的文件数；skill = iconId 状态）');
for (const id of [...exclusive].sort()) {
  const cov = charCoverage(id);
  const skills = [...(skillMap.get(id) || new Map())];
  const iconTxt = skills.length
    ? skills.map(([sid, icon]) => `${icon}[${skillState.get(icon)}${inManifest(icon) && inManifestById(sid) ? '' : '/无清单'}]`).join(' ')
    : '（该干员没有技能）';
  const kindTxt = CHAR_KINDS.map((k) => `${k} ${cov[k]}`).join(' · ') + ` · spine ${cov.spine} · voice ${cov.voice}`;
  console.log(`  ${id.padEnd(20)} ${(charName.get(id) || '?').padEnd(6)} ${kindTxt}`);
  console.log(`  ${''.padEnd(20)} ${iconTxt}`);
}
console.log('');
console.log('B · 本机美术覆盖（由 tools/fetch-assets.mjs 覆盖，本工具不下载）');
line('炸惊干员位 charId', zjCharIds.length);
line('  一条美术都没有', charMissing.length ? `${charMissing.length}：${charMissing.slice(0, 8).join(', ')}${charMissing.length > 8 ? ' …' : ''}` : '0');
line('湮灭新盟约图标', `${annBondIds.length - bondMissing.length}/${annBondIds.length}${bondMissing.length ? ` 缺 ${bondMissing.join(', ')}` : ''}`);
line('炸惊专属道具图标', `${zjItems.length - itemMissing.length}/${zjItems.length}${itemMissing.length ? ` 缺 ${itemMissing.slice(0, 8).join(', ')}` : ''}`);
console.log('');
const skillGap = manifestGap;
if (skillCopies.length || skillGap.length) {
  console.log('补齐命令：');
  if (skillCopies.length) {
    console.log(`  node tools/import-extension-assets.mjs --zip="${zip?.path || '<炸惊包>.zip'}" --apply   # 抽技能图标`);
  }
  if (skillGap.length) {
    console.log('  node tools/patch-assets-local.mjs --write --slots skills            # 并进 data/assets.json（并同步 public/data）');
  }
}
if (charMissing.length || itemMissing.length) {
  console.log('补齐命令（下载官方美术，GB 级，且会重写 data/assets.json，按需自行执行）：');
  console.log('  node tools/fetch-assets.mjs            # 全量；幂等，已存在的同尺寸文件会跳过');
}
