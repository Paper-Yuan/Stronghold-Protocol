// ui/dpsPanel.js — 战斗内实时伤害榜与总伤统计 (参考明日方舟原版总伤柱状榜)
import { useEffect, useState, useMemo } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { Img } from './gameComponents.js';
import { currentBattle } from '../diag.js';
import { chessAvatarUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t } from '../../shared/i18n.js';

function fmtDamage(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  return Math.round(n).toLocaleString('en-US');
}

export function DpsPanel({ myId, watching = null, phase = null }) {
  const [stats, setStats] = useState({ total: 0, ops: [] });

  useEffect(() => {
    let timer = 0;
    const poll = () => {
      const b = currentBattle();
      if (!b || !b.units) {
        return;
      }
      const targetOwner = watching?.playerId || myId;
      const allies = b.units.filter((u) => u && u.side === 'ally' && (targetOwner ? u.ownerId === targetOwner : true));
      
      let totalDmg = 0;
      const map = new Map();

      for (const u of allies) {
        const dmg = Math.max(0, Number(u.stats?.dmg) || 0);
        totalDmg += dmg;
        // 以干员 defId / charId 聚合（召唤物可归并至所属干员或单独展示）
        const id = u.defId || u.charId || u.id;
        if (!id) continue;
        const prev = map.get(id) || { id, name: u.name || id, dmg: 0, charId: u.charId || id, standInFor: u.standInFor || null };
        prev.dmg += dmg;
        if (u.standInFor) prev.standInFor = u.standInFor;
        map.set(id, prev);
      }

      const list = [...map.values()]
        .filter((x) => x.dmg > 0)
        .sort((a, b) => b.dmg - a.dmg);

      setStats({ total: totalDmg, ops: list.slice(0, 8) });
    };

    poll();
    timer = setInterval(poll, 240);
    return () => clearInterval(timer);
  }, [myId, watching?.playerId]);

  const m = data.get('assets');
  const maxDmg = stats.ops[0]?.dmg || 1;

  if (stats.total <= 0 && (!stats.ops || stats.ops.length === 0)) {
    return null;
  }

  return html`<aside class="dps-panel" aria-label=${t('实时伤害统计')}>
    <div class="dps-panel__head">
      <span class="dps-panel__tag">${t('总伤')}</span>
      <b class="dps-panel__total num">${fmtDamage(stats.total)}</b>
    </div>
    <div class="dps-panel__list">
      ${stats.ops.map((op) => {
        const pct = Math.min(100, Math.round((op.dmg / maxDmg) * 100));
        let chessRec = data.lookup('chess', op.id);
        if (op.standInFor) {
          chessRec = { ...(chessRec || {}), charId: op.charId, standInFor: op.standInFor };
        }
        const avatarSrc = chessAvatarUrl(m, chessRec || { charId: op.charId, standInFor: op.standInFor });
        return html`<div key=${op.id} class="dps-row">
          <div class="dps-row__bar" style=${`width: ${pct}%`} aria-hidden="true"></div>
          <span class="dps-row__avatar">
            <${Img} src=${avatarSrc} fallback=${html`<span class="dps-row__char">${[...(op.name || '?')][0]}</span>`} />
          </span>
          <span class="dps-row__num num">${fmtDamage(op.dmg)}</span>
        </div>`;
      })}
    </div>
  </aside>`;
}
