import { WebSocket } from 'ws';

async function main() {
  const res = await fetch('http://127.0.0.1:9229/json');
  const targets = await res.json();
  const wsUrl = targets[0]?.webSocketDebuggerUrl;
  if (!wsUrl) {
    console.error('No debugger ws url');
    process.exit(1);
  }

  const ws = new WebSocket(wsUrl);

  const send = (method, params = {}) => new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        ws.off('message', handler);
        resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await new Promise((r) => ws.on('open', r));
  console.log('Connected to V8 Inspector!');

  await send('Debugger.enable');

  // Find server request listener and inspect scopes to get lobby
  const evalRes = await send('Runtime.evaluate', {
    expression: `
(() => {
  const handles = process._getActiveHandles();
  const server = handles.find(h => h && h.constructor && h.constructor.name === 'Server' && h._events && h._events.request);
  return server ? server._events.request : null;
})()
    `,
    returnByValue: false
  });

  const objId = evalRes?.result?.objectId;
  if (!objId) {
    console.error('Could not get server._events.request');
    process.exit(1);
  }

  const props = await send('Runtime.getProperties', {
    objectId: objId,
    ownProperties: false,
    generatePreview: false
  });

  const scopesProp = props.internalProperties?.find(p => p.name === '[[Scopes]]');
  if (!scopesProp) {
    console.error('No [[Scopes]] found');
    process.exit(1);
  }

  const scopes = await send('Runtime.getProperties', {
    objectId: scopesProp.value.objectId,
    ownProperties: true
  });

  let lobbyFound = false;
  for (const s of scopes.result || []) {
    if (!s.value?.objectId) continue;
    const scopeVars = await send('Runtime.getProperties', {
      objectId: s.value.objectId,
      ownProperties: true
    });
    for (const v of scopeVars.result || []) {
      if (v.name === 'lobby') {
        lobbyFound = true;
        console.log('Found lobby in scope! Injecting globalThis.__LOBBY__...');
        await send('Runtime.callFunctionOn', {
          objectId: v.value.objectId,
          functionDeclaration: 'function() { globalThis.__LOBBY__ = this; }'
        });
      }
    }
  }

  if (!lobbyFound) {
    console.error('Lobby variable not found in scopes');
    process.exit(1);
  }

  // Now execute room disposal using globalThis.__LOBBY__
  const testCodes = ['VERH', 'ZBGP', 'PRDT', 'HEHH', 'LYAF', 'ZDDQ', 'SWFW'];
  const cleanRes = await send('Runtime.evaluate', {
    expression: `
(() => {
  const lobby = globalThis.__LOBBY__;
  if (!lobby) return { error: 'No lobby' };
  const codes = ${JSON.stringify(testCodes)};
  const disposed = [];
  for (const c of codes) {
    const room = lobby.rooms.get(c);
    if (room) {
      lobby.disposeRoom(room, 'admin_test_cleanup');
      disposed.push(c);
    }
  }
  // Check remaining rooms count
  return {
    disposed,
    remainingTotal: lobby.rooms.size
  };
})()
    `,
    returnByValue: true
  });

  console.log('Clean result:', cleanRes.result?.value);
  ws.close();
  process.exit(0);
}

main().catch(console.error);
