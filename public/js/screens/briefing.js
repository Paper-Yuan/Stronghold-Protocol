// Briefing — INFO_CHECK "1/2 确认本局信息" (research 06 §4.1, D1): enemy leader (silhouette, name,
// abilities), stage (+ its pool: 战场固定 / 战场随机（共N张）), 特训敌人 factions (icon, name, description), the difficulty
// tag, the ready count x/N with person pips, the 准备就绪 button (g.infoReady) and the countdown. The 核心盟约 / 附加盟约
// rows of bond discs (disabled bonds greyed with the banned-member badge), the legend and the 本局禁用干员 avatars, with
// the player's own 自选 pieces out of the shop (m.private.diyBanned), are ui/matchInfo.js MatchBondRow / MatchLegend /
// BannedOperators, the blocks the strategy draft's 本局信息 dialog shows (screens/bandDraft.js). The enemy section is shared too:
// ui/matchEnemies.js MatchEnemies (GitHub #484, DESIGN §35.6).
// The event's layout (PR #643, video 6:29–7:51): one scrolling column of sections under grey header bars — 本局遭遇敌方
// (MatchEnemies: the leader's framed portrait over 敌方领袖, its text with the battlefield, the 特训敌人 as round icons
// with their names, the description in a tooltip — the maintainer's decision of 2026-10-22), 核心盟约, 附加盟约 (the legend
// under it), 本局禁用干员 — with 已就绪 x/N over the person pips (已就绪 2/4 as research 06 §4.1 reads it, no colon) and
// the big 准备就绪 in the bottom-right corner. The sections come in from the right one after another
// (css/screens/briefing.css 开局转场).

import { useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon } from '../ui/components.js';
import { useGameData } from '../ui/gameComponents.js';
import { StepHeader, ExitModal } from '../ui/matchChrome.js';
import { MatchBondRow, MatchLegend, BannedOperators, matchInfoModel } from '../ui/matchInfo.js';
import { MatchEnemies } from '../ui/matchEnemies.js';
import { LoadoutButton } from './loadout.js';
import { UnofficialMark, VersionTag } from '../ui/pluginTag.js';
import { SetupReroll } from '../ui/setupReroll.js';
import { actions } from '../ui/gameActions.js';
import { sortedPlayers, phaseTotalSeconds } from '../ui/gameLogic.js';
// 炸惊模拟（ZHAJING）：简报里只写玩法包自己的名字/简介与**阶段名**，不写惊变卡面 —— 卡面要到惊变阶段当场才揭晓
// （包内同一条纪律；数据在 config 的 mode 记录里，spPhaseKinds 是回合 → 阶段种类）。
import { ZHAJING_DIFFICULTY } from './extensionModes.js';
import { useStore } from '../store.js';
import { data } from '../data.js';
import { officialBonds } from '../ui/zjView.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** INFO_CHECK screen. */
export function BriefingScreen() {
  const pub = useStore((s) => s.match.public);
  const priv = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  const solo = useStore((s) => s.room?.mode === 'solo') || String(pub?.modeId || '').includes('single');
  // gameplay plugins (DESIGN §32.6): the briefing says the match is unofficial
  const room = useStore((s) => s.room);
  const gd = useGameData();
  const [exit, setExit] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!pub) return null;

  const players = sortedPlayers(pub);
  const me = players.find((p) => p.playerId === myId);
  const readyN = players.filter((p) => p.ready).length;
  const mode = gd.config?.modes?.[pub.modeId];
  // (+ the own 自选 pieces this match leaves out of the shop: m.private.diyBanned)
  const info = matchInfoModel(pub, { bonds: officialBonds(gd.list('bonds'), pub?.modeId ?? pub?.difficulty), chess: gd.chess, mode, priv, diyData: { chess: data.get('chess'), backups: data.get('backups') } });
  // 炸惊模拟: its own name / description, and the special 阶段 by NAME only — the 惊变 cards are drawn when the phase opens,
  // so the briefing has nothing to leak and prints nothing but the round and the kind (spPhaseKinds: 1→jibian …).
  const zhajing = mode && mode.difficulty === ZHAJING_DIFFICULTY ? mode : null;
  const PHASE_KIND = { jibian: t('惊变阶段'), express: t('快递'), bountyHigh: t('悬赏') };
  const phases = zhajing && zhajing.spPhaseKinds && typeof zhajing.spPhaseKinds === 'object'
    ? Object.entries(zhajing.spPhaseKinds).map(([r, k]) => ({ round: Number(r), kind: k }))
      .filter((x) => Number.isInteger(x.round)).sort((a, b) => a.round - b.round)
    : [];

  const ready = async () => {
    if (busy || me?.ready) return;
    setBusy(true);
    await actions.infoReady(pub.setupRevision ?? 0);
    setBusy(false);
  };

  return html`<div class="screen brief">
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${1} of=${2} title=${t('确认本局信息')} micro="BRIEFING // INFO CHECK" pub=${pub}
      total=${phaseTotalSeconds(pub, gd.config)} onExit=${() => setExit(true)} />
    <${UnofficialMark} room=${room} class="brief__modmark" /><${VersionTag} room=${room} class="brief__vertag" />
    <main class="brief__main">
      <section class="brief-sec brief-sec--enemy" style="--i:1">
        <${MatchEnemies} pub=${pub} gd=${gd} />
      </section>

      <section class="brief-sec brief-sec--core" style="--i:2"><${MatchBondRow} title=${t('核心盟约')} micro="CORE BONDS" bonds=${info.core} model=${info} /></section>
      <section class="brief-sec brief-sec--addon" style="--i:3">
        <${MatchBondRow} title=${t('附加盟约')} micro="ADD-ON BONDS" bonds=${info.addon} model=${info} />
        <${MatchLegend} model=${info} />
      </section>
      <section class="brief-sec brief-sec--banned" style="--i:4"><${BannedOperators} model=${info} /></section>
      ${zhajing ? html`<section class="brief-sec brief-sec--zj" style="--i:5" data-testid="brief-zhajing">
        <header class="brief-h"><span>${t('玩法包')}</span><span class="micro">${zhajing.code || ''}</span></header>
        <div class="brief-zj">
          <b class="brief-zj__name">${t(zhajing.name || '')}</b>
          <p class="brief-zj__desc">${t(zhajing.desc || '')}</p>
          ${phases.length ? html`<ul class="brief-zj__phases">
            ${phases.map((x) => html`<li key=${x.round} data-kind=${x.kind}><span class="num">R${x.round}</span>${PHASE_KIND[x.kind] || x.kind}</li>`)}
          </ul>` : null}
        </div>
      </section>` : null}
    </main>
    <${SetupReroll} pub=${pub} />
    <footer class="brief__foot">
      <${LoadoutButton} from="briefing" size="lg" class="brief-loadout" />
      <div class="brief-ready">
        <span class="brief-ready__txt">${t('已就绪')}<b class="num">${readyN}</b><span class="num">/${players.length}</span></span>
        <span class="brief-ready__pips">${players.map((p) => html`<i key=${p.playerId} class=${cx(p.ready && 'on', p.playerId === myId && 'me')} title=${p.name}><${Icon} name="user" /></i>`)}</span>
      </div>
      <${Button} variant="primary" size="xl" class="brief-go" icon=${me?.ready ? 'check' : me ? 'play' : 'eye'} active=${!!me?.ready} loading=${busy}
        disabled=${!!me?.ready || !me || !!pub.rerollVote} onClick=${ready}>${me?.ready ? t('已就绪') : me ? t('准备就绪') : t('观战中')}<//>
    </footer>
    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${solo} />
  </div>`;
}
