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
  wireModPipeline();
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
  // MOD pipeline polls separately: it is heavier (staging scan + catalog read) and the
  // section is optional, so a failure there must not break the rest of the dashboard.
  try {
    await refreshModPipeline();
  } catch (err) {
    console.warn('[admin] mod pipeline poll error', err);
  }
}

// ---- MOD pipeline (upload → verify → publish) --------------------------------------

let modBusy = false;

function modStatus(msg, isError = false) {
  const el = $('#mod-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--red-premium, #eb4b4b)' : '';
}

async function refreshModPipeline() {
  if (!$('#mod-staged-body')) return;
  const [staged, catalog] = await Promise.all([
    apiGet('/api/admin/mods/staged'),
    apiGet('/api/admin/mods/catalog'),
  ]);
  renderModStaged(staged.staged || []);
  renderModCatalog(catalog.catalog?.packs || []);
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderModStaged(rows) {
  const tbody = $('#mod-staged-body');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="adm-td-empty">暂无已上传的 mod 包</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r) => {
    const id = r.uploadId;
    const published = r.status === 'published';
    const actions = published
      ? '<span class="adm-card__sub">已发布</span>'
      : `<button class="adm-pill" data-mod-verify="${id}">验证</button> ` +
        `<button class="adm-pill" data-mod-publish="${id}" title="验证只有 skip 项时需显式放行">发布</button>`;
    return `<tr>
      <td class="adm-td-mono">${id}</td>
      <td class="adm-td-mono">${String(r.sha256 || '').slice(0, 12)}</td>
      <td>${fmtBytes(r.bytes)}</td>
      <td>${r.status || 'staged'}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
}

function renderModCatalog(packs) {
  const tbody = $('#mod-catalog-body');
  if (!tbody) return;
  if (!packs.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="adm-td-empty">catalog 为空（尚无已发布的 mod）</td></tr>';
    return;
  }
  tbody.innerHTML = packs.map((p) => `<tr>
    <td class="adm-td-mono">${p.id}</td>
    <td>${p.name || ''}</td>
    <td>${p.version || ''}</td>
    <td class="adm-td-mono">${String(p.sha256 || '').slice(0, 12)}</td>
    <td>${fmtBytes(p.bytes)}</td>
  </tr>`).join('');
}

async function uploadModZip(file) {
  modStatus(`上传中：${file.name}（${fmtBytes(file.size)}）…`);
  const res = await fetch('/api/admin/mods/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/zip' },
    body: file, // raw body — the zip IS the request body (no FormData; §0.3 contract)
  });
  if (res.status === 401) { showLogin(true); throw new Error('Unauthorized'); }
  const doc = await res.json().catch(() => null);
  if (!res.ok || !doc?.ok) throw new Error(doc?.error || `HTTP ${res.status}`);
  modStatus(`已上传 ${doc.uploadId}（sha256 ${String(doc.sha256).slice(0, 12)}）。接下来点「验证」。`);
  return doc;
}

async function runModAction(uploadId, action, extra = {}) {
  modStatus(`${action === 'verify' ? '验证' : '发布'}中：${uploadId}（五道验证可能要一两分钟）…`);
  const doc = await apiPost(`/api/admin/mods/${uploadId}/${action}`, extra);
  if (!doc?.ok) throw new Error(doc?.error || '操作失败');
  if (action === 'verify') {
    const gates = (doc.report?.gates || []).map((g) => `g${g.gate}:${g.status}`).join(' ');
    modStatus(`验证完成 overall=${doc.report?.overall}（${gates}）`);
  } else {
    modStatus(`已发布 ${doc.catalogEntry?.id}@${doc.catalogEntry?.version} → ${doc.catalogEntry?.url}`);
  }
  return doc;
}

function wireModPipeline() {
  const fileInput = $('#mod-file');
  if (!fileInput) return;
  $('#btn-mod-upload').addEventListener('click', () => fileInput.click());
  $('#btn-mod-refresh').addEventListener('click', () => refreshModPipeline().catch((e) => modStatus(e.message, true)));
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file || modBusy) return;
    modBusy = true;
    try {
      await uploadModZip(file);
      await refreshModPipeline();
    } catch (err) {
      modStatus(err.message, true);
    } finally {
      modBusy = false;
      fileInput.value = '';
    }
  });
  $('#mod-staged-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-mod-verify], button[data-mod-publish]');
    if (!btn || modBusy) return;
    modBusy = true;
    try {
      if (btn.dataset.modVerify) await runModAction(btn.dataset.modVerify, 'verify');
      else await runModAction(btn.dataset.modPublish, 'publish', { allowPending: true });
      await refreshModPipeline();
    } catch (err) {
      modStatus(err.message, true);
    } finally {
      modBusy = false;
    }
  });
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
    const androidF = clients.androidFull || 0;
    const webF = clients.webFull || 0;
    const webC = clients.webCore || clients.webPreloaded || 0;
    const webS = clients.webStream || 0;
    statClientsEl.innerHTML = `📱 手机全量: <b>${androidF}</b> | 🌟 全预载: <b>${webF}</b> | ⚡ 基础预载: <b>${webC}</b> | 🌐 流式: <b>${webS}</b>`;
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
          const bundle = s.client?.bundle;
          let badge = '<span class="adm-client-badge is-stream" title="网页端在线流式">🌐 流式</span>';
          if (bundle === 'full' || bundle === 'android_full') {
            badge = '<span class="adm-client-badge is-android" title="手机端全量包">📱 全量</span>';
          } else if (bundle === 'web_full') {
            badge = '<span class="adm-client-badge is-web-full" title="网页端全量预载 (~280MB)">🌟 全预载</span>';
          } else if (bundle === 'web_core' || bundle === 'core' || bundle === 'preloaded') {
            badge = '<span class="adm-client-badge is-preloaded" title="网页端基础包预载 (~35MB)">⚡ 基础预载</span>';
          }
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
