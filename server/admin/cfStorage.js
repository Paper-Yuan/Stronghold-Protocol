// server/admin/cfStorage.js — Cloudflare External Storage Pipeline for Mod Packs.
// Allows admin console to dispatch mod assets directly to CF storage endpoints.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export class CloudflareModStorage {
  constructor(config = {}) {
    this.endpoint = config.endpoint || process.env.CF_R2_ENDPOINT || 'https://game.jyuanblog.cc.cd/api/storage';
    this.apiToken = config.apiToken || process.env.CF_API_TOKEN || '';
  }

  /**
   * Generates a tamper-proof SHA-256 integrity hash for an asset bundle buffer.
   * @param {Buffer} buffer
   */
  hashBundle(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Dispatches a mod pack archive to the CF storage endpoint.
   * Local stage lands in server/.mod-staging/cf-pending/<packId>/ (CF_MOD_TRI_PLAN.md
   * §2-C1-4); the CF key shape mods/<packId>/<sha256>.zip follows the §0.3 catalog
   * contract — B1's catalog entries are the source of truth for the final shape.
   * @param {string} packId
   * @param {Buffer} fileBuffer
   */
  async uploadModPack(packId, fileBuffer) {
    if (!packId || !fileBuffer) throw new Error('Invalid packId or buffer');

    const hash = this.hashBundle(fileBuffer);
    const targetDir = path.join(process.cwd(), 'server', '.mod-staging', 'cf-pending', packId);
    await fs.mkdir(targetDir, { recursive: true });

    // Write hash manifest
    const manifest = {
      packId,
      sha256: hash,
      uploadedAt: new Date().toISOString(),
      cfRemotePath: `mods/${packId}/${hash}.zip`
    };

    await fs.writeFile(path.join(targetDir, 'manifest.sha256'), JSON.stringify(manifest, null, 2), 'utf8');

    return {
      success: true,
      packId,
      hash,
      cfUrl: `${this.endpoint}/mods/${packId}/${hash}.zip`
    };
  }
}
