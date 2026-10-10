import { html, Modal, Button, Icon, MicroLabel } from './components.js';
import { useState, useEffect } from '../../vendor/hooks.module.js';
import { parseModZip } from './modZipParser.js';
import { modStorage } from './modStorage.js';

const STORAGE_KEY = 'sp.installed_mods';

function loadStoredMods() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredMods(mods) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(mods));
  } catch {}
}

export function ModUploadModal({ open, onClose, onImported }) {
  if (!open) return null;

  const [parsing, setParsing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [statusTone, setStatusTone] = useState('mint');
  const [mods, setMods] = useState(() => loadStoredMods());
  const [expandedReadme, setExpandedReadme] = useState(null);

  // Fetch server status and local IndexedDB mods on mount
  useEffect(() => {
    // 1. First load from IndexedDB (v2: meta records; display-only until the pack has a blob)
    modStorage.listMeta().then((localMods) => {
      if (localMods && localMods.length > 0) {
        setMods((prev) => {
          const map = new Map(prev.map(m => [m.id, m]));
          for (const lm of localMods) {
            map.set(lm.id, { ...lm, active: lm.enabled !== false, source: 'local-db' });
          }
          const list = Array.from(map.values());
          saveStoredMods(list);
          return list;
        });
      }
    }).catch(() => {});

    // 2. Then probe server packs
    fetch('/api/packs')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.installedPacks?.length) {
          setMods((prev) => {
            const list = [...prev];
            for (const sp of data.installedPacks) {
              const existing = list.find((m) => m.id === sp.id);
              if (existing) {
                existing.active = sp.active ?? existing.active;
                if (sp.description && !existing.summary) existing.summary = sp.description;
              } else {
                list.push({
                  id: sp.id,
                  name: sp.name,
                  version: sp.version,
                  summary: sp.description || sp.summary || '服务端预装内容包',
                  credits: sp.credits || '',
                  features: sp.features || ['卡兹戴尔 / 罗德岛核心盟约与装备扩展'],
                  active: sp.active ?? true,
                  source: 'server',
                  fileCount: sp.fileCount || 91,
                });
              }
            }
            saveStoredMods(list);
            return list;
          });
        }
      })
      .catch(() => {
        // Offline / client-only mode
      });
  }, []);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsing(true);
    setStatusTone('mint');
    setStatusMsg(`正在解析模组包: ${file.name}...`);

    try {
      const parsed = await parseModZip(file);
      const newMod = {
        id: parsed.id,
        name: parsed.name,
        version: parsed.version,
        app: parsed.app,
        credits: parsed.credits,
        summary: parsed.summary,
        readme: parsed.readme,
        features: parsed.features,
        fileCount: parsed.fileCount,
        totalBytes: parsed.totalBytes,
        fileName: file.name,
        active: true,
        source: 'local',
        importedAt: Date.now(),
      };

      // Persist metadata to IndexedDB (v2: meta only; the zip itself is catalog-driven)
      await modStorage.putMeta({
        id: newMod.id,
        name: newMod.name,
        version: newMod.version,
        sha256: '', // local imports carry no catalog sha; D1 treats them as always-stale display entries
        bytes: newMod.totalBytes || 0,
        features: newMod.features || [],
        fetchedAt: Date.now(),
      }).catch(() => {});

      setMods((prev) => {
        const next = [newMod, ...prev.filter((m) => m.id !== newMod.id)];
        saveStoredMods(next);
        return next;
      });

      setStatusTone('mint');
      setStatusMsg(`✔ 成功读取模组 [${newMod.name} v${newMod.version}]！已持久化至本地沙盒。`);
      setParsing(false);

      if (typeof onImported === 'function') {
        onImported(newMod);
      }
    } catch (err) {
      setStatusTone('danger');
      setStatusMsg(`✘ 解析模组包失败: ${err.message || '未知错误'}`);
      setParsing(false);
    }
  };

  const toggleModActive = (id) => {
    setMods((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, active: !m.active } : m));
      saveStoredMods(next);
      return next;
    });
  };

  const removeMod = (id) => {
    modStorage.removePack(id).catch(() => {});
    setMods((prev) => {
      const next = prev.filter((m) => m.id !== id);
      saveStoredMods(next);
      return next;
    });
  };

  const actions = html`
    <${Button} variant="secondary" size="md" onClick=${onClose}>关闭<//>
  `;

  return html`
    <${Modal}
      open=${open}
      onClose=${onClose}
      title="本地模组管理"
      micro="MOD PACKAGE MANAGER"
      tone="mint"
      width="min(7.2rem, 94vw)"
      actions=${actions}>
      <div class="mod-upload-modal" style="display: flex; flex-direction: column; gap: .16rem;">
        <div style="border: 2px dashed var(--line-2); background: rgba(14, 18, 16, 0.7); border-radius: 4px; padding: .18rem .16rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: .08rem;">
          <input type="file" id="mod-file-input" accept=".zip" style="display: none;" onChange=${handleFileChange} />
          <label for="mod-file-input" class="btn btn--primary btn--md" style="cursor: pointer; display: inline-flex; align-items: center; gap: .08rem;">
            <${Icon} name="folder" />
            <span>${parsing ? '正在解析...' : '选择本地模组包 (.zip)'}</span>
          </label>
          <div style="font-size: max(.12rem, 10px); color: var(--text-dim);">
            PC 端点击直接浏览文件，Android 端调用系统存储选择器 · 自动读取清单与简介
          </div>
        </div>

        ${statusMsg ? html`
          <div style="padding: .08rem .12rem; background: ${statusTone === 'danger' ? 'rgba(235, 75, 75, 0.12)' : 'rgba(23, 249, 183, 0.08)'}; border: 1px solid ${statusTone === 'danger' ? 'var(--red-premium, #eb4b4b)' : 'var(--mint-700, #17f9b7)'}; border-radius: 3px; font-size: max(.13rem, 11px); color: ${statusTone === 'danger' ? '#ff7e7e' : 'var(--mint-400, #4ed8af)'}; display: flex; align-items: center; gap: .08rem;">
            <${Icon} name="info" />
            <span>${statusMsg}</span>
          </div>
        ` : null}

        <div class="mod-list-section" style="display: flex; flex-direction: column; gap: .12rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--line-2); padding-bottom: .06rem;">
            <span style="font-size: max(.14rem, 12px); font-weight: 700; color: #f4f6f5; display: flex; align-items: center; gap: .06rem;">
              <${Icon} name="grid" />
              <span>已加载模组 (${mods.length})</span>
            </span>
            <span style="font-size: max(.12rem, 10px); color: var(--text-dim);">离线单机与自定义房间即刻生效</span>
          </div>

          ${mods.length === 0 ? html`
            <div style="text-align: center; padding: .24rem; color: var(--text-dim); font-size: max(.13rem, 11px); background: rgba(0,0,0,0.2); border-radius: 4px;">
              暂未导入任何模组扩展包。请点击上方按钮导入 .zip 文件。
            </div>
          ` : html`
            <div style="display: flex; flex-direction: column; gap: .12rem; max-height: 52vh; overflow-y: auto; padding-right: 4px;">
              ${mods.map((mod) => html`
                <div key=${mod.id} style="background: rgba(18, 24, 21, 0.85); border: 1px solid ${mod.active ? 'rgba(23, 249, 183, 0.35)' : 'var(--line-2)'}; border-radius: 4px; padding: .14rem .16rem; display: flex; flex-direction: column; gap: .1rem;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: .1rem;">
                    <div>
                      <div style="display: flex; align-items: center; gap: .08rem; flex-wrap: wrap;">
                        <span style="font-size: max(.16rem, 13px); font-weight: 700; color: #fff;">${mod.name}</span>
                        <span style="font-family: var(--font-mono); font-size: max(.11rem, 9px); padding: .02rem .06rem; background: rgba(23, 249, 183, 0.15); color: var(--mint-400); border-radius: 2px;">v${mod.version}</span>
                        <span style="font-family: var(--font-mono); font-size: max(.11rem, 9px); padding: .02rem .06rem; background: rgba(255, 255, 255, 0.08); color: var(--text-dim); border-radius: 2px;">${mod.id}</span>
                        ${mod.active ? html`
                          <span style="font-size: max(.11rem, 9px); padding: .02rem .06rem; background: rgba(78, 216, 175, 0.2); color: #4ed8af; border: 1px solid #4ed8af; border-radius: 2px;">● 已生效</span>
                        ` : html`
                          <span style="font-size: max(.11rem, 9px); padding: .02rem .06rem; background: rgba(150, 150, 150, 0.15); color: var(--text-lo); border-radius: 2px;">○ 已停用</span>
                        `}
                      </div>
                      ${mod.credits ? html`
                        <div style="font-size: max(.12rem, 10px); color: var(--text-dim); margin-top: .04rem;">
                          ${mod.credits}
                        </div>
                      ` : null}
                    </div>

                    <div style="display: flex; gap: .06rem;">
                      <${Button}
                        variant=${mod.active ? 'primary' : 'secondary'}
                        size="sm"
                        onClick=${() => toggleModActive(mod.id)}>
                        ${mod.active ? '生效中' : '点击启用'}
                      <//>
                      <${Button}
                        variant="ghost"
                        size="sm"
                        onClick=${() => removeMod(mod.id)}
                        title="从本地列表中移除">
                        移除
                      <//>
                    </div>
                  </div>

                  <!-- 模组详细简介 -->
                  <div style="background: rgba(10, 14, 12, 0.7); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 3px; padding: .1rem .12rem; font-size: max(.13rem, 11px); color: var(--text-md); line-height: 1.6;">
                    <div style="color: #e2e8e5; margin-bottom: .04rem;">${mod.summary}</div>
                    ${mod.features && mod.features.length ? html`
                      <div style="display: flex; flex-direction: column; gap: .03rem; margin-top: .06rem; padding-top: .06rem; border-top: 1px dashed rgba(255, 255, 255, 0.08);">
                        <span style="font-size: max(.12rem, 10px); color: var(--mint-400); font-weight: 700;">核心特性：</span>
                        ${mod.features.slice(0, 5).map((f, i) => html`
                          <div key=${i} style="display: flex; align-items: center; gap: .06rem; color: #cfd8d3; font-size: max(.12rem, 10px);">
                            <span style="color: var(--mint-500);">◆</span>
                            <span>${f}</span>
                          </div>
                        `)}
                      </div>
                    ` : null}
                  </div>

                  <!-- 底部统计与展开详细文档 -->
                  <div style="display: flex; justify-content: space-between; align-items: center; font-size: max(.115rem, 9px); color: var(--text-dim);">
                    <span>共包含 ${mod.fileCount} 个资源文件</span>
                    ${mod.readme ? html`
                      <button
                        type="button"
                        class="btn-text"
                        style="color: var(--mint-400); background: transparent; border: none; cursor: pointer; text-decoration: underline; font-size: max(.12rem, 10px);"
                        onClick=${() => setExpandedReadme(expandedReadme === mod.id ? null : mod.id)}>
                        ${expandedReadme === mod.id ? '收起完整说明' : '查看完整说明文档 (README)'}
                      </button>
                    ` : null}
                  </div>

                  ${expandedReadme === mod.id && mod.readme ? html`
                    <pre style="white-space: pre-wrap; word-break: break-all; background: #0c100e; border: 1px solid var(--line-2); border-radius: 3px; padding: .1rem .12rem; font-family: var(--font-mono); font-size: max(.115rem, 10px); color: #abbbb3; max-height: 200px; overflow-y: auto; margin: 0;">
                      ${mod.readme}
                    </pre>
                  ` : null}
                </div>
              `)}
            </div>
          `}
        </div>
      </div>
    <//>
  `;
}
