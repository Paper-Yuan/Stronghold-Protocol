// public/js/ui/overlimitBondText.js — 超限盟约文案的「只强调数值片段」：**唯一实现**（分词 + 渲染）。
//
// S.W.E.E.P. 盟约报告的强化行（js/screens/sweep.js 的 BondPanel）与**局内**的盟约弹窗
// （js/ui/bondStrip.js 的 BondPopup 盟约描述，只在超限局）都渲染这里的 OverlimitValueLine ——
// 业主 2026-11-01：「局内显示盟约时也要按同一规则只强调数值片段」，并且「分色逻辑只有一份」，两处不许再各写一套。
//
// 口径（业主 2026-11-01）：一段盟约文案里**只有涉及数值的片段**用强调色，纯描述文字保持正文色，不整句染色。
// 数据里的样式标记（`<@ba.vup>攻击力叠层上限由 25 层提高到 9999 层</>`）包的是整句短语，按这个口径不能复用 ——
// 所以先把标记剥成明文（richTextPlain，纯函数、无 DOM），再用下面这条"值表达式"正则切段，不写标签解析器。
//
// 一个数值片段 = 一个「值表达式」：
//   值      25 / 9999 / 0.2 / 1,000（小数与千分位），可带单位 % ％ 万 亿 —— +12% / 0.2% / 250万；
//   式子    (15+0.2×层数)%：括号里用 ± × → ~ ～ / 连起来，括号外可再接单位；
//   范围    25→9999、(1+0.25+0.01×层数) → 2×(1+0.25+0.01×层数)：`→` 与 `~` 是范围连接符，整段算一个数；
//   因子    「层数」在式子里是变量（0.2×层数 是一个值），但**单独出现的「层数」是描述词、不是数值** ——
//           因此式子必须以数值或括号开头（HEAD），"层数"只能出现在运算符后面。
// 括号里的补充说明（（受层数影响）、（最终加算，不受攻击力加成影响））不含数值就不染色，含数值（（受层数影响，即每层 +0.2%））才染。
//
// 分色逻辑只有一份（业主 2026-11-01）：
//   · 分词 = overlimitValueSegments（本文件，全仓唯一）；
//   · 渲染 = OverlimitValueLine（本文件，全仓唯一）：数值片段是 <span class="olb-num">，其余是纯文本节点；
//   · 颜色 = css/components.css 的 `.olb-num { color: var(--mint-400); }`（全仓唯一的一份颜色规则 ——
//     css/screens/sweep.css 与局内的 css/screens/game-panels.css 都不再声明，只引用同一个类名）。
//   两处渲染的都是本文件的同一个组件，所以片段序列与类名不可能走散（断言：test/ui/overlimit-bond-text.test.js）。
//
// ⚠ 本文件早先存过一版写死的超限盟约全文（`overlimitBondText` / `overlimitBondNow`）：全仓无 import、内容已过期，
//   且与 data/bonds.json 的 `inf` 覆盖块冲突。那份内容已删除 —— 超限盟约文案的**唯一来源是数据**
//   （data/bonds.json 的 `inf` 覆盖块，由 tools/build-data.mjs 生成），本文件只负责给文本片段分色。

import { html } from './components.js';
import { richTextPlain } from './richText.js';

/** 数值片段用的共享类名。颜色规则全仓唯一一份：css/components.css 的 `.olb-num`。 */
export const OVERLIMIT_NUM_CLASS = 'olb-num';

const NUM_VALUE = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const NUM_UNIT = String.raw`(?:[%％]|[万亿])?`;
const NUM_TERM = String.raw`(?:${NUM_VALUE}${NUM_UNIT}|层数)`;
const NUM_OP = String.raw`(?:\s*(?:[+\-×✕xX*→~～/])\s*)`;
const NUM_GROUP = String.raw`\(\s*${NUM_TERM}(?:${NUM_OP}${NUM_TERM})*\s*\)`;
const NUM_ITEM = String.raw`(?:${NUM_GROUP}${NUM_UNIT}|${NUM_TERM})`;
const NUM_HEAD = String.raw`(?:${NUM_GROUP}${NUM_UNIT}|${NUM_VALUE}${NUM_UNIT})`;
const OVERLIMIT_VALUE_RE = new RegExp(String.raw`[+\-]?${NUM_HEAD}(?:${NUM_OP}${NUM_ITEM})*`, 'g');

/**
 * 把一条盟约文案切成片段，`num: true` 的片段走强调色（`.olb-num`），其余是普通正文色。
 * 只切不改字：片段文本按顺序拼起来逐字等于 `richTextPlain(line)`（断言见 test/ui/overlimit-bond-text.test.js）。
 * @param {string} line 盟约文案原文（可带官方样式标记；`\n` = 换行，保留在普通片段里）
 * @returns {{ text: string, num: boolean }[]}
 */
export function overlimitValueSegments(line) {
  const text = richTextPlain(line);
  /** @type {{ text: string, num: boolean }[]} */
  const out = [];
  let last = 0;
  for (const m of text.matchAll(OVERLIMIT_VALUE_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), num: false });
    out.push({ text: m[0], num: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), num: false });
  return out;
}

/**
 * 一行盟约文案：数值片段 `<span class="olb-num">`，其余是纯文本节点（不带类名，所以「整句都在强调节点里」在结构上
 * 不可能发生）；原文里的换行渲染成 `<br>`（与 ui/gameComponents.js 的 RichText 同一个换行口径，局内的多行描述
 * 不会挤成一行）。
 *
 * 故意不读 hooks（没有 useMemo）：组件是纯函数，测试可以直接调用它拿到 vnode 树——两处渲染的一致性断言
 * （sweep 的强化行 vs 局内的盟约描述）就是这么比的，不需要 DOM、不需要浏览器。
 * @param {{ text: string, class?: string|null }} props `class` 是外层 <p> 自己的类名（各调用方传自己的版式类名）
 */
export function OverlimitValueLine({ text, class: cls = null }) {
  const segs = overlimitValueSegments(text);
  /** @type {any[]} */
  const nodes = [];
  segs.forEach((s, i) => {
    // 一条片段里的换行切成 <br>：RichText 也是把 \n 画成 <br>（局内描述是多行的）
    const parts = s.text.split('\n');
    parts.forEach((part, j) => {
      if (j) nodes.push(html`<br key=${`br-${i}-${j}`} />`);
      if (!part) return;
      nodes.push(s.num
        ? html`<span class=${OVERLIMIT_NUM_CLASS} key=${`${i}-${j}`}>${part}</span>`
        : part);
    });
  });
  return html`<p class=${cls}>${nodes}</p>`;
}
