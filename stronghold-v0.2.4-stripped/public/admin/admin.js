const $ = selector => document.querySelector(selector);
const state = { csrf: null, tab: 'players', offset: 0, snapshot: null, action: null, generation: 0, loading: false };
const statusNames = { playing: '正在对局', disconnected: '离线留席', matching: '等待匹配', spectating: '观战中', waiting: '房间等待', lobby: '大厅' };
const difficultyNames = { FUNNY: '标准模拟', NORMAL: '险境模拟', HARD: '绝境模拟', ABYSS: '终极模拟' };
const phaseNames = { INFO_CHECK: '开局确认', BAND_DRAFT: '策略选择', PREP: '整备', COMBAT: '作战', UNITE: '联防', SETTLE: '结算', CHOICE: '机变', RESULT: '结束', LOBBY: '等待' };
const actionNames = { kick: '踢出玩家', ban: '封禁玩家', unban: '解除封禁', announcement: '发布公告', stopAnnouncement: '结束公告', passwordChanged: '修改管理密码' };
const scopeNames = { session: '会话', browser: '同一浏览器', ip: '公网 IP' };
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const elem = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = String(text); if (className) node.className = className; return node; };
const cell = (...nodes) => { const td = elem('td'); td.append(...nodes); return td; };
function notice(text, error = false) { const n = $('#notice'); n.textContent = text; n.className = 'notice' + (error ? ' error' : ''); n.hidden = !text; }
async function api(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('/admin/api/' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', ...(state.csrf ? { 'X-CSRF-Token': state.csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || '操作失败'), { status: response.status });
    return data;
  } finally { clearTimeout(timer); }
}
function showLogin(message = '') {
  state.csrf = null; state.snapshot = null; state.generation++;
  $('#console').hidden = true; $('#login-screen').hidden = false;
  $('#login-error').textContent = message;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
}
async function showConsole(session) {
  state.csrf = session.csrf; state.offset = 0; state.generation++;
  $('#admin-name').textContent = session.username;
  $('#login-form').elements.password.value = '';
  $('#login-screen').hidden = true; $('#console').hidden = false;
  await refresh();
}
function empty(tbody, columns, message) {
  tbody.replaceChildren(); const row = elem('tr'), td = elem('td', message, 'empty'); td.colSpan = columns; row.append(td); tbody.append(row);
}
function nameBlock(p) {
  const wrap = elem('div', null, 'player-name'), avatar = elem('span', [...(p.name || '博士')][0], 'avatar'), text = elem('div', null, 'name-text');
  text.append(elem('strong', p.name || '博士'), elem('span', p.playerId, 'subtext mono')); wrap.append(avatar, text); return wrap;
}
function actionButton(label, action, target, danger = false) {
  const button = elem('button', label, danger ? 'danger' : 'subtle'); button.type = 'button';
  button.addEventListener('click', () => openAction(action, target)); return button;
}
function renderPlayers(data) {
  const body = $('#players-body'); body.replaceChildren();
  if (!data.players.length) empty(body, 6, '当前筛选下没有玩家。可切换为“所有玩家”查看大厅和房间。');
  for (const p of data.players) {
    const row = elem('tr'), stateCell = elem('div');
    stateCell.append(elem('span', statusNames[p.status] || p.status, 'pill ' + p.status));
    if (p.alive === false && p.playing) stateCell.append(elem('span', '已淘汰', 'subtext'));
    if (p.autoplay) stateCell.append(elem('span', 'AI 托管', 'subtext'));
    const room = elem('div'); room.append(elem('span', p.roomCode || p.matchId || '—', 'mono'), elem('span', p.isHost ? '房主' : p.spectator ? '观战席位' : p.mode === 'solo' ? '独立模拟' : p.mode ? '同盟模拟' : '未加入房间', 'subtext'));
    const progress = elem('div'); progress.append(elem('span', difficultyNames[p.difficulty] || '—'), elem('span', p.phase ? `${phaseNames[p.phase] || p.phase}${p.round != null ? ` · 第 ${p.round} 回合` : ''}${p.lp != null ? ` · LP ${p.lp}` : ''}` : '—', 'subtext'));
    const addr = elem('div'); addr.append(elem('span', p.ip || '—', 'mono'), elem('span', p.connected ? '连接有效' : `断线 ${date(p.disconnectedAt)}`, 'subtext'));
    const actions = cell(actionButton('踢出', 'kick', p), actionButton('封禁', 'ban', p, true)); actions.className = 'action-cell';
    row.append(cell(nameBlock(p)), cell(stateCell), cell(room), cell(progress), cell(addr), actions); body.append(row);
  }
  $('#player-count').textContent = `${data.filteredCount} 人`;
  $('#previous-page').disabled = state.offset === 0;
  $('#next-page').disabled = state.offset + 200 >= data.filteredCount;
  $('#page-range').textContent = data.filteredCount ? `${state.offset + 1}–${Math.min(state.offset + 200, data.filteredCount)} / ${data.filteredCount}` : '0 / 0';
}
function renderBans(data) {
  const body = $('#bans-body'); body.replaceChildren();
  const active = data.bans.filter(b => !b.expired);
  $('#ban-count').textContent = active.length;
  if (!data.bans.length) empty(body, 5, '暂无封禁记录。');
  for (const ban of [...data.bans].reverse()) {
    const row = elem('tr'), reason = elem('div'); reason.append(elem('span', ban.reason), elem('span', ban.scopes.map(s => scopeNames[s] || s).join(' / '), 'subtext'));
    row.append(cell(nameBlock(ban)), cell(reason), cell(elem('span', date(ban.createdAt))), cell(elem('span', ban.expired ? '已到期' : ban.expiresAt ? date(ban.expiresAt) : '永久')), cell(actionButton('解除', 'unban', ban)));
    body.append(row);
  }
}
function renderAudit(data) {
  const body = $('#audit-body'); body.replaceChildren();
  if (!data.audit.length) empty(body, 5, '暂无管理操作记录。');
  for (const item of data.audit) {
    const row = elem('tr'); row.append(cell(elem('span', date(item.at))), cell(elem('span', actionNames[item.action] || item.action)), cell(elem('span', item.name || item.playerId || '服务器')), cell(elem('span', item.reason || item.text || item.announcementId || '—')), cell(elem('span', item.actor))); body.append(row);
  }
}
async function renderAnnouncements() {
  const generation = state.generation;
  const data = await api('announcements');
  if (generation !== state.generation) return;
  const list = $('#announcements-list'); list.replaceChildren();
  const rows = data.announcements.filter(n => n.enabled && n.endAt > Date.now()).sort((a, b) => a.startAt - b.startAt);
  if (!rows.length) list.append(elem('p', '当前没有有效公告。', 'muted'));
  for (const n of rows) {
    const card = elem('article', null, 'announcement-card');
    card.append(elem('span', data.current?.id === n.id ? '正在展示' : n.startAt > Date.now() ? '等待开始' : '等待更高等级公告结束', 'pill'), elem('p', n.text), elem('small', `${date(n.startAt)} — ${date(n.endAt)} · ${n.level === 'urgent' ? '紧急' : n.level === 'warning' ? '提醒' : '普通'}`));
    if (n.id.startsWith('admin_')) card.append(actionButton('提前结束', 'stopAnnouncement', n));
    list.append(card);
  }
}
async function refresh() {
  if (!state.csrf) return;
  if (state.loading) { state.refreshAgain = true; return; }
  state.loading = true; $('#refresh-button').disabled = true;
  const generation = state.generation;
  try {
    const query = new URLSearchParams({ scope: $('#scope').value, search: $('#search').value.trim(), offset: state.offset });
    const data = await api('snapshot?' + query);
    if (generation !== state.generation) return;
    state.snapshot = data;
    $('#stat-online').textContent = data.stats.onlineBrowsers;
    $('#stat-playing').textContent = data.stats.playingPlayers;
    $('#stat-offline').textContent = data.stats.disconnectedPlayers;
    $('#stat-queue').textContent = data.stats.matchmaking.total;
    $('#stat-matches').textContent = `${data.stats.matches} 场对局进行中`;
    $('#last-update').textContent = `更新于 ${date(data.serverNow)} · 当前连接 ${data.stats.connectedPlayers} 个真人席位`;
    renderPlayers(data); renderBans(data); renderAudit(data);
    if (state.tab === 'announcements') await renderAnnouncements();
    if ($('#notice').classList.contains('error')) notice('');
  } catch (e) { if (e.status === 401) showLogin('管理会话已过期，请重新登录'); else notice('刷新失败，当前显示上次成功获取的数据：' + e.message, true); }
  finally { state.loading = false; $('#refresh-button').disabled = false; if (state.refreshAgain) { state.refreshAgain = false; queueMicrotask(refresh); } }
}
function openAction(kind, target) {
  state.action = { kind, target };
  const names = { kick: '踢出玩家', ban: '封禁玩家', unban: '解除封禁', stopAnnouncement: '结束公告' };
  $('#action-title').textContent = `${names[kind]}${target.name ? ' · ' + target.name : ''}`;
  $('#action-description').textContent = kind === 'kick' ? '将玩家从房间、队列和当前对局移出，并关闭连接；玩家可刷新页面重新加入。'
    : kind === 'ban' ? '将结束此客户端的当前参与，并在封禁期间阻止同一浏览器与会话重连。'
    : kind === 'unban' ? '解除这条封禁。其他仍生效的封禁不会改变；玩家可刷新页面重连。' : '提前结束这条公告，其余公告排期继续生效。';
  $('#reason-label').hidden = !['kick', 'ban'].includes(kind);
  $('#ban-options').hidden = kind !== 'ban';
  $('#action-form').reset();
  $('#action-form .form-error').textContent = '';
  $('#action-form').elements.includeIp.disabled = !target.canBanIp;
  $('#action-submit').textContent = names[kind] || '确认';
  $('#action-submit').className = kind === 'unban' ? 'primary' : 'danger';
  $('#action-dialog').showModal();
}
async function submit(form, work) {
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  const error = form.querySelector('.form-error');
  if (error) error.textContent = '';
  try { await work(); } catch (e) { if (e.status === 401 && state.csrf) showLogin('管理会话已过期，请重新登录'); else { if (error) error.textContent = e.message; else notice(e.message, true); } }
  finally { button.disabled = false; }
}
$('#login-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submit(form, async () => { const body = Object.fromEntries(new FormData(form)); const session = await api('login', body); $('#login-error').textContent = ''; await showConsole(session); });
});
$('#action-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submit(form, async () => {
    const { kind, target } = state.action, body = { playerId: target.playerId, reason: form.elements.reason.value.trim() || undefined };
    let endpoint = kind;
    if (kind === 'ban') { body.durationSeconds = Number(form.elements.durationSeconds.value); body.includeIp = form.elements.includeIp.checked; }
    if (kind === 'unban') body.banId = target.id;
    if (kind === 'stopAnnouncement') { endpoint = 'announcement/stop'; body.announcementId = target.id; }
    const result = await api(endpoint, body); $('#action-dialog').close();
    notice(kind === 'ban' ? `封禁已生效，已移出 ${result.affected} 个匹配客户端席位。` : '管理操作已完成。');
    await refresh();
  });
});
$('#announcement-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submit(form, async () => {
    if (!confirm('确认将这条公告发布给服务器所有玩家？')) return;
    const values = Object.fromEntries(new FormData(form)); values.durationSeconds = Number(values.durationSeconds);
    await api('announcement', values); form.elements.text.value = ''; notice('公告已发布，将按等级和排期展示。'); await renderAnnouncements();
  });
});
$('#password-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submit(form, async () => {
    const body = Object.fromEntries(new FormData(form));
    if (body.newPassword !== body.confirmPassword) throw new Error('两次输入的新密码不一致');
    await api('password', body); form.reset(); showLogin('密码已修改，请使用新密码登录');
  });
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $('#' + button.dataset.close).close());
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => {
  state.tab = button.dataset.tab;
  for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('active', b === button);
  for (const panel of document.querySelectorAll('.tab-panel')) panel.hidden = panel.id !== 'tab-' + state.tab;
  $('#page-title').textContent = { players: '玩家与对局', bans: '封禁管理', announcements: '服务器公告', audit: '操作记录' }[state.tab];
  if (state.tab === 'announcements') renderAnnouncements().catch(e => notice(e.message, true));
});
$('#refresh-button').addEventListener('click', refresh);
$('#scope').addEventListener('change', () => { state.offset = 0; state.generation++; refresh(); });
let searchTimer;
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.offset = 0; state.generation++; refresh(); }, 300); });
$('#previous-page').addEventListener('click', () => { state.offset = Math.max(0, state.offset - 200); refresh(); });
$('#next-page').addEventListener('click', () => { state.offset += 200; refresh(); });
$('#password-button').addEventListener('click', () => { $('#password-form').reset(); $('#password-form .form-error').textContent = ''; $('#password-dialog').showModal(); });
$('#logout-button').addEventListener('click', () => api('logout', {}).then(() => showLogin()).catch(e => notice(e.message, true)));
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
api('session').then(showConsole).catch(e => showLogin(e.status === 401 ? '' : e.message));
