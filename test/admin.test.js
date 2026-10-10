// test/admin.test.js — Tests for Admin Dashboard & Live Monitoring API
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';

test('admin dashboard: authorization, metrics, rooms and ops', async () => {
  const secret = 'test-secret-key-123';
  const srv = await startServer({ port: 0, quiet: true, adminSecret: secret });

  try {
    const baseUrl = `http://127.0.0.1:${srv.port}`;

    // 1. Unauthorized request
    const unauth = await fetch(`${baseUrl}/api/admin/overview`);
    assert.equal(unauth.status, 401, 'missing token returns 401');

    // 2. Authorized overview request
    const auth = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    assert.equal(auth.status, 200);
    const overview = await auth.json();
    assert.equal(overview.version.app, '0.2.2-fusion');
    assert.ok(typeof overview.system.processRssMb === 'number');
    assert.equal(overview.isDraining, false);

    // 3. Rooms listing
    const roomsRes = await fetch(`${baseUrl}/api/admin/rooms`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    assert.equal(roomsRes.status, 200);
    const rooms = await roomsRes.json();
    assert.ok(Array.isArray(rooms));

    // 4. Log streaming
    const logsRes = await fetch(`${baseUrl}/api/admin/logs`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    assert.equal(logsRes.status, 200);
    const logs = await logsRes.json();
    assert.ok(Array.isArray(logs));
    assert.ok(logs.length > 0, 'boot logs should be recorded');

    // 5. Broadcast message
    const bcastRes = await fetch(`${baseUrl}/api/admin/broadcast`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: '测试全服广播' }),
    });
    assert.equal(bcastRes.status, 200);
    const bcast = await bcastRes.json();
    assert.equal(bcast.ok, true);

    // 6. Graceful Drain
    const drainRes = await fetch(`${baseUrl}/api/admin/drain`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    assert.equal(drainRes.status, 200);
    const drain = await drainRes.json();
    assert.equal(drain.draining, true);
    assert.equal(srv.admin.isDraining, true);
    assert.equal(srv.lobby.isDraining, true);

    // 7. Verify /admin route serves HTML
    const adminPage = await fetch(`${baseUrl}/admin`);
    assert.equal(adminPage.status, 200);
    const html = await adminPage.text();
    assert.ok(html.includes('STRONGHOLD ALLIANCE'));
  } finally {
    await srv.close();
  }
});
