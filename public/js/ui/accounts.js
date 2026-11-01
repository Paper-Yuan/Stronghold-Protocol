// Compat module (stronghold-ui package) — install ONLY when the target has no public/js/ui/accounts.js.
// The original deployment has player accounts kept by its own accounts service (login, avatar, #tag, name cards, the
// same records on every device). This module is the LOCAL stand-in: one "本机账号" per browser, everything in
// localStorage — the profile (avatar, #tag) under `sp.pref.localAccount`, the match records in the game's own
// `sp.pref.stats` (ui/stats.js). Nothing is sent to the server, and only the player on this browser has an account:
// teammates show no #tag. To connect a real account system later, replace this file with a module that has the same
// exports (AGENTS.md §3.2 lists them and what each must return).
import { html, AvatarFrame, MicroLabel, Icon, Modal, Button } from './components.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { render } from '../../vendor/preact.module.js';
import { store } from '../store.js';
import { openNamecardPicker, NameCardLayer, NamecardVariantSwitch, namecardKnown } from './namecards.js';
import { useData } from '../data.js';
import { t } from '../../../shared/i18n.js';

/** This module keeps the account in the browser (other modules may check it to word their notes). */
export const LOCAL_ACCOUNT = true;

const KEY = 'sp.pref.localAccount';
const AVATAR_MAX = 160_000; // the stored data: URL (a 128×128 JPEG is ~10 kB)
const listeners = new Set();
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode / quota: kept for this page only */ } };

let profile = null;
function load() {
  if (profile) return profile;
  profile = read() || {};
  if (!/^\d{4}$/.test(profile.tag || '')) { profile.tag = String(1000 + Math.floor(Math.random() * 9000)); write(profile); }
  return profile;
}
function emit() { for (const fn of listeners) { try { fn(); } catch { /* a listener's own problem */ } } }
// (guarded: the module is also imported by Node tests, where there is no window)
globalThis.addEventListener?.('storage', (e) => { if (e.key === KEY) { profile = null; emit(); } });

/** The local account: { id, name (the game's player name), tag, avatar (data: URL or null), card (card id or null), local: true }. */
export function currentAccount() {
  const p = load();
  const name = store.get().me?.name || p.name || '博士';
  return { id: `local-${p.tag}`, name, tag: p.tag, avatar: typeof p.avatar === 'string' ? p.avatar : null, card: typeof p.card === 'string' ? p.card : null, local: true };
}
export function setLocalCard(cardId) {
  profile = { ...load(), card: cardId || null };
  write(profile);
  emit();
}
export function onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export async function refreshAccount() { return currentAccount(); }
export async function logoutAccount() { /* a local account cannot log out */ }
/** A fetch timeout signal (some modules import it from here). */
export function timeoutSignal(ms) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }

/** Preact: { me, loaded } — always loaded, `me` is the local account. */
export function useCurrentAccount() {
  const [me, setMe] = useState(currentAccount);
  useEffect(() => {
    const update = () => setMe(currentAccount());
    listeners.add(update);
    const off = store.subscribe ? store.subscribe(update) : null;
    return () => { listeners.delete(update); if (typeof off === 'function') off(); };
  }, []);
  return { me, loaded: true };
}

const isMe = (playerId) => !!playerId && playerId === store.get().me?.playerId;
/** A player's account — only this browser's own player has one here (teammates: null, no #tag). */
export function accountOf(playerId) { return isMe(playerId) ? currentAccount() : null; }
export function useAccount(playerId) {
  const { me } = useCurrentAccount();
  return isMe(playerId) ? me : null;
}
/** The small "#1234" after a name when that player has an account. */
export function AccountTag({ playerId }) {
  const info = useAccount(playerId);
  return info ? html`<span class="acct-tag" title=${`本机账号 ${info.name}#${info.tag}`}>#${info.tag}</span>` : null;
}
/** Plain DOM (chats): the #tag after this browser's own name. */
export function decorateChatName(element, playerId) {
  const info = accountOf(playerId);
  if (element && info && !element.querySelector('.acct-tag')) {
    const tag = document.createElement('span'); tag.className = 'acct-tag'; tag.textContent = `#${info.tag}`; element.append(tag);
  }
  return element;
}

// ---- avatar file → 128×128 square ------------------------------------------------------------------------------------
async function squareAvatar(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('图片读取失败')); i.src = url; });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 128, 128);
    return c.toDataURL('image/jpeg', 0.86);
  } finally { URL.revokeObjectURL(url); }
}

// ---- the panel (opened from the hub's top-right chip) -------------------------------------------------------------------
let cssLoaded = false;
/** 个人条 / 个人资料面板 / 名片选择器的样式（ui/forge.js 同一个懒加载写法；不进 index.html）。 */
export function ensureProfileCss() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  if (document.querySelector('link[data-profile]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/screens/profile.css';
  link.dataset.profile = '1';
  document.head.appendChild(link);
}

let host = null;

function AccountPanel({ onStats, onClose }) {
  const { me } = useCurrentAccount();
  // 名片索引（data/namecards.json，34 张）：载入完成会自动重画，索引缺失时这一栏只留「选择名片」
  useData('namecards');
  // 选了名片但索引没生成过（或这张卡不在索引里）：不画 600×186 的空框，退回「选择名片」占位
  const cardKnown = namecardKnown(me.card);
  const [busy, setBusy] = useState(false);
  // 差分切换后强制重画预览（NameCardLayer 每次渲染都从本机 pref 读序号）
  const [variantTick, setVariantTick] = useState(0);
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      setBusy(true);
      try { const d = await squareAvatar(f); if (d.length <= AVATAR_MAX) { profile = { ...load(), avatar: d }; write(profile); emit(); } }
      catch { /* not an image */ } finally { setBusy(false); }
    };
    input.click();
  };
  const clear = () => { profile = { ...load(), avatar: null }; write(profile); emit(); };
  return html`<${Modal} open=${true} title=${t('个人资料')} micro="PROFILE" onClose=${onClose}>
    <div class="lacct" data-testid="profile">
      <section class="lacct__sec" data-testid="profile-avatar">
        <header class="lacct__sec-head"><h3 class="lacct__sec-title">${t('个人资料')}</h3><${MicroLabel}>LOCAL ACCOUNT<//></header>
        <div class="lacct__who">
          <span class="lacct__pic">${me.avatar ? html`<img src=${me.avatar} alt="" />` : [...me.name][0]}</span>
          <span><b class="lacct__name">${me.name}<span class="acct-tag">#${me.tag}</span></b><br /><${MicroLabel}>LOCAL · 本机<//></span>
        </div>
        <p class="lacct__note">头像、编号和战绩都保存在这台设备的浏览器里，不上传服务器；换设备或清除浏览器数据后不会保留。昵称跟随游戏里的名字。</p>
        <div class="lacct__btns">
          <${Button} size="sm" variant="secondary" icon="edit" loading=${busy} onClick=${pick}>更换头像<//>
          ${me.avatar ? html`<${Button} size="sm" variant="ghost" onClick=${clear}>移除头像<//>` : null}
          ${onStats ? html`<${Button} size="sm" variant="primary" icon="chart" onClick=${() => { onClose(); onStats(); }}>统计数据<//>` : null}
        </div>
      </section>
      <section class="lacct__sec" data-testid="profile-card">
        <header class="lacct__sec-head"><h3 class="lacct__sec-title">${t('名片')}</h3><${MicroLabel}>NAME CARD<//></header>
        <div class=${`lacct__cardview${cardKnown ? '' : ' lacct__cardview--none'}`} data-testid="profile-card-preview"
            data-variant-tick=${variantTick}>
          ${cardKnown ? html`<${NameCardLayer} card=${me.card} />` : html`<span>${t('选择名片')}</span>`}
        </div>
        <div class="lacct__btns">
          <${Button} size="sm" variant="secondary" icon="image" onClick=${() => openNamecardPicker()}>${t('选择名片')}<//>
          <${NamecardVariantSwitch} card=${me.card} onChange=${() => setVariantTick((n) => n + 1)} />
        </div>
      </section>
    </div>
  <//>`;
}
/** Open the account panel ({ onStats } adds the 统计数据 button). */
export function openAccountPanel(opts = {}) {
  ensureProfileCss();
  if (!host) { host = document.createElement('div'); host.className = 'local-acct-host'; document.body.appendChild(host); }
  const close = () => render(null, host);
  render(html`<${AccountPanel} onStats=${opts.onStats} onClose=${close} />`, host);
}

/** The hub's top-right chip: avatar + name #tag; a click opens the account panel (with 统计数据). */
export function AccountMeChip({ player, onStats }) {
  const { me } = useCurrentAccount();
  useEffect(ensureProfileCss, []);
  // 名片底图要用索引（载入完成后自动重画）
  useData('namecards');
  const name = player?.name || me.name || '博士';
  return html`<button type="button" class="me-chip me-chip--btn stats-entry" data-testid="profile-entry"
      onClick=${() => openAccountPanel({ onStats })} title=${t('个人资料')} aria-label=${t('个人资料')}>
    <${AvatarFrame} size="sm" name=${name} seat=${0} self=${true} src=${me.avatar || undefined} />
    <span class="me-chip__text"><span class="me-chip__name">${name}<span class="acct-tag">#${me.tag}</span></span><${MicroLabel}>LOCAL · 本机账号<//></span>
    <${Icon} name="user" class="me-chip__stats" />
  </button>`;
}

/** Nothing to start: no service. */
export function startAccounts() {}
