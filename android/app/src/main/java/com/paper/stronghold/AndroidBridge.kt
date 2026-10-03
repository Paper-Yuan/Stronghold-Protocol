package com.paper.stronghold

import android.webkit.JavascriptInterface

class AndroidBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun isNativeApp(): Boolean = true

    @JavascriptInterface
    fun getAppVersion(): String = "0.1.0"

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

    @JavascriptInterface
    fun reloadClient() {
        activity.runOnUiThread {
            activity.reloadWebView()
        }
    }
}
