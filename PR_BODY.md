# fix: robust health checks, port fallback, deterministic exit, server reuse

## Motivation

While testing the Android client on a **OnePlus Ace 5 (Android 16, ColorOS)**, four reliability problems showed up around the embedded Node.js server (`NodeServerService`, an in-process Node runtime loaded via JNA):

1. **A live server looked dead under VPN.** The health probe only ever requested `http://127.0.0.1:3000/healthz`. With a VPN/TUN profile active, plain-http loopback traffic can be intercepted by the tunnel, so the probe never reached the healthy embedded server. The app then reported "服务启动超时" (startup timeout) even though the server was up, and every retry failed the same way.

2. **Startup failed outright when port 3000 was squatted.** The service hard-coded `setenv("PORT", "3000")` and assumed the bind would succeed. On the ColorOS test image something on the system already occupies loopback 3000, so the embedded server never came up and there was no fallback — startup was simply broken on that device.

3. **Swiping the app away left a zombie server.** The foreground service keeps Node *inside* the app process; when the user swiped the task away, the process (and the listening server) survived. The stale process kept its port bound, so an immediate relaunch could not start a fresh server — the classic "works again after a minute, or after reboot" symptom.

4. **Re-entering the game was slow or failed.** After backing out of the game (activity finished, foreground service kept running), picking 本机单人 again tried to boot a *second* server instead of reusing the healthy one that was still live, and could land on a different port and present it as a connection failure.

## What changed

### `NodeServerService.kt`

- **Multi-address health check.** New `healthCandidates()` returns `127.0.0.1` plus every non-loopback IPv4 of the device (via `NetworkInterface`); `firstHealthyAddress()` probes each candidate's `/healthz` and succeeds as soon as **any** address answers `ok:true`. The startup poller and the instant re-check both use it. Health clients also pin `Proxy.NO_PROXY` so a VPN/system proxy cannot divert the probes into a tunnel.
- **Port fallback.** New `pickFreePort()` walks up from the configured port (3000) and returns the first port a `ServerSocket` with `SO_REUSEADDR` can bind, then `setenv("PORT", …)` is called **before** node starts. A `[BOOT] … falling back` line lands in the server log when the port moves.
- **Port surfaced.** `ACTION_SERVER_READY` (broadcast + `stateListener`) now carries the committed `port` extra, and the ready notification shows `本地服务已就绪 · 端口 N`.
- **Deterministic exit.** `onTaskRemoved()` now stops the foreground service, calls `stopSelf()`, and finishes with `Process.killProcess(Process.myPid())`, so a swipe kills the whole process and releases the port. (`onStartCommand` already returned `START_NOT_STICKY`; this commit adds the missing process teardown.)

### `MainActivity.kt`

- **Fast re-entry.** The local-server flow (`startLocalFlow`) now first probes the port the runtime actually committed to (`NodeServerService.committedPort`) across all candidate addresses; if a healthy server is already running, the WebView navigates straight into it and asset extraction / service start are skipped.
- **No hardcoded 3000 left in the UI paths.** `handleServerReady(port)`, the `SERVER_READY` receiver/listener, the self-healing `onResume` probe, the diagnostics health check, the LAN-address hints, and the `reloadWebView` fallback all use the committed port. Remote-host flows (`填地址连接`, LAN scan) are untouched.

The JNA/OkHttp architecture is unchanged — these are surgical fixes on top of it.

## Verification

On a OnePlus Ace 5 (Android 16 / ColorOS), debug build installed via Android Studio:

1. **Normal start:** launch the app → 本机单人. Expect the log to show the server port, `[READY] Local game server running at http://… (ok:true)`, and the notification `本地服务已就绪 · 端口 3000` (or a fallback port).
2. **Port fallback:** with the ColorOS squatter holding 3000, expect `[BOOT] Port 3000 is occupied — falling back to 3001` (or next free), the server healthy on 3001, and the loading status / diagnostics / LAN hint showing port 3001.
3. **VPN interception:** enable a VPN app, back out, re-enter via 本机单人. Expect the app to detect the live server (via the LAN IPv4 candidate) instead of timing out.
4. **Deterministic exit:** swipe the app from Recents, then immediately relaunch and start 本机单人. Expect an immediate clean start on the configured port — no "port busy", no stale server.
5. **Fast re-entry:** back out of the game (service still foregrounded), relaunch and pick 本机单人. Expect "检测到本地服务仍在运行，直接进入" and instant entry into the running server.
6. **Diagnostics:** 诊断与日志 → expect the status line to name the address that answered and the committed port.
