// public/js/ui/namecards.js — 原作特色名片系统与底图材质渲染
// 采用明日方舟官方阵营徽标（ui/campLogo/logo_*.png）与官方关卡通行证底纹，纯正罗德岛终端视觉风格。

import { html, Modal, Button } from './components.js';
import { useState } from '../../vendor/hooks.module.js';
import { render } from '../../vendor/preact.module.js';
import { currentAccount, setLocalCard } from './accounts.js';

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
 * 名片图层组件：作为 `.has-nc` 容器内部的背景图层渲染
 * @param {{ card?: string, small?: boolean }} props
 */
export function NameCardLayer({ card }) {
  if (!card) return null;
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

export function loadNamecards() {
  return Promise.resolve(NAMECARDS);
}

/** 名片选择器弹窗组件 */
function NamecardPickerModal({ current, onClose, onPick }) {
  const [selected, setSelected] = useState(current || '');

  const handleSelect = (id) => {
    setSelected(id);
    onPick(id);
  };

  return html`<div class="nc-pick" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="nc-pick__panel">
      <header class="nc-pick__head">
        <strong>PROFILE CARD</strong>
        <span class="nc-pick__title">更换名片（明日方舟官方特色）</span>
        <button type="button" class="nc-pick__x" onClick=${onClose} aria-label="关闭">×</button>
      </header>
      <div class="nc-pick__grid">
        <button type="button" class=${`nc-pick__card${!selected ? ' is-on' : ''}`} onClick=${() => handleSelect('')}>
          <div style="width:100%;aspect-ratio:600/186;display:flex;align-items:center;justify-content:center;background:#141817;color:#8c9894;font-size:13px;font-weight:700;">
            <span>默认制式（无名片）</span>
          </div>
          ${!selected ? html`<span class="nc-pick__on">使用中</span>` : null}
        </button>
        ${NAMECARDS.map((c) => {
          const isCurrent = selected === c.id;
          return html`<button key=${c.id} type="button" class=${`nc-pick__card${isCurrent ? ' is-on' : ''}`}
            onClick=${() => handleSelect(c.id)} title=${c.desc}>
            <div style=${`position:relative;width:100%;aspect-ratio:600/186;background:${c.bg};border-radius:2px;overflow:hidden;display:flex;align-items:center;`}>
              <img src=${c.logo} alt="" style="position:absolute;right:6%;height:85%;opacity:0.35;filter:drop-shadow(0 0 6px ${c.accent});" />
              <div style="position:relative;z-index:2;padding-left:14px;text-align:left;">
                <div style="font-size:12px;font-weight:900;color:#fff;letter-spacing:0.04em;">${c.name}</div>
                <div style="font-size:9px;font-weight:700;color:${c.accent};margin-top:2px;">${c.en}</div>
              </div>
              <div style="position:absolute;left:0;right:0;bottom:0;height:2px;background:${c.accent};"></div>
            </div>
            <div style="padding:4px 6px;text-align:left;">
              <small style="font-size:10px;color:#8c9894;">${c.theme} · ${c.code}</small>
            </div>
            ${isCurrent ? html`<span class="nc-pick__on">使用中</span>` : null}
          </button>`;
        })}
      </div>
      <footer class="nc-pick__foot">
        <small>选择的明日方舟官方阵营名片将展示在个人名牌、房间座位与结算战报中，纯本地持久化。</small>
        <${Button} size="sm" variant="primary" onClick=${onClose}>完成<//>
      </footer>
    </div>
  </div>`;
}

let pickerHost = null;

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
