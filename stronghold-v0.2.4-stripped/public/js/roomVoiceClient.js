export class RoomVoiceClient extends EventTarget {
  constructor({
    net, store,
    media = globalThis.navigator?.mediaDevices,
    PC = globalThis.RTCPeerConnection,
    audio = () => {
      const a = document.createElement('audio');
      a.autoplay = true;
      document.body.append(a);
      return a;
    },
  }) {
    super();
    Object.assign(this, { net, store, media, PC, audio });
    this.room = null;
    this.status = net.status;
    this.id = null;
    this.joined = false;
    this.joining = null;
    this.stream = null;
    this.capture = 0;
    this.wantMic = false;
    this.users = [];
    this.peers = new Map();
    this.iceServers = [];
    this.error = '';
    this.blocked = false;
    this.refresh = null;
    this.off = [
      store.subscribe(() => this.sync()),
      net.on('status', () => this.sync()),
      net.on('room.voice.ice', m => this.onIce(m)),
      net.on('room.voice.state', m => this.onState(m)),
      net.on('room.voice.signal', m => this.onSignal(m)),
      net.on('room.voice.closed', m => {
        if (this.accept(m)) this.leave();
      }),
    ];
    this.sync();
  }

  changed() {
    this.dispatchEvent(new Event('change'));
  }

  sync() {
    const s = this.store.get(), room = s.room;
    const playerId = s.me?.playerId;
    const seat = room?.seats?.find(v => v?.playerId === playerId);
    const next = room?.mode === 'coop' && seat &&
      !seat.isBot && !seat.left
      ? { code: room.code, playerId } : null;
    const changed = next?.code !== this.room?.code ||
      next?.playerId !== this.room?.playerId;

    const statusChanged = this.status !== this.net.status;
    if (!changed && !statusChanged) return;
    this.status = this.net.status;
    if (changed || this.net.status !== 'online') this.leave();
    if (changed) this.room = next;
    this.changed();
  }

  accept(m) {
    return !!this.id && m.id === this.id &&
      m.code === this.room?.code;
  }

  async request(t, fields = {}, id = this.id, room = this.room) {
    if (!id || !room || this.net.status !== 'online')
      throw new Error('请等待游戏连接恢复');
    return this.net.request(t, { code: room.code, id, ...fields });
  }

  play() {
    this.blocked = false;
    for (const p of this.peers.values())
      if (p.audio.srcObject)
        p.audio.play().catch(() => {
          if (this.peers.get(p.playerId) === p) {
            this.blocked = true;
            this.changed();
          }
        });
    this.changed();
  }

  async join() {
    this.play();
    if (this.joined) return;
    if (this.joining) return this.joining;
    if (!this.PC)
      throw new Error('此浏览器不支持语音，请使用新版浏览器');
    if (!this.room || this.net.status !== 'online')
      throw new Error('请先进入同盟房间');

    this.error = '';
    const id = globalThis.crypto.randomUUID().replaceAll('-', '');
    const room = { ...this.room };
    this.id = id;

    const task = this.request('room.voice.join', {}, id, room)
      .then(() => {
        if (this.id !== id) return;
        this.joined = true;
        this.reconcile();
        this.changed();
      })
      .catch(error => {
        if (this.id === id) {
          this.leave();
          this.error = error.message;
          this.changed();
        }
        throw error;
      })
      .finally(() => {
        if (this.joining === task) this.joining = null;
      });

    this.joining = task;
    this.changed();
    return task;
  }

  async startMic() {
    if (this.wantMic || this.stream) return;
    if (!this.room || this.net.status !== 'online') {
      this.error = '请先进入已连接的同盟房间';
      this.changed();
      return;
    }
    if (!this.media?.getUserMedia) {
      this.error = '麦克风需要 HTTPS 和受支持的浏览器';
      this.changed();
      return;
    }

    const revision = ++this.capture, room = this.room;
    this.wantMic = true;
    this.error = '';
    this.play();
    this.changed();
    let acquired;

    try {
      acquired = await this.media.getUserMedia({
        video: false,
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (revision !== this.capture ||
          room !== this.room || !this.wantMic) {
        acquired.getTracks().forEach(t => t.stop());
        return;
      }

      // 提前保存，等待加入房间期间也能立即取消采集。
      this.stream = acquired;
      const track = acquired.getAudioTracks()[0];
      if (!track) throw new Error('没有可用的麦克风音轨');

      track.onended = () => {
        if (this.stream === acquired) {
          this.mute();
          this.error = '麦克风已被系统关闭';
          this.changed();
        }
      };

      await this.join();
      if (revision !== this.capture ||
          this.stream !== acquired || room !== this.room) return;

      await Promise.all(
        [...this.peers.values()].map(p => this.replace(p, track)),
      );
      if (revision !== this.capture ||
          this.stream !== acquired) return;

      await this.request('room.voice.mute', { muted: false });
      this.changed();
    } catch (error) {
      acquired?.getTracks().forEach(t => t.stop());
      if (revision === this.capture) {
        this.mute();
        this.error = error.name === 'NotAllowedError'
          ? '麦克风权限被拒绝，请在浏览器设置中允许'
          : error.name === 'NotFoundError'
            ? '未找到麦克风'
            : error.message || '开麦失败';
        this.changed();
      }
    }
  }

  replace(p, track) {
    p.tracks = p.tracks.catch(() => {}).then(() => {
      if (this.peers.get(p.playerId) !== p || !p.sender) return;
      const current = track?.readyState === 'live' &&
        this.stream?.getAudioTracks().includes(track);
      return p.sender.replaceTrack(current ? track : null);
    });
    return p.tracks;
  }

  mute() {
    ++this.capture;
    this.wantMic = false;
    const stream = this.stream;
    this.stream = null;

    // 同步释放采集，不等待网络请求。
    stream?.getTracks().forEach(t => {
      t.onended = null;
      t.stop();
    });

    for (const p of this.peers.values())
      this.replace(p, null).catch(() => {});
    if (this.joined)
      this.request('room.voice.mute', { muted: true }).catch(() => {});
    this.changed();
  }

  leave() {
    const id = this.id, room = this.room;
    this.joined = false;
    this.id = null;
    this.joining = null;
    this.mute();
    clearTimeout(this.refresh);
    this.refresh = null;
    for (const p of [...this.peers.values()]) this.closePeer(p);
    this.users = [];
    this.iceServers = [];
    this.blocked = false;
    if (id)
      this.request('room.voice.leave', {}, id, room).catch(() => {});
    this.changed();
  }

  onIce(m) {
    if (!this.accept(m) || !Array.isArray(m.iceServers)) return;
    this.iceServers = m.iceServers;
    for (const p of this.peers.values()) {
      p.pc.setConfiguration({ iceServers: this.iceServers });
      if (p.offerer) this.restart(p);
    }
    clearTimeout(this.refresh);
    const id = this.id;
    this.refresh = setTimeout(() => {
      if (this.id === id)
        this.request('room.voice.ice').catch(() => {});
    }, 3300000);
  }

  onState(m) {
    if (!this.accept(m) || !Array.isArray(m.users)) return;
    this.users = m.users;
    this.joined = true;
    this.reconcile();
    this.changed();
  }

  reconcile() {
    if (!this.joined) return;
    const others = this.users.filter(
      u => u.playerId !== this.room.playerId,
    );
    for (const p of [...this.peers.values()])
      if (!others.some(
        u => u.playerId === p.playerId && u.id === p.id,
      )) this.closePeer(p);

    for (const user of others)
      if (!this.peers.has(user.playerId)) {
        try {
          this.addPeer(user);
        } catch (e) {
          this.error = e.message;
          this.changed();
        }
      }
  }

  addPeer(user) {
    const pc = new this.PC({ iceServers: this.iceServers });
    const a = this.audio();
    a.setAttribute('playsinline', '');
    a.hidden = true;

    const p = {
      pc, audio: a,
      playerId: user.playerId, id: user.id, session: this.id,
      offerer: this.room.playerId < user.playerId,
      queue: Promise.resolve(), tracks: Promise.resolve(),
      candidates: [], incoming: [], timer: null, lastRestart: 0,
    };
    this.peers.set(p.playerId, p);

    // 接收邀请的一端复用远端提供的 transceiver。
    p.sender = null;
    if (p.offerer) {
      p.sender = pc.addTransceiver(
        'audio', { direction: 'sendrecv' },
      ).sender;
      this.replace(
        p, this.stream?.getAudioTracks()[0] || null,
      ).catch(() => {});
    }

    pc.onnegotiationneeded = () => {
      if (p.offerer) this.enqueue(p, () => this.offer(p));
    };

    pc.onicecandidate = e => {
      if (this.peers.get(p.playerId) !== p) return;
      p.candidates.push(e.candidate ? e.candidate.toJSON() : null);
      if (!p.timer)
        p.timer = setTimeout(() => this.flush(p), 100);
    };

    pc.ontrack = e => {
      if (this.peers.get(p.playerId) !== p) return;
      a.srcObject = e.streams[0] || new MediaStream([e.track]);
      a.play().catch(() => {
        if (this.peers.get(p.playerId) === p) {
          this.blocked = true;
          this.changed();
        }
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        if (p.offerer) this.restart(p);
        else this.signal(p, { restart: true });
      }
      this.changed();
    };
  }

  closePeer(p) {
    this.peers.delete(p.playerId);
    clearTimeout(p.timer);
    p.pc.ontrack = p.pc.onicecandidate =
      p.pc.onnegotiationneeded =
      p.pc.onconnectionstatechange = null;
    p.pc.close();
    p.audio.pause();
    p.audio.srcObject = null;
    p.audio.remove();
  }

  enqueue(p, fn) {
    p.queue = p.queue.catch(() => {}).then(async () => {
      if (this.peers.get(p.playerId) === p && p.session === this.id)
        await fn();
    }).catch(e => {
      if (this.peers.get(p.playerId) === p) {
        this.error = '语音连接失败：' + e.message;
        this.changed();
      }
    });
    return p.queue;
  }

  signal(p, data) {
    if (this.peers.get(p.playerId) !== p || p.session !== this.id)
      return Promise.resolve();
    return this.request('room.voice.signal', {
      to: p.playerId, toId: p.id, data: JSON.stringify(data),
    }).catch(e => {
      if (this.peers.get(p.playerId) === p) {
        this.error = e.message;
        this.changed();
      }
    });
  }

  async offer(p, restart = false) {
    if (p.pc.signalingState !== 'stable') return;
    await p.pc.setLocalDescription(
      await p.pc.createOffer({ iceRestart: restart }),
    );
    await this.signal(p, {
      description: {
        type: p.pc.localDescription.type,
        sdp: p.pc.localDescription.sdp,
      },
    });
  }

  restart(p) {
    const now = Date.now();
    if (now - p.lastRestart < 5000) return;
    p.lastRestart = now;
    this.enqueue(p, () => this.offer(p, true));
  }

  flush(p) {
    p.timer = null;
    if (this.peers.get(p.playerId) !== p) return;
    if (p.candidates.length)
      this.signal(p, { candidates: p.candidates.splice(0, 8) });
    if (p.candidates.length)
      p.timer = setTimeout(() => this.flush(p), 100);
  }

  onSignal(m) {
    if (!this.accept(m)) return;
    const p = this.peers.get(m.from);
    if (!p || p.id !== m.fromId) return;

    this.enqueue(p, async () => {
      const data = m.data;
      if (data.restart) {
        if (p.offerer) this.restart(p);
        return;
      }

      if (data.description) {
        if ((data.description.type === 'offer') === p.offerer)
          return;
        await p.pc.setRemoteDescription(data.description);

        if (data.description.type === 'offer') {
          const t = p.pc.getTransceivers().find(
            t => t.receiver.track.kind === 'audio' && !t.stopped,
          );
          if (!t) throw new Error('缺少音频通道');
          t.direction = 'sendrecv';
          p.sender = t.sender;
          await this.replace(
            p, this.stream?.getAudioTracks()[0] || null,
          );
        }

        for (const c of p.incoming.splice(0))
          await p.pc.addIceCandidate(c);

        if (data.description.type === 'offer') {
          await p.pc.setLocalDescription(
            await p.pc.createAnswer(),
          );
          await this.signal(p, {
            description: {
              type: p.pc.localDescription.type,
              sdp: p.pc.localDescription.sdp,
            },
          });
        }
      } else if (data.candidates) {
        for (const c of data.candidates) {
          if (p.pc.remoteDescription)
            await p.pc.addIceCandidate(c);
          else if (p.incoming.length < 64)
            p.incoming.push(c);
        }
      }
    });
  }

  dispose() {
    this.leave();
    this.off.forEach(fn => fn());
  }
}
