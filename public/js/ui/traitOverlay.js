// public/js/ui/traitOverlay.js — 超限「词条抉择」界面（业主 2026-10-18）
//
// 只在 TRAIT_DRAFT 阶段挂载。视觉与动效来自 public/dev/trait-preview 的定稿：
//   · 三张卡依次入场（下方 + 后仰 + 弹簧落位），线框四边依次画出，角标点亮，扫描线扫过
//   · 环绕光带：正面荧光绿 / 负面危机合约红
//   · 选中：瞄准镜锁定 → 另外两张赛博删除（错开 120ms）→ 全部消失后选中卡滑到正中 → 长成文件夹
//   · 特化卡：角标直接显示词条名，卡面偏红，文件夹保持红底 + 警示斜条 + 徽记水印

import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';

const DEL_STAGGER = 120, DEL_FLICKER = 580, DEL_WIPE = 400, DEL_PAD = 100;
const MOVE_MS = 620, MORPH_MS = 820;

/** 特化配置：与服务端 server/match/traits.js SPECIALS 对应（只放卡面需要的字段） */
const SPECIAL_VIEW = {
  reid: { title: '复仇-火与钢', img: '/ui/enemy-special/enemy-reid.png' },
  mdrock: { title: '坚甲随身Ⅲ', img: '/ui/enemy-special/enemy-mdrock.png' },
  xi: { title: '气定神闲Ⅲ', img: '/ui/enemy-special/enemy-xi.png' },
};

export function TraitOverlay({ trait, myId, busyIdx = null, onPick }) {
  const [phase, setPhase] = useState('enter');   // enter → idle → choosing → moving → folder
  const [picked, setPicked] = useState(null);
  const cardsRef = useRef(null);
  const rootRef = useRef(null);
  const timers = useRef([]);

  const neg = trait?.polarity === 'neg';
  const cards = Array.isArray(trait?.cards) ? trait.cards : [];
  const myTurn = trait?.turn === myId;

  const after = (ms, fn) => { timers.current.push(setTimeout(fn, ms)); };
  useEffect(() => () => { for (const id of timers.current) clearTimeout(id); timers.current = []; }, []);

  // 入场结束后转 idle
  useEffect(() => {
    const id = setTimeout(() => setPhase((p) => (p === 'enter' ? 'idle' : p)), 900 + cards.length * 120);
    return () => clearTimeout(id);
  }, [cards.length]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.style.setProperty('--acc', neg ? 'var(--neg)' : 'var(--pos)');
    root.style.setProperty('--acc-hi', neg ? 'var(--neg-hi)' : 'var(--pos-hi)');
  }, [neg]);

  const choose = (idx) => {
    if (phase !== 'idle' || !myTurn || busyIdx != null) return;
    setPhase('choosing');
    setPicked(idx);
    const list = [...(cardsRef.current?.children || [])];
    const el = list[idx];
    const dels = list.filter((_, i) => i !== idx);
    // ① 选中锁定 + 落选错开删除
    if (el) el.classList.add('is-selected');
    dels.forEach((c, i) => {
      c.style.setProperty('--del-delay', (i * DEL_STAGGER) + 'ms');
      c.classList.add('is-deleting');
    });
    after(DEL_FLICKER, () => { for (const c of dels) c.classList.add('is-wiped'); });
    // ② 全部删完再滑到正中
    const lastGone = DEL_FLICKER + Math.max(0, dels.length - 1) * DEL_STAGGER + DEL_WIPE + DEL_PAD;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      setPhase('moving');
      const row = cardsRef.current.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      el.style.setProperty('--to-center', ((row.left + row.width / 2) - (box.left + box.width / 2)) + 'px');
      el.classList.add('is-moving');
      after(MOVE_MS + 60, () => { setPhase('folder'); after(240, () => onPick?.(idx)); });
    };
    let remaining = dels.length;
    for (const c of dels) {
      c.addEventListener('animationend', (e) => {
        if (e.animationName === 'traitCyberWipe' && --remaining <= 0) start();
      }, { once: true });
    }
    after(lastGone + 60, start);
  };

  return html`<div ref=${rootRef} class=${'traitov' + (neg ? ' traitov--neg' : '')} data-testid="trait-draft">
    <div class="traitov__veil"></div>
    <header class="traitov__head">
      <div class="traitov__micro">INFINITE PROTOCOL · TRAIT</div>
      <div class="traitov__title-row"><span class="traitov__dia"></span><h2>词条抉择</h2><span class="traitov__dia"></span></div>
      <div class="traitov__rule"></div>
      <p class="traitov__sub">本次为<b>${neg ? '负面' : '正面'}</b>词条 · 效果立即生效并贯穿本局剩余战斗</p>
    </header>
    <div ref=${cardsRef} class=${'traitov__cards' + (phase !== 'enter' ? ' is-ready' : '')}>
      ${cards.map((c, i) => {
        const sp = c.special ? SPECIAL_VIEW[c.special] : null;
        return html`<div class=${'tcard' + (neg ? ' tcard--neg' : '') + (c.special ? ' tcard--special' : '')}
            style=${sp ? `--sigil:url("${sp.img}")` : ''} key=${i}
            onClick=${() => choose(i)} role="button" tabindex="0">
          <span class="tcard__ring tcard__ring--glow"></span><span class="tcard__ring"></span>
          <span class="tcard__frame"><i class="t"></i><i class="r"></i><i class="b"></i><i class="l"></i></span>
          <b class="tcard__brk tl"></b><b class="tcard__brk tr"></b><b class="tcard__brk bl"></b><b class="tcard__brk br"></b>
          <span class="tcard__scan"></span>
          ${c.special ? html`<span class="tcard__wm"></span>` : null}
          <span class=${'tcard__tag' + (sp ? ' tcard__tag--special' : '')}>${sp ? sp.title : (neg ? '负面词条' : '正面词条')}</span>
          ${c.boss ? html`<span class="tcard__boss">BOSS</span>` : null}
          <div class="tcard__art">
            <span class="tcard__diamond"></span>
            <img class="tcard__icon" src=${'/assets/enemy/icon/' + c.mob + '.png'} alt="" draggable="false" />
          </div>
          <div class="tcard__body">
            <div class="tcard__mob">${c.name || ''}</div>
            ${c.special ? html`<div class="tcard__sep tcard__sep--tight"></div>` : null}
            ${c.special ? html`<div class="tcard__specdesc">${sp ? specialDesc(c.special) : ''}</div>` : null}
            <div class="tcard__sep"></div>
            <div class="tcard__traitname">${c.traitName || ''}</div>
            <div class="tcard__trait">${c.traitText || ''}</div>
          </div>
          <div class="tcard__pick"><span>已选择</span></div>
        </div>`;
      })}
    </div>
  </div>`;
}

/** 特化的完整描述（与服务端一致；客户端只做展示） */
function specialDesc(id) {
  if (id === 'reid') return '“复仇者”的生命值提升 150%，获得抵抗，攻击速度提升 100，生命值低于一半时攻击力额外提升 100% 且受到的伤害减少 60%';
  if (id === 'mdrock') return '泥岩的攻击力提升 90%，生命值提升 100%，法术抗性提升 45，泥岩的护盾值额外提升 100% 且护盾刷新冷却时间减少至 70%';
  if (id === 'xi') return '“自在”的生命值提升 50%，防御力提升 250%，法术抗性提升 30，【破桎而出】的释放间隔缩短 50%，爆炸范围扩大 100%';
  return '';
}
