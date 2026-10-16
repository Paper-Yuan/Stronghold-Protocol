// public/js/ui/modManagerModal.js — In-game Mod Management Dialog (Settings Level 2)
import { useState, useEffect } from '../../vendor/hooks.module.js';
import { isSoloRoomMode } from '../../shared/infiniteMode.js';
import { html, Modal, Button, Icon, MicroLabel } from './components.js';
import { GIcon } from './gameComponents.js';
import { t } from '../../../shared/i18n.js';
import { toast } from './toasts.js';
// import { VirtualModList } from './VirtualModList.js'; // 临时禁用虚拟滚动

import { setSelectedModIds, registerPackOperators, unregisterPackOperators } from '../roomMods.js';
import { net } from '../net.js';
import { store } from '../store.js';

const STORAGE_KEY = 'sp.pref.enabledMods';
const REMOTE_SERVER_KEY = 'sp.pref.remoteModServer';

// 默认远程服务器地址（你的生产服务器）
const DEFAULT_REMOTE_SERVER = 'http://101.37.150.107:3000';

export function getRemoteModServer() {
  try {
    return localStorage.getItem(REMOTE_SERVER_KEY) || DEFAULT_REMOTE_SERVER;
  } catch {
    return DEFAULT_REMOTE_SERVER;
  }
}

export function setRemoteModServer(url) {
  try {
    localStorage.setItem(REMOTE_SERVER_KEY, url);
  } catch {}
}

export function getLocalEnabledMods() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setLocalEnabledMods(modIds) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(modIds));
  } catch {}
}

export function ModManagerModal({ open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [mods, setMods] = useState([]);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [enabledMap, setEnabledMap] = useState({});
  const [showRemoteConfig, setShowRemoteConfig] = useState(false);
  const [remoteServer, setRemoteServer] = useState(getRemoteModServer());
  const [syncing, setSyncing] = useState(new Set()); // 正在同步的模组 ID

  const fetchMods = async (source = 'both') => {
    setLoading(true);
    setError(null);
    try {
      const isSolo = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      
      // 获取本地模组列表
      const localMods = [];
      if (source === 'local' || source === 'both') {
        try {
          const localRes = await fetch('/api/mods', { cache: 'no-cache', signal: AbortSignal.timeout(5000) });
          if (localRes.ok) {
            const localData = await localRes.json();
            localMods.push(...(Array.isArray(localData.packs) ? localData.packs : []).map(m => ({ ...m, source: 'local' })));
          }
        } catch (err) {
          console.warn('[modManager] Failed to fetch local mods:', err);
        }
      }
      
      // 获取远程服务器模组列表（仅在单机模式下）
      const remoteMods = [];
      if (isSolo && (source === 'remote' || source === 'both')) {
        try {
          const remoteUrl = remoteServer || DEFAULT_REMOTE_SERVER;
          const remoteRes = await fetch(`${remoteUrl}/api/mods`, { 
            cache: 'no-cache', 
            signal: AbortSignal.timeout(8000),
            mode: 'cors'
          });
          if (remoteRes.ok) {
            const remoteData = await remoteRes.json();
            remoteMods.push(...(Array.isArray(remoteData.packs) ? remoteData.packs : []).map(m => ({ ...m, source: 'remote' })));
          }
        } catch (err) {
          console.warn('[modManager] Failed to fetch remote mods:', err);
          if (source === 'remote') {
            throw new Error(t('无法连接到远程服务器'));
          }
        }
      }
      
      // 合并本地和远程模组列表，去重（本地优先）
      const localIds = new Set(localMods.map(m => m.id));
      const allMods = [...localMods];
      for (const mod of remoteMods) {
        if (!localIds.has(mod.id)) {
          allMods.push(mod);
        }
      }
      
      setMods(allMods);

      const saved = getLocalEnabledMods();
      const initMap = {};
      allMods.forEach((m) => {
        // 只有**非空**的已启用列表才算数：空数组以前会被当成「全部禁用」，于是刚启用也什么都不显示。
        if (saved && Array.isArray(saved) && saved.length) {
          initMap[m.id] = saved.includes(m.id);
        } else {
          initMap[m.id] = m.enabled !== false;
        }
        // 只有**启用**的包才把算子登记进池子：以前这里对列表里每个包都注册，于是禁用的模组也照样出现在
        // 干员池 / 编队 / 图鉴里（owner：取消启动后不该显示）。
        if (initMap[m.id]) {
          if (Array.isArray(m.operators)) registerPackOperators(m.id, m.operators);
        } else {
          unregisterPackOperators(m.id);
        }
      });
      setEnabledMap(initMap);
    } catch (err) {
      console.warn('[modManager] Fetch remote mods failed:', err);
      setError(err.message || '获取模组列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchMods();
    }
  }, [open]);

  const toggleMod = (id) => {
    const next = !enabledMap[id];
    const newMap = { ...enabledMap, [id]: next };
    setEnabledMap(newMap);
    const enabledIds = Object.keys(newMap).filter((k) => newMap[k]);
    setLocalEnabledMods(enabledIds);
    setSelectedModIds(enabledIds);
    // 启用/禁用立刻反映到干员池：禁用的包注销掉算子，启用的补登记。
    const rec = mods.find((m) => m.id === id);
    if (next) { if (rec && Array.isArray(rec.operators)) registerPackOperators(id, rec.operators); }
    else unregisterPackOperators(id);

    // 即时向当前所在房间同步（房主/单机房主）
    try {
      const st = store.get();
      const room = st.room;
      const myId = st.me?.playerId;
      // 规则（owner 2026-10-16）：单人房与多人房都能声明房间模组，**超限模拟不能被声明**（它会把这些内容当无效请求拒掉）。
      if (room && (!room.hostId || room.hostId === myId) && !isSoloRoomMode(room.mode)) {
        net.request('room.setMods', { modIds: enabledIds }).catch((e) => {
          console.warn('[modManager] Failed to sync room.setMods:', e);
        });
      }
    } catch {}

    window.dispatchEvent(new CustomEvent('sp:mods-changed', { detail: { enabledIds } }));
    toast(next ? t('已启用模组：{name}', { name: id }) : t('已禁用模组：{name}', { name: id }));
  };

  // 从远程服务器同步模组到本地（Android 单机端场景）
  const syncModFromRemote = async (modId) => {
    if (syncing.has(modId)) return;
    
    setSyncing(new Set([...syncing, modId]));
    try {
      toast(t('正在从远程服务器同步模组 {name}...', { name: modId }));
      
      const res = await fetch('/api/mods/sync-from-remote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          modId, 
          remoteServer: remoteServer || DEFAULT_REMOTE_SERVER 
        }),
        signal: AbortSignal.timeout(120000), // 2分钟超时
      });
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      if (!data.ok) throw new Error(data.error || '同步失败');
      
      toast(t('模组 {name} 同步成功！', { name: modId }));
      
      // 刷新模组列表
      await fetchMods('local');
    } catch (err) {
      console.error('[modManager] Sync failed:', err);
      toast(t('同步失败: {err}', { err: err.message }));
    } finally {
      setSyncing(prev => {
        const next = new Set(prev);
        next.delete(modId);
        return next;
      });
    }
  };

  const filtered = mods.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.id && m.id.toLowerCase().includes(q)) ||
      (m.author && m.author.toLowerCase().includes(q)) ||
      (m.description && m.description.toLowerCase().includes(q))
    );
  });

  const enabledCount = Object.values(enabledMap).filter(Boolean).length;

  return html`<${Modal}
    open=${open}
    onClose=${onClose}
    title=${t('模组管理')}
    micro="MODS MANAGEMENT"
    width="min(8.2rem, 92vw)"
    class="mod-mgr-modal"
    actions=${html`
      <div class="mod-mgr__actions">
        ${location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? html`
          <${Button} 
            variant="ghost" 
            icon="cloud" 
            onClick=${() => setShowRemoteConfig(!showRemoteConfig)}
          >
            ${t('远程服务器')}
          <//>
        ` : null}
        <${Button} variant="secondary" icon="arrow-clockwise" onClick=${() => fetchMods('both')} disabled=${loading}>
          ${t('刷新模组清单')}
        <//>
        <${Button} variant="primary" icon="check" onClick=${onClose}>
          ${t('完成')}
        <//>
      </div>
    `}
  >
    <div class="mod-mgr">
      <!-- 远程服务器配置面板 -->
      ${showRemoteConfig ? html`
        <div class="mod-mgr__remote-panel">
          <div class="mod-mgr__remote-row">
            <label class="mod-mgr__remote-label">${t('远程服务器地址')}:</label>
            <input
              type="text"
              class="mod-mgr__remote-input"
              value=${remoteServer || DEFAULT_REMOTE_SERVER}
              placeholder=${DEFAULT_REMOTE_SERVER}
              onInput=${(e) => setRemoteServer(e.target.value)}
            />
            <${Button} 
              variant="ghost" 
              size="sm" 
              onClick=${() => {
                setRemoteModServer(remoteServer || DEFAULT_REMOTE_SERVER);
                toast(t('远程服务器配置已保存'));
                fetchMods('both');
              }}
            >
              ${t('保存并刷新')}
            <//>
          </div>
          <div class="mod-mgr__remote-hint">
            ${t('提示：配置你的生产服务器地址，即可从远程同步模组到本地')}
          </div>
        </div>
      ` : null}

      <!-- 顶部统计与搜索栏 -->
      <div class="mod-mgr__header">
        <div class="mod-mgr__stats">
          <span class="mod-mgr__stat-item">
            ${t('共计')} <strong class="num">${mods.length}</strong> ${t('个模组')}
          </span>
          <span class="mod-mgr__divider">/</span>
          <span class="mod-mgr__stat-item">
            ${t('已启用')} <strong class="num" style="color: #23e2b2">${enabledCount}</strong> ${t('个')}
          </span>
        </div>
        <div class="mod-mgr__search">
          <input
            type="text"
            class="mod-mgr__input"
            placeholder=${t('搜索模组名称、ID、作者或描述…')}
            value=${search}
            onInput=${(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <!-- 列表内容区 -->
      <div class="mod-mgr__list">
        ${loading
          ? html`<div class="mod-mgr__status mod-mgr__status--loading">
              <span class="mod-mgr__spinner"></span>
              <span>${t('正在连接服务器获取最新模组清单…')}</span>
            </div>`
          : error
          ? html`<div class="mod-mgr__status mod-mgr__status--error">
              <${Icon} name="exclamation-circle" />
              <span>${t('获取失败: {err}', { err: error })}</span>
              <${Button} variant="ghost" size="sm" onClick=${fetchMods}>${t('重试')}<//>
            </div>`
          : filtered.length === 0
          ? html`<div class="mod-mgr__empty">
              <${GIcon} name="gear" class="mod-mgr__empty-icon" />
              <p class="mod-mgr__empty-title">${t('当前未装载任何模组')}</p>
              <p class="mod-mgr__empty-desc">
                ${t('管理员可登录 /admin/ 后台工坊上传 ZIP 模组包，上传后将在此处与建房列表中即时展现。')}
              </p>
            </div>`
          : filtered.map((m) => {
              const isEnabled = !!enabledMap[m.id];
              return html`
                <div class=${`mod-card${isEnabled ? ' is-enabled' : ''}${m.source === 'remote' ? ' is-remote' : ''}`} key=${m.id}>
                  <div class="mod-card__main">
                    <div class="mod-card__head">
                      <div class="mod-card__title-row">
                        <strong class="mod-card__name">${m.name || m.id}</strong>
                        <span class="mod-card__ver">v${m.version || '1.0.0'}</span>
                        ${m.combat ? html`<span class="mod-card__badge">${t('战斗机制')}</span>` : null}
                        ${m.source === 'remote' ? html`<span class="mod-card__badge mod-card__badge--remote">${t('远程')}</span>` : null}
                      </div>
                      <div class="mod-card__meta">
                        <span class="mod-card__author">${t('作者')}: ${m.author || '未知'}</span>
                        <span class="mod-card__id">${m.id}</span>
                      </div>
                    </div>

                    <!-- 模组详细描述 -->
                    <div class="mod-card__desc">
                      ${m.description || t('暂无描述内容')}
                    </div>
                  </div>

                  <!-- 操作栏：开关 + 同步按钮 -->
                  <div class="mod-card__actions">
                    <div class="mod-card__toggle-wrap">
                      <button
                        type="button"
                        class=${`set-toggle${isEnabled ? ' is-on' : ''}`}
                        role="switch"
                        aria-checked=${isEnabled ? 'true' : 'false'}
                        onClick=${() => toggleMod(m.id)}
                        disabled=${m.source === 'remote'}
                      >
                        <i></i>
                        <span>${isEnabled ? t('已启用') : t('已关闭')}</span>
                      </button>
                    </div>
                    ${m.source === 'remote' ? html`
                      <button
                        type="button"
                        class=${`mod-card__sync-btn${syncing.has(m.id) ? ' is-syncing' : ''}`}
                        onClick=${() => syncModFromRemote(m.id)}
                        disabled=${syncing.has(m.id)}
                        title=${t('从远程服务器同步到本地')}
                      >
                        <${Icon} name=${syncing.has(m.id) ? 'arrow-repeat' : 'cloud-download'} />
                        <span class="mod-card__sync-text">
                          ${syncing.has(m.id) ? t('同步中...') : t('同步到本地')}
                        </span>
                      </button>
                    ` : null}
                  </div>
                </div>
              `;
            })}
      </div>
    </div>
  <//>`;
}
