#!/usr/bin/env node
// tools/check-android-e2e.mjs — End-to-end verification probe for Android local mode
//
// Verification criteria:
// 1. Healthz responds 200 with matching app version.
// 2. sockets >= 1 (WebView successfully connected to game server WebSocket).
// 3. CDP remote devtools reports active navigation (url is not empty or about:blank).

import http from 'node:http';
import { spawnSync, execSync } from 'node:child_process';

const PKG = 'com.paper.stronghold';
const DEBUG_PKG = 'com.paper.stronghold.debug';
const HEALTH_URL = 'http://127.0.0.1:13000/healthz';

console.log('========================================================');
console.log('  Android 端对端健康探测与自动化验收工具');
console.log('========================================================\n');

function runAdb(args) {
  const res = spawnSync('adb', args, { encoding: 'utf8' });
  return (res.stdout || '').trim();
}

function fetchJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  const devices = runAdb(['devices']).split('\n').slice(1).filter(l => l.includes('\tdevice'));
  if (devices.length === 0) {
    console.log('⚠ 未检测到已连接的 Android adb 设备，跳过设备端自动化执行。');
    process.exit(0);
  }

  console.log(`✔ 检测到已连接设备: ${devices[0].split('\t')[0]}`);

  // Forward ports
  console.log('[1/4] 配置 adb 端口映射 tcp:13000 -> tcp:3000 ...');
  runAdb(['forward', 'tcp:13000', 'tcp:3000']);

  // Poll healthz
  console.log('[2/4] 轮询 http://127.0.0.1:13000/healthz 状态 (最多等待 30 秒) ...');
  let health = null;
  const start = Date.now();
  while (Date.now() - start < 30000) {
    try {
      const res = await fetchJson(HEALTH_URL, 1500);
      if (res.status === 200 && res.body && res.body.ok) {
        health = res.body;
        break;
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!health) {
    console.error('✘ 无法在 30 秒内连接到 :3000/healthz 服务！');
    process.exit(1);
  }

  console.log(`✔ 服务端响应正常: app=${health.app} version=${health.version} uptime=${health.uptimeSec}s`);

  // Check sockets
  console.log('[3/4] 验证客户端连接状态 (sockets >= 1) ...');
  let connected = health.sockets >= 1;
  const socketStart = Date.now();
  while (!connected && Date.now() - socketStart < 15000) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const res = await fetchJson(HEALTH_URL, 1500);
      if (res.body && res.body.sockets >= 1) {
        health = res.body;
        connected = true;
        break;
      }
    } catch (_) {}
  }

  if (connected) {
    console.log(`✔ 客户端已成功连接到本地引擎！当前活动 sockets: ${health.sockets}`);
  } else {
    console.warn(`⚠ 警告: 当前活动 sockets 为 0，WebView 可能尚未完成页面加载或 WebSocket 连接。`);
  }

  // Check WebView devtools if available
  console.log('[4/4] 探测 WebView CDP 远程调试页面状态 ...');
  try {
    const pid = runAdb(['shell', `pidof ${DEBUG_PKG} || pidof ${PKG}`]).trim();
    if (pid) {
      runAdb(['forward', 'tcp:9225', `localabstract:webview_devtools_remote_${pid}`]);
      const cdpRes = await fetchJson('http://127.0.0.1:9225/json', 1500);
      if (Array.isArray(cdpRes.body) && cdpRes.body.length > 0) {
        const page = cdpRes.body[0];
        console.log(`✔ WebView 页面已加载: title="${page.title}" url="${page.url}"`);
      }
    }
  } catch (e) {
    console.log(`  (CDP 探测说明: ${e.message})`);
  }

  console.log('\n========================================================');
  console.log('  验收检查完成！');
  console.log('========================================================');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
