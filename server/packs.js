// server/packs.js — Mod Pack & Overlay Management.
// Provides non-blocking lazy probe and runtime overlay routing for servers.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { mergeCustomContent } from '../shared/customContent.js';

export const GlobalModManager = {
  masterEnabled: true,
  roomPolicy: 'OPTIONAL', // 'OPTIONAL' | 'STRICT_VANILLA' | 'FORCE_ALL'
  bannedItems: new Set(),
  activePacksRegistry: new Map(), // packId -> manifest
  cache: new Map(), // packId:file -> data

  /**
   * Arbitrate which packs a room can activate.
   * @param {string[]} requestedPacks
   * @returns {string[]} Allowed pack IDs
   */
  resolveRoomPacks(requestedPacks = []) {
    if (!this.masterEnabled || this.roomPolicy === 'STRICT_VANILLA') {
      return [];
    }
    if (this.roomPolicy === 'FORCE_ALL') {
      return Array.from(this.activePacksRegistry.keys());
    }
    return requestedPacks.filter(id => this.activePacksRegistry.has(id));
  },

  /**
   * Non-blocking lazy status probe.
   * Called only when the player opens the Mod menu — zero overhead during normal match play.
   */
  async probeStatus() {
    const packsDir = path.join(process.cwd(), 'packs');
    const status = {
      masterEnabled: this.masterEnabled,
      roomPolicy: this.roomPolicy,
      installedPacks: []
    };

    try {
      const entries = await fs.readdir(packsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const packJsonPath = path.join(packsDir, ent.name, 'pack.json');
        try {
          const raw = await fs.readFile(packJsonPath, 'utf8');
          const meta = JSON.parse(raw);
          const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
          let description = meta._doc || meta.description || '';
          let features = [];
          const readmePath = path.join(packsDir, ent.name, 'README.md');
          try {
            const readmeRaw = await fs.readFile(readmePath, 'utf8');
            const lines = readmeRaw.split(/\r?\n/);
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('* **') || trimmed.startsWith('- **')) {
                features.push(trimmed.replace(/^[*\-]\s*\*\*/, '').replace(/\*\*[:：]?\s*/, '：').replace(/\*\*$/, ''));
              }
            }
            if (!description) {
              const intro = lines.filter(l => l.trim() && !l.startsWith('#')).slice(0, 2).join(' ');
              if (intro) description = intro;
            }
          } catch {}

          status.installedPacks.push({
            id: meta.id || ent.name,
            name: meta.name || ent.name,
            version: meta.version || '1.0.0',
            description,
            credits: meta.credits || '',
            features: features.length ? features : ['包含自定义干员、装备与盟约扩展'],
            hash,
            cfUrl: `https://game.jyuanblog.cc.cd/packs/${ent.name}/`,
            active: this.activePacksRegistry.has(meta.id || ent.name)
          });
        } catch { /* skip unparseable pack */ }
      }
    } catch { /* packs folder not found */ }

    return status;
  },

  /**
   * Hot-register or load a pack into runtime registry.
   */
  async registerPack(packId) {
    const packJsonPath = path.join(process.cwd(), 'packs', packId, 'pack.json');
    try {
      const raw = await fs.readFile(packJsonPath, 'utf8');
      const meta = JSON.parse(raw);
      this.activePacksRegistry.set(packId, meta);
      return { success: true, meta };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Eject a pack dynamically.
   */
  ejectPack(packId) {
    this.activePacksRegistry.delete(packId);
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${packId}:`)) this.cache.delete(key);
    }
    return { success: true };
  }
};
