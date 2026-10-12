import fs from 'node:fs';
import { createHmac } from 'node:crypto';
import { ERR } from '../shared/constants.js';
import { parseRoomVoiceSignal } from '../shared/roomVoiceProtocol.js';
import { TokenBucket, sendSession } from './net.js';
import { isVoiceEnabled } from './serverStatus.js';

export class RoomVoice {
  constructor(lobby) {
    this.lobby = lobby;
    this.states = new WeakMap();
    this.config = null;
    try {
      const config = JSON.parse(
        fs.readFileSync(new URL('../config/voice.json', import.meta.url), 'utf8'),
      );
      if (typeof config.secret === 'string' && config.secret.length >= 32 &&
          Array.isArray(config.turnUrls) && config.turnUrls.length &&
          config.turnUrls.every(url =>
            typeof url === 'string' &&
            /^turn:[A-Za-z0-9.:-]+\?transport=(udp|tcp)$/.test(url)))
        this.config = config;
    } catch {}
  }

  state(room) {
    let state = this.states.get(room);
    if (!state) {
      state = { members: new Map(), buckets: new Map() };
      this.states.set(room, state);
    }
    return state;
  }

  memberRoom(session, code) {
    const room = this.lobby.roomOf(session);
    const seat = room?.seatOf(session.playerId);
    return room && !room.disposed && room.mode === 'coop' &&
      room.code === code && seat && !seat.isBot && !seat.left &&
      session.connected ? room : null;
  }

  take(state, playerId, kind, rate, burst) {
    const key = playerId + ':' + kind, at = this.lobby.now();
    let bucket = state.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(rate, burst, at);
      state.buckets.set(key, bucket);
    }
    return bucket.take(at);
  }

  roster(room) {
    const state = this.state(room);
    const users = [];
    for (const [playerId, member] of state.members) {
      const session = this.lobby.registry.byId(playerId);
      if (session?.connected && session.ws === member.ws &&
          this.memberRoom(session, room.code))
        users.push({
          playerId, id: member.id,
          name: session.name, muted: member.muted,
        });
    }
    for (const user of users)
      sendSession(this.lobby.registry.byId(user.playerId), {
        t: 'room.voice.state', code: room.code, id: user.id, users,
      });
  }

  ice(room, session, member) {
    const expiresAt = this.lobby.now() + 3600000;
    const iceServers = [];
    if (this.config) {
      const username =
        Math.floor(expiresAt / 1000) + ':' + session.playerId;
      const credential = createHmac('sha1', this.config.secret)
        .update(username).digest('base64');
      const endpoint = this.config.turnUrls[0]
        .split('?')[0].replace(/^turn:/, 'stun:');
      iceServers.push({ urls: endpoint });
      iceServers.push({
        urls: this.config.turnUrls, username, credential,
      });
    }
    sendSession(session, {
      t: 'room.voice.ice', code: room.code, id: member.id,
      iceServers, expiresAt,
    });
  }

  handle(session, msg) {
    if (!isVoiceEnabled()) return { error: ERR.BAD_MSG, detail: '此服务器未开启队友语音' };
    const room = this.memberRoom(session, msg.code);
    if (!room) return { error: ERR.NOT_IN_ROOM };
    const state = this.state(room);
    const member = state.members.get(session.playerId);

    if (msg.t === 'room.voice.join') {
      if (!this.take(state, session.playerId, 'join', 1, 3))
        return { error: ERR.RATE };
      state.members.set(session.playerId, {
        id: msg.id, ws: session.ws,
        muted: member?.id === msg.id ? member.muted : true,
      });
      this.ice(room, session, state.members.get(session.playerId));
      this.roster(room);
      return { ok: true };
    }

    if (!member || member.id !== msg.id || member.ws !== session.ws)
      return { error: ERR.BAD_MSG };

    if (msg.t === 'room.voice.leave') {
      this.drop(room, session.playerId);
    } else if (msg.t === 'room.voice.ice') {
      if (!this.take(state, session.playerId, 'ice', 1, 2))
        return { error: ERR.RATE };
      this.ice(room, session, member);
    } else if (msg.t === 'room.voice.mute') {
      if (!this.take(state, session.playerId, 'mute', 4, 8))
        return { error: ERR.RATE };
      if (member.muted !== msg.muted) {
        member.muted = msg.muted;
        this.roster(room);
      }
    } else if (msg.t === 'room.voice.signal') {
      if (!this.take(state, session.playerId, 'signal', 15, 40))
        return { error: ERR.RATE };
      const target = state.members.get(msg.to);
      const to = this.lobby.registry.byId(msg.to);
      const data = parseRoomVoiceSignal(msg.data);
      if (!data || msg.to === session.playerId || !target ||
          target.id !== msg.toId || !to?.connected ||
          to.ws !== target.ws || !this.memberRoom(to, room.code))
        return { error: ERR.BAD_TARGET };

      sendSession(to, {
        t: 'room.voice.signal', code: room.code, id: target.id,
        from: session.playerId, fromId: member.id, data,
      });
    } else return { error: ERR.BAD_MSG };

    return { ok: true };
  }

  drop(room, playerId, forget = false) {
    if (!room) return;
    const state = this.states.get(room);
    if (!state) return;
    if (forget)
      for (const key of state.buckets.keys())
        if (key.startsWith(playerId + ':')) state.buckets.delete(key);
    if (state.members.delete(playerId) && !room.disposed)
      this.roster(room);
  }

  resume(session) {
    const room = this.lobby.roomOf(session);
    const member =
      room && this.states.get(room)?.members.get(session.playerId);
    if (member && member.ws !== session.ws)
      this.drop(room, session.playerId);
  }

  close(room) {
    const state = this.states.get(room);
    if (!state) return;
    for (const [playerId, member] of state.members)
      sendSession(this.lobby.registry.byId(playerId), {
        t: 'room.voice.closed', code: room.code, id: member.id,
      });
    state.members.clear();
    state.buckets.clear();
    this.states.delete(room);
  }
}
