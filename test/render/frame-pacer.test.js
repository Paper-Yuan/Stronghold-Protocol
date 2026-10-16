import assert from 'node:assert/strict';
import test from 'node:test';

class FramePacer {
  constructor(target = '60') {
    this.targetFps = String(target || '60');
    this.intervals = [];
    this.lastTs = 0;
    this.lastPicture = 0;
    this.next = 0;
  }
  setTarget(target) {
    this.targetFps = String(target || '60');
    this.lastPicture = 0;
    this.next = 0;
  }
  shouldDraw(ts) {
    if (this.targetFps === 'screen' || this.targetFps === '0') {
      this.lastPicture = ts;
      return true;
    }
    const targetFpsNum = Number(this.targetFps) || 60;
    const I = 1000 / targetFpsNum;

    if (this.lastTs > 0) {
      const dt = ts - this.lastTs;
      if (dt >= 1 && dt <= 100) {
        this.intervals.push(dt);
        if (this.intervals.length > 21) this.intervals.shift();
      }
    }
    this.lastTs = ts;

    if (this.intervals.length < 5) {
      this.lastPicture = ts;
      this.next = ts + I;
      return true;
    }

    const sorted = [...this.intervals].sort((a, b) => a - b);
    const P = sorted[Math.floor(sorted.length / 2)];
    const r = I / P;

    if (!this.lastPicture || (ts - this.lastPicture) > (I * 1.8)) {
      this.lastPicture = ts;
      this.next = ts + I;
      return true;
    }

    let draw = false;
    if (r <= 1.06) {
      draw = true;
    } else if (Math.abs(r - Math.round(r)) <= 0.06) {
      if (ts - this.lastPicture >= (Math.round(r) - 0.5) * P) {
        draw = true;
      }
    } else {
      const tau = Math.min(P, I) / 2;
      if (ts >= this.next - tau) {
        draw = true;
        this.next = Math.max(this.next + I, ts + I - tau);
      }
    }

    if (draw) this.lastPicture = ts;
    return draw;
  }
}

test('FramePacer on 120Hz display locked to 60fps steady state', () => {
  const pacer = new FramePacer('60');
  const step = 1000 / 120; // 8.333ms
  let t = 0;
  for (let i = 0; i < 60; i++) { t += step; pacer.shouldDraw(t); } // warmup
  let drawn = 0;
  for (let i = 0; i < 120 * 5; i++) {
    t += step;
    if (pacer.shouldDraw(t)) drawn++;
  }
  const fps = drawn / 5;
  assert.equal(fps, 60.0);
});

test('FramePacer on 144Hz display locked to 60fps steady state', () => {
  const pacer = new FramePacer('60');
  const step = 1000 / 144; // ~6.944ms
  let t = 0;
  for (let i = 0; i < 72; i++) { t += step; pacer.shouldDraw(t); } // warmup
  let drawn = 0;
  for (let i = 0; i < 144 * 5; i++) {
    t += step;
    if (pacer.shouldDraw(t)) drawn++;
  }
  const fps = drawn / 5;
  assert.equal(fps, 60.0);
});

test('FramePacer on 100Hz display locked to 60fps steady state', () => {
  const pacer = new FramePacer('60');
  const step = 1000 / 100;
  let t = 0;
  for (let i = 0; i < 50; i++) { t += step; pacer.shouldDraw(t); } // warmup
  let drawn = 0;
  for (let i = 0; i < 100 * 5; i++) {
    t += step;
    if (pacer.shouldDraw(t)) drawn++;
  }
  const fps = drawn / 5;
  assert.equal(fps, 60.0);
});

test('FramePacer locked to 30fps steady state', () => {
  const pacer = new FramePacer('30');
  const step = 1000 / 60; // 60Hz 屏幕
  let t = 0;
  for (let i = 0; i < 30; i++) { t += step; pacer.shouldDraw(t); } // warmup
  let drawn = 0;
  for (let i = 0; i < 60 * 5; i++) {
    t += step;
    if (pacer.shouldDraw(t)) drawn++;
  }
  const fps = drawn / 5;
  assert.equal(fps, 30.0);
});

test('FramePacer screen mode draws every frame', () => {
  const pacer = new FramePacer('screen');
  const step = 1000 / 144;
  let drawn = 0;
  let t = 0;
  for (let i = 0; i < 100; i++) {
    t += step;
    if (pacer.shouldDraw(t)) drawn++;
  }
  assert.equal(drawn, 100);
});

test('AdaptLoad threshold shift', () => {
  const getThresholds = (fps) => {
    const targetFpsNum = Number(fps) || 60;
    const I = (fps === 'screen' || fps === '0') ? (1000 / 60) : (1000 / targetFpsNum);
    const shift = Math.max(0, I - 1000 / 60);
    return { slowAt: 19.5 + shift, fastAt: 17.6 + shift };
  };
  const th60 = getThresholds('60');
  assert.equal(th60.slowAt, 19.5);
  assert.equal(th60.fastAt, 17.6);

  const th30 = getThresholds('30');
  assert.ok(Math.abs(th30.slowAt - 36.16) < 0.1);
  assert.ok(Math.abs(th30.fastAt - 34.26) < 0.1);
});
