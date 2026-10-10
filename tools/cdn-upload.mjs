#!/usr/bin/env node
// tools/cdn-upload.mjs — Static CDN Asset Uploader & Deduplication Tool.
// Integrates with https://downcdn.jiangjiangze.icu using x-admin-key: mod325.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CDN_ADMIN_BASE = 'https://downcdn.jiangjiangze.icu';
const CDN_PUBLIC_BASE = 'https://weishucdn.jiangjiangze.icu';
const ADMIN_KEY = process.env.CDN_ADMIN_KEY || 'mod325';

function sha256Of(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function api(endpoint, opts = {}) {
  const url = `${CDN_ADMIN_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'x-admin-key': ADMIN_KEY,
      ...(opts.headers || {})
    }
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function fetchRemoteIndex() {
  try {
    const res = await fetch(`${CDN_PUBLIC_BASE}/cdn/v1/hosted-index.json`);
    if (res.ok) {
      const doc = await res.json();
      return doc.files || {};
    }
  } catch {}
  return {};
}

async function getStatus() {
  console.log(`[CDN] 查询后台状态 (${CDN_ADMIN_BASE})...`);
  const { ok, status, data } = await api('/api/cdn/upload/status');
  if (!ok) {
    console.error(`[CDN] 获取状态失败: HTTP ${status}`, data);
    return;
  }
  console.log(`[CDN] 状态正常: 暂存中 ${data.staging?.length || 0} 项, 待发布 ${data.pending || 0} 项`);
  if (data.staging?.length) {
    console.log(`--- 最近暂存项 ---`);
    data.staging.slice(0, 5).forEach(s => {
      console.log(`  - ${s.stagingKey} (${(s.stagedSize / 1024).toFixed(1)} KB)`);
    });
  }
}

async function kickPublish() {
  console.log(`[CDN] 催促发布轮...`);
  const { ok, status, data } = await api('/api/cdn/upload/kick', { method: 'POST' });
  if (ok || status === 202) {
    console.log(`[CDN] ✔ 成功叫起发布轮！预计 1~2 分钟内上线至 ${CDN_PUBLIC_BASE}`);
  } else {
    console.error(`[CDN] 催促失败: HTTP ${status}`, data);
  }
}

async function uploadSingleFile(filePath, targetKey, source, what, remoteIndex = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  const buf = fs.readFileSync(filePath);
  const sha256 = sha256Of(buf);

  // 1. 本地查重与远程对比
  if (remoteIndex[targetKey] && remoteIndex[targetKey].sha256 === sha256) {
    console.log(`[CDN 查重命中] ${targetKey} (SHA-256 相同，跳过上传)`);
    return { skipped: true, targetKey, sha256 };
  }

  // 2. 构造查询参数上传至暂存区
  console.log(`[CDN 上传中] ${path.basename(filePath)} -> ${targetKey} (${(stat.size / 1024).toFixed(1)} KB)...`);
  const qs = new URLSearchParams({
    key: targetKey,
    sha256,
    size: String(stat.size),
    source: source || 'mod-asset',
    what: what || 'MOD 第三方素材同步'
  });

  const res = await fetch(`${CDN_ADMIN_BASE}/api/cdn/upload/put?${qs}`, {
    method: 'PUT',
    headers: {
      'x-admin-key': ADMIN_KEY,
      'content-type': 'application/octet-stream'
    },
    body: buf
  });

  const doc = await res.json().catch(() => null);
  if (res.ok && doc?.ok) {
    console.log(`[CDN 已暂存] ✔ ${targetKey} [ID: ${doc.id}]`);
    return { success: true, targetKey, sha256 };
  } else {
    throw new Error(`上传被拒: ${doc?.error || `HTTP ${res.status}`}`);
  }
}

async function uploadDirectory(dirPath, targetPrefix, source, what) {
  console.log(`[CDN] 开始扫描目录: ${dirPath} -> ${targetPrefix}`);
  const remoteIndex = await fetchRemoteIndex();
  console.log(`[CDN] 已载入远程索引 (${Object.keys(remoteIndex).length} 个文件用于自动查重)`);

  function walk(currentDir) {
    let files = [];
    for (const ent of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const full = path.join(currentDir, ent.name);
      if (ent.isDirectory()) files = files.concat(walk(full));
      else if (ent.isFile()) files.push(full);
    }
    return files;
  }

  const allFiles = walk(dirPath);
  console.log(`[CDN] 共发现 ${allFiles.length} 个待处理文件。`);

  let uploaded = 0;
  let skipped = 0;

  for (const file of allFiles) {
    const rel = path.relative(dirPath, file).replace(/\\/g, '/');
    const targetKey = `${targetPrefix.replace(/\/+$/, '')}/${rel}`;
    try {
      const res = await uploadSingleFile(file, targetKey, source, what, remoteIndex);
      if (res.skipped) skipped++;
      else uploaded++;
    } catch (err) {
      console.error(`[CDN 失败] ${rel}: ${err.message}`);
    }
  }

  console.log(`\n========================================`);
  console.log(`[CDN 完成] 上传新增: ${uploaded} 个 | 自动查重跳过: ${skipped} 个`);
  console.log(`========================================`);

  if (uploaded > 0) {
    await kickPublish();
  }
}

// ---- CLI Dispatcher ----
async function main() {
  const args = process.argv.slice(2);
  const getArg = (prefix) => {
    const found = args.find(a => a.startsWith(prefix));
    return found ? found.slice(prefix.length) : null;
  };

  if (args.includes('--status')) {
    await getStatus();
    return;
  }

  if (args.includes('--kick')) {
    await kickPublish();
    return;
  }

  const file = getArg('--file=');
  const dir = getArg('--dir=');
  const to = getArg('--to=');
  const source = getArg('--source=') || 'sp-mod';
  const what = getArg('--what=') || '第三方 MOD 静态素材';

  if (file && to) {
    const remoteIndex = await fetchRemoteIndex();
    await uploadSingleFile(file, to, source, what, remoteIndex);
    if (args.includes('--kick')) await kickPublish();
    return;
  }

  if (dir && to) {
    await uploadDirectory(dir, to, source, what);
    return;
  }

  console.log(`
使用方式:
  node tools/cdn-upload.mjs --status
  node tools/cdn-upload.mjs --kick
  node tools/cdn-upload.mjs --file=<本地文件> --to=<目标键> --source=<mod标识> [--kick]
  node tools/cdn-upload.mjs --dir=<本地目录> --to=<目标前缀> --source=<mod标识>

示例:
  node tools/cdn-upload.mjs --dir=./assets/item --to=assets/item/ --source=kazdel-pack
  node tools/cdn-upload.mjs --file=./avatar.png --to=assets/char/avatar/ws_alice.png --source=alice-mod --kick
  `);
}

main().catch(err => {
  console.error('[CDN 异常]', err);
  process.exit(1);
});
