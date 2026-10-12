import { DIFFICULTIES } from '../../../shared/constants.js';
import { html } from './components.js';

/** A missing/old server snapshot is unknown, not an empty queue. */
export function normalizeMatchmaking(value) {
  if (!value || !Number.isSafeInteger(value.total) || value.total < 0) return null;
  const byDifficulty = {};
  for (const difficulty of DIFFICULTIES) {
    const count = value.byDifficulty?.[difficulty];
    if (!Number.isSafeInteger(count) || count < 0) return null;
    byDifficulty[difficulty] = count;
  }
  return Object.values(byDifficulty).reduce((sum, count) => sum + count, 0) === value.total
    ? { total: value.total, byDifficulty } : null;
}

export function MatchmakingCount({ count }) {
  const known = Number.isSafeInteger(count) && count >= 0;
  return html`<span class="matchmaking-count" title="当前等待同盟匹配的真人席位，不含 AI 和已开始的对局，约每 2 秒更新">
    <span class="num">${known ? count : '--'}</span>人匹配中
  </span>`;
}
