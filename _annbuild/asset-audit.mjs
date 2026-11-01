// _annbuild/asset-audit.mjs — read-only: 炸惊专属内容在真机上会用到的每一个资产 key，对照 data/assets.json 与磁盘。
// 不写任何文件。用法：node _annbuild/asset-audit.mjs
import { existsSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const A = JSON.parse(readFileSync(join(ROOT, 'data/assets.json'), 'utf8'));
const B = JSON.parse(readFileSync(join(ROOT, 'data/bonds.json'), 'utf8'));
const C = JSON.parse(readFileSync(join(ROOT, 'data/chess.json'), 'utf8'));
const I = JSON.parse(readFileSync(join(ROOT, 'data/items.json'), 'utf8'));
const BANDS = JSON.parse(readFileSync(join(ROOT, 'data/bands.json'), 'utf8'));
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'data/config.json'), 'utf8'));

const rows = [];
const file = (url) => (url ? join(ROOT, 'public', url.replace(/^\//, '')) : null);
const check = (kind, key, owner, url) => {
  const p = file(url);
  const onDisk = p ? existsSync(p) && statSync(p).size > 0 : false;
  rows.push({ kind, key, owner, url: url ?? '(manifest 无条目)', onDisk });
};

// 1) 盟约图标：客户端 shared/../public/js/assets.js bondIconUrl = assets.bonds[bondId]
for (const [bondId, rec] of Object.entries(B)) {
  const tag = rec.zjOnly ? 'zjOnly' : rec.annOnly ? 'annOnly' : rec.zj ? 'zj-block' : 'official';
  if (!rec.zjOnly && !rec.annOnly && !rec.zj) continue;   // 官方 23 条不在此列
  check('bond', bondId, `${tag} (iconId=${JSON.stringify(rec.iconId)})`, A.bonds?.[bondId]);
}

// 2) 炸惊名册（97 可抽取 ∪ 2 grantOnly）的干员立绘/头像/插画
const roster = new Set(Object.values(C).filter((c) => c.zhajing === true).map((c) => c.charId).filter(Boolean));
for (const charId of [...roster].sort()) {
  const man = A.chars?.[charId];
  for (const slot of ['avatar', 'portrait', 'illust']) check('char', `${charId}:${slot}`, man ? 'manifest 有该 charId' : 'manifest 无该 charId', man?.[slot]);
}

// 3) zjOnly 道具图标：assets.items[iconId ?? trapId]
for (const [id, it] of Object.entries(I)) {
  if (it.zjOnly !== true) continue;
  check('item', it.iconId ?? it.trapId, `${id}`, A.items?.[it.iconId] ?? A.items?.[it.trapId]);
}

// 4) zjOnly 策略图标：assets.bands[bandId]
for (const [id, b] of Object.entries(BANDS)) {
  if (b.zjOnly !== true) continue;
  check('band', id, `iconId=${JSON.stringify(b.iconId)}`, A.bands?.[id]);
}

// 5) 模式图标（大厅/房间卡）：assets.ui['modeIcon/<iconId>']
for (const [modeId, m] of Object.entries(CONFIG.modes)) {
  if (m.difficulty !== 'ZHAJING') continue;
  const k = `modeIcon/${m.iconId}`;
  check('mode-icon', k, `${modeId}`, A.ui?.[k]);
}

// 6) 炸惊棋的技能/子职业图标（客户端 assetUrls.js 的真实取值方式）
//    skillIconUrl: manifest.skills[iconId|skillId]，否则 manifest.skills[manifest.skillsById[skillId]]
//    subProfIconUrl: manifest.prof.sub[<subProfIcon 去掉 sub_/_icon>]
const skillUrl = (id, skillId) => {
  if (id && A.skills?.[id]) return A.skills[id];
  if (skillId && A.skills?.[skillId]) return A.skills[skillId];
  const alt = skillId ? A.skillsById?.[skillId] : null;
  return (alt && A.skills?.[alt]) ?? null;
};
const subUrl = (key) => {
  const raw = String(key || '');
  const id = raw ? raw.replace(/^sub_/, '').replace(/_icon$/, '') : '';
  return (id && A.prof?.sub?.[id]) ?? null;
};
const skillKeys = new Map();
const subKeys = new Set();
for (const c of Object.values(C)) {
  if (c.zhajing !== true) continue;
  for (const s of [c.skill, ...(c.skills || [])]) if (s) skillKeys.set(s.iconId ?? s.skillId, s.skillId);
  if (c.assets?.subProfIcon) subKeys.add(c.assets.subProfIcon);
}
for (const [k, skillId] of [...skillKeys].sort()) check('skill-icon', k, '炸惊棋的 skill.iconId', skillUrl(k, skillId));
for (const k of [...subKeys].sort()) check('subprof-icon', k, '炸惊棋的 assets.subProfIcon', subUrl(k));

// 6b) 对照组：官方干员同样三个槽位必须在——用来证明本审计的取值方式没错（不是误报）
const official = Object.values(C).filter((c) => !('zhajing' in c) && c.visible === true && !c.isGolden).slice(0, 6);
for (const c of official) {
  check('control', `${c.chessId}:avatar`, 'control(official)', A.chars?.[c.charId]?.avatar);
  check('control', `${c.chessId}:skill`, 'control(official)', skillUrl(c.skill?.iconId, c.skill?.skillId));
  check('control', `${c.chessId}:subprof`, 'control(official)', subUrl(c.assets?.subProfIcon));
}

// ---- 汇总 ----
const missing = rows.filter((r) => !r.onDisk);
const byKind = {};
for (const r of missing) {
  byKind[r.kind] ??= { manifestMissing: 0, fileMissing: 0, total: 0 };
  byKind[r.kind].total++;
  if (String(r.url).startsWith('(manifest')) byKind[r.kind].manifestMissing++;
  else byKind[r.kind].fileMissing++;
}
console.log(`检查 ${rows.length} 个 key：${rows.length - missing.length} 可用 / ${missing.length} 缺失\n`);
console.log('按类型：');
for (const [k, v] of Object.entries(byKind)) console.log(`  ${k.padEnd(12)} 缺 ${v.total}（manifest 无条目 ${v.manifestMissing}，有条目但文件不在 ${v.fileMissing}）`);
console.log('\n明细（只列缺失）：');
for (const r of missing) console.log(`  [${r.kind}] ${r.key} ← ${r.owner} | ${r.url} | 磁盘 ${r.onDisk ? 'OK' : 'MISSING'}`);
const budget = process.env.AUDIT_LIMIT ? Number(process.env.AUDIT_LIMIT) : 200;
if (missing.length > budget) console.log(`  …（共 ${missing.length} 条，只显示前 ${budget}）`);
