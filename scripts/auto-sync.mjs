#!/usr/bin/env node
/**
 * scripts/auto-sync.mjs — 随时自动同步守护进程
 *
 * 适用于阿里云 / 自建服务器后台运行：
 * 1. 周期性检测 GitHub 仓库对应分支是否有新提交
 * 2. 发现新代码自动执行: git pull -> tools/vendor.mjs -> 重启/热载服务
 * 3. 支持 PM2 守护或独立进程守护
 *
 * 运行方式:
 *   node scripts/auto-sync.mjs [--branch 0.1.6-pre-skin] [--interval 20]
 *   或 PM2 后台常驻:
 *   pm2 start scripts/auto-sync.mjs --name "stronghold-sync" -- --branch 0.1.6-pre-skin
 */

import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 命令行参数解析
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const BRANCH = getArg('branch', process.env.SYNC_BRANCH || '0.1.6-pre-skin');
const INTERVAL_SEC = Math.max(5, parseInt(getArg('interval', process.env.SYNC_INTERVAL || '20'), 10));
const PM2_APP_NAME = getArg('pm2-app', process.env.PM2_APP || 'stronghold');

function log(msg) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${ts}] [AutoSync] ${msg}`);
}

function run(cmd, silent = false) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: silent ? 'pipe' : 'inherit' });
  } catch (err) {
    if (!silent) console.error(`Command failed: ${cmd}`, err.message);
    return null;
  }
}

function getCommitHash(ref) {
  try {
    return execSync(`git rev-parse ${ref}`, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

function syncOnce() {
  // 1. fetch 远程最新状态
  const fetchRes = spawnSync('git', ['fetch', 'origin', BRANCH, '--quiet'], { cwd: ROOT });
  if (fetchRes.status !== 0) {
    // 遇到临时网络波动或握手中断时静默跳过，下周期重试
    return;
  }

  const localHead = getCommitHash('HEAD');
  const remoteHead = getCommitHash(`origin/${BRANCH}`);

  if (!localHead || !remoteHead) return;

  if (localHead !== remoteHead) {
    log(`检测到分支 [${BRANCH}] 新提交: ${remoteHead.slice(0, 7)} (当前: ${localHead.slice(0, 7)})`);
    log('正在拉取最新代码...');

    const pullRes = spawnSync('git', ['pull', 'origin', BRANCH], { cwd: ROOT, stdio: 'inherit' });
    if (pullRes.status !== 0) {
      log('✘ git pull 失败，等待下一周期重试。');
      return;
    }

    log('正在更新三方库依赖与分发资源...');
    run('node tools/vendor.mjs', true);
    run('node tools/sync-static-web.mjs', true);

    log(`正在热重载游戏服务 (PM2: ${PM2_APP_NAME})...`);
    // 尝试通知 pm2 重载
    try {
      const pm2Res = spawnSync('pm2', ['reload', PM2_APP_NAME], { stdio: 'pipe', encoding: 'utf8' });
      if (pm2Res.status === 0) {
        log(`✔ PM2 [${PM2_APP_NAME}] 热重载成功！`);
      } else {
        // 如果不是 reload，尝试 restart
        spawnSync('pm2', ['restart', PM2_APP_NAME], { stdio: 'pipe' });
        log(`✔ PM2 [${PM2_APP_NAME}] 重启成功！`);
      }
    } catch {
      log('提示: 未检测到 pm2 命令行，若未通过 pm2 运行服务，请手动重启 server/index.js');
    }

    log(`🎉 代码同步完毕，当前版本: ${remoteHead.slice(0, 7)}`);
  }
}

log(`启动自动同步守护器 (分支: ${BRANCH}, 检查间隔: ${INTERVAL_SEC}s)`);
syncOnce();
setInterval(syncOnce, INTERVAL_SEC * 1000);
