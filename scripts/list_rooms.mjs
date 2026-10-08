import { WebSocket } from 'ws';

const ws = new WebSocket('ws://127.0.0.1:3000/ws');

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'hello', name: 'Watcher', version: 1 }));
});

ws.on('message', (data) => {
  const m = JSON.parse(data.toString());
  if (m.t === 'welcome') {
    ws.send(JSON.stringify({ t: 'lobby.rooms' }));
  }
  if (m.t === 'lobby.rooms' || m.rooms) {
    console.log('=== ROOMS IN LOBBY ===');
    const rooms = m.rooms || [];
    console.log('Total rooms:', rooms.length);
    for (const r of rooms) {
      console.log(`[Room ${r.code || r.roomCode}] Mode=${r.mode} Host=${r.hostName || r.leader || r.name} State=${r.state || r.phase} Players=${(r.players||[]).length}`);
    }
    process.exit(0);
  }
});

setTimeout(() => {
  console.log('Timeout waiting for rooms');
  process.exit(0);
}, 4000);
