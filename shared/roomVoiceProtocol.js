import { ROOM_CODE_LEN } from './constants.js';

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;
const only = (v, keys) => Object.keys(v).every(key => keys.includes(key));
const id = v => typeof v === 'string' && /^[A-Za-z0-9_\-.:]{1,64}$/.test(v);
const voiceId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v);
const code = v => typeof v === 'string' && v.length === ROOM_CODE_LEN &&
  /^[ABCDEFGHJKLMNPQRSTUVWXYZ]+$/.test(v);

/** Only bounded audio-session descriptions and ICE candidates may be relayed. */
export function parseRoomVoiceSignal(raw) {
  if (typeof raw !== 'string' || raw.length > 12000) return null;
  try {
    const v = JSON.parse(raw);
    if (!plain(v) || Object.keys(v).length !== 1) return null;
    if (v.restart === true) return { restart: true };
    if (plain(v.description)) {
      const d = v.description;
      if (!only(d, ['type', 'sdp']) || !['offer', 'answer'].includes(d.type) ||
          typeof d.sdp !== 'string' || !d.sdp.length || d.sdp.length > 8000)
        return null;
      return { description: { type: d.type, sdp: d.sdp } };
    }
    if (Array.isArray(v.candidates) && v.candidates.length <= 8) {
      const candidates = [];
      for (const c of v.candidates) {
        if (c === null) { candidates.push(null); continue; }
        if (!plain(c) || !only(c, ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment']) ||
            typeof c.candidate !== 'string' || c.candidate.length > 1024 ||
            (c.sdpMid != null && (typeof c.sdpMid !== 'string' || c.sdpMid.length > 64)) ||
            (c.sdpMLineIndex != null && (!Number.isInteger(c.sdpMLineIndex) ||
              c.sdpMLineIndex < 0 || c.sdpMLineIndex > 32)) ||
            (c.usernameFragment != null && (typeof c.usernameFragment !== 'string' ||
              c.usernameFragment.length > 256))) return null;
        candidates.push({ candidate: c.candidate, sdpMid: c.sdpMid ?? null,
          sdpMLineIndex: c.sdpMLineIndex ?? null, usernameFragment: c.usernameFragment ?? null });
      }
      return { candidates };
    }
  } catch {}
  return null;
}

export const ROOM_VOICE_C2S = {
  'room.voice.join': { code, id: voiceId },
  'room.voice.leave': { code, id: voiceId },
  'room.voice.mute': { code, id: voiceId, muted: v => typeof v === 'boolean' },
  'room.voice.ice': { code, id: voiceId },
  'room.voice.signal': { code, id: voiceId, to: id, toId: voiceId,
    data: v => parseRoomVoiceSignal(v) !== null },
};
