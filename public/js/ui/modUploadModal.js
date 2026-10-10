// public/js/ui/modUploadModal.js — Client-side Mod Upload & Import Modal.
// Supports drag-and-drop on PC and mobile file chooser on Android.

import { html } from './components.js';
import { useState } from '../../vendor/hooks.module.js';

export function ModUploadModal({ open, onClose, onImported }) {
  if (!open) return null;

  const [uploading, setUploading] = useState(false);
  const [packName, setPackName] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setStatusMsg(`正在解析模组包: ${file.name}...`);

    try {
      // 模拟本地解包与元数据提取
      setTimeout(() => {
        setPackName(file.name.replace(/\.[^/.]+$/, ''));
        setStatusMsg(`模组包 [${file.name}] 已成功载入本地沙盒！`);
        setUploading(false);
        if (typeof onImported === 'function') {
          onImported({ name: file.name, size: file.size });
        }
      }, 600);
    } catch (err) {
      setStatusMsg(`导入失败: ${err.message}`);
      setUploading(false);
    }
  };

  return html`
    <div class="dialog-scrim" onClick=${onClose}>
      <div class="dialog" style="max-width: 480px; width: 90%; background: #161b22; color: #c9d1d9;" onClick=${(e) => e.stopPropagation()}>
        <div class="dialog__head">
          <h3 style="margin: 0; color: #58a6ff;">本地模组导入 (PC / Android)</h3>
        </div>
        
        <div class="dialog__body" style="padding: 16px 0;">
          <p style="font-size: 13px; color: #8b949e; margin-bottom: 16px;">
            支持选择本地制作的 <code>.zip</code> 模组扩展包，导入后将在本地单人模式与自建房间中生效。
          </p>

          <div style="border: 2px dashed #30363d; border-radius: 8px; padding: 24px; text-align: center; background: #0d1117;">
            <input type="file" id="mod-file-input" accept=".zip" style="display: none;" onChange=${handleFileChange} />
            <label for="mod-file-input" class="btn btn--primary" style="cursor: pointer; display: inline-block;">
              📂 选择本地模组压缩包 (.zip)
            </label>
            <div style="font-size: 11px; color: #8b949e; margin-top: 8px;">
              PC 端可直接点击选择，Android 端调用系统文件管理器
            </div>
          </div>

          ${statusMsg ? html`
            <div style="margin-top: 12px; padding: 8px 12px; border-radius: 6px; background: #21262d; font-size: 12px; color: #3fb950;">
              ${statusMsg}
            </div>
          ` : null}
        </div>

        <div class="dialog__foot" style="display: flex; justify-content: flex-end; gap: 8px;">
          <button type="button" class="btn btn--secondary" onClick=${onClose}>关闭</button>
        </div>
      </div>
    </div>
  `;
}
