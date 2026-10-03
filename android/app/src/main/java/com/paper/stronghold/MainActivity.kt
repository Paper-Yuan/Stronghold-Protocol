package com.paper.stronghold

import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.*
import android.widget.*
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    companion object {
        private const val TAG = "MainActivity"
        private const val PREFS_NAME = "stronghold_prefs"
        private const val KEY_SERVER_MODE = "server_mode" // "local" or "remote"
        private const val KEY_REMOTE_URL = "remote_url"
        private const val KEY_BOARD_MODE = "board_mode"   // "3d" or "2d"
        private const val DEFAULT_LOCAL_URL = "http://127.0.0.1:3000"
        private const val DEFAULT_LAN_URL = "http://192.168.10.25:3000"
    }

    private lateinit var webView: WebView
    private lateinit var layoutLoading: LinearLayout
    private lateinit var layoutFailedActions: LinearLayout
    private lateinit var tvLoadingStatus: TextView
    private lateinit var progressLoading: ProgressBar
    private lateinit var btnOpenSettings: ImageView
    private lateinit var btnQuickConnectLan: Button
    private lateinit var btnDirectSettings: Button
    private lateinit var btnRetryConnect: Button

    private var serverReadyReceiver: BroadcastReceiver? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE)

        // Cutout support for Android 9+ (display notch edge-to-edge)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                window.attributes.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            } catch (e: Exception) {
                Log.w(TAG, "Failed to set display cutout mode: ${e.message}")
            }
        }

        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        layoutLoading = findViewById(R.id.layoutLoading)
        layoutFailedActions = findViewById(R.id.layoutFailedActions)
        tvLoadingStatus = findViewById(R.id.tvLoadingStatus)
        progressLoading = findViewById(R.id.progressLoading)
        btnOpenSettings = findViewById(R.id.btnOpenSettings)
        btnQuickConnectLan = findViewById(R.id.btnQuickConnectLan)
        btnDirectSettings = findViewById(R.id.btnDirectSettings)
        btnRetryConnect = findViewById(R.id.btnRetryConnect)

        btnOpenSettings.setOnClickListener { showServerSwitchDialog() }
        btnDirectSettings.setOnClickListener { showServerSwitchDialog() }
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

        setupWebView()
        setupServerReceiver()

        startStartupFlow()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        enableFullscreen()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enableFullscreen()
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
        try {
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        } catch (e: Exception) {
            Log.w(TAG, "Hardware acceleration layer error: ${e.message}")
        }

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
                    Log.d("WebViewConsole", "${it.message()} -- From line ${it.lineNumber()} of ${it.sourceId()}")
                }
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                layoutLoading.visibility = View.GONE
                layoutFailedActions.visibility = View.GONE
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    showConnectionError("连接游戏服务超时或未响应。\n若使用电脑服务端，请确保手机与电脑在同一 Wi-Fi。")
                }
            }

            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                Log.e(TAG, "WebView render process gone. Did crash: ${detail?.didCrash()}")
                runOnUiThread {
                    layoutLoading.visibility = View.VISIBLE
                    tvLoadingStatus.text = "显存渲染已重置，正在恢复战场…"
                    try {
                        reloadWebView()
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to reload after render process crash", e)
                    }
                }
                return true // Prevent host process from being killed
            }
        }
    }

    private fun setupServerReceiver() {
        serverReadyReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                when (intent?.action) {
                    NodeServerService.ACTION_SERVER_READY -> {
                        runOnUiThread {
                            val lanIp = NetworkUtils.getLocalIpAddress(this@MainActivity)
                            val statusMsg = if (lanIp != "127.0.0.1") {
                                "本地引擎已就绪！\n本机局域网地址: http://$lanIp:3000\n(其他手机填入此地址可联机)"
                            } else {
                                getString(R.string.server_ready)
                            }
                            tvLoadingStatus.text = statusMsg
                            loadServerUrl(DEFAULT_LOCAL_URL)
                        }
                    }
                    NodeServerService.ACTION_SERVER_FAILED -> {
                        val reason = intent.getStringExtra("reason") ?: "本地引擎未启动"
                        runOnUiThread {
                            showConnectionError("本地独立服务提示: $reason\n可在设置中切换为单机重试或连接其他手机/电脑。")
                        }
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(NodeServerService.ACTION_SERVER_READY)
            addAction(NodeServerService.ACTION_SERVER_FAILED)
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
            }

            runOnUiThread {
                startLocalServer()
            }
        }.start()
    }

    fun startLocalServer() {
        tvLoadingStatus.text = getString(R.string.server_starting)
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

    private fun loadServerUrl(rawUrl: String) {
        val targetUrl = buildUrlWithBoardMode(rawUrl)
        runOnUiThread {
            Log.i(TAG, "Loading target URL in WebView: $targetUrl")
            webView.loadUrl(targetUrl)
        }
    }

    private fun buildUrlWithBoardMode(baseUrl: String): String {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val boardMode = prefs.getString(KEY_BOARD_MODE, "3d") ?: "3d"
        val cleanUrl = baseUrl.replace(Regex("[?&]board=[^&]+"), "")
        val separator = if (cleanUrl.contains("?")) "&" else "?"
        return "$cleanUrl${separator}board=$boardMode"
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

    fun showServerSwitchDialog() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val currentMode = prefs.getString(KEY_SERVER_MODE, "local")
        val currentRemoteUrl = prefs.getString(KEY_REMOTE_URL, DEFAULT_LAN_URL)
        val currentBoardMode = prefs.getString(KEY_BOARD_MODE, "3d")

        val dialogView = layoutInflater.inflate(R.layout.dialog_server_switch, null)
        val rbLocal = dialogView.findViewById<RadioButton>(R.id.rbLocalMode)
        val rbRemote = dialogView.findViewById<RadioButton>(R.id.rbRemoteMode)
        val tvLocalIpHint = dialogView.findViewById<TextView>(R.id.tvLocalIpHint)
        val etAddress = dialogView.findViewById<EditText>(R.id.etServerAddress)
        val rbBoard3D = dialogView.findViewById<RadioButton>(R.id.rbBoard3D)
        val rbBoard2D = dialogView.findViewById<RadioButton>(R.id.rbBoard2D)

        val lanIp = NetworkUtils.getLocalIpAddress(this)
        tvLocalIpHint.text = if (lanIp != "127.0.0.1") {
            "本机局域网地址: http://$lanIp:3000\n(如果作为房主，好友填入此地址即可联机)"
        } else {
            "本机局域网地址: 未连接 Wi-Fi (单机离线可用)"
        }

        val btnRestart = dialogView.findViewById<Button>(R.id.btnRestartServer)
        val btnCancel = dialogView.findViewById<Button>(R.id.btnCancelDialog)
        val btnApply = dialogView.findViewById<Button>(R.id.btnApplyDialog)

        if (currentMode == "remote") {
            rbRemote.isChecked = true
            etAddress.visibility = View.VISIBLE
            etAddress.setText(currentRemoteUrl)
        } else {
            rbLocal.isChecked = true
            etAddress.visibility = View.GONE
            etAddress.setText(if (!currentRemoteUrl.isNullOrBlank()) currentRemoteUrl else DEFAULT_LAN_URL)
        }

        if (currentBoardMode == "2d") {
            rbBoard2D.isChecked = true
        } else {
            rbBoard3D.isChecked = true
        }

        rbLocal.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) etAddress.visibility = View.GONE
        }
        rbRemote.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) etAddress.visibility = View.VISIBLE
        }

        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .create()

        btnRestart.setOnClickListener {
            dialog.dismiss()
            startLocalServer()
        }

        btnCancel.setOnClickListener {
            dialog.dismiss()
        }

        btnApply.setOnClickListener {
            val isRemote = rbRemote.isChecked
            val url = etAddress.text.toString().trim()
            val selectedBoardMode = if (rbBoard2D.isChecked) "2d" else "3d"

            if (isRemote && (url.isBlank() || (!url.startsWith("http://") && !url.startsWith("https://")))) {
                Toast.makeText(this, "请输入合法的 http:// 或 https:// 服务器地址", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            prefs.edit().apply {
                putString(KEY_SERVER_MODE, if (isRemote) "remote" else "local")
                putString(KEY_REMOTE_URL, url)
                putString(KEY_BOARD_MODE, selectedBoardMode)
                apply()
            }

            dialog.dismiss()

            if (isRemote) {
                loadServerUrl(url)
            } else {
                startLocalFlow()
            }
        }

        dialog.show()
    }

    override fun onDestroy() {
        super.onDestroy()
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
