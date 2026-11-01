// tools/research-normalize.mjs — 研究源（docs/research/*.json）文本与图标的归一化。
//
// 为什么需要它：炸惊模拟 / 湮灭专属 mod 的记录是从外部整合包（modref/）的**已构建记录**里抽出来的，那个包自己的
// 0.3.1 builder 有三类会漏进本仓的缺陷（2026-10-29 手工在 research 源修了 23 处）：
//
//   1. `desc`（纯文本）里的换行写成**字面 `\n`**（两个字符），而不是真正的换行符；
//   2. `desc` 与 `descRaw` 不一致：包的 builder 把黑板上限「（每场作战至多666层）」只写进 `desc`、忘了 `descRaw`，
//      或反过来 `desc` 还是旧文案 —— `descRaw` 才是权威（docs/DATA.md §0：`desc = 纯文本(descRaw)`）；
//   3. `eventTypeIcon` 写了官方图标集里不存在的名字（`icon_server`），客户端按名字取图 → 卡面空白。
//
// 这个模块给两个 importer（tools/extract-zhajing-research.mjs、tools/extract-annihilation-mods.mjs）共用，保证
// 「同一份包再导入一次」不会把这些坏值重新写回 research 源；tools/build-data.mjs 的生成期护栏
// （checkTextContracts）再用同一套纯文本转换复核一遍，两条链不会各自漂。
//
// 纯文本转换不是新写的：直接用 UI 的 `richTextPlain`（public/js/ui/richText.js，纯 ESM、无 DOM，Node 可加载，
// test/ui/richText.test.js 用它钉住整份数据）。研究源已经按它修好，所以这里的归一化对当前输入是 no-op —— 只在
// 下一份（或旧版）整合包重新导入时才真的改写记录。
//
// 不碰的东西（有明确理由）：
//   · `effectDesc` / `effectDescRaw`：盟约效果文案保留 `{i:fmt}` 占位符由 formatBondEffect 现算（docs/DATA.md §3）；
//   · 盟约的 `zj` / `ann` **覆盖块**（bondZjOverrides / bondAnnOverrides）：它们是包内 `desc,descRaw,effectDesc…` 的
//     原样片段，desc 不是由 descRaw 生成的（包内两处文案本身就不一致），归一化会改写覆盖文案 —— importer 原样搬运，
//     生成期护栏也不下钻这两个键；
//   · `*Raw` 字段里的字面 `\n`：官方原料就长这样，UI 的解析器两种都认（DATA.md §0），只有非 Raw 的 `desc` 必须解成真换行。
import { richTextPlain } from '../public/js/ui/richText.js';

/**
 * The one plain-text conversion both sides use (re-exported so the importer's normalization and build-data's guard can
 * never drift apart): `richTextPlain` from public/js/ui/richText.js — the pure function the UI renders with.
 */
export { richTextPlain };

/** 官方卫戍类型图标所在的资源目录（data/cdn-resource-config.json 的 `files` 键）。 */
const GARRISON_ICON_DIR = '/assets/ui/garrisonTypeIcon/';

/** 字面 `\n`（反斜杠 + n 两个字符）→ 真换行。与 server/plugins/officialUnitBuilder.js 的 unescapeNewlines 同一条规则。 */
export function unescapeNewlines(s) {
  return typeof s === 'string' ? s.replace(/\\n/g, '\n') : s;
}

/**
 * 一个对象的 `desc` / `descRaw` 归一化（原地改写，返回改了什么；没有 desc/descRaw 的对象原样不动）：
 *   · 有 `descRaw`：`desc = richTextPlain(descRaw)`（以 Raw 为权威，`\n` 转义、原始换行、标记都按 UI 的解析器处理）；
 *   · 只有 `desc`：把字面 `\n` 解成真换行（`descRaw` 缺失时没有更权威的文本）。
 * 递归进数组与嵌套对象（chess 的 `skill` / `skills[]` / `talents[]`、token 的 `variants` 都在这一层）。
 * @param {any} value a record (or any nested value)
 * @param {string} [path] path label for the report
 * @param {string[]} [changes] collector of changed paths
 * @returns {string[]} the changed paths (same array as `changes` when given)
 */
export function normalizeDescPairs(value, path = '', changes = []) {
  if (!value || typeof value !== 'object') return changes;
  if (Array.isArray(value)) {
    value.forEach((v, i) => normalizeDescPairs(v, `${path}[${i}]`, changes));
    return changes;
  }
  const hasRaw = typeof value.descRaw === 'string';
  if (hasRaw) {
    const plain = richTextPlain(value.descRaw);
    if (value.desc !== plain) {
      value.desc = plain;
      changes.push(`${path}.desc`);
    }
  } else if (typeof value.desc === 'string' && /\\n/.test(value.desc)) {
    value.desc = unescapeNewlines(value.desc);
    changes.push(`${path}.desc`);
  }
  for (const [k, v] of Object.entries(value)) {
    if (v && typeof v === 'object') normalizeDescPairs(v, `${path}.${k}`, changes);
  }
  return changes;
}

/**
 * 包内 builder 的缺陷 2 的另一半：`desc` 写着黑板上限「（每场作战至多N层）」，`descRaw` 尾部却漏了它（garrison_zj_92_a/b）。
 * 上限来自记录自己的黑板 `bb.max_add_count_per_battle`，短语在 `desc` 里已经存在 —— 这里只是把它补回 `descRaw`，
 * 不是造文案：`desc` 不以该短语结尾时不动（留给生成期护栏报出来）。
 * 反例（故意不动）：garrison_zj_90_2_a/b 的 bb 有 `max_add_count_per_battle: 100/200`，但 `desc` / `descRaw` 都没有
 * 这句说明 —— 补一句包里没有的话是改设计，不是归一化。
 * @param {any} rec a record with `desc`, `descRaw` and `bb`
 * @returns {boolean} whether `descRaw` gained the note
 */
export function restoreBlackboardCapNote(rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (typeof rec.desc !== 'string' || typeof rec.descRaw !== 'string') return false;
  const cap = rec.bb?.max_add_count_per_battle;
  if (!Number.isFinite(cap) || cap <= 0) return false;
  const note = `（每场作战至多${cap}层）`;
  if (!rec.desc.endsWith(note) || rec.descRaw.includes(note)) return false;
  rec.descRaw += note;
  return true;
}

/**
 * 官方卫戍类型图标集：从 data/cdn-resource-config.json 的 `files` 键现算（`/assets/ui/garrisonTypeIcon/icon_gold.png`
 * 与 `s_` 小图两种），不做硬编码清单 —— 清单过期时这里自动跟着官方资源走。
 * @param {any} cdn data/cdn-resource-config.json
 * @returns {Set<string>} e.g. {'icon_battle', 'icon_bond', 'icon_gold', 'icon_support'}
 */
export function officialGarrisonTypeIcons(cdn) {
  const icons = new Set();
  for (const rel of Object.keys(cdn?.files || {})) {
    if (!rel.startsWith(GARRISON_ICON_DIR)) continue;
    const m = /^(?:s_)?([A-Za-z0-9_]+)\.png$/.exec(rel.slice(GARRISON_ICON_DIR.length));
    if (m) icons.add(m[1]);
  }
  return icons;
}

/**
 * `eventTypeDesc`（官方卫戍表里的中文分类）→ 官方四图标。只映射官方数据里真实出现过的分类；映射不到返回 null，
 * 由调用方留空让 UI 按触发时机（eventType）兜底。
 *   整备能力 → icon_gold（整备区/商店类，官方 82 条全是它）
 *   作战能力 → icon_battle（战斗类，官方 106 条）
 *   单次叠加 / 持续叠加 / 休整期叠加 → icon_bond（盟约叠层类，官方 287 条）
 *   特异化 → icon_support（官方 14 条）
 */
const EVENT_TYPE_ICON = Object.freeze({
  整备能力: 'icon_gold',
  作战能力: 'icon_battle',
  单次叠加: 'icon_bond',
  持续叠加: 'icon_bond',
  休整期叠加: 'icon_bond',
  特异化: 'icon_support',
});

/**
 * 修一条记录的 `eventTypeIcon`：**只改非法值**（不在官方图标集里，例如包内 mujica 特质的 `icon_server`）。
 * 合法图标原样保留（不拿 `eventTypeDesc` 覆盖包内自己的选择）；非法且映射不到官方四图标 → 置空串，UI 按触发时机兜底。
 * @param {any} rec a garrison record
 * @param {Set<string>} icons officialGarrisonTypeIcons()
 * @returns {{from: string, to: string}|null} the change, or null when the icon is legal / absent
 */
export function normalizeEventTypeIcon(rec, icons) {
  if (!rec || typeof rec !== 'object' || !('eventTypeIcon' in rec)) return null;
  const cur = rec.eventTypeIcon;
  if (typeof cur === 'string' && cur !== '' && icons.has(cur)) return null;
  const mapped = EVENT_TYPE_ICON[String(rec.eventTypeDesc ?? '').trim()] ?? null;
  const next = mapped && icons.has(mapped) ? mapped : '';
  if (cur === next) return null;
  rec.eventTypeIcon = next;
  return { from: cur, to: next };
}

/**
 * 「导入器 / 已有 research 文件」两层归一化：给那些**不能**用 `descRaw` 反推 `desc` 的包用（湮灭模拟）。
 * 与 `normalizeDescPairs` 的差别就在这里：`desc` 是权威，**永远不拿 descRaw 覆盖它**。
 *   · `desc` 里字面 `\n` → 真换行；`restoreBlackboardCapNote` 补回黑板上限说明；
 *   · `desc` 与 `plainText(descRaw)` 不一致时：若 `previous`（磁盘上已有的 research）里同一条记录的 `descRaw`
 *     与 `desc` 对得上，就**沿用磁盘上那份**（重导入不许冲掉手工修复）；否则记进 `mismatches`（由调用方决定
 *     报错还是拒绝构建）；
 *   · `eventTypeIcon` 非法值按 `eventTypeDesc` 映射官方四图标（只改非法值）。
 * @param {any} root 导入产物（原地改写）
 * @param {{ icons?: Set<string>|null, previous?: any|null, skipSections?: string[] }} [opts]
 *   previous: 磁盘上已有的同形文档（用来沿用修好的 descRaw）；skipSections: 跳过的顶层节（默认 _doc / _extract）
 * @returns {{ mismatches: any[], kept: any[], icons: any[] }} 三类记录（供写进 _extract 与测试断言）
 */
export function normalizeImportedTree(root, { icons = null, previous = null, skipSections = ['_doc', '_extract'] } = {}) {
  const mismatches = [];
  const kept = [];
  const iconChanges = [];
  const skip = new Set(skipSections);
  const at = (doc, trail) => trail.reduce((acc, k) => (acc == null ? acc : acc[k]), doc);
  const walk = (value, label, path = '', trail = []) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, label, `${path}[${i}]`, [...trail, i])); return; }
    if (typeof value.desc === 'string' && /\\n/.test(value.desc)) value.desc = unescapeNewlines(value.desc);
    if (typeof value.desc === 'string' && typeof value.descRaw === 'string') {
      restoreBlackboardCapNote(value);
      if (richTextPlain(value.descRaw) !== value.desc) {
        const prev = previous ? at(previous, trail) : null;
        if (prev && typeof prev.descRaw === 'string' && richTextPlain(prev.descRaw) === value.desc) {
          value.descRaw = prev.descRaw;
          // 文案与去重前 importer 内联版本逐字一致（`_extract.descKeptFromDisk` 是给人读的证据，不该因搬函数而变）
          kept.push({ record: `${label}${path}`, why: "kept the on-disk descRaw (the package's disagrees with desc)" });
        } else {
          mismatches.push({
            record: `${label}${path}`,
            why: 'desc ≠ plainText(descRaw)',
            desc: value.desc.slice(0, 90),
            descRaw: value.descRaw.slice(0, 120),
          });
        }
      }
    }
    if (icons && 'eventTypeIcon' in value) {
      const changed = normalizeEventTypeIcon(value, icons);
      if (changed) iconChanges.push({ record: `${label}${path}`, ...changed });
    }
    for (const [k, v] of Object.entries(value)) if (v && typeof v === 'object') walk(v, label, `${path}.${k}`, [...trail, k]);
  };
  for (const [section, value] of Object.entries(root && typeof root === 'object' ? root : {})) {
    if (skip.has(section)) continue;
    walk(value, section, '', [section]);
  }
  return { mismatches, kept, icons: iconChanges };
}
