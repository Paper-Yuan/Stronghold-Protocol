'use strict';
// Per connection: only opt-in clients receive omitted unchanged skin maps.
function createSkinDelta() {
  const cache = new Map();
  return data => {
    // Avoid parsing battle snapshots and other unrelated messages.
    const text = data.toString();
    if (!text.includes('"m.public"')) return data;
    let msg;
    try { msg = JSON.parse(text); } catch { return data; }
    if (msg?.t !== 'm.public' || !Array.isArray(msg.players)) return data;
    if (msg.players.some(p => !p || typeof p.playerId !== 'string')) return data;
    const present = new Set();
    for (const player of msg.players) {
      const id = player.playerId;
      present.add(id);
      const skins = player.skins || {};
      const signature = JSON.stringify(skins);
      if (cache.get(id) === signature) delete player.skins;
      else { cache.set(id, signature); player.skins = skins; }
    }
    for (const id of cache.keys()) if (!present.has(id)) cache.delete(id);
    msg._skinDelta = 1;
    return Buffer.from(JSON.stringify(msg));
  };
}
module.exports = { createSkinDelta };
