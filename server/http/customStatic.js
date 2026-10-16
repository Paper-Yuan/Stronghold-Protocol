// Custom online/offline resource routes around the upstream 0.2.3 static handler.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createStaticHandler as upstreamStatic } from './static.js';
import { ROOT, noopLog } from './config.js';
import { sendError } from './common.js';
import { MIME, acceptsGzip, isNotModified } from './files.js';
import { createResourceIndex, RESOURCE_MANIFEST_FILE } from '../resources.js';
import { rewriteAssetPaths } from '../../shared/cdn.js';
import { serveWorkshop } from './workshopServe.js';
export function createStaticHandler(dirs) {
  const { publicDir, dataDir, simDir = path.join(ROOT, 'server/sim'), log = noopLog, cdnBase = '', workshop = null } = dirs;
  const serve = upstreamStatic(dirs);
  const resources = createResourceIndex({ dataDir, publicDir, cdnBase, frozenManifest: dirs.resourceManifestPath || process.env.SP_RESOURCE_MANIFEST || path.join(dataDir, 'resource-manifest-frozen.json'), rewrite: v => cdnBase ? rewriteAssetPaths(v, cdnBase) : v, log });
  return async (req, res, rawPath, query) => {
    let decoded;
    try { decoded = decodeURIComponent(rawPath); } catch { return serve(req, res, rawPath, query); }
    // 创意工坊 / 客户端 mod 缓存 (server/http/workshopServe.js)：命中就回答；未命中落到上游挂载 —— 没有安装任何工坊包
    // 时那些表全是空的，每个分支都被跳过，行为与上游逐字节一致。
    if (workshop && serveWorkshop(req, res, decoded, query, workshop, log)) return;
    if (decoded.toLowerCase() === `/data/${RESOURCE_MANIFEST_FILE}`) {
      let idx;
      try {
        idx = await resources.get();
      } catch (e) {
        log.error('[http] cannot build the resource manifest', e);
        sendError(req, res, 500, '服务器内部错误 · Internal error');
        return;
      }
      const gz = acceptsGzip(req.headers['accept-encoding']) ? idx.gzip : null;
      const body = gz || idx.body;
      const stat = { size: idx.body.length, mtimeMs: idx.mtimeMs, mtime: new Date(idx.mtimeMs) };
      const etag = gz ? `${idx.etag.slice(0, -1)}-gz"` : idx.etag;
      const headers = {
        'Content-Type': MIME['.json'],
        'Cache-Control': 'no-cache',
        ETag: etag,
        'Last-Modified': stat.mtime.toUTCString(),
        Vary: 'Accept-Encoding',
      };
      if (gz) headers['Content-Encoding'] = 'gzip';
      if (isNotModified(req, etag, stat.mtime)) { res.writeHead(304, headers); res.end(); return; }
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (decoded === '/sim/simdata.js') {
      try {
        const rawCode = await fsp.readFile(path.join(simDir, 'simdata.js'), 'utf8');
        // Strip Node-only top-level await block so Chrome < 89 (e.g. Chrome 80-88 WebView) parses cleanly without 'Unexpected reserved word'
        const browserCode = rawCode.replace(/if\s*\(\s*IS_NODE\s*\)\s*\{[\s\S]*?\n\}/, '/* browser: nodeLoader omitted (setSimData injects data) */');
        const bBody = Buffer.from(browserCode);
        const bTag = `"simdata-${createHash('sha256').update(bBody).digest('hex').slice(0, 24)}"`;
        const headers = { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache', ETag: bTag, 'Content-Length': bBody.length };
        if (isNotModified(req, bTag, new Date(0))) { delete headers['Content-Length']; res.writeHead(304, headers); res.end(); return; }
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : bBody);
        return;
      } catch (err) {
        log.warn?.('[static] failed to serve browser simdata', err);
      }
    }

    return serve(req, res, rawPath, query);
  };
}
