// The blank-screen class of reports: "server ready, loading bar gone, then pure black with no message".
//
// A page cannot annotate that failure — anything it draws goes onto the same broken surface — so the shell owns the
// detection and the way out (docs/ANDROID.md §8): the client reports its own state over the bridge, the shell shows a
// native dialog when nothing arrives, and 「兼容模式重启」 reloads without the forced hardware layer and with the DOM
// board. These are static contract checks over that chain; the renderer fallbacks themselves are exercised by
// test/ui/webgl-fallback.e2e.test.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const activity = read('android/app/src/main/java/com/paper/stronghold/MainActivity.kt');
const bridge = read('android/app/src/main/java/com/paper/stronghold/AndroidBridge.kt');
const mainJs = read('public/js/main.js');
const docs = read('docs/ANDROID.md');

describe('no forced hardware layer', () => {
  test('the WebView layer type is opt-in, defaulting to no forced layer', () => {
    assert.match(activity, /KEY_HW_LAYER = "webview_hw_layer"/);
    assert.match(activity, /getBoolean\(KEY_HW_LAYER, false\)/, 'default must be off: forcing it black-screens older OEM GPUs');
    assert.match(activity, /setLayerType\(if \(hwLayer\) View\.LAYER_TYPE_HARDWARE else View\.LAYER_TYPE_NONE, null\)/);
  });
});

describe('the page reports what it can see', () => {
  test('reportClientState crosses into the shell and covers the boot and the error path', () => {
    assert.match(mainJs, /function reportClientState\(extra = \{\}\)/);
    assert.match(mainJs, /typeof native\?\.reportClientState !== 'function'/, 'browsers and older shells have no bridge method');
    assert.match(mainJs, /rootChildren: document\.getElementById\('app'\)\?\.childElementCount/);
    assert.match(mainJs, /webgl2: gl\('webgl2'\), webgl: gl\('webgl'\)/);
    assert.match(mainJs, /globalThis\.__SP__ = \{[^}]*\};\n  reportClientState\(\);/, 'reported once the first render is in');
    assert.match(mainJs, /reportClientState\(\{ error:/, 'an uncaught throw must reach the shell too, not just the console');
  });

  test('the bridge carries it across', () => {
    assert.match(bridge, /@JavascriptInterface\r?\n    fun reportClientState\(json: String\) \{/);
    assert.match(bridge, /@JavascriptInterface\r?\n    fun getClientState\(\): String = activity\.getClientState\(\)/);
  });
});

describe('the shell notices a black screen with a native dialog', () => {
  test('a page that finishes loading but never reports triggers the watchdog', () => {
    assert.match(activity, /BLANK_SCREEN_WATCHDOG_MS = 12_000L/);
    assert.match(activity, /layoutFailedActions\.visibility = View\.GONE\r?\n                scheduleBlankScreenWatchdog\(\)/);
    assert.match(activity, /if \(isFinishing \|\| clientState != null\) return@Runnable/);
    assert.match(activity, /mainHandler\.postDelayed\(watchdog, BLANK_SCREEN_WATCHDOG_MS\)/);
    assert.match(activity, /override fun onDestroy\(\) \{\r?\n *super\.onDestroy\(\)\r?\n *cancelBlankScreenWatchdog\(\)/, 'no dialog after the activity is gone');
  });

  test('the dialog is native and offers a way out, not just a message', () => {
    assert.match(activity, /private fun showBlankScreenDialog\(\) \{[\s\S]{0,220}AlertDialog\.Builder\(this\)/);
    assert.match(activity, /setTitle\("画面可能没有出来"\)/);
    assert.match(activity, /setPositiveButton\("兼容模式重启"\) \{ _, _ -> enableCompatModeAndReload\(\) \}/);
    assert.match(activity, /setNeutralButton\("查看日志"\) \{ _, _ -> showLogsAndDiagnosticsDialog\(\) \}/);
    assert.match(activity, /WebView\.getCurrentWebViewPackage\(\)\?\.versionName/, 'the WebView build is the number we need from the reporter');
  });

  test('compat mode flips every switch that can cause it and reloads', () => {
    assert.match(activity, /\.putBoolean\(KEY_COMPAT_MODE, true\)[\s\S]{0,120}\.putBoolean\(KEY_HW_LAYER, false\)[\s\S]{0,120}\.putString\(KEY_BOARD_MODE, "2d"\)/);
    assert.match(activity, /if \(prefs\.getBoolean\(KEY_COMPAT_MODE, false\)\) url = withParam\(url, "render", "fallback"\)/);
    assert.match(activity, /reloadWebView\(\)\r?\n    \}/);
  });

  test('a new page load clears the previous report so the watchdog can arm again', () => {
    assert.match(activity, /val targetUrl = buildUrlWithBoardMode\(rawUrl\)\r?\n        clientState = null/);
  });
});

describe('the launcher warns before an outdated WebView', () => {
  test('the chooser subtitle carries the warning when the major version is below the floor', () => {
    assert.match(activity, /MIN_WEBVIEW_CHROME = 87/);
    assert.match(activity, /if \(major >= MIN_WEBVIEW_CHROME\) return null/);
    assert.match(activity, /val webviewWarning = outdatedWebViewWarning\(\)/);
    assert.match(activity, /if \(webviewWarning != null\) append\("\\n⚠ "\)\.append\(webviewWarning\)/);
    assert.match(activity, /低于本游戏所需的 \$MIN_WEBVIEW_CHROME/);
  });

  test('compat mode is reachable from the page, not only from the watchdog dialog', () => {
    assert.match(bridge, /@JavascriptInterface\r?\n    fun enableCompatMode\(\) \{/);
    assert.match(bridge, /activity\.runOnUiThread \{ activity\.enableCompatMode\(\) \}/);
  });
});

describe('documented', () => {
  test('docs/ANDROID.md §8 records the cause, the report and the escape hatch', () => {
    assert.match(docs, /## 8\. 黑屏排查/);
    assert.match(docs, /webview_hw_layer/);
    assert.match(docs, /reportClientState/);
    assert.match(docs, /\?render=fallback/);
  });
});
