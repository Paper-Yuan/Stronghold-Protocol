// End-to-end smoke: connect like the browser, hello, then create a solo_infinite room.
// Proves the three console errors' paths: protocol accepts the mode, the server builds the room.
import WebSocket from 'ws';

const url = `ws://127.0.0.1:${process.env.PORT || 3000}/ws`;
const ws = new WebSocket(url);
let rid = 0;
const pending = new Map();

function send(t, fields = {}) {
  const id = ++rid;
  ws.send(JSON.stringify({ t, rid: id, ...fields }));
  return new Promise((resolve) => pending.set(id, resolve));
}

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.rid && pending.has(msg.rid)) {
    const done = pending.get(msg.rid);
    pending.delete(msg.rid);
    done(msg);
  }
});

ws.on('open', async () => {
  const hello = await send('hello', { name: 'smoke-test' });
  console.log('hello:', hello.t, '| playerId:', hello.playerId ? 'yes' : 'no');

  const create = await send('room.create', { mode: 'solo_infinite', difficulty: 'ABYSS' });
  if (create.t === 'ok') {
    console.log('room.create solo_infinite: OK');
  } else {
    console.log('room.create solo_infinite: FAILED ->', create.t, create.code || '', create.detail || '');
  }

  const plain = await send('room.create', { mode: 'solo', difficulty: 'NORMAL' });
  console.log('room.create plain solo:', plain.t === 'ok' ? 'OK' : `FAILED -> ${plain.t} ${plain.code || ''}`);

  const bad = await send('room.create', { mode: 'not_a_mode', difficulty: 'NORMAL' });
  console.log('room.create invalid mode refused:', bad.t !== 'ok' ? 'yes' : 'NO (should refuse)');

  ws.close();
  process.exit(create.t === 'ok' && plain.t === 'ok' ? 0 : 1);
});

ws.on('error', (e) => { console.log('socket error:', e.message); process.exit(1); });
setTimeout(() => { console.log('timeout'); process.exit(1); }, 20000);
