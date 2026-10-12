import { open } from 'node:fs/promises';
import { parseAnnouncements, activeAnnouncement } from '../shared/announcements.js';

export const ANNOUNCEMENT_POLL_MS = 2000;
export const ANNOUNCEMENT_MAX_BYTES = 128 * 1024;
const quiet = { info() {}, warn() {}, error() {} };

/** Read-only config service: content polling also catches atomic replacements inside Docker bind mounts. */
export class Announcements {
  constructor({ file, broadcast = () => {}, now = Date.now, log = quiet, pollMs = ANNOUNCEMENT_POLL_MS } = {}) {
    this.file = file;
    this.broadcast = broadcast;
    this.now = now;
    this.log = log;
    this.pollMs = pollMs;
    this.rows = [];
    this.current = null;
    this.key = 'null';
    this.raw = null;
    this.loaded = false;
    this.lastError = null;
    this.started = false;
    this.stopped = false;
    this.pollTimer = null;
    this.boundaryTimer = null;
    this.pending = null;
  }

  async start() {
    if (this.started || this.stopped) return;
    this.started = true;
    await this.reload();
    if (!this.stopped && this.file) {
      this.pollTimer = setInterval(() => { this.reload(); }, this.pollMs);
      this.pollTimer.unref?.();
    }
    this.refresh();
  }

  reload() {
    if (this.pending) return this.pending;
    if (this.stopped || !this.file) return Promise.resolve(false);
    this.pending = this._read().finally(() => { this.pending = null; });
    return this.pending;
  }

  async _read() {
    let handle;
    try {
      handle = await open(this.file, 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > ANNOUNCEMENT_MAX_BYTES) throw new Error('announcement file must be at most 128 KiB');
      const buffer = Buffer.alloc(ANNOUNCEMENT_MAX_BYTES + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const chunk = await handle.read(buffer, bytes, buffer.length - bytes, null);
        if (!chunk.bytesRead) break;
        bytes += chunk.bytesRead;
      }
      if (bytes > ANNOUNCEMENT_MAX_BYTES) throw new Error('announcement file must be at most 128 KiB');
      const raw = buffer.toString('utf8', 0, bytes).replace(/^\uFEFF/, '');
      if (this.stopped) return false;
      if (raw !== this.raw) {
        const rows = parseAnnouncements(JSON.parse(raw));
        this.rows = rows;
        this.raw = raw;
        this.loaded = true;
      }
      this.lastError = null;
      this.refresh();
      return true;
    } catch (err) {
      if (!this.stopped) {
        const message = err.code || err.message;
        if (message !== this.lastError && !(message === 'ENOENT' && !this.loaded)) {
          this.log.warn(`[announcements] config rejected (${message}); keeping last valid schedule`);
        }
        this.lastError = message;
      }
      return false;
    } finally { await handle?.close().catch(() => {}); }
  }

  refresh() {
    if (this.stopped) return;
    const now = this.now();
    const current = activeAnnouncement(this.rows, now);
    const key = JSON.stringify(current);
    this.current = current;
    if (key !== this.key) {
      this.key = key;
      try { this.broadcast(this.message()); } catch (err) { this.log.error('[announcements] broadcast failed', err); }
    }
    clearTimeout(this.boundaryTimer);
    this.boundaryTimer = null;
    let next = Infinity;
    for (const row of this.rows) if (row.enabled) {
      if (row.startAt > now) next = Math.min(next, row.startAt);
      if (row.endAt > now) next = Math.min(next, row.endAt);
    }
    if (Number.isFinite(next)) {
      // Recheck absolute wall time as well as boundaries: clock changes do not leave a long stale timer.
      this.boundaryTimer = setTimeout(() => this.refresh(), Math.max(1, Math.min(30000, next - now)));
      this.boundaryTimer.unref?.();
    }
  }

  message() { return { t: 'site.announcement', serverNow: this.now(), announcement: this.current }; }
  stats() { return { configured: !!this.file, loaded: this.loaded, entries: this.rows.length, activeId: this.current?.id || null, configError: this.lastError }; }

  async stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearTimeout(this.boundaryTimer);
    this.pollTimer = this.boundaryTimer = null;
    await this.pending;
  }
}
