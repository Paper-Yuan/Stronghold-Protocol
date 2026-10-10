// server/admin/cfStorage.js — DEPRECATED SHIM.
// The CF/R2 publishing plan was replaced on 2026-10-10: mod distribution now uses the
// third-party static hosting pool (see server/mod/cdnClient.js and docs/CF_MOD_TRI_PLAN.md §0.3).
// The class name and method signatures are kept so nothing breaks; uploads delegate to the CDN.
//
// New code should call server/mod/publish.js (verify → split → CDN → catalog) instead.

import { createCdnClient, sha256Of } from '../mod/cdnClient.js';

export class CloudflareModStorage {
  /** @param {{ client?: object, adminKey?: string, fetchImpl?: typeof fetch }} [config] */
  constructor(config = {}) {
    this.client = config.client || createCdnClient({ adminKey: config.adminKey, fetchImpl: config.fetchImpl });
    this.endpoint = this.client.adminBase;
    this.publicBase = this.client.publicBase;
  }

  hashBundle(buffer) {
    return sha256Of(buffer);
  }

  /**
   * Stage one mod zip on the CDN. Kept for interface compatibility; prefer publishPack()
   * which also splits art, builds the slim zip and writes the catalog entry.
   * @param {string} packId
   * @param {Buffer} fileBuffer
   */
  async uploadModPack(packId, fileBuffer) {
    if (!packId || !fileBuffer) throw new Error('Invalid packId or buffer');
    const hash = this.hashBundle(fileBuffer);
    const key = `packs/${packId}/${hash}.zip`;
    const res = await this.client.put(key, fileBuffer, { source: packId, what: `MOD ${packId} 分发包` });
    return { success: true, packId, hash, key, skipped: !!res.skipped, cfUrl: this.client.urlFor(key) };
  }
}
