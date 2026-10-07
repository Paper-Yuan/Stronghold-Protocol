// public/admin/admin.js — Dashboard Application Script
let token = sessionStorage.getItem('sp_admin_token') || '';
let currentFilter = 'all';
let allLogs = [];
let pollTimer = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Initialize app
window.addEventListener('DOMContentLoaded', () => {
  if (!token) {
    showLogin(true);
  } else {
    initDashboard();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#input-token').value.trim();
    if (!input) return;
    const ok = await checkToken(input);
    if (ok) {
      token = input;
      sessionStorage.setItem('sp_admin_token', token);
      showLogin(false);
      initDashboard();
    } else {
      $('#login-err').style.display = 'block';
    }
  });

  $('#btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem('sp_admin_token');
    token = '';
    showLogin(true);
  });

  $('#btn-refresh').addEventListener('click', () => fetchAllData());

  $('#btn-broadcast').addEventListener('click', async () => {
    const text = $('#input-broadcast').value.trim();
    if (!text) return;
    try {
      const res = await apiPost('/api/admin/broadcast', { message: text });
      if (res.ok) {
        alert('广播已发送！');
        $('#input-broadcast').value = '';
        fetchAllData();
      } else {
        alert('广播发送失败: ' + (res.error || '未知错误'));
      }
    } catch (err) {
      alert('请求失败');
    }
  });

  $('#btn-drain').addEventListener('click', async () => {
    if (!confirm('确认启动平滑排空模式？\n这将拒绝新创建房间，等待已有对战打完后以便执行零停机热切换。')) return;
    try {
      const res = await apiPost('/api/admin/drain');
      if (res.ok) {
        alert('平滑排空模式已激活！');
        fetchAllData();
      }
    } catch {
      alert('请求失败');
    }
  });

  // Log filter pills
  $$('.adm-log-filters .adm-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.adm-log-filters .adm-pill').forEach((p) => p.classList.remove('is-active'));
      btn.classList.add('is-active');
      currentFilter = btn.dataset.filter;
      renderLogs();
    });
  });
});

function showLogin(show) {
  $('#login-modal').style.display = show ? 'grid' : 'none';
  $('#dashboard').style.display = show ? 'none' : 'flex';
  $('#btn-logout').style.display = show ? 'none' : 'inline-block';
  if (show && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function checkToken(testToken) {
  try {
    const res = await fetch('/api/admin/overview', {
      headers: { Authorization: 'Bearer ' + testToken },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function apiGet(path) {
  const res = await fetch(path, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (res.status === 401) {
    showLogin(true);
    throw new Error('Unauthorized');
  }
  return res.json();
}

async function apiPost(path, body = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    showLogin(true);
    throw new Error('Unauthorized');
  }
  return res.json();
}

function initDashboard() {
  showLogin(false);
  fetchAllData();
  if (!pollTimer) {
    pollTimer = setInterval(fetchAllData, 2000);
  }
}

async function fetchAllData() {
  try {
    const [overview, rooms, logs] = await Promise.all([
      apiGet('/api/admin/overview'),
      apiGet('/api/admin/rooms'),
      apiGet('/api/admin/logs'),
    ]);

    renderOverview(overview);
    renderRooms(rooms);
    allLogs = logs || [];
    renderLogs();
  } catch (err) {
    console.warn('[admin] poll error', err);
  }
}

function renderOverview(data) {
  if (!data) return;
  $('#badge-version').textContent = `v${data.version?.app || '0.2.1'} (${data.version?.build || 'git'})`;
  if (data.isDraining) {
    $('#badge-status').textContent = `排空模式 (${data.drainElapsedSec}s)`;
    $('#badge-status').className = 'adm-badge adm-badge--orange';
    $('#drain-banner').style.display = 'block';
  } else {
    $('#badge-status').textContent = '服务运行中';
    $('#badge-status').className = 'adm-badge adm-badge--green';
    $('#drain-banner').style.display = 'none';
  }

  $('#stat-sockets').textContent = data.network?.sockets ?? 0;
  $('#stat-sessions').textContent = data.network?.sessions ?? 0;
  const clients = data.network?.clients || {};
  const statClientsEl = $('#stat-clients');
  if (statClientsEl) {
    statClientsEl.textContent = `📱 全量: ${clients.androidFull || 0} | ⚡ 预载: ${clients.webPreloaded || 0} | 🌐 流式: ${clients.webStream || 0}`;
  }

  $('#stat-rooms').textContent = data.network?.roomsCount ?? 0;
  $('#stat-matches').textContent = data.network?.matchesCount ?? 0;

  $('#stat-cpu').textContent = (data.system?.cpuPercent ?? 0) + '%';
  const up = data.uptime || 0;
  const h = Math.floor(up / 3600);
  const m = Math.floor((up % 3600) / 60);
  const s = up % 60;
  $('#stat-uptime').textContent = `在线: ${h > 0 ? h + '时' : ''}${m}分${s}秒`;

  $('#stat-mem').textContent = data.system?.processRssMb ?? 0;
  $('#stat-heap').textContent = `堆已用: ${data.system?.heapUsedMb ?? 0} MB`;
}

function renderRooms(rooms = []) {
  $('#rooms-count').textContent = rooms.length;
  const tbody = $('#rooms-tbody');
  if (!rooms.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="adm-td-empty">暂无活动房间</td></tr>';
    return;
  }

  tbody.innerHTML = rooms
    .map((r) => {
      const modeLabel = r.mode === 'solo' ? '单人模拟' : '合作同盟';
      const diffLabel = r.difficulty || 'NORMAL';
      const humanCount = (r.seats || []).filter((s) => !s.isBot).length;
      const botCount = (r.seats || []).filter((s) => s.isBot).length;
      const statusLabel = r.inMatch
        ? '<span class="adm-badge adm-badge--orange">战斗中</span>'
        : '<span class="adm-badge adm-badge--green">备战房</span>';

      const phase = r.match?.phase ? `第 ${r.match.round || 1} 回合 · ${r.match.phase}` : '—';
      const seatItems = (r.seats || [])
        .map((s) => {
          if (s.isBot) return `<span class="adm-player-tag is-bot">🤖 ${s.name || 'AI'}</span>`;
          const isFull = s.client?.bundle === 'full';
          const isPreload = s.client?.bundle === 'preloaded';
          const badge = isFull
            ? '<span class="adm-client-badge is-android" title="手机端全量包">📱 全量</span>'
            : isPreload
            ? '<span class="adm-client-badge is-preloaded" title="网页端已预载">⚡ 预载</span>'
            : '<span class="adm-client-badge is-stream" title="网页端在线流式">🌐 流式</span>';
          return `<span class="adm-player-tag">${s.name || '博士'} ${badge}</span>`;
        })
        .join(' ');

      const players = r.match?.alivePlayers?.length
        ? (r.match.alivePlayers || [])
            .map((p) => {
              const botPrefix = p.isBot ? '<span class="adm-player-tag is-bot">🤖</span> ' : '';
              return `<span style="color:${p.alive ? '#17f9b7' : '#ef4444'}">${botPrefix}${p.name || '博士'}(${p.lp ?? '—'}LP)</span>`;
            })
            .join(', ')
        : (seatItems || '—');

      return `<tr>
        <td><strong style="color:var(--mint); font-family:var(--font-mono);">${r.code}</strong></td>
        <td>${modeLabel} / ${diffLabel}</td>
        <td>${humanCount} 人 ${botCount ? `(${botCount} 助手)` : ''}</td>
        <td>${statusLabel}</td>
        <td>${phase}</td>
        <td>${players}</td>
      </tr>`;
    })
    .join('');
}

function renderLogs() {
  const container = $('#log-console');
  const filtered = allLogs.filter((l) => {
    if (currentFilter === 'all') return true;
    return l.level === currentFilter;
  });

  const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 40;

  container.innerHTML = filtered
    .map((l) => {
      const timeStr = new Date(l.at).toLocaleTimeString();
      return `<div class="adm-log-line">
        <span class="adm-log-time">[${timeStr}]</span>
        <span class="adm-log-lvl ${l.level}">${l.level.toUpperCase()}</span>
        <span class="adm-log-msg">${escapeHtml(l.message)}</span>
      </div>`;
    })
    .join('');

  if (isAtBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
