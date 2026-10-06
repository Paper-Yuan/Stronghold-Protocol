# feat: 120 Hz display mode, notch padding slider, rotating file logs

## Motivation

Three device-adaptation gaps reported from real phones (ColorOS in particular):

1. **OEM skins park the app at 60 Hz.** The game is a PixiJS/Three.js WebView that renders at
   whatever refresh rate the platform grants. Many OEM skins (ColorOS included) keep third-party
   apps on a 60 Hz display mode unless the app explicitly opts in, so 120 Hz panels never leave
   60 fps. `preferredDisplayModeId` is the sanctioned opt-in, and a user toggle is needed because
   pinning the highest mode costs battery.
2. **Irregular screens (notches / punch-holes).** The shell already renders edge-to-edge in
   landscape (`LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`), so on cutout devices part of the game
   UI sits under the camera cutout. Players need a way to pull the UI in from both sides, tuned
   per device — a fixed inset cannot fit every panel.
3. **Logcat is not reliable evidence on OEM skins.** Several OEM ROMs filter or drop third-party
   logcat output, so "it works in my logcat" is not a usable bug report. Durable, shareable file
   logs are the source of truth: they survive the process, capture server stdout and WebView
   events in one place, and can be exported with a share sheet.

## What changed

### New files

| File | Purpose |
| --- | --- |
| `android/app/src/main/java/com/paper/stronghold/DisplayHelper.kt` | Picks the highest-refresh supported display mode that matches the current resolution and pins it via `WindowManager.LayoutParams.preferredDisplayModeId`. With the toggle off it picks the supported mode closest to 60 Hz (battery friendly). Guards every call: the window is only touched when the target `modeId` differs from the currently pinned one, so repeated calls from `onCreate` / `onWindowFocusChanged` are cheap. |
| `android/app/src/main/java/com/paper/stronghold/FileLogger.kt` | Rotating file logger. Appends timestamped `[LEVEL/tag]` lines to `getExternalFilesDir(null)/logs/debug.log` (internal `filesDir/logs` fallback), rotates at 2 MB keeping 3 generations (`debug.log`, `debug-1.log`, `debug-2.log`). Thread safety: all writes go through a single-thread executor; failures are swallowed (logging must never crash the app). Every write also mirrors to logcat, so existing `adb logcat` workflows keep working. Exposes `tail()` for the diagnostics dialog and `share()` for the export sheet. |
| `android/app/src/main/res/xml/file_paths.xml` | FileProvider path declarations: `files-path` and `external-files-path` entries for the `logs/` directory (the external one matches where `FileLogger` writes; the internal one covers the fallback location). |

### Modified files

| File | Change |
| --- | --- |
| `android/app/src/main/java/com/paper/stronghold/MainActivity.kt` | - `onCreate`: initializes `FileLogger`, applies the persisted high-refresh mode, and applies the persisted edge padding.<br>- `onWindowFocusChanged`: re-asserts the high-refresh mode after focus changes (guarded by `DisplayHelper`, no-op when unchanged).<br>- Connection chooser (`showServerSwitchDialog`, which is also the first-run launcher): wires the new `SwitchCompat` 120 Hz toggle (persists `high_refresh`, default `true`) and the `SeekBar` edge-padding slider (persists `edge_padding_px`, 0–200) with a live preview: while sliding, the WebView and the loading/error dashboard behind the dialog pull in from both sides.<br>- Applies the persisted padding as LEFT+RIGHT margins on the WebView via `ViewGroup.MarginLayoutParams` (`applyEdgePadding`).<br>- Routes key events into `FileLogger` without touching existing behavior: server start / ready / failed / exited, asset-extraction failures, WebView page finished / main-frame errors / renderer gone, game console output, chooser + diagnostics dialog decisions, activity lifecycle. |
| `android/app/src/main/java/com/paper/stronghold/NodeServerService.kt` | `addLog` (the in-memory ring feeding `AndroidBridge.getLogs()`) now also mirrors each line into `FileLogger`, so the shareable `debug.log` carries embedded-node stdout too. The ring itself is unchanged — `getLogs()` keeps working as before. |
| `android/app/src/main/AndroidManifest.xml` | Adds an exported=false `FileProvider` (authority `${applicationId}.logs`, i.e. correct for both release and the `.debug` build suffix) backed by `@xml/file_paths`. |
| `android/app/src/main/res/layout/dialog_server_switch.xml` | Adds the 120 Hz `SwitchCompat` row, the edge-padding label and `SeekBar` (max 200) below the board-quality block. Visible in every mode of the chooser, including the first-run launcher. |
| `android/app/src/main/res/layout/dialog_server_logs.xml` | Adds a「分享日志」button to the diagnostics dialog button row. |
| `android/app/src/main/res/values/strings.xml` | Adds `high_refresh_toggle`（120Hz 高刷新率（关闭可省电））, `edge_padding_label`（异形屏适配：UI 距两侧各 %1$d px（刘海/打孔屏横屏使用）） and `share_logs`（分享日志）. |

### Behavior notes

- `AndroidBridge.getLogs()` and the in-memory ring (`NodeServerService.serverLogs`) are untouched.
- The diagnostics dialog (`AndroidBridge.showLogs()` → `showLogsAndDiagnosticsDialog`) now shows the
  in-memory ring **plus** the tail of `files/logs/debug.log` (falls back to the legacy
  `filesDir/server.log` view when both are empty).
- 「分享日志」 sends every `debug*.log` generation via `ACTION_SEND_MULTIPLE` with
  `FLAG_GRANT_READ_URI_PERMISSION`; if nothing has been logged yet it toasts「暂无日志」.
- Chinese appears only in user-facing strings; code comments, this document and the commit message
  are in English.

## Verification

No CI runs gradle for the Android shell; verify on a device/emulator (`arm64-v8a`, API 24+):
`./gradlew :app:assembleDebug`, install, then:

1. **120 Hz mode**
   - On a 120 Hz device (e.g. ColorOS phone parked at 60 Hz): launch the app → the connection
     chooser shows「120Hz 高刷新率（关闭可省电）」checked by default.
   - Enable "Show refresh rate" in Developer options: the overlay should read ≥90/120 Hz while the
     app is foreground.
   - Toggle it off: the mode falls back to ~60 Hz; toggle back on and it returns. Kill and relaunch:
     the choice persists.
2. **Edge padding**
   - In the chooser, drag the slider under「异形屏适配：UI 距两侧各 N px…」: the label updates and the
     launcher UI behind the dialog shrinks in from both sides live.
   - Release the slider → toast confirms; enter the game → the WebView content is inset N px from
     each side. Rotate/re-focus and reopen the chooser: the persisted value is still selected.
   - Set it back to 0: margins return to full width.
3. **File logs**
   - Play a round (local server start → ready → page load), then open 诊断与日志: the log area shows
     the in-memory ring followed by「---- 文件日志 files/logs/debug.log（末尾）----」with matching
     events (server start/ready, page finished, chooser decisions).
   - Confirm `adb shell ls /sdcard/Android/data/<applicationId>/files/logs/` contains `debug.log`
     (≤2 MB; generate more logs to see `debug-1.log` rotation).
   - Tap 分享日志: a share sheet offers the log files; e.g. share to Drive and confirm the file
     content is readable (FileProvider grant works).
   - Stop the local server intentionally (e.g. wrong state) and confirm the failure reason appears
     both in the dialog and in `debug.log`.
