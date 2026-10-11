export const GAME_NODES = Object.freeze([
  { id: 'hongkong', name: '香港服', url: 'https://sp.isomer319.xyz/', voice: true },
  { id: 'hongkong2', name: '香港 2', url: 'https://wei.isomer319.xyz/game/', voice: false },
]);
export const STATUS_ORIGIN = 'https://sp.isomer319.xyz';
export const STATUS_MAX_AGE_MS = 20000;

export function nodeForHost(hostname) {
  if (hostname === 'wei.isomer319.xyz') return 'hongkong2';
  if (hostname === 'sp.isomer319.xyz') return 'hongkong';
  return null;
}
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
/** @param {{ cpuPercent?: number, memoryPercent?: number, loopLagMs?: number }} [metrics] */
export function pressureLevel({ cpuPercent, memoryPercent, loopLagMs } = {}) {
  if ([cpuPercent, memoryPercent, loopLagMs].every(v => v == null)) return 'unknown';
  if (cpuPercent >= 85 || memoryPercent >= 90 || loopLagMs >= 120) return 'busy';
  if (cpuPercent >= 60 || memoryPercent >= 80 || loopLagMs >= 50) return 'moderate';
  return 'low';
}
/** Accept only fresh, bounded public fields. A failed probe never pretends to have zero players. */
export function normalizeNodeStatus(doc, receivedAt = Date.now()) {
  if (!doc || doc.ok !== true || !doc.node || number(doc.node.observedAt, 0, receivedAt + 5000) == null ||
      receivedAt - doc.node.observedAt > STATUS_MAX_AGE_MS) return { available: false };
  const cpuPercent = number(doc.node.cpuPercent, 0, 100), memoryPercent = number(doc.node.memoryPercent, 0, 100);
  const loopLagMs = number(doc.node.loopLagMs, 0, 60000);
  const online = number(doc.online, 0, 1000000), matches = number(doc.matches, 0, 1000000);
  return { available: true, online, matches, cpuPercent, memoryPercent, loopLagMs,
    pressure: pressureLevel({ cpuPercent, memoryPercent, loopLagMs }),
    receivedAt };
}
/** Recommend by measured host/process pressure and online population, not HTTP response times. */
export function recommendNode(statuses, now = Date.now()) {
  const valid = GAME_NODES.map(n => ({ ...n, status: statuses[n.id] })).filter(n =>
    n.status?.available && now - n.status.receivedAt <= STATUS_MAX_AGE_MS && n.status.pressure !== 'unknown');
  const rank = { low: 0, moderate: 1000, busy: 3000 };
  const score = s => rank[s.pressure] + (s.cpuPercent ?? 50) * 2 + (s.memoryPercent ?? 50) +
    (s.online ?? 0) * 2;
  valid.sort((a,b) => score(a.status) - score(b.status));
  return valid[0]?.id || null;
}
/** Fixed allowlist: do not carry room codes or identity tokens to another server. */
export function serverEntryUrl(id, nickname = '') {
  const node = GAME_NODES.find(n => n.id === id);
  if (!node) throw new Error('Unknown server');
  return node.url + (nickname ? '#sp-enter=' + encodeURIComponent(String(nickname).slice(0, 64)) : '');
}
