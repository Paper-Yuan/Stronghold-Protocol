package com.paper.stronghold

import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.*
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {
    companion object {
        private const val TAG = "MainActivity"
        private const val PREFS_NAME = "stronghold_prefs"
        private const val KEY_SERVER_MODE = "server_mode" // "local" or "remote"
        private const val KEY_REMOTE_URL = "remote_url"
        private val IP_V4 = Regex("""^\d{1,3}(\.\d{1,3}){3}$""")
        private const val ROOM_CODE_MAX = 8
        private const val KEY_BOARD_MODE = "board_mode"   // "3d" or "2d"
        private const val KEY_HW_LAYER = "webview_hw_layer" // opt-in; forcing it black-screens some OEM GPU drivers
        private const val KEY_COMPAT_MODE = "compat_mode"   // simplified view + 2D + no forced hardware layer
        private const val BLANK_SCREEN_WATCHDOG_MS = 12_000L
        private const val MIN_WEBVIEW_CHROME = 87   // CSS `inset` shorthand; `replaceChildren` needs 86
        private const val KEY_HIGH_REFRESH = "high_refresh"      // true = pin the highest refresh mode (120 Hz+)
        private const val KEY_EDGE_PADDING = "edge_padding_px"   // 0-200 px inset from each side (notch/punch-hole)
        private const val DEFAULT_LOCAL_URL = "http://127.0.0.1:3000"
        private const val DEFAULT_LAN_URL = "http://192.168.10.25:3000"
    }

    private lateinit var webView: WebView
    private lateinit var layoutLoading: LinearLayout
    private lateinit var layoutFailedActions: LinearLayout
    private lateinit var tvLoadingStatus: TextView
    private lateinit var progressLoading: ProgressBar
    private lateinit var btnQuickConnectLan: Button
    private lateinit var btnDirectSettings: Button
    private lateinit var btnRetryConnect: Button
    private lateinit var btnShowDiagLogs: Button

    private var serverReadyReceiver: BroadcastReceiver? = null
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private var blankWatchdog: Runnable? = null

    /** The page's own "this is what I see" report; null means the WebView never said anything at all. */
    @Volatile private var clientState: String? = null

    private val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                runOnUiThread {
                    try {
                        webView.evaluateJavascript("globalThis.__SP__?.audio?.suspend?.()", null)
                    } catch (_: Exception) {}
                }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                runOnUiThread {
                    try {
                        webView.evaluateJavascript("globalThis.__SP__?.audio?.resume?.()", null)
                    } catch (_: Exception) {}
                }
            }
        }
    }

    private fun requestAudioFocus() {
        if (audioManager == null) {
            audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        }
        val am = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (audioFocusRequest == null) {
                val playbackAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
                audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(playbackAttributes)
                    .setAcceptsDelayedFocusGain(true)
                    .setOnAudioFocusChangeListener(audioFocusChangeListener)
                    .build()
            }
            audioFocusRequest?.let { am.requestAudioFocus(it) }
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(
                audioFocusChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            )
        }
    }

    private fun abandonAudioFocus() {
        val am = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { am.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            am.abandonAudioFocus(audioFocusChangeListener)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE)

        FileLogger.init(applicationContext)

        // Cutout support for Android 9+ (display notch edge-to-edge)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                window.attributes.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            } catch (e: Exception) {
                Log.w(TAG, "Failed to set display cutout mode: ${e.message}")
            }
        }

        // Pin the highest refresh mode the panel supports (ColorOS and other OEM skins park
        // apps at 60 Hz unless the app opts in); the toggle falls back to ~60 Hz for battery.
        applyHighRefresh()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
                pm?.addThermalStatusListener { status ->
                    val warm = status >= PowerManager.THERMAL_STATUS_MODERATE
                    FileLogger.i("thermal", "Thermal status changed: $status (throttle=$warm)")
                    runOnUiThread {
                        if (::webView.isInitialized) {
                            webView.evaluateJavascript("globalThis.__SP__?.onThermalThrottle?.($warm)", null)
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Thermal listener init failed: ${e.message}")
            }
        }

        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        layoutLoading = findViewById(R.id.layoutLoading)
        layoutFailedActions = findViewById(R.id.layoutFailedActions)
        tvLoadingStatus = findViewById(R.id.tvLoadingStatus)
        progressLoading = findViewById(R.id.progressLoading)
        btnQuickConnectLan = findViewById(R.id.btnQuickConnectLan)
        btnDirectSettings = findViewById(R.id.btnDirectSettings)
        btnRetryConnect = findViewById(R.id.btnRetryConnect)
        btnShowDiagLogs = findViewById(R.id.btnShowDiagLogs)

        btnDirectSettings.setOnClickListener { showServerSwitchDialog() }
        btnShowDiagLogs.setOnClickListener { showLogsAndDiagnosticsDialog() }
        btnQuickConnectLan.setOnClickListener {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().apply {
                putString(KEY_SERVER_MODE, "local")
                apply()
            }
            startLocalFlow()
        }
        btnRetryConnect.setOnClickListener {
            startStartupFlow()
        }

        // Irregular screens: pull the game UI in from both sides by the persisted amount.
        applyEdgePadding(prefs().getInt(KEY_EDGE_PADDING, 0))

        setupWebView()
        setupServerReceiver()

        // The chooser is the launcher: it also serves as the escape hatch when a stored address
        // stops working, so it shows on every start with the previous choice pre-selected.
        showServerSwitchDialog(asLauncher = true)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        enableFullscreen()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            enableFullscreen()
            // Re-assert the refresh mode after focus changes (the system can switch modes while
            // we are paused); DisplayHelper only touches the window when the mode id differs.
            applyHighRefresh()
        }
    }

    fun prefs() = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun isHighRefresh(): Boolean = prefs().getBoolean(KEY_HIGH_REFRESH, true)

    fun setHighRefresh(enabled: Boolean) {
        prefs().edit().putBoolean(KEY_HIGH_REFRESH, enabled).apply()
        DisplayHelper.apply(window, enabled)
        notifyWebHighRefresh(enabled)
        FileLogger.i("settings", "high refresh = $enabled")
    }

    fun notifyWebHighRefresh(enabled: Boolean) {
        if (::webView.isInitialized) {
            webView.evaluateJavascript("globalThis.__SP__?.updateSettings?.({ highRefresh: $enabled })", null)
        }
    }

    private fun applyHighRefresh() {
        DisplayHelper.apply(window, isHighRefresh())
    }

    /**
     * Irregular-screen padding: distance from each side, in px (0-200). Applies to the WebView
     * (the game UI itself) and to the loading/error dashboard that covers it, so the slider in
     * the chooser previews live while the launcher overlay is still up.
     */
    private fun applyEdgePadding(px: Int) {
        if (!::webView.isInitialized) return
        for (target in listOf(webView, layoutLoading)) {
            (target.layoutParams as? ViewGroup.MarginLayoutParams)?.let { lp ->
                if (lp.leftMargin != px || lp.rightMargin != px) {
                    lp.leftMargin = px
                    lp.rightMargin = px
                    target.layoutParams = lp
                }
            }
        }
    }

    private fun enableFullscreen() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.insetsController?.let { controller ->
                    controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                    controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                }
            } else {
                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                )
            }
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } catch (e: Exception) {
            Log.w(TAG, "Fullscreen setup error: ${e.message}")
        }
    }

    private fun setupWebView() {
        // Forcing a hardware layer on a WebView that hosts WebGL canvases leaves a black surface on several older
        // OEM GPU drivers (Kirin/Mali, Adreno on Android 10): the page is alive and painting, nothing composites, and
        // because the window background is dark the player sees pure black with no message — and the page cannot put
        // one up, since it would be drawn on that same broken surface. So this is opt-in now; the blank-screen
        // watchdog below is what tells the player about it and offers 兼容模式.
        val isCompat = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(KEY_COMPAT_MODE, false)
        val hwLayer = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(KEY_HW_LAYER, false)
        try {
            if (isCompat) {
                webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
            } else {
                webView.setLayerType(if (hwLayer) View.LAYER_TYPE_HARDWARE else View.LAYER_TYPE_NONE, null)
            }
        } catch (e: Exception) {
            Log.w(TAG, "WebView layer type error: ${e.message}")
        }
        webView.setBackgroundColor(0xFF2A2F2E.toInt())

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            allowContentAccess = true
            setSupportZoom(false)
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            textZoom = 100 // Prevent Android system accessibility font scaling from breaking layout
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        webView.addJavascriptInterface(AndroidBridge(this), "AndroidNative")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                consoleMessage?.let {
                    // Mirror game console output into the file log (logcat is filtered on some OEM skins).
                    FileLogger.console(
                        it.messageLevel()?.name,
                        it.message(),
                        "${it.sourceId()}:${it.lineNumber()}"
                    )
                }
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                FileLogger.i("webview", "page finished: $url")
                layoutLoading.visibility = View.GONE
                layoutFailedActions.visibility = View.GONE
                scheduleBlankScreenWatchdog()
                notifyWebHighRefresh(isHighRefresh())
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    FileLogger.e("webview", "main frame error: ${error?.description} (${error?.errorCode}) url=${request.url}")
                    showConnectionError("连接不上这个地址。\n自己开服请改选「本机单人」或「同一 Wi-Fi」；连电脑则确认在同一网络 / 同一加速器房间。")
                }
            }

            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                val didCrash = detail?.didCrash() ?: false
                FileLogger.e("webview", "render process gone, didCrash=$didCrash")
                Log.e(TAG, "WebView render process gone. Did crash: $didCrash")
                runOnUiThread {
                    recoverFromRenderProcessGone()
                }
                return true // Prevent host process from being killed
            }
        }
    }

    private fun recoverFromRenderProcessGone() {
        layoutLoading.visibility = View.VISIBLE
        progressLoading.visibility = View.VISIBLE
        tvLoadingStatus.text = "显存渲染已重置，已切换轻量模式恢复战场…"

        // If crash happened in 3D mode, downgrade to 2D to prevent re-crashing GPU
        val prefs = prefs()
        if (prefs.getString(KEY_BOARD_MODE, "3d") == "3d") {
            prefs.edit().putString(KEY_BOARD_MODE, "2d").apply()
            FileLogger.w("webview", "auto-downgraded board_mode to 2d after render process crash")
        }

        try {
            val parent = webView.parent as? ViewGroup
            parent?.removeView(webView)
            try {
                webView.stopLoading()
                webView.clearHistory()
                webView.removeAllViews()
                webView.destroy()
            } catch (_: Exception) {}

            val newWebView = WebView(this)
            newWebView.id = R.id.webView
            parent?.addView(newWebView, 0, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ))
            webView = newWebView
            applyEdgePadding(prefs.getInt(KEY_EDGE_PADDING, 0))
            setupWebView()
            reloadWebView()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to recover from render process gone", e)
            FileLogger.e("webview", "failed to recreate webview after crash", e)
            showConnectionError("显存崩溃后恢复失败: ${e.message}\n请点击下方按钮重新进入。")
        }
    }

    private fun handleServerReady() {
        val lanIp = NetworkUtils.getLocalIpAddress(this@MainActivity)
        FileLogger.i("server", "local server ready (lan=$lanIp)")
        val statusMsg = if (lanIp != "127.0.0.1") {
            "本地引擎已就绪！\n本机局域网地址: http://$lanIp:3000\n(其他手机填入此地址可联机)"
        } else {
            getString(R.string.server_ready)
        }
        tvLoadingStatus.text = statusMsg
        loadServerUrl(DEFAULT_LOCAL_URL)
    }

    private fun setupServerReceiver() {
        // Direct in-process callback listener (avoids broadcast delivery latency or filters)
        NodeServerService.stateListener = ServerStateListener { action, extras ->
            runOnUiThread {
                when (action) {
                    NodeServerService.ACTION_SERVER_READY -> handleServerReady()
                    NodeServerService.ACTION_SERVER_FAILED -> {
                        val reason = (extras?.get("reason") as? String) ?: "本地引擎未启动"
                        FileLogger.e("server", "local server failed: $reason")
                        showConnectionError("本地独立服务启动失败: $reason\n可点击上方【诊断与日志】查看具体报错，或在设置中切换为连接其他手机/电脑。")
                    }
                    NodeServerService.ACTION_SERVER_EXITED -> {
                        val exitCode = (extras?.get("exitCode") as? Int) ?: -1
                        FileLogger.e("server", "local server exited (code $exitCode)")
                        showConnectionError("本地独立服务已异常退出 (代码: $exitCode)\n可点击上方【诊断与日志】查看崩溃堆栈。")
                    }
                }
            }
        }

        serverReadyReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                when (intent?.action) {
                    NodeServerService.ACTION_SERVER_READY -> {
                        runOnUiThread { handleServerReady() }
                    }
                    NodeServerService.ACTION_SERVER_FAILED -> {
                        val reason = intent.getStringExtra("reason") ?: "本地引擎未启动"
                        runOnUiThread {
                            showConnectionError("本地独立服务启动失败: $reason\n可点击上方【诊断与日志】查看具体报错，或在设置中切换为连接其他手机/电脑。")
                        }
                    }
                    NodeServerService.ACTION_SERVER_EXITED -> {
                        val exitCode = intent.getIntExtra("exitCode", -1)
                        runOnUiThread {
                            showConnectionError("本地独立服务已异常退出 (代码: $exitCode)\n可点击上方【诊断与日志】查看崩溃堆栈。")
                        }
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(NodeServerService.ACTION_SERVER_READY)
            addAction(NodeServerService.ACTION_SERVER_FAILED)
            addAction(NodeServerService.ACTION_SERVER_EXITED)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(serverReadyReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(serverReadyReceiver, filter)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Register receiver error: ${e.message}")
        }
    }

    private fun startStartupFlow() {
        layoutLoading.visibility = View.VISIBLE
        layoutFailedActions.visibility = View.GONE
        progressLoading.visibility = View.VISIBLE

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val mode = prefs.getString(KEY_SERVER_MODE, "local")

        if (mode == "remote") {
            val remoteUrl = prefs.getString(KEY_REMOTE_URL, "")
            if (!remoteUrl.isNullOrBlank()) {
                tvLoadingStatus.text = "正在连接目标服务器: $remoteUrl …"
                loadServerUrl(remoteUrl)
            } else {
                startLocalFlow()
            }
        } else {
            startLocalFlow()
        }
    }

    private fun startLocalFlow() {
        tvLoadingStatus.text = "正在准备本地运行资源…"

        Thread {
            try {
                AssetManagerHelper.ensureAssetsExtracted(this) { msg ->
                    runOnUiThread { tvLoadingStatus.text = msg }
                }
            } catch (t: Throwable) {
                Log.e(TAG, "Asset extraction error", t)
                FileLogger.e("assets", "asset extraction failed", t)
            }

            runOnUiThread {
                startLocalServer()
            }
        }.start()
    }

    fun startLocalServer() {
        tvLoadingStatus.text = getString(R.string.server_starting)
        FileLogger.i("server", "local server start requested")
        try {
            val intent = Intent(this, NodeServerService::class.java).apply {
                action = NodeServerService.ACTION_START
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start NodeServerService: ${e.message}")
            showConnectionError("启动本地后台服务受限: ${e.message}\n请使用电脑服务端局域网直连模式。")
        }
    }

    private fun showConnectionError(msg: String) {
        runOnUiThread {
            progressLoading.visibility = View.GONE
            layoutLoading.visibility = View.VISIBLE
            layoutFailedActions.visibility = View.VISIBLE
            tvLoadingStatus.text = msg
        }
    }

    /**
     * Point the client at another phone's server (found by [AndroidBridge.scanLanHosts]) and open its room. The page
     * cannot switch the shell's server mode itself, so this stays the one entry point for it. Both arguments come from
     * JavaScript, so each is validated before it reaches a URL.
     */
    fun connectToHost(ip: String, room: String) {
        if (!IP_V4.matches(ip)) return
        val code = room.filter { it.isLetterOrDigit() }.uppercase().take(ROOM_CODE_MAX)
        val base = "http://$ip:3000/"
        runOnUiThread {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putString(KEY_SERVER_MODE, "remote")
                .putString(KEY_REMOTE_URL, base)
                .apply()
            loadServerUrl(if (code.isEmpty()) base else "$base?room=$code")
        }
    }

    private fun loadServerUrl(rawUrl: String) {
        val targetUrl = buildUrlWithBoardMode(rawUrl)
        clientState = null
        runOnUiThread {
            Log.i(TAG, "Loading target URL in WebView: $targetUrl")
            webView.loadUrl(targetUrl)
        }
    }

    private fun buildUrlWithBoardMode(baseUrl: String): String {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val boardMode = prefs.getString(KEY_BOARD_MODE, "3d") ?: "3d"
        var url = withParam(baseUrl, "board", boardMode)
        // Compat mode asks the client for the DOM board (ui/fieldHost.js reads ?render=), which needs no WebGL.
        if (prefs.getBoolean(KEY_COMPAT_MODE, false)) url = withParam(url, "render", "fallback")
        return url
    }

    private fun withParam(url: String, key: String, value: String): String {
        val clean = url.replace(Regex("[?&]$key=[^&]+"), "")
        return clean + (if (clean.contains("?")) "&" else "?") + "$key=$value"
    }

    /** Hand a "which host has this room code" answer back; see [AndroidBridge.findRoom]. */
    fun deliverRoomFound(json: String) {
        runOnUiThread {
            webView.evaluateJavascript("window.__onRoomFound && window.__onRoomFound($json)", null)
        }
    }

    /**
     * Receive the page's self-report (see main.js reportClientState). Anything it says is better than the player
     * seeing nothing, so an error report also stops the watchdog and is shown with the diagnostics.
     */
    fun reportClientState(json: String) {
        val isHealthy = json.contains("\"booted\":true") && !json.contains("\"layoutCollapsed\":true")
        if (isHealthy) {
            clientState = json
            cancelBlankScreenWatchdog()
        } else {
            Log.w(TAG, "client state reported unready or collapsed: $json")
        }
        Log.i(TAG, "client state: $json")
    }

    fun getClientState(): String = clientState ?: "null"

    private fun scheduleBlankScreenWatchdog() {
        cancelBlankScreenWatchdog()
        val watchdog = Runnable {
            blankWatchdog = null
            if (isFinishing || clientState != null) return@Runnable
            showBlankScreenDialog()
        }
        blankWatchdog = watchdog
        mainHandler.postDelayed(watchdog, BLANK_SCREEN_WATCHDOG_MS)
    }

    private fun cancelBlankScreenWatchdog() {
        blankWatchdog?.let { mainHandler.removeCallbacks(it) }
        blankWatchdog = null
    }

    /** A native dialog is the only thing that can reach the player when the WebView surface itself is dead. */
    private fun showBlankScreenDialog() {
        val webviewVersion = try {
            WebView.getCurrentWebViewPackage()?.versionName ?: "未知"
        } catch (e: Exception) { "读不到" }
        AlertDialog.Builder(this)
            .setTitle("画面可能没有出来")
            .setMessage(
                "页面已加载完成，但游戏没有回报「已在绘制」。如果屏幕是黑的，试试「兼容模式重启」：" +
                    "改用简易棋盘、不加载 3D、并关闭强制硬件加速层。\n\n" +
                    "WebView 版本：$webviewVersion\n" +
                    "（重启后仍有问题，请点「查看日志」把信息发给我们。）",
            )
            .setPositiveButton("兼容模式重启") { _, _ -> enableCompatModeAndReload() }
            .setNeutralButton("查看日志") { _, _ -> showLogsAndDiagnosticsDialog() }
            .setNegativeButton("继续等", null)
            .show()
    }

    /** Entry point for the watchdog dialog and the page's own settings row. */
    fun enableCompatMode() = enableCompatModeAndReload()

    /**
     * Android 12 is where WebView reached Chromium 91; older devices sit on 77-87 and, without Play Store, usually
     * cannot move. That is also the population reporting a black screen (the client needs Chrome 87 for the CSS
     * `inset` shorthand and 86 for `replaceChildren`), so the launcher says it before the player hits 开始 rather
     * than waiting for the watchdog. Null means the WebView is new enough.
     */
    private fun outdatedWebViewWarning(): String? {
        val version = try { WebView.getCurrentWebViewPackage()?.versionName } catch (e: Exception) { null }
        val major = version?.substringBefore('.')?.toIntOrNull() ?: return null
        if (major >= MIN_WEBVIEW_CHROME) return null
        return "本机 WebView 为 Chrome $major，低于本游戏所需的 $MIN_WEBVIEW_CHROME，可能黑屏或排版错位。" +
            "请到系统设置/应用商店更新「Android System WebView」。"
    }

    /** Flip the switches that get a device out of a black surface, and reload with them applied. */
    private fun enableCompatModeAndReload() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_COMPAT_MODE, true)
            .putBoolean(KEY_HW_LAYER, false)
            .putString(KEY_BOARD_MODE, "2d")
            .apply()
        try {
            webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
        } catch (e: Exception) {
            Log.w(TAG, "layer reset before compat reload failed: ${e.message}")
        }
        reloadWebView()
    }

    fun reloadWebView() {
        runOnUiThread {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val mode = prefs.getString(KEY_SERVER_MODE, "local")
            val remoteUrl = prefs.getString(KEY_REMOTE_URL, DEFAULT_LAN_URL)
            val currentUrl = if (mode == "remote" && !remoteUrl.isNullOrBlank()) remoteUrl else (webView.url ?: DEFAULT_LOCAL_URL)
            loadServerUrl(currentUrl)
        }
    }

    /**
     * The connection chooser. On the very first launch it replaces [startStartupFlow], so the player
     * decides where to play before the WebView ever navigates; the in-game gear opens the same dialog
     * with the board-quality block and a "cancel" that keeps the stored choice.
     */
    fun showServerSwitchDialog(asLauncher: Boolean = false) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val currentMode = prefs.getString(KEY_SERVER_MODE, "local")
        val currentRemoteUrl = prefs.getString(KEY_REMOTE_URL, DEFAULT_LAN_URL)
        val currentBoardMode = prefs.getString(KEY_BOARD_MODE, "3d")

        val dialogView = layoutInflater.inflate(R.layout.dialog_server_switch, null)
        val tvTitle = dialogView.findViewById<TextView>(R.id.tvDialogTitle)
        val tvSub = dialogView.findViewById<TextView>(R.id.tvDialogSub)
        val cards = listOf(
            "solo" to dialogView.findViewById<View>(R.id.cardSolo),
            "lan" to dialogView.findViewById<View>(R.id.cardLan),
            "remote" to dialogView.findViewById<View>(R.id.cardRemote),
        )
        val strips = mapOf(
            "solo" to dialogView.findViewById<View>(R.id.cardSoloStrip),
            "lan" to dialogView.findViewById<View>(R.id.cardLanStrip),
            "remote" to dialogView.findViewById<View>(R.id.cardRemoteStrip),
        )
        val cardTitles = mapOf(
            "solo" to dialogView.findViewById<TextView>(R.id.cardSoloTitle),
            "lan" to dialogView.findViewById<TextView>(R.id.cardLanTitle),
            "remote" to dialogView.findViewById<TextView>(R.id.cardRemoteTitle),
        )
        val tvLocalIpHint = dialogView.findViewById<TextView>(R.id.tvLocalIpHint)
        val etAddress = dialogView.findViewById<EditText>(R.id.etServerAddress)
        val tvUrlPreview = dialogView.findViewById<TextView>(R.id.tvUrlPreview)
        val boardBlock = dialogView.findViewById<View>(R.id.boardBlock)
        val rbBoard3D = dialogView.findViewById<RadioButton>(R.id.rbBoard3D)
        val rbBoard2D = dialogView.findViewById<RadioButton>(R.id.rbBoard2D)
        val btnFirstRunSolo = dialogView.findViewById<Button>(R.id.btnFirstRunSolo)
        val btnShowLogs = dialogView.findViewById<Button>(R.id.btnShowLogsSwitch)
        val btnCancel = dialogView.findViewById<Button>(R.id.btnCancelDialog)
        val btnApply = dialogView.findViewById<Button>(R.id.btnApplyDialog)

        // Display adaptation controls (share the dialog with the board-quality block).
        val swHighRefresh = dialogView.findViewById<SwitchCompat>(R.id.swHighRefresh)
        val lblEdge = dialogView.findViewById<TextView>(R.id.lblEdge)
        val sbEdge = dialogView.findViewById<SeekBar>(R.id.sbEdge)

        swHighRefresh.isChecked = isHighRefresh()
        swHighRefresh.setOnCheckedChangeListener { _, checked ->
            setHighRefresh(checked)
        }

        var edgePreview = prefs.getInt(KEY_EDGE_PADDING, 0)
        fun updateEdgeLabel(px: Int) {
            lblEdge.text = getString(R.string.edge_padding_label, px)
        }
        sbEdge.max = 200
        sbEdge.progress = edgePreview
        updateEdgeLabel(edgePreview)
        sbEdge.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {
                updateEdgeLabel(value)
                // Live preview: the launcher UI behind the dialog pulls in from both sides.
                applyEdgePadding(value)
            }
            override fun onStartTrackingTouch(bar: SeekBar?) {}
            override fun onStopTrackingTouch(bar: SeekBar?) {
                val v = bar?.progress ?: 0
                if (v != edgePreview) {
                    edgePreview = v
                    prefs.edit().putInt(KEY_EDGE_PADDING, v).apply()
                    FileLogger.i("settings", "edge padding = $v px")
                    Toast.makeText(this@MainActivity, "已应用到游戏画面（进游戏即可看到）", Toast.LENGTH_SHORT).show()
                }
            }
        })

        val usableAddresses = NetworkUtils.allUsableAddresses(this)
        val copyAddressesText = if (usableAddresses.isNotEmpty()) {
            usableAddresses.joinToString("\n") { "http://${it.ip}:3000 (${it.typeLabel})" }
        } else {
            "http://127.0.0.1:3000"
        }

        var picked = if (currentMode == "remote") "remote" else "solo"

        fun updateIpHint() {
            when (picked) {
                "lan" -> {
                    if (usableAddresses.isNotEmpty()) {
                        val sb = StringBuilder("本机可开服地址（点击复制分享）：\n")
                        for (item in usableAddresses) {
                            sb.append("• http://${item.ip}:3000  [${item.typeLabel}]\n")
                        }
                        sb.append("💡 同 Wi-Fi 朋友直连或填 4 位同盟码；异地/虚拟网发对应 IP:3000")
                        tvLocalIpHint.text = sb.toString().trimEnd()
                        tvLocalIpHint.setOnClickListener {
                            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
                            val clip = android.content.ClipData.newPlainText("Stronghold Host Address", copyAddressesText)
                            cm?.setPrimaryClip(clip)
                            Toast.makeText(this@MainActivity, "已复制本机全部开服地址到剪贴板！", Toast.LENGTH_SHORT).show()
                        }
                    } else {
                        tvLocalIpHint.text = "本机地址: 127.0.0.1 (未检测到可用网络，仅可单机)"
                        tvLocalIpHint.setOnClickListener(null)
                    }
                    tvLocalIpHint.visibility = View.VISIBLE
                }
                "solo" -> {
                    tvLocalIpHint.text = "无需联网，本机运行独立 Node 引擎 · 进度完全保存在本地"
                    tvLocalIpHint.setOnClickListener(null)
                    tvLocalIpHint.visibility = View.VISIBLE
                }
                "remote" -> {
                    tvLocalIpHint.visibility = View.GONE
                    tvLocalIpHint.setOnClickListener(null)
                }
            }
        }

        if (asLauncher) {
            tvTitle.text = "这局怎么开始？"
            tvSub.visibility = View.VISIBLE
            val webviewWarning = outdatedWebViewWarning()
            tvSub.text = buildString {
                append(
                    if (currentMode == "remote" && !currentRemoteUrl.isNullOrBlank())
                        "上次连的是 $currentRemoteUrl · 点「连接」继续，或换一台"
                    else "选一个进入。每次启动都会先问这个。"
                )
                if (webviewWarning != null) append("\n⚠ ").append(webviewWarning)
            }
            boardBlock.visibility = View.VISIBLE
            btnShowLogs.visibility = View.GONE
            btnCancel.visibility = View.GONE
            btnFirstRunSolo.visibility = View.VISIBLE
            btnApply.text = "连接"
        }

        if (currentBoardMode == "2d") rbBoard2D.isChecked = true else rbBoard3D.isChecked = true
        etAddress.setText(if (!currentRemoteUrl.isNullOrBlank()) currentRemoteUrl else DEFAULT_LAN_URL)

        fun preview() {
            val url = normalizeServerUrl(etAddress.text.toString())
            tvUrlPreview.text = url?.let { "将连接 $it" }
                ?: "填房主的地址即可，形如 100.127.8.41:3000，或 https://域名"
        }

        fun paint() {
            for ((key, card) in cards) {
                val on = key == picked
                card.setBackgroundColor(if (on) 0xFF16211D.toInt() else 0xFF131817.toInt())
                strips[key]?.setBackgroundColor(if (on) 0xFF4ED8AF.toInt() else 0xFF2A3531.toInt())
                cardTitles[key]?.setTextColor(if (on) 0xFF4ED8AF.toInt() else 0xFFF0F4F2.toInt())
            }
            val remote = picked == "remote"
            etAddress.visibility = if (remote) View.VISIBLE else View.GONE
            tvUrlPreview.visibility = if (remote) View.VISIBLE else View.GONE
            updateIpHint()
            if (remote) preview()
        }

        for ((key, card) in cards) card.setOnClickListener { picked = key; paint() }
        etAddress.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) = preview()
        })

        val dialog = AlertDialog.Builder(this).setView(dialogView).create()
        btnShowLogs.setOnClickListener { showLogsAndDiagnosticsDialog() }
        btnFirstRunSolo.setOnClickListener {
            FileLogger.i("ui", "chooser decision: first-run solo")
            val boardMode = if (rbBoard2D.isChecked) "2d" else "3d"
            prefs.edit().putString(KEY_BOARD_MODE, boardMode).putBoolean(KEY_COMPAT_MODE, false).apply()
            dialog.dismiss()
            startLocalFlow()
        }
        btnCancel.setOnClickListener {
            FileLogger.i("ui", "chooser decision: cancelled (keeping stored choice)")
            dialog.dismiss()
        }
        if (asLauncher) dialog.setOnCancelListener {
            FileLogger.i("ui", "chooser decision: cancelled via back (defaulting to local flow)")
            startLocalFlow()
        }

        btnApply.setOnClickListener {
            val boardMode = if (rbBoard2D.isChecked) "2d" else "3d"
            val editor = prefs.edit().putString(KEY_BOARD_MODE, boardMode).putBoolean(KEY_COMPAT_MODE, false)
            if (picked == "remote") {
                val url = normalizeServerUrl(etAddress.text.toString())
                if (url == null) {
                    Toast.makeText(this, "请填写有效地址，形如 100.127.8.41:3000 或 https://域名", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                FileLogger.i("ui", "chooser decision: remote url=$url board=$boardMode")
                editor.putString(KEY_SERVER_MODE, "remote").putString(KEY_REMOTE_URL, url)
                editor.apply()
                dialog.dismiss()
                loadServerUrl(url)
            } else {
                FileLogger.i("ui", "chooser decision: local ($picked) board=$boardMode")
                editor.putString(KEY_SERVER_MODE, "local")
                editor.apply()
                dialog.dismiss()
                startLocalFlow()
            }
        }

        paint()
        dialog.show()
    }

    /**
     * Accept what a player actually pastes — a bare IP, an `ip:port`, or a whole invite link — instead
     * of demanding a full `http://…`. Adds the scheme and default port (when needed), and rejects anything
     * that cannot be a server address.
     *
     * Note: Does NOT append :3000 to https:// URLs, so standard 443 domains remain intact!
     */
    private fun normalizeServerUrl(input: String): String? {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return null
        val lower = trimmed.lowercase()
        val isExplicitHttps = lower.startsWith("https://")
        val isExplicitHttp = lower.startsWith("http://")
        val scheme = if (isExplicitHttps) "https://" else "http://"
        val body = when {
            isExplicitHttp -> trimmed.substring(7)
            isExplicitHttps -> trimmed.substring(8)
            else -> trimmed
        }
        if (body.isBlank() || body.any(Char::isWhitespace)) return null
        val slash = body.indexOf('/')
        val authority = if (slash >= 0) body.substring(0, slash) else body
        val path = if (slash >= 0) body.substring(slash) else ""
        if (authority.isEmpty()) return null
        if (!authority.all { it.isLetterOrDigit() || it == '.' || it == ':' || it == '-' || it == '_' }) return null

        val withPort = when {
            authority.contains(':') -> authority // User explicitly provided port
            isExplicitHttps -> authority          // Standard HTTPS port 443, do NOT append :3000
            else -> "$authority:3000"             // HTTP bare IP or host, defaults to :3000
        }
        return "$scheme$withPort$path"
    }

    fun showLogsAndDiagnosticsDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_server_logs, null)
        val tvStatus = dialogView.findViewById<TextView>(R.id.tvDiagServerStatus)
        val tvLanIp = dialogView.findViewById<TextView>(R.id.tvDiagLanIp)
        val tvLogContent = dialogView.findViewById<TextView>(R.id.tvLogContent)
        val scrollLogs = dialogView.findViewById<ScrollView>(R.id.scrollLogs)
        val btnCopy = dialogView.findViewById<Button>(R.id.btnCopyLogs)
        val btnShare = dialogView.findViewById<Button>(R.id.btnShareLogs)
        val btnRefresh = dialogView.findViewById<Button>(R.id.btnRefreshDiag)
        val btnClose = dialogView.findViewById<Button>(R.id.btnCloseDiag)

        val usableAddresses = NetworkUtils.allUsableAddresses(this)
        tvLanIp.text = if (usableAddresses.isNotEmpty()) {
            val listStr = usableAddresses.joinToString("\n") { "• http://${it.ip}:3000 [${it.typeLabel}]" }
            "本机网络 IP:\n$listStr"
        } else {
            "本机网络 IP: 127.0.0.1 (未连接 Wi-Fi 或虚拟专网，仅单机可用)"
        }

        fun updateLogs() {
            // In-memory ring first (unchanged), then the rotating file log tail — the file is
            // the source of truth on OEM skins that filter logcat, and outlives the process.
            val sb = StringBuilder()
            val memoryLogs = NodeServerService.getRecentLogs(100)
            if (memoryLogs.isNotEmpty()) {
                sb.append(memoryLogs.joinToString("\n"))
            }
            val fileTail = FileLogger.tail()
            if (fileTail.isNotBlank()) {
                if (sb.isNotEmpty()) sb.append("\n")
                sb.append("---- 文件日志 files/logs/debug.log（末尾）----\n").append(fileTail)
            }
            if (sb.isEmpty()) {
                val logFile = File(filesDir, "server.log")
                if (logFile.exists() && logFile.length() > 0) {
                    try {
                        val text = logFile.readText(Charsets.UTF_8).takeLast(8192)
                        tvLogContent.text = text
                    } catch (e: Exception) {
                        tvLogContent.text = "读取日志文件失败: ${e.message}"
                    }
                } else {
                    tvLogContent.text = "暂无运行日志 (服务未启动或尚未产生输出)"
                }
            } else {
                tvLogContent.text = sb.toString()
            }
            scrollLogs.post {
                scrollLogs.fullScroll(View.FOCUS_DOWN)
            }
        }

        fun checkServerHealth() {
            tvStatus.text = "服务连接状态: 正在探测 http://127.0.0.1:3000/healthz …"
            tvStatus.setTextColor(0xFFE0E0E0.toInt())
            Thread {
                try {
                    val client = OkHttpClient.Builder()
                        .connectTimeout(1, TimeUnit.SECONDS)
                        .readTimeout(1, TimeUnit.SECONDS)
                        .build()
                    val req = Request.Builder()
                        .url("http://127.0.0.1:3000/healthz")
                        .build()
                    client.newCall(req).execute().use { resp ->
                        val code = resp.code
                        val body = resp.body?.string() ?: ""
                        runOnUiThread {
                            if (resp.isSuccessful) {
                                tvStatus.text = "服务连接状态: 正常运行 (HTTP $code: $body)"
                                tvStatus.setTextColor(0xFF00E676.toInt())
                            } else {
                                tvStatus.text = "服务连接状态: 异常响应 (HTTP $code: $body)"
                                tvStatus.setTextColor(0xFFFFAB00.toInt())
                            }
                        }
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        tvStatus.text = "服务连接状态: 无法连通 (${e.javaClass.simpleName}: ${e.message})"
                        tvStatus.setTextColor(0xFFFF5252.toInt())
                    }
                }
            }.start()
        }

        updateLogs()
        checkServerHealth()
        FileLogger.i("ui", "diagnostics dialog opened")

        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .create()

        btnCopy.setOnClickListener {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("Stronghold Server Logs", tvLogContent.text)
            clipboard.setPrimaryClip(clip)
            Toast.makeText(this, "日志已复制到剪贴板", Toast.LENGTH_SHORT).show()
        }

        btnShare.setOnClickListener {
            FileLogger.i("ui", "share logs requested")
            FileLogger.share(this)
        }

        btnRefresh.setOnClickListener {
            updateLogs()
            checkServerHealth()
        }

        btnClose.setOnClickListener {
            dialog.dismiss()
        }

        dialog.show()
    }

    override fun onResume() {
        super.onResume()
        try {
            webView.onResume()
            requestAudioFocus()
            webView.evaluateJavascript("globalThis.__SP__?.audio?.resume?.()", null)
        } catch (_: Exception) {}

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val mode = prefs.getString(KEY_SERVER_MODE, "local")
        if (mode == "local" && layoutLoading.visibility == View.VISIBLE) {
            // Self-healing: if returning from background/HOME and UI is stuck in loading, probe :3000/healthz
            Thread {
                try {
                    val client = OkHttpClient.Builder()
                        .connectTimeout(500, TimeUnit.MILLISECONDS)
                        .readTimeout(500, TimeUnit.MILLISECONDS)
                        .build()
                    val req = Request.Builder().url("http://127.0.0.1:3000/healthz").build()
                    client.newCall(req).execute().use { resp ->
                        if (resp.isSuccessful) {
                            runOnUiThread {
                                if (layoutLoading.visibility == View.VISIBLE) {
                                    Log.i(TAG, "Self-healing onResume: local server is healthy, navigating WebView")
                                    handleServerReady()
                                }
                            }
                        }
                    }
                } catch (_: Exception) {}
            }.start()
        }
    }

    override fun onPause() {
        super.onPause()
        abandonAudioFocus()
        try {
            webView.evaluateJavascript("globalThis.__SP__?.audio?.suspend?.()", null)
            webView.onPause()
        } catch (_: Exception) {}
    }

    override fun onDestroy() {
        super.onDestroy()
        cancelBlankScreenWatchdog()
        FileLogger.i("lifecycle", "MainActivity onDestroy (finishing=$isFinishing)")
        abandonAudioFocus()
        NodeServerService.stateListener = null
        serverReadyReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (_: Exception) {}
        }
        try {
            webView.apply {
                loadUrl("about:blank")
                stopLoading()
                clearHistory()
                removeAllViews()
                destroy()
            }
        } catch (_: Exception) {}
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            AlertDialog.Builder(this)
                .setTitle("退出作战")
                .setMessage("确定要退出卫戍协议吗？")
                .setPositiveButton("退出") { _, _ -> finish() }
                .setNegativeButton("继续", null)
                .show()
        }
    }
}
