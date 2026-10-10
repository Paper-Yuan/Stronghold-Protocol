// server/debug.js — 服务器主人专用调试模式鉴权 (timing-safe)
import crypto from 'node:crypto';

/**
 * 从环境变量与配置中解析调试开关。
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ secret?: string, names?: string[] }} [opts]
 * @returns {{ secret: string, names: string[] }}
 */
export function debugConfigFrom(env = process.env, opts = {}) {
  const secret = String(opts.secret || env.DEBUG_SECRET || env.ADMIN_SECRET || '').trim();
  const rawNames = String(opts.names || env.DEBUG_NAMES || '').trim();
  const names = rawNames ? rawNames.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean) : [];
  return { secret, names };
}

/**
 * 校验调试指令鉴权（口令 + 昵称白名单）。
 * @param {{ secret?: string, names?: string[] }} cfg
 * @param {{ secret?: string, name?: string }} intent
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkDebugAuth(cfg = {}, { secret, name } = {}) {
  if (!cfg || !cfg.secret) return { ok: false, reason: 'disabled' };
  if (!secret) return { ok: false, reason: 'missing_secret' };
  try {
    const a = Buffer.from(String(secret));
    const b = Buffer.from(String(cfg.secret));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'bad_secret' };
    }
  } catch {
    return { ok: false, reason: 'bad_secret' };
  }
  if (Array.isArray(cfg.names) && cfg.names.length > 0) {
    if (!name || !cfg.names.includes(String(name).trim())) {
      return { ok: false, reason: 'not_whitelisted' };
    }
  }
  return { ok: true };
}
