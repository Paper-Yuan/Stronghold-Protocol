// public/js/ui/traitPicker.js — 超限词条选择弹窗
import { html } from '../vendor/preact-htm.js';
import { useEffect, useState } from '../vendor/preact-hooks.js';

/**
 * 超限词条选择弹窗：Boss 战胜利后的词条抉择界面
 * @param {{ trait: any, onSelect: (index: number) => void, onClose?: () => void }} props
 */
export function TraitPicker({ trait, onSelect, onClose }) {
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);

  if (!trait || !Array.isArray(trait.choices) || trait.choices.length === 0) {
    return null;
  }

  const handleSelect = (index) => {
    setSelected(index);
    setTimeout(() => {
      onSelect(index);
      if (onClose) onClose();
    }, 300); // 延迟关闭，显示选中动画
  };

  return html`
    <div class="trait-picker-overlay">
      <div class="trait-picker">
        <div class="trait-picker__header">
          <div class="trait-picker__title">
            <span class="trait-picker__icon">⚡</span>
            <h2>超限词条抉择</h2>
          </div>
          <div class="trait-picker__subtitle">
            选择一项词条强化你的阵容
          </div>
        </div>

        <div class="trait-picker__cards">
          ${trait.choices.map((choice, i) => html`
            <div
              key=${i}
              class=${[
                'trait-card',
                hovered === i && 'trait-card--hovered',
                selected === i && 'trait-card--selected'
              ].filter(Boolean).join(' ')}
              onMouseEnter=${() => setHovered(i)}
              onMouseLeave=${() => setHovered(null)}
              onClick=${() => handleSelect(i)}
            >
              <div class="trait-card__glow"></div>
              <div class="trait-card__content">
                <div class="trait-card__name">${choice.name || `词条 ${i + 1}`}</div>
                <div class="trait-card__desc">${choice.description || '增强效果'}</div>
                ${choice.value ? html`
                  <div class="trait-card__value">+${choice.value}</div>
                ` : null}
              </div>
              <div class="trait-card__index">${i + 1}</div>
            </div>
          `)}
        </div>

        <div class="trait-picker__hint">
          点击卡片选择词条
        </div>
      </div>
    </div>
  `;
}
