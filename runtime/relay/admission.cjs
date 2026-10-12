'use strict';
const crypto = require('node:crypto');
function admissionFactory(config) {
  if (!config?.version || !Array.isArray(config.files) || config.files.length < 3) throw Error('Missing resource admission policy');
  return front => {
    let allowed = false, challenge, lastRequest = 0;
    const send = msg => { if (front.readyState === 1) front.send(JSON.stringify(msg)); };
    const issue = () => {
      if (Date.now() - lastRequest < 1000) return;
      lastRequest = Date.now();const indexes = new Set();
      while (indexes.size < 3) indexes.add(crypto.randomInt(config.files.length));
      const files = [...indexes].map(i => config.files[i]);
      challenge = { nonce: crypto.randomBytes(24).toString('hex'), expiresAt: Date.now() + 5 * 60 * 1000, files };
      send({ t: 'resource.challenge', version: config.version, nonce: challenge.nonce,
        expiresAt: challenge.expiresAt, files: files.map(f => f.url) });
    };
    issue();
    return { handle(data, binary) {
      let msg;try { msg = JSON.parse(data.toString()); } catch { return false; }
      if (msg?.t === 'resource.reset') { allowed = false;challenge = null;lastRequest = 0;issue();return true; }
      if (msg?.t === 'resource.challenge.request') { issue();return true; }
      if (msg?.t === 'resource.proof') {
        let ok = !!challenge && challenge.expiresAt > Date.now() && msg.nonce === challenge.nonce &&
          msg.version === config.version && Array.isArray(msg.proofs) && msg.proofs.length === 3;
        if (ok) for (let i = 0; i < 3; i++) {
          const f = challenge.files[i], proof = msg.proofs[i];
          const expected = crypto.createHash('sha256').update(`${challenge.nonce}\n${f.url}\n${f.sha256}`).digest();
          if (typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof) || !crypto.timingSafeEqual(expected, Buffer.from(proof,'hex'))) { ok = false;break; }
        }
        allowed = ok;
        send({ t: ok ? 'resource.accepted' : 'resource.rejected', version: config.version });
        return true;
      }
      if (!allowed && (['room.create','room.join','room.spectate','room.start','match.queue','queue.join'].includes(msg?.t))) {
        send({ t: 'error', ...(msg.rid != null ? { rid: msg.rid } : {}), code: 'RESOURCE_REQUIRED',
          msg: '必须导入并校验完整资源包；请到 QQ 群 1074985123 获取' });return true;
      }
      return false;
    }};
  };
}
module.exports = { admissionFactory };
