// public/js/ui/bossPhaseWarn.js — 超限双 Boss 第二阶段的过场（业主 2026-10-21）
//
// 击败第一个 Boss 后，服务端把 phase 切到 BOSS_PHASE2_WARN 并保持 2.6 秒，
// 这里按这个阶段挂一块全屏红色横板（视觉见 public/dev/double-boss-preview.html）。
// 同一套机能风元素：黑-红横板 / 中心白字 / 数据读数条 / 虚线框 / 逐字浮现。
//
// 血条（.bossbar / PhaseCapsule）完全不参与 —— 阶段切换后服务端换血池，
// 顶部那条自然从 100% 重开，这里只管过场。

import { useEffect, useRef } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';

/** 与服务端 BOSS_PHASE2_WARN_MS 一致：2.6 秒。 */
export const WARN_MS = 2600;

/**
 * 双 Boss 第二阶段的全屏预警。
 * @param {{ on?: boolean }} props `on` = pub.phase === PHASE.BOSS_PHASE2_WARN
 */
export function BossPhaseWarn({ on = false }) {
  const rootRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    clearTimeout(timerRef.current);
    if (!on) {
      el.classList.remove('is-on', 'is-out');
      return undefined;
    }
    // 重播：先摘类强制回流，再挂上，动画就会从头播
    el.classList.remove('is-on', 'is-out');
    void el.offsetWidth;
    el.classList.add('is-on');
    const bar = el.querySelector('.bpwarn__timer');
    if (bar) {
      bar.style.transition = 'none';
      bar.style.transform = 'scaleX(0)';
      void bar.offsetWidth;
      bar.style.transition = `transform ${WARN_MS}ms linear`;
      bar.style.transform = 'scaleX(1)';
    }
    return () => { clearTimeout(timerRef.current); };
  }, [on]);

  if (!on) return null;

  return html`<div ref=${rootRef} class="bpwarn" data-testid="boss-phase2-warn">
    <div class="bpwarn__flush"></div>
    <div class="bpwarn__pulse"></div>
    <div class="bpwarn__edge bpwarn__edge--top"></div>
    <div class="bpwarn__edge bpwarn__edge--bottom"></div>
    <span class="bpwarn__corner bpwarn__corner--tl"></span>
    <span class="bpwarn__corner bpwarn__corner--tr"></span>
    <span class="bpwarn__corner bpwarn__corner--bl"></span>
    <span class="bpwarn__corner bpwarn__corner--br"></span>

    <div class="bpwarn__body">
      <div class="bpwarn__sweep"></div>
      <div class="bpwarn__scanline"></div>
      <div class="bpwarn__data bpwarn__data--top">
        <span>PHASE <b>01</b>/02</span>
        <span>CORE <b>ACTIVE</b></span>
        <span>THREAT <b>▮▮▮▮▮</b></span>
      </div>
      <div class="bpwarn__micro">SECOND PHASE INCOMING</div>
      <div class="bpwarn__title">
        <span>隐</span><span>秘</span><span>核</span><span>心</span><span> </span><em><span>正</span><span>在</span><span>觉</span><span>醒</span></em>
      </div>
      <div class="bpwarn__sub">
        <span>${t('敌方领袖已失去战斗能力，但污染源仍在扩散')}</span>
        <span><b>${t('检测到更高强度的核心反应')}</b> —— ${t('重新建立接触')}</span>
      </div>
      <div class="bpwarn__data bpwarn__data--bottom">
        <span>SEAL <b>BREACHED</b></span>
        <span>RE-ENTRY <b>2.6s</b></span>
      </div>
      <div class="bpwarn__foot">
        <span class="bpwarn__read">PHASE <b>1</b> → <b>2</b></span>
        <div class="bpwarn__track"><div class="bpwarn__timer"></div></div>
      </div>
    </div>
  </div>`;
}
