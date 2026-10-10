// server/mod/cdnClient.js — client for the third-party static hosting pool
// (docs/STATIC_CDN_ANALYSIS_AND_TOOL_SPEC.md; CF_MOD_TRI_PLAN.md §0.3 分发承载).
//
//   admin  https://downcdn.jiangjiangze.icu   (x-admin-key) — staging + publish rounds
//   public https://weishucdn.jiangjiangze.icu (CORS *, immutable) — client downloads
//
// Server-side use: the publish pipeline (server/mod/publish.js) uploads split-out mod art
// and the slim pack zip, deduping by sha256 against the public hosted index. The game
// server itself never serves static assets — this client only writes them upstream.
//
// The CDN refuses executable/active content (.js/.html/.svg): isAllowedAssetKey enforces
// that locally so a bad key fails before the upload round-trip.

import { createHash } from 'node:crypto';

export const CDN_ADMIN_BASE = 'https://downcdn.jiangjiangze.icu';
export const CDN_PUBLIC_BASE = 'https://weishucdn.jiangjiangze.icu';
export const CDN_INDEX_URL = `${CDN_PUBLIC_BASE}/cdn/v1/hosted-index.json`;

// Extensions the pool accepts (its own published allowlist). .zip is accepted — that is
// how a mod pack itself is distributed.
const ALLOWED_EXT = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'atlas', 'skel', 'json', 'txt',
  'mp3', 'ogg', 'wav', 'woff', 'woff2', 'ttf', 'zip',
]);

export function extOfKey(key) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(key || ''));
  return m ? m[1].toLowerCase() : '';
}

/** True when the CDN will accept this key (rejects .js/.html/.svg and unknown extensions). */
export function isAllowedAssetKey(key) {
  return ALLOWED_EXT.has(extOfKey(key));
}

export function sha256Of(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * @param {{ adminBase?: string, publicBase?: string, adminKey?: string, fetchImpl?: typeof fetch }} [opts]
 */
export function createCdnClient({ adminBase = CDN_ADMIN_BASE, publicBase = CDN_PUBLIC_BASE, adminKey, fetchImpl = fetch } = {}) {
  const key = adminKey ?? process.env.CDN_ADMIN_KEY ?? 'mod325';

  async function api(pathname, opts = {}) {
    const res = await fetchImpl(`${adminBase}${pathname}`, {
      ...opts,
      headers: { 'x-admin-key': key, ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }

  return {
    adminBase,
    publicBase,

    /** Remote dedup index: { key → { sha256, size, ... } }. Failures degrade to an empty map. */
    async remoteIndex() {
      try {
        const res = await fetchImpl(`${publicBase}/cdn/v1/hosted-index.json`);
        if (!res.ok) return {};
        const doc = await res.json();
        return doc?.files || {};
      } catch {
        return {};
      }
    },

    /** Staging queue + pending publish count. */
    async status() {
      const { ok, status, data } = await api('/api/cdn/upload/status');
      if (!ok) throw new Error(`CDN status 失败: HTTP ${status}`);
      return data;
    },

    /**
     * Stage one object. Dedup is the caller's job (pass a preloaded index via opts.index)
     * so a batch of files costs one index fetch.
     * @returns {{ skipped: boolean, key: string, sha256: string, id?: string }}
     */
    async put(objectKey, buffer, { source = 'sp-mod', what = 'MOD 静态素材', index = null } = {}) {
      if (!isAllowedAssetKey(objectKey)) {
        throw new Error(`CDN 拒收该类型: ${objectKey}（仅静态素材与 zip）`);
      }
      const sha256 = sha256Of(buffer);
      if (index && index[objectKey]?.sha256 === sha256) {
        return { skipped: true, key: objectKey, sha256 };
      }
      const qs = new URLSearchParams({
        key: objectKey, sha256, size: String(buffer.length), source, what,
      });
      const res = await fetchImpl(`${adminBase}/api/cdn/upload/put?${qs}`, {
        method: 'PUT',
        headers: { 'x-admin-key': key, 'content-type': 'application/octet-stream' },
        body: buffer,
      });
      const doc = await res.json().catch(() => null);
      if (!res.ok || !doc?.ok) {
        throw new Error(`CDN 上传被拒 ${objectKey}: ${doc?.error || `HTTP ${res.status}`}`);
      }
      return { skipped: false, key: objectKey, sha256, id: doc.id };
    },

    /** Ask the publish round to run (objects land on the public host in ~1–2 min). */
    async kick() {
      const { ok, status } = await api('/api/cdn/upload/kick', { method: 'POST' });
      if (!ok && status !== 202) throw new Error(`CDN kick 失败: HTTP ${status}`);
      return true;
    },

    /** Public URL for a key (what goes into the catalog / rewritten section data). */
    urlFor(objectKey) {
      return `${publicBase}/${objectKey.replace(/^\/+/, '')}`;
    },
  };
}
