// server/http/modApi.js — 模组管理 API（本仓库自有，上游 0.3.0 没有）。
//
//   GET  /api/mods                     磁盘上的模组清单（比 /mods/catalog.json 更全：连 pack.json 读不出来的目录也列出）
//   GET  /api/mods/download?id=<modId> 把一个模组目录打成 ZIP 下载（管理端与「同步到别处」的来源）
//   POST /api/mods/reload              重新装载 workshop/（手机导入模组后无需重启服务）
//   POST /api/mods/sync-from-remote    从另一台服务器拉一个模组 ZIP，解压进 workshop/，并热重载
//
// 都带 CORS 头：这是给管理端/跨服务器同步用的接口，不是同源的页面资源。
//
// 逐条迁移自 server/index.js 的 2bed2e7f 版 —— 合并时该文件取了上游实现，整套 API 随之丢失。上游的
// server/http/routes.js 在 serveStatic **之前**就用 405 挡掉非 GET/HEAD，所以这一层必须象 studio 一样挂在
// 那一道方法门之前（server/http/routes.js 里 modApi 那个钩子）。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { sendError, sendJson } from './common.js';
import { createZipFromDir } from '../simpleZip.js';
import { loadWorkshop } from '../workshop.js';
import { modSetOf } from '../../shared/modIdentity.js';

/** 一个模组 id 只允许这些字符（也决定了它会成为 workshop/ 下的哪个目录名）。 */
const MOD_ID_RE = /^[a-zA-Z0-9_.-]+$/;

/** CORS 头（GET/HEAD/OPTIONS 那几条用）。 */
function allowRead(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}
/** CORS 头（POST 那几条用）。 */
function allowWrite(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

/** 读一个请求体（带上限：这些端点只收发一个小 JSON）。 */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > limit) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * @param {{ workshopDir: string, log?: any, reload?: () => Promise<any> }} o
 *   `reload` 重新装载 workshop 并换掉服务表（server/index.js 的 loadWorkshopTables）
 * @returns {{ handles: (p: string) => boolean, handle: (req, res, rawPath: string, query: string) => Promise<void> }}
 */
export function createModApi({ workshopDir, log = console, reload = null }) {
  const handles = (p) => p === '/api/mods' || p.startsWith('/api/mods/');

  /** 磁盘上的模组（含 pack.json 缺失/损坏的目录：管理端要能看见它们才好修）。 */
  const listMods = async () => {
    let diskDirs = [];
    try {
      const entries = await fsp.readdir(workshopDir, { withFileTypes: true });
      diskDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
    } catch { /* 没有 workshop/ 目录：清单就是空的 */ }
    const loaded = loadWorkshop(workshopDir, { log });
    const loadedMap = new Map((loaded.packs || []).map((p) => [p.id, p]));
    const packs = [];
    for (const dirName of diskDirs) {
      const p = loadedMap.get(dirName);
      let rawMeta = null;
      try { rawMeta = JSON.parse(await fsp.readFile(path.join(workshopDir, dirName, 'pack.json'), 'utf8')); } catch { /* 没有 pack.json */ }
      const chessKeys = p && p.files && p.files.chess ? Object.keys(p.files.chess) : [];
      packs.push({
        id: dirName,
        name: rawMeta?.name || p?.manifest?.name || dirName,
        version: rawMeta?.version || p?.manifest?.version || '1.0.0',
        author: rawMeta?.author || p?.manifest?.author || '未知作者',
        description: rawMeta?.description || rawMeta?.desc || p?.manifest?.description || '暂无描述',
        layer: p?.layer || 'data',
        combat: !!p?.combat,
        enabled: rawMeta?.enabled !== false && p?.manifest?.enabled !== false,
        hash: p?.hash || '',
        operators: chessKeys,
        downloadUrl: `/api/mods/download?id=${encodeURIComponent(dirName)}`,
      });
    }
    return packs;
  };

  /** 下载一个模组目录为 ZIP。 */
  const download = (req, res, query) => {
    const modId = new URLSearchParams(query || '').get('id');
    if (!modId || !MOD_ID_RE.test(modId)) { sendError(req, res, 400, '无效的模组标识 · Invalid mod ID'); return; }
    const targetDir = path.join(workshopDir, modId);
    // 规范化后必须仍在 workshop/ 之内（`..` 与绝对路径都拼不出去）
    const normTarget = path.normalize(targetDir);
    const normRoot = path.normalize(workshopDir);
    if (normTarget !== normRoot && !normTarget.startsWith(normRoot + path.sep)) { sendError(req, res, 403, '禁止访问 · Forbidden'); return; }
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) { sendError(req, res, 404, '模组不存在 · Mod not found'); return; }
    let zipBuf;
    try {
      zipBuf = createZipFromDir(targetDir);
    } catch (err) {
      log.error?.('[mods-download] Failed to zip mod', modId, err);
      sendError(req, res, 500, '打包下载失败 · Pack error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(modId)}.zip"`,
      'Content-Length': zipBuf.length,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(zipBuf);
  };

  const handle = async (req, res, rawPath, query) => {
    if (rawPath === '/api/mods') {
      allowRead(res);
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const packs = await listMods();
      sendJson(req, res, 200, { ok: true, packs, total: packs.length });
      return;
    }
    if (rawPath === '/api/mods/download') {
      allowRead(res);
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      download(req, res, query);
      return;
    }
    if (rawPath === '/api/mods/reload' && req.method === 'POST') {
      allowWrite(res);
      try {
        const served = reload ? await reload() : null;
        log.info?.(`[MOD-RELOAD] ✓ 重新装载 ${(served?.packs || []).length} 个包`);
        const mods = (served?.packs || []).map((p) => ({ id: p.id, name: p.name || p.id, version: p.version }));
        sendJson(req, res, 200, {
          ok: true,
          reloaded: (served?.packs || []).length,
          packs: mods,
          modSet: mods.length ? modSetOf(mods) : null,
          message: '模组已热重载，无需重启服务 · Mods reloaded successfully',
        });
      } catch (err) {
        log.error?.('[MOD-RELOAD] Failed:', err);
        sendError(req, res, 500, '模组重载失败 · Reload failed');
      }
      return;
    }
    if (rawPath === '/api/mods/sync-from-remote' && req.method === 'POST') {
      allowWrite(res);
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        sendJson(req, res, 400, { ok: false, error: 'Bad request body' });
        return;
      }
      const { modId, remoteServer } = payload || {};
      if (!modId || typeof modId !== 'string' || !MOD_ID_RE.test(modId)) {
        sendJson(req, res, 400, { ok: false, error: 'Missing or invalid modId' });
        return;
      }
      const remoteUrl = String(remoteServer || '').replace(/\/+$/, '');
      if (!/^https?:\/\//.test(remoteUrl)) { sendJson(req, res, 400, { ok: false, error: 'Missing or invalid remoteServer' }); return; }
      try {
        log.info?.(`[MOD-SYNC] Downloading ${modId} from ${remoteUrl}...`);
        const r = await fetch(`${remoteUrl}/api/mods/download?id=${encodeURIComponent(modId)}`, { signal: AbortSignal.timeout(120000) });
        if (!r.ok) throw new Error(`Remote server returned ${r.status}`);
        const buffer = Buffer.from(await r.arrayBuffer());
        const targetDir = path.join(workshopDir, modId);
        if (fs.existsSync(targetDir)) {
          log.warn?.(`[MOD-SYNC] ${modId} already exists, overwriting...`);
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
        const AdmZip = (await import('adm-zip')).default;
        new AdmZip(buffer).extractAllTo(targetDir, true);
        log.info?.(`[MOD-SYNC] ✓ ${modId} synced successfully`);
        const served = reload ? await reload() : null;
        const mods = (served?.packs || []).map((p) => ({ id: p.id, name: p.name || p.id, version: p.version }));
        sendJson(req, res, 200, {
          ok: true,
          reloaded: (served?.packs || []).length,
          packs: mods,
          message: '模组已从远程同步并热重载 · Mod synced and reloaded',
        });
      } catch (err) {
        log.error?.('[MOD-SYNC] Failed:', err);
        sendJson(req, res, 500, { ok: false, error: String(err && err.message ? err.message : err) });
      }
      return;
    }
    sendError(req, res, 404, '页面不存在 · Not found');
  };

  return { handles, handle };
}
