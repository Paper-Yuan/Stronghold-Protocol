package com.paper.stronghold

import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

class AndroidBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun isNativeApp(): Boolean = true

    @JavascriptInterface
    fun getAppVersion(): String = BuildConfig.VERSION_NAME

    /** This device's LAN address, so the page can label the room it is hosting itself. */
    @JavascriptInterface
    fun getLocalIp(): String = NetworkUtils.getLocalIpAddress(activity)

    /** Join a room hosted by another phone found by [findRoom]. */
    @JavascriptInterface
    fun connectToHost(ip: String, room: String) {
        activity.connectToHost(ip, room)
    }

    /**
     * Ask the local network which machine hosts the room [room], so the guest only ever types the key. Results come
     * back on `window.__onRoomFound(json)`. Asynchronous for the same reason as [scanLanHosts].
     */
    @JavascriptInterface
    fun findRoom(room: String) {
        val own = NetworkUtils.lanAddresses(activity)
        Thread {
            val hosts = NetworkUtils.findRoom(own, room)
            val arr = JSONArray()
            for (h in hosts) {
                arr.put(JSONObject().put("ip", h.ip).put("app", h.app).put("humans", h.rooms).put("self", h.self))
            }
            activity.deliverRoomFound(arr.toString())
        }.start()
    }

    @JavascriptInterface
    fun openServerSettings() {
        activity.runOnUiThread {
            activity.showServerSwitchDialog()
        }
    }

    @JavascriptInterface
    fun restartLocalServer() {
        activity.runOnUiThread {
            activity.startLocalServer()
        }
    }

    @JavascriptInterface
    fun getLogs(): String {
        return NodeServerService.serverLogs.joinToString("\n")
    }

    /** The shell's own diagnostics sheet: it tails filesDir/server.log, which the page cannot read. */
    @JavascriptInterface
    fun showLogs() {
        activity.runOnUiThread { activity.showLogsAndDiagnosticsDialog() }
    }

    /**
     * The page telling the shell what it can see (main.js reportClientState). A WebView whose surface fails to
     * composite cannot show the player anything, so this has to cross into native land for anyone to notice.
     */
    @JavascriptInterface
    fun reportClientState(json: String) {
        activity.reportClientState(json)
    }

    @JavascriptInterface
    fun getClientState(): String = activity.getClientState()

    /**
     * Switch to the DOM board (no WebGL, no forced hardware layer) and reload. Reachable from the page so a player
     * whose screen is fine but broken can fix it from the in-game settings without waiting for the watchdog dialog.
     */
    @JavascriptInterface
    fun enableCompatMode() {
        activity.runOnUiThread { activity.enableCompatMode() }
    }

    @JavascriptInterface
    fun reloadClient() {
        activity.runOnUiThread {
            activity.reloadWebView()
        }
    }
}
