// server/admin/modUploads.js — admin-only raw-body mod zip uploads (CF_MOD_TRI_PLAN.md §2-C1-1).
// Contract (§0.3 frozen): the client sends the zip file AS THE WHOLE REQUEST BODY
// (fetch(url, {method:'POST', body: file}) — File is a BodyInit), Content-Type
// application/zip, no FormData / no multipart. Uploads land in server/.mod-staging/
// as <uploadId>/pack.zip + receipt.json; verification (C2) and CF publishing (C3)
// consume them from there. Zero new npm dependencies.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../index.js';

export const MOD_UPLOAD_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB default (env override in constructor)
const ACCEPTED_TYPES = new Set(['application/zip', 'application/x-zip-compressed']);
const ZIP_MAGIC = 0x50; // 'P' of "PK\x03\x04" — cheap sniff, deep validation is C2's job

export class ModUploadManager {
  constructor({ stagingDir, maxBytes, log = () => {} } = {}) {
    this.stagingDir = stagingDir || path.join(ROOT, 'server', '.mod-staging');
    this.maxBytes = maxBytes
      ?? (Number(process.env.MOD_UPLOAD_MAX_BYTES) > 0 ? Number(process.env.MOD_UPLOAD_MAX_BYTES) : MOD_UPLOAD_MAX_BYTES);
    this.log = log;
  }

  /**
   * Receive one raw-body upload. Returns { uploadId, sha256, bytes, stagedAt } or throws
   * { status, error } with the HTTP status the caller should send.
   * Idempotent: a same-sha256 upload already staged or verified returns its existing uploadId.
   */
  async receive(req) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!ACCEPTED_TYPES.has(type)) {
      throw { status: 415, error: 'Content-Type 必须是 application/zip（裸 body 直传，不用 multipart）' };
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > this.maxBytes) {
      throw { status: 413, error: `mod 包超过大小上限 (${this.maxBytes} 字节)` };
    }
    if (req.method !== 'POST') {
      throw { status: 405, error: '仅支持 POST' };
    }

    await fsp.mkdir(this.stagingDir, { recursive: true });
    const tmpDir = path.join(this.stagingDir, `incoming-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    await fsp.mkdir(tmpDir, { recursive: true });

    try {
      // stream the body, hashing as it arrives; abort the moment the cap is exceeded
      const hash = createHash('sha256');
      const chunks = [];
      let total = 0;
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > this.maxBytes) {
          throw { status: 413, error: `mod 包超过大小上限 (${this.maxBytes} 字节)` };
        }
        hash.update(buf);
        chunks.push(buf);
      }
      if (total === 0) throw { status: 400, error: '空请求体' };
      if (chunks[0][0] !== ZIP_MAGIC) {
        throw { status: 400, error: '请求体不是 ZIP（缺少 PK 魔数）' };
      }
      const sha256 = hash.digest('hex');
      const body = Buffer.concat(chunks);

      // idempotency: same bytes already staged/verified → return the existing receipt
      const existing = await this._findReceiptBySha(sha256);
      if (existing) {
        await fsp.rm(tmpDir, { recursive: true, force: true });
        this.log(`[mod-uploads] idempotent hit ${existing.uploadId}`);
        return { uploadId: existing.uploadId, sha256, bytes: total, stagedAt: existing.stagedAt, idempotent: true };
      }

      const uploadId = `${sha256.slice(0, 12)}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
      const destDir = path.join(this.stagingDir, uploadId);
      await fsp.mkdir(destDir, { recursive: true });
      await fsp.writeFile(path.join(destDir, 'pack.zip'), body);
      const receipt = { uploadId, sha256, bytes: total, stagedAt: Date.now(), status: 'staged' };
      await fsp.writeFile(path.join(destDir, 'receipt.json'), JSON.stringify(receipt, null, 2));
      await fsp.rm(tmpDir, { recursive: true, force: true });
      this.log(`[mod-uploads] staged ${uploadId} (${total} bytes)`);
      return receipt;
    } catch (err) {
      await fsp.rm(tmpDir, { recursive: true, force: true }); // no orphan incoming-* dirs
      throw err;
    }
  }

  async _findReceiptBySha(sha256) {
    let entries;
    try { entries = await fsp.readdir(this.stagingDir, { withFileTypes: true }); } catch { return null; }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('incoming-')) continue;
      try {
        const r = JSON.parse(await fsp.readFile(path.join(this.stagingDir, ent.name, 'receipt.json'), 'utf8'));
        if (r.sha256 === sha256) return r;
      } catch { /* skip unreadable */ }
    }
    return null;
  }

  /** List staged uploads (newest first) for the admin UI. */
  async list() {
    let entries;
    try { entries = await fsp.readdir(this.stagingDir, { withFileTypes: true }); } catch { return []; }
    const out = [];
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('incoming-')) continue;
      try {
        out.push(JSON.parse(await fsp.readFile(path.join(this.stagingDir, ent.name, 'receipt.json'), 'utf8')));
      } catch { /* skip */ }
    }
    return out.sort((a, b) => (b.stagedAt || 0) - (a.stagedAt || 0));
  }

  /** One receipt by uploadId, or null. */
  async get(uploadId) {
    if (!/^[0-9a-f]{12}-\d{14}$/.test(uploadId)) return null;
    try {
      return JSON.parse(await fsp.readFile(path.join(this.stagingDir, uploadId, 'receipt.json'), 'utf8'));
    } catch { return null; }
  }

  /** Remove one staged upload (and its zip). Refuses unknown ids silently (idempotent). */
  async remove(uploadId) {
    const dir = path.join(this.stagingDir, uploadId);
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(path.resolve(this.stagingDir) + path.sep)) return false;
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    return true;
  }
}
