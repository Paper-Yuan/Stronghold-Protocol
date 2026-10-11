// 皮肤选择器 (docs/SKINS.md) — the 皮肤 section of the 干员调配 screen's detail panel.
//
// All 174 skins are built-in. Operators without skins return null silently.
// Outside match only: changes are persisted to localStorage and mirrored via room.skins.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, MicroLabel } from './components.js';
import { useStore, shallowEqual } from '../store.js';
import { data } from '../data.js';
import { skinsStore, availableSkins, loadSkinData, setSkin, clearSkin } from './skins.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * The installed skin's 180×180 avatar URL, or null.
 *
 * Keyed by OPERATOR id, not by chess id: data/assets.json groups everything under `chars[charId]`.
 */
function skinAvatar(charId, skinId) {
  return data.get('assets')?.chars?.[charId]?.skins?.[skinId]?.avatar || null;
}

/**
 * 皮肤 section for one operator.
 * @param {{ chess: any }} props `chess` is the chess record of the detail panel
 */
export function SkinSection({ chess }) {
  const s = useStore((v) => v, shallowEqual, skinsStore);
  const [, bump] = useState(0);

  const chessId = chess && chess.chessId;
  const charId = chess && chess.charId;

  useEffect(() => {
    let dead = false;
    loadSkinData();
    const off = data.subscribe?.(() => { if (!dead) bump((n) => n + 1); });
    const t = setInterval(() => { if (!dead) bump((n) => n + 1); }, 500);
    return () => { dead = true; clearInterval(t); off?.(); };
  }, [chessId]);

  if (!chessId || !charId) return null;
  const skinsReady = data.status('skins') === 'ready';
  if (!skinsReady) {
    return html`<section class="lo-sec lo-sec--skin" data-testid="skin-section">
      <header class="lo-sec__head">
        <h3>皮肤<${MicroLabel}>SKIN<//></h3>
        <span class="lo-sec__note">正在载入配置…</span>
      </header>
    </section>`;
  }

  const list = availableSkins(charId);
  if (!list.length) return null; // 确认加载完且真无皮肤才隐藏

  const chosen = s.entries[chessId] || null;
  const defaultArt = data.get('assets')?.chars?.[charId]?.avatar || null;

  return html`<section class="lo-sec lo-sec--skin" data-testid="skin-section">
    <header class="lo-sec__head">
      <h3>皮肤<${MicroLabel}>SKIN<//></h3>
      <span class="lo-sec__note">${list.length} 款可选</span>
    </header>
    <div class="lo-skins" role="radiogroup" aria-label="选择皮肤">
      <button type="button" role="radio" aria-checked=${chosen ? 'false' : 'true'} data-skin=""
        class=${cx('lo-skin', 'lo-skin--default', !chosen && 'is-on')} onClick=${() => clearSkin(chessId)}>
        <span class="lo-skin__art">
          ${defaultArt
            ? html`<img src=${defaultArt} alt="" loading="lazy" />`
            : html`<span class="lo-skin__art--none"></span>`}
        </span>
        <span class="lo-skin__text">
          <b class="lo-skin__name">默认</b>
          <span class="lo-skin__group">DEFAULT</span>
        </span>
        ${!chosen ? html`<span class="lo-skin__badge">已装配</span>` : null}
      </button>
      ${list.map((x) => {
        const art = skinAvatar(charId, x.id) || defaultArt;
        const isEquipped = chosen === x.id;
        return html`<button key=${x.id} type="button" role="radio" aria-checked=${isEquipped ? 'true' : 'false'}
            data-skin=${x.id}
            class=${cx('lo-skin', isEquipped && 'is-on')}
            onClick=${() => setSkin(chessId, x.id)}>
          <span class="lo-skin__art">
            ${art
              ? html`<img src=${art} alt="" loading="lazy" onError=${(e) => {
                  if (defaultArt && e.currentTarget.src !== defaultArt) {
                    e.currentTarget.src = defaultArt;
                  }
                }} />`
              : html`<span class="lo-skin__art--none"></span>`}
          </span>
          <span class="lo-skin__text">
            <b class="lo-skin__name">${x.name}</b>
            <span class="lo-skin__group">${x.group || 'SPECIAL'}</span>
          </span>
          ${isEquipped ? html`<span class="lo-skin__badge">已装配</span>` : null}
        </button>`;
      })}
    </div>
  </section>`;
}
