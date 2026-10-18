// scripts/dev-server.mjs — 业主自测用的开发服务器（不进正式构建）
// 用法: node scripts/dev-server.mjs [--round 13] [--funds 9999] [--level 6]
//
// 起服务后，用浏览器打开打印出来的地址，建一间超限房并开始；
// 脚本会在对局进入 R1 休战期后把它直接跳到指定回合并改资金/商店等级。

import { startServer } from '../server/index.js';

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
};
const wantRound = Number(arg('round', 16));
const wantFunds = Number(arg('funds', 9999));
const wantLevel = Number(arg('level', 6));
const wantLp = Number(arg('lp', 999));
const port = Number(process.env.PORT) || 3000;

const srv = await startServer({ port, host: '127.0.0.1' });
console.log('[dev] ' + srv.url);
console.log('[dev] 目标: R' + wantRound + ' 休战期 · ' + wantFunds + ' 金 · ' + wantLevel + ' 本');

const jumped = new WeakSet();   // 每个对局各跳一次（刷新/重开也能跳）
setInterval(() => {
  for (const room of srv.lobby.rooms.values()) {
    const m = room.match;
    if (!m || jumped.has(m)) continue;
    if (m.round < 1 || m.phase !== 'PREP') continue;
    jumped.add(m);
  m.startRound(wantRound);
  m.phase = 'PREP';
  try { m.setDeadline(0); } catch { /* solo is untimed anyway */ }
  for (const ps of m.players.values()) {
    ps.funds = wantFunds;
    ps.shop.level = wantLevel;
    ps.lp = wantLp;   // 测 Boss 轮时把 LP 拉满，免得中途被淘汰
    ps.recompute?.();
    ps.dirty?.();
  }
  m.markPublic();
  // 客户端读的是 m.private：必须再推一次，否则界面还停在跳转前的回合
  // 走框架自己的脏标记 + flush：private 和 public 一起推，客户端才会看到 R13 / 9999 / 6
  try {
    for (const ps of m.players.values()) { ps.dirty?.(); m.markPrivate(ps); }
    m.markPublic();
    m.flush(true);
  } catch (e) { console.log('[dev] push 失败: ' + e.message); }
  console.log('[dev] 已跳转: R' + m.round + ' ' + m.phase + '  资金 ' + [...m.players.values()].map((p) => p.funds).join(',') + '  等级 ' + [...m.players.values()].map((p) => p.shop.level).join(','));
  }
}, 700);
