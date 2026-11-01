// public/js/ui/namecards.js — 原作特色名片系统与底图材质渲染
// 采用明日方舟官方阵营徽标（ui/campLogo/logo_*.png）与官方关卡通行证底纹，纯正罗德岛终端视觉风格。
//
// 2026-10-28（业主 B 项）：除了下面这 8 张**手绘渐变**（旧存档里可能在用，继续能画），还认
// `tools/import-namecards.py` 生成的真实名片索引 —— `data/namecards.json`（34 张，`public/assets/namecard/<id>/*.webp`
// 共 552 张）。索引缺失时（服务器没生成过）**不画破图**：图层返回 null，选择器退回这 8 张。

import { html, Button } from './components.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { render } from '../../vendor/preact.module.js';
import { data, useData } from '../data.js';
import { loadPref, savePref } from '../store.js';
import { currentAccount, setLocalCard } from './accounts.js';
import { t } from '../../../shared/i18n.js';

/** 原作明日方舟阵营官方名片配置 */
export const NAMECARDS = [
  {
    id: 'rhodes_standard',
    theme: '罗德岛',
    name: '制式终端 · 罗德岛',
    desc: '罗德岛制式外勤干员身份标识，方舟经典黑绿战术终端。',
    logo: '/assets/ui/campLogo/logo_rhodes.png',
    bg: 'linear-gradient(135deg, #101c19 0%, #172a25 55%, #0b1311 100%)',
    accent: '#4fe8c0',
    code: 'RI-PRTS // 001',
    en: 'RHODES ISLAND',
  },
  {
    id: 'kazimierz_glory',
    theme: '卡西米尔',
    name: '骑士领航 · 卡西米尔',
    desc: '卡西米尔大骑士领特锦赛官方徽章，烁金与长枪荣耀。',
    logo: '/assets/ui/campLogo/logo_kazimierz.png',
    bg: 'linear-gradient(135deg, #251e11 0%, #3e321b 55%, #181309 100%)',
    accent: '#ffc83b',
    code: 'KZ-MAJOR // 008',
    en: 'KAZIMIERZ',
  },
  {
    id: 'yan_sui',
    theme: '炎国',
    name: '百灶岁相 · 炎国大理',
    desc: '大炎古国龙印与岁相司岁台卷宗，绛赤山河之意。',
    logo: '/assets/ui/campLogo/logo_yan.png',
    bg: 'linear-gradient(135deg, #291113 0%, #441c20 55%, #19090a 100%)',
    accent: '#ff5c5c',
    code: 'YAN-SUI // 001',
    en: 'GREAT YAN',
  },
  {
    id: 'victoria_royal',
    theme: '维多利亚',
    name: '皇家禁卫 · 维多利亚',
    desc: '伦蒂尼姆皇冠与双狮徽记，辉煌帝国之重锤。',
    logo: '/assets/ui/campLogo/logo_victoria.png',
    bg: 'linear-gradient(135deg, #182229 0%, #223440 55%, #0e161c 100%)',
    accent: '#5cc8ff',
    code: 'VIC-ROYAL // 003',
    en: 'VICTORIA',
  },
  {
    id: 'egir_deep',
    theme: '阿戈尔',
    name: '幽海回响 · 阿戈尔',
    desc: '大洋深处的技术结晶与深海猎人作战档案底卡。',
    logo: '/assets/ui/campLogo/logo_egir.png',
    bg: 'linear-gradient(135deg, #091a26 0%, #0f2c42 55%, #06121b 100%)',
    accent: '#4fc3f7',
    code: 'EGIR-DEEP // 006',
    en: 'AEGIR NATION',
  },
  {
    id: 'laterano_sanctuary',
    theme: '拉特兰',
    name: '圣堂铳律 · 拉特兰',
    desc: '公证所铳械律令与圣徒光环，纯白守护与爆破之礼。',
    logo: '/assets/ui/campLogo/logo_laterano.png',
    bg: 'linear-gradient(135deg, #232219 0%, #3a3826 55%, #15140e 100%)',
    accent: '#ffe57f',
    code: 'LT-NOTARY // 005',
    en: 'LATERANO',
  },
  {
    id: 'kjerag_frost',
    theme: '谢拉格',
    name: '雪境神圣 · 谢拉格',
    desc: '喀兰贸易与蔓珠院雪山圣境，凛冬冰风之礼。',
    logo: '/assets/ui/campLogo/logo_kjerag.png',
    bg: 'linear-gradient(135deg, #131d24 0%, #1e2f3b 55%, #0b1217 100%)',
    accent: '#80d8ff',
    code: 'KJ-KARLAN // 004',
    en: 'KJERAG',
  },
  {
    id: 'infinite_core',
    theme: '超限推演',
    name: '极限推演 · 超限核心',
    desc: '突破常规模拟上限，终极深紫与虚空能量环流。',
    logo: '/assets/ui/campLogo/logo_rhodes.png',
    bg: 'linear-gradient(135deg, #1d0f2f 0%, #331554 55%, #11071c 100%)',
    accent: '#c988ff',
    code: 'INF-LIMIT // 9999',
    en: 'INFINITE EXPERIMENT',
  },
];

const CARD_MAP = new Map(NAMECARDS.map((c) => [c.id, c]));

/**
 * 真实名片索引（`data/namecards.json`，由 tools/import-namecards.py 生成）：`[{ id, name, side, entry, preview, variants }]`。
 * 数据没载入 / 服务器没生成过 → 空数组（调用方据此退回 8 张手绘或只画头像区）。
 * `raw` 可注入（node 测试直接喂 `data/namecards.json` 的内容，不需要浏览器 fetch）。
 * @param {any} [raw]
 * @returns {{ id: string, name?: string, side?: string, entry?: string, preview?: string, variants?: any }[]}
 */
export function namecardIndex(raw = data.get('namecards')) {
  const pick = (list) => (Array.isArray(list) ? list : [])
    .filter((c) => c && typeof c.id === 'string' && (typeof c.preview === 'string' || typeof c.entry === 'string' || typeof c.side === 'string'));
  if (Array.isArray(raw)) return pick(raw);
  if (raw && Array.isArray(raw.cards)) return pick(raw.cards);
  if (raw && typeof raw === 'object') return pick(Object.values(raw));
  return [];
}

/** 索引里的一张名片（没有就是 null）。`raw` 同 `namecardIndex`。 */
export function namecardOf(id, raw) {
  if (!id) return null;
  return namecardIndex(raw).find((c) => c.id === id) || null;
}

/** 这张名片**画得出来**吗（索引命中，或是旧存档里的 8 张手绘之一）——画不出来就不要留空框。 */
export function namecardKnown(id, raw) {
  if (!id) return false;
  return !!namecardOf(id, raw) || CARD_MAP.has(id);
}

/** 差分的本机 pref：`{ [cardId]: 变体序号 }`（每张卡各自记，互不影响）。 */
export const NAMECARD_VARIANT_PREF = 'sp.pref.namecardVariant';

/** 某张名片有几张差分（`entry` 优先；没有 entry 就用 side / preview 的张数）。0 = 手绘或没索引。 */
export function namecardVariantCount(card, raw) {
  const real = namecardOf(card, raw);
  if (!real) return 0;
  const v = real.variants && typeof real.variants === 'object' ? real.variants : {};
  const list = Array.isArray(v.entry) && v.entry.length ? v.entry
    : Array.isArray(v.side) && v.side.length ? v.side
      : Array.isArray(v.preview) && v.preview.length ? v.preview : [];
  return list.length;
}

/** 这张名片此刻该画哪一张差分（存下来的序号夹在范围内；0 = 默认那一张）。 */
export function namecardVariantOf(card, raw) {
  const n = namecardVariantCount(card, raw);
  if (n <= 0) return 0;
  const all = readVariantPrefs();
  const want = Number.isInteger(all[card]) ? all[card] : 0;
  return Math.min(Math.max(0, want), n - 1);
}

function readVariantPrefs() {
  try {
    const raw = loadPref(NAMECARD_VARIANT_PREF, null);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

/** 存某张名片的差分序号（越界自动夹住；返回真正生效的序号）。 */
export function setVariantOf(card, index) {
  if (!card) return 0;
  const n = namecardVariantCount(card);
  if (n <= 0) return 0;
  const i = Math.min(Math.max(0, Math.trunc(Number(index) || 0)), n - 1);
  const all = { ...readVariantPrefs(), [card]: i };
  try { savePref(NAMECARD_VARIANT_PREF, all); } catch { /* 隐私模式：本次会话里仍然生效 */ }
  return i;
}

/** 名片图层组件：作为 `.has-nc` 容器内部的背景图层渲染
 * `card` 既可以是索引里的 webp 名片（`card_xxxxxxxx`），也可以是旧存档里的 8 张手绘 id；都不是 → null（不画破图）。
 * 索引名片按本机存下来的**差分序号**取图（业主 2026-10-29：有些名片有多张差分）。
 * @param {{ card?: string, small?: boolean }} props
 */
export function NameCardLayer({ card }) {
  if (!card) return null;
  const real = namecardOf(card);
  if (real) {
    const v = real.variants && typeof real.variants === 'object' ? real.variants : {};
    const list = Array.isArray(v.entry) && v.entry.length ? v.entry
      : Array.isArray(v.side) && v.side.length ? v.side : null;
    const i = namecardVariantOf(real.id);
    const src = (list && list[Math.min(i, list.length - 1)]) || real.entry || real.side || real.preview;
    return html`<div class="nc-layer nc-layer--art" data-card=${real.id} data-variant=${i} aria-hidden="true">
      <img src=${src} alt="" loading="lazy" draggable=${false} />
    </div>`;
  }
  const c = CARD_MAP.get(card);
  if (!c) return null;

  return html`<div class="nc-layer" style=${`background: ${c.bg};`}>
    <div style="position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:inherit;">
      <img src=${c.logo} alt="" style="position:absolute;right:4%;top:50%;transform:translateY(-50%);height:88%;width:auto;opacity:0.22;object-fit:contain;filter:drop-shadow(0 0 8px ${c.accent});pointer-events:none;" />
      <div style="position:absolute;left:0;right:0;bottom:0;height:3px;background:${c.accent};box-shadow:0 0 8px ${c.accent};opacity:0.8;"></div>
      <div style="position:absolute;right:8px;bottom:6px;font-family:var(--font-display);font-size:10px;font-weight:900;letter-spacing:0.12em;color:${c.accent};opacity:0.65;">${c.code}</div>
    </div>
  </div>`;
}

export const nameCardLayer = NameCardLayer;

/** 选择器里的可选名片：真实索引优先，没有索引就用 8 张手绘（旧存档仍可选到它们）。`raw` 同 `namecardIndex`。 */
export function namecardChoices(raw = data.get('namecards')) {
  const real = namecardIndex(raw);
  if (real.length) {
    return real.map((c) => ({
      id: c.id,
      name: c.name || c.id,
      desc: c.name || c.id,
      shot: c.preview || c.entry || c.side,
      variants: namecardVariantCount(c.id, raw),
      theme: null,
      code: null,
      art: true,
    }));
  }
  return NAMECARDS.map((c) => ({ id: c.id, name: c.name, desc: c.desc, shot: null, variants: 0, theme: c.theme, code: c.code, art: false }));
}

export function loadNamecards() {
  const real = namecardIndex();
  return Promise.resolve(real.length ? real : NAMECARDS);
}

/** 名片选择器弹窗组件 */
function NamecardPickerModal({ current, onClose, onPick }) {
  const [selected, setSelected] = useState(current || '');
  // 差分切换后靠这个计数重画瓦片（瓦片里的 NameCardLayer 每次渲染都从本机 pref 读序号）
  const [tick, setTick] = useState(0);
  // 索引可能还在载入：订阅它，数据一到就重画（否则会停在 8 张手绘的回退态，必须关掉重开）
  useData('namecards');
  const choices = namecardChoices();

  // Escape 先关这一层：它是 body 上另挂的覆盖层，不是 Modal，别让底下的面板先吃掉（见 namecards.js 头部注释）
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const handleSelect = (id) => {
    setSelected(id);
    onPick(id);
  };

  return html`<div class="nc-pick" data-testid="namecard-picker" role="dialog" aria-modal="true" aria-label="PROFILE CARD"
      onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="nc-pick__panel">
      <header class="nc-pick__head">
        <strong>PROFILE CARD</strong>
        <span class="nc-pick__title">更换名片（明日方舟官方特色）</span>
        <button type="button" class="nc-pick__x" onClick=${onClose} aria-label="关闭">×</button>
      </header>
      <div class="nc-pick__grid">
        <button type="button" class=${`nc-pick__card${!selected ? ' is-on' : ''}`} data-card="" onClick=${() => handleSelect('')}>
          <span class="nc-pick__shot"></span>
          <span class="nc-pick__name">默认制式（无名片）</span>
          ${!selected ? html`<span class="nc-pick__on">使用中</span>` : null}
        </button>
        ${choices.map((c) => {
          const isCurrent = selected === c.id;
          return html`<button key=${c.id} type="button" class=${`nc-pick__card${isCurrent ? ' is-on' : ''}`} data-card=${c.id}
            data-variants=${c.variants || 0} title=${c.desc || c.name} onClick=${() => handleSelect(c.id)}>
            <span class="nc-pick__shot" data-tick=${tick}><${NameCardLayer} card=${c.id} /></span>
            <span class="nc-pick__name">${c.name}</span>
            ${c.variants > 1 ? html`<span class="nc-pick__var" aria-hidden="true">${c.variants}</span>` : null}
            ${isCurrent ? html`<span class="nc-pick__on">使用中</span>` : null}
          </button>`;
        })}
      </div>
      ${/* 差分（业主 2026-10-29 修订）：在选择器里就能换，不用退回个人资料面板再切一遍 */''}
      ${selected && namecardVariantCount(selected) > 1 ? html`<div class="nc-pick__varrow">
        <${NamecardVariantSwitch} card=${selected} onChange=${() => { setTick((n) => n + 1); onPick(selected); }} />
        <small class="nc-pick__varhint">${t('差分')}</small>
      </div>` : null}
      <footer class="nc-pick__foot">
        <small>选择的明日方舟官方阵营名片将展示在个人名牌、房间座位与结算战报中，纯本地持久化。</small>
        <${Button} size="sm" variant="primary" onClick=${onClose}>完成<//>
      </footer>
    </div>
  </div>`;
}

let pickerHost = null;

/**
 * 差分切换（业主 2026-10-29，2026-10-29 修订）：只在当前名片有 >1 张差分时出现，`‹ 差分 1/5 ›`，
 * 点一下**立即换图**并存在本机；组件自己持有当前序号（父级不必重画）。
 * 无差分（手绘名片 / 索引缺失）时返回 null —— 不留一颗点不动的键。
 * @param {{ card: string, onChange?: (index: number) => void }} props
 */
export function NamecardVariantSwitch({ card, onChange = () => {} }) {
  const n = namecardVariantCount(card);
  // 序号以本机 pref 为准，但组件自己也记一份（换图后必须立刻重画，不能指望父级）
  const [i, setI] = useState(() => namecardVariantOf(card));
  useEffect(() => { setI(namecardVariantOf(card)); }, [card]);
  if (n <= 1) return null;
  const step = (d) => {
    const next = setVariantOf(card, (i + d + n) % n);
    setI(next);
    onChange(next);
  };
  return html`<div class="nc-var" data-testid="nc-variant" role="group" aria-label=${t('差分')}>
    <button type="button" class="nc-var__btn" data-testid="nc-variant-prev" aria-label=${`${t('差分')} ←`} onClick=${() => step(-1)}>‹</button>
    <span class="nc-var__pos num" data-testid="nc-variant-pos">${t('差分')} ${i + 1}/${n}</span>
    <button type="button" class="nc-var__btn" data-testid="nc-variant-next" aria-label=${`${t('差分')} →`} onClick=${() => step(1)}>›</button>
    ${n > 2 ? html`<span class="nc-var__dots" aria-hidden="true">${Array.from({ length: n }, (_, k) => html`<i key=${k} class=${k === i ? 'is-on' : ''}></i>`)}</span>` : null}
  </div>`;
}

/** 唤起名片选择面板 */
export function openNamecardPicker(opts = {}) {
  if (!pickerHost) {
    pickerHost = document.createElement('div');
    pickerHost.className = 'nc-picker-host';
    document.body.appendChild(pickerHost);
  }
  const acct = currentAccount();
  const close = () => {
    render(null, pickerHost);
    if (typeof opts.onClose === 'function') opts.onClose();
  };

  const pick = (cardId) => {
    setLocalCard(cardId);
    if (typeof opts.onPick === 'function') opts.onPick(cardId);
  };

  render(html`<${NamecardPickerModal} current=${acct.card} onClose=${close} onPick=${pick} />`, pickerHost);
}
