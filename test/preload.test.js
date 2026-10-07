// test/preload.test.js — Test for Client Preload Engine and Asset Extraction
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preloadEngine, PreloadPill, PreloadModal } from '../public/js/ui/preloadModal.js';

test('preload engine initialization and state', () => {
  assert.ok(preloadEngine, 'preloadEngine is exported');
  assert.equal(typeof PreloadPill, 'function', 'PreloadPill is a component');
  assert.equal(typeof PreloadModal, 'function', 'PreloadModal is a component');
  assert.equal(preloadEngine.status, 'idle');
  assert.ok(preloadEngine.cachedProfiles);
});

test('preload engine subscription', () => {
  let called = false;
  const unsub = preloadEngine.subscribe(() => { called = true; });
  preloadEngine.notify();
  assert.equal(called, true);
  unsub();
});
