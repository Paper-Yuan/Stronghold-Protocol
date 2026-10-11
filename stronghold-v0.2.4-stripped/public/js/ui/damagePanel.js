import { html, useTicker } from './components.js';
const number = v => Math.round(Number(v) || 0).toLocaleString('zh-CN');

export function DamagePanel({ runner, fieldId = null, onClose }) {
  useTicker(500);
  const report = runner?.damageReport?.(fieldId);
  return html`<aside class="damage-panel brackets" role="dialog" aria-label="干员伤害统计">
    <header><strong>干员伤害统计</strong><button type="button" onClick=${onClose} aria-label="关闭伤害统计">×</button></header>
    <p>本场实际伤害 · 平均 DPS = 总伤害 ÷ 本场战斗时间。暂停不计时，仅统计引擎归属于干员的伤害。</p>
    ${report?.units?.length ? html`<div class="damage-panel__scroll"><table><thead><tr><th>干员</th><th>总伤害</th><th>平均 DPS</th></tr></thead>
      <tbody>${report.units.map(u => html`<tr key=${u.id}><td>${u.name}</td><td>${number(u.damage)}</td><td>${number(u.dps)}</td></tr>`)}</tbody></table></div>
      <footer>${report.finished ? '本场战斗结算' : '实时统计'} · 战斗时间 ${report.seconds.toFixed(1)} 秒</footer>`
      : html`<p>当前还没有可查看的本地战斗统计，开始战斗后可查看。</p>`}
  </aside>`;
}
