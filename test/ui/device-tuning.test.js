// test/ui/device-tuning.test.js — 机型渲染策略（业主 2026-10-26）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDeviceTuning, resolveTuning } from '../../public/js/ui/deviceTuning.js';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../../public/js/ui/gameLogic/settings.js';

const HONOR_OLD = 'Mozilla/5.0 (Linux; Android 10; HONOR V30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.104 Mobile Safari/537.36';
const HONOR_NEW = 'Mozilla/5.0 (Linux; Android 14; HONOR MAA-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const XIAOMI_DIM = 'Mozilla/5.0 (Linux; Android 13; 2211133C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const XIAOMI_SNAP = 'Mozilla/5.0 (Linux; Android 13; Xiaomi 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

test('荣耀 + 旧内核/Mali：低画质、1 倍像素、关 MSAA、30 帧，不禁 WebGL2', () => {
  const t = detectDeviceTuning({ ua: HONOR_OLD, gpu: 'mali-g76', webgl2: 'slow' });
  assert.equal(t.family, 'honor');
  assert.equal(t.quality, 'low');
  assert.equal(t.maxPixelRatio, 1);
  assert.equal(t.antialias, false);
  assert.equal(t.frameCap, 30);
  assert.equal(t.force2d, false, '荣耀也只能降档，不能整屏黑');
  assert.ok(t.reasons.includes('honor-old-chromium'));
});

test('荣耀 + 新内核 + 非 Mali：保持高画质', () => {
  const t = detectDeviceTuning({ ua: HONOR_NEW, gpu: 'adreno (tm) 740', webgl2: 'ok' });
  assert.equal(t.quality, 'high');
  assert.equal(t.maxPixelRatio, 2);
  assert.equal(t.antialias, true);
  assert.ok(t.reasons.includes('honor-modern'));
});

test('小米/红米 + 天玑（Mali）：中画质、1.25 倍、关 MSAA、45 帧', () => {
  const t = detectDeviceTuning({ ua: `${XIAOMI_DIM} Dimensity`, gpu: 'mali-g77', webgl2: 'slow' });
  assert.equal(t.family, 'xiaomi');
  assert.equal(t.quality, 'medium');
  assert.equal(t.maxPixelRatio, 1.25);
  assert.equal(t.antialias, false);
  assert.equal(t.frameCap, 45);
  assert.ok(t.reasons.includes('xiaomi-dimensity'));
});

test('小米 + 骁龙（Adreno）：不降档', () => {
  const t = detectDeviceTuning({ ua: XIAOMI_SNAP, gpu: 'adreno (tm) 740', webgl2: 'ok' });
  assert.equal(t.family, 'xiaomi');
  assert.equal(t.quality, 'high');
  assert.equal(t.maxPixelRatio, 2);
});

test('小米 + GPU 未知（WebView 屏蔽 renderer）：保守取中档', () => {
  const t = detectDeviceTuning({ ua: XIAOMI_SNAP, gpu: '', webgl2: 'ok' });
  assert.equal(t.family, 'xiaomi');
  assert.equal(t.quality, 'medium');
  assert.equal(t.maxPixelRatio, 1.5);
  assert.equal(t.frameCap, 45);
  assert.ok(t.reasons.includes('xiaomi-gpu-unknown'));
});

test('只有真的拿不到 WebGL2 才 force2d', () => {
  const t = detectDeviceTuning({ ua: XIAOMI_SNAP, gpu: '', webgl2: 'none' });
  assert.equal(t.force2d, true);
  assert.ok(t.reasons.includes('webgl2-unavailable'));
});

test('webgl2 被标 caveat（slow）：不再抬高像素比，只压不升', () => {
  const honor = detectDeviceTuning({ ua: HONOR_NEW, gpu: 'mali-g610', webgl2: 'slow' });
  assert.equal(honor.quality, 'low');
  assert.equal(honor.maxPixelRatio, 1, '荣耀 Mali 已经是 1，caveat 不能把它抬回 1.5');
  assert.ok(honor.reasons.includes('webgl2-caveat'));
  const other = detectDeviceTuning({ ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) Chrome/120.0.0.0', gpu: 'adreno 730', webgl2: 'slow' });
  assert.equal(other.quality, 'medium');
  assert.equal(other.maxPixelRatio, 1.5);
});

test('用户覆盖：smooth 强制最低档，hd 强制最高档', () => {
  const base = detectDeviceTuning({ ua: XIAOMI_DIM, gpu: 'mali-g77', webgl2: 'slow' });
  const smooth = resolveTuning(base, 'smooth');
  assert.equal(smooth.quality, 'low');
  assert.equal(smooth.maxPixelRatio, 1);
  assert.equal(smooth.frameCap, 30);
  const hd = resolveTuning(base, 'hd');
  assert.equal(hd.quality, 'high');
  assert.equal(hd.maxPixelRatio, 2);
  assert.equal(hd.force2d, false, '用户选高清时不该被 force2d 拦住');
  assert.equal(resolveTuning(base, 'auto'), base);
});

test('设置：compatMode 默认 auto、非法值回落、合法值保留', () => {
  assert.equal(DEFAULT_SETTINGS.compatMode, 'auto');
  assert.equal(sanitizeSettings({}).compatMode, 'auto');
  assert.equal(sanitizeSettings({ compatMode: 'smooth' }).compatMode, 'smooth');
  assert.equal(sanitizeSettings({ compatMode: 'hd' }).compatMode, 'hd');
  assert.equal(sanitizeSettings({ compatMode: 'ultra' }).compatMode, 'auto');
});
