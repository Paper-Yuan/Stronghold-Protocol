// public/js/ui/annihilationSettings.js — 湮灭模拟 · 二级页的「功能设置」面板（业主 2026-10-28 晚，Part B 最后一件）
//
// 入口在**湮灭的主题大厅**（与炸惊的「规则 / 卡池调整」同一排），`data-testid="extension-feature-settings"`；打开的是
// 这张只有开关的表 `data-testid="ann-feature-settings"`，8 行：
//   * 上 4 行 = `shared/plugins/rules.js` 的 RULE_SWITCHES（shopBias / prepLoadout / morphPairing / unequip）。
//     每行**直接取该开关非官方那一档的 `phrase[option]` 当说明** —— 零新字面量，且文案永远与引擎的规则表同源。
//     开关的布尔语义照 protocol.js：`true` = 取 `options[1]`（非官方那一档）。
//   * 下 4 行 = 内容开关（`ANN_CONTENT_NAMES`：egirBuff / commsPriority / rhodesShip / kazdelShip）。这四条是内容而非规则，
//     引擎的规则表里没有它们的措辞，所以是**新字面量**（已报 Lead）。后两条在引擎侧**只影响计数与展示**（效果未接），
//     标签里写清，别让玩家以为它们真的改了玩法。
//
// 协议（engine-core 的 `shared/protocol.js` 已落，`server/lobby.js` 半边在落）：
//   * 写：房主的 `room.setAnnMods { annMods }`；新建房时从 `room.create { annMods }` 带初值。
//   * 读：`room.state.annMods`（这一轮先按这个键写，**字段名以 engine-core 回执为准**）。
//   * 每次发**完整的八个键**（未选显式 false），服务端 `normalizeAnnMods` 只留 true 的键，所以没有合并歧义；
//     `comms` 只是服务端的兼容别名，客户端只发长名 `commsPriority`。
//   * 读回：`room.state.annMods` = **只含 true 的键**的对象，全关 = `{}`；**非湮灭房没有这个键**（用这个区分「不适用」）。
//     局内没有 `m.public.annMods`（engine-core 不加），要显示「本局生效的设置」得在进房前从 room.state 带。
//   * 权限：`room.setAnnMods` = 房主 + 未开局（非房主 NOT_HOST / 已开局 ROOM_STARTED / 观战 SPECTATOR / 不在房
//     NOT_IN_ROOM / 非湮灭房 BAD_TARGET）。服务端不发 toast，只读提示由这里用既有词条画（`由创建者设置`）。
//   * 生效时机：**下一局生效**（Match 构造时把 annMods 快照给 GameData）；建房时带上则第一局就生效。这一句用既有词条
//     `下一局生效` 写在面板页脚。
import { html, Icon, Modal } from './components.js';
import { RULE_SWITCHES } from '../../../shared/plugins/rules.js';
import { ANN_RULE_NAMES, ANN_CONTENT_NAMES } from '../../../shared/protocol.js';
// 缺省开启的两条（罗德岛 / 卡兹戴尔）与「显式压缺省」的判据：与服务端、战斗侧同一份来源
import { annModOn } from '../../../shared/annihilation-constants.js';
import { t, N_ } from '../../../shared/i18n.js';

/**
 * The four content switches' labels. These are the only new strings of this panel (the four rule rows borrow the rule
 * table's own phrasing). 2026-10-29：罗德岛 / 卡兹戴尔两条盟约的战斗效果已接（server/sim/content/bonds/addon/annbonds.js），
 * 所以标签去掉了原先的「（仅计数与展示）」后缀。
 * @type {Readonly<Record<string, string>>}
 */
export const ANN_CONTENT_LABELS = Object.freeze({
  egirBuff: N_('阿戈尔加强'),
  commsPriority: N_('通讯机与寻呼模块'),
  rhodesShip: N_('罗德岛盟约'),
  kazdelShip: N_('卡兹戴尔盟约'),
});

/** A rule switch's own sentence for its non-official option (the `true` side). */
function rulePhrase(name) {
  const spec = RULE_SWITCHES[name];
  if (!spec || !Array.isArray(spec.options) || spec.options.length < 2) return name;
  const option = spec.options[1];
  return (spec.phrase && spec.phrase[option]) || name;
}

/**
 * The eight rows, in display order: the four rule switches then the four content switches.
 * 缺省值走 `shared/annihilation-constants.js` 的 `ANN_MOD_DEFAULT_ON`（罗德岛 / 卡兹戴尔默认开）：
 * 房间回显只带**显式**键，所以「没写过」= 取缺省，`{ kazdelShip: false }` 才是关。
 * @param {Record<string, boolean>} [value] the room's explicit `annMods`
 * @returns {{ id: string, kind: 'rule'|'content', label: string, on: boolean }[]}
 */
export function annModRows(value = {}) {
  const v = value && typeof value === 'object' ? value : {};
  const rows = [];
  for (const name of ANN_RULE_NAMES) rows.push({ id: name, kind: 'rule', label: rulePhrase(name), on: v[name] === true });
  for (const name of ANN_CONTENT_NAMES) {
    rows.push({ id: name, kind: 'content', label: ANN_CONTENT_LABELS[name] || name, on: annModOn(v, name) });
  }
  return rows;
}

/**
 * The whole map the protocol wants: every known key, explicitly boolean.
 * 规则四项 = 面板勾选；**内容四项 = 生效值**（`annModOn`，缺省开启的两条在「没动过」时发 `true`）——
 * 否则 `lobby` 的确认路径会把空回显整表喂进来，用户什么都没点也会把默认开启的两条静默写成 `false`。
 * @param {Record<string, boolean>} value
 */
export function annModsWire(value = {}) {
  const v = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const name of ANN_RULE_NAMES) out[name] = v[name] === true;
  for (const name of ANN_CONTENT_NAMES) out[name] = annModOn(v, name);
  return out;
}

/**
 * The panel's view (pure: the caller owns the draft map, so a test draws it as a function).
 * @param {{ rows?: any[], readOnly?: boolean, hint?: string|null, busy?: boolean,
 *   onToggle?: (id: string, on: boolean) => void, onSave?: () => void, onClose?: () => void }} props
 */
export function AnnSettingsView({ rows = annModRows(), readOnly = false, hint = null, busy = false, onToggle = () => {}, onSave = () => {}, onClose = () => {} }) {
  const on = rows.filter((r) => r.on).length;
  return html`<${Modal} open=${true} onClose=${onClose} class="annmods" title=${t('功能设置')} micro="ANNIHILATION // MODS">
    <div class="annmods__body" data-testid="ann-feature-settings">
      ${readOnly && hint ? html`<p class="annmods__ro" role="status"><${Icon} name="info" />${hint}</p>` : null}
      <ul class="annmods__list" role="list">
        ${rows.map((r) => html`<li key=${r.id} class=${`annmods__row${r.kind === 'content' ? ' is-content' : ''}`} data-kind=${r.kind}>
          <button type="button" class="annmods__sw" role="switch" aria-checked=${r.on ? 'true' : 'false'}
              aria-pressed=${r.on ? 'true' : 'false'} data-testid=${`ann-mod-${r.id}`} data-on=${r.on ? 'true' : 'false'}
              disabled=${readOnly || busy} onClick=${() => { if (!readOnly && !busy) onToggle(r.id, !r.on); }}>
            <span class="annmods__track" aria-hidden="true"><i></i></span>
            <span class="annmods__label">${t(r.label)}</span>
          </button>
        </li>`)}
      </ul>
      <footer class="annmods__foot">
        <span class="annmods__note">${t('下一局生效')}</span>
        <span class="annmods__count num" data-testid="ann-mod-count">${on}</span>
        <button type="button" class="annmods__save" data-testid="ann-mod-save" disabled=${readOnly || busy} onClick=${onSave}>${t('确认')}</button>
      </footer>
    </div>
  <//>`;
}

/**
 * Send the switches as the room's setting (the host, before the match). Kept here so both an in-lobby draft and any
 * future in-room entry go through one shape.
 * @param {{ request: (t: string, fields?: any) => Promise<any> }} net
 * @param {Record<string, boolean>} value
 */
export function sendAnnMods(net, value) {
  return net.request('room.setAnnMods', { annMods: annModsWire(value) });
}
