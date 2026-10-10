import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalModManager } from '../server/packs.js';

test('GlobalModManager arbitration logic', () => {
  GlobalModManager.masterEnabled = true;
  GlobalModManager.roomPolicy = 'OPTIONAL';
  GlobalModManager.activePacksRegistry.set('fanpack', { version: '1.0.0' });

  // 1. Normal resolution
  const resolved = GlobalModManager.resolveRoomPacks(['fanpack', 'unknown_pack']);
  assert.deepEqual(resolved, ['fanpack']);

  // 2. STRICT_VANILLA enforcement
  GlobalModManager.roomPolicy = 'STRICT_VANILLA';
  assert.deepEqual(GlobalModManager.resolveRoomPacks(['fanpack']), []);

  // 3. FORCE_ALL enforcement
  GlobalModManager.roomPolicy = 'FORCE_ALL';
  assert.deepEqual(GlobalModManager.resolveRoomPacks([]), ['fanpack']);

  // 4. Master switch disabled
  GlobalModManager.masterEnabled = false;
  assert.deepEqual(GlobalModManager.resolveRoomPacks(['fanpack']), []);

  // Reset
  GlobalModManager.masterEnabled = true;
  GlobalModManager.roomPolicy = 'OPTIONAL';
});

test('probeStatus runs non-blocking without throwing', async () => {
  const status = await GlobalModManager.probeStatus();
  assert.equal(typeof status.masterEnabled, 'boolean');
  assert.ok(Array.isArray(status.installedPacks));
});
