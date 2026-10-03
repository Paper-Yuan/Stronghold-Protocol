package com.paper.stronghold

import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.*
import android.widget.*
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    companion object {
        private const val PREFS_NAME = "stronghold_prefs"
        private const val KEY_SERVER_MODE = "server_mode" // "local" or "remote"
        private const val KEY_REMOTE_URL = "remote_url"
        private const val DEFAULT_LOCAL_URL = "http://127.0.0.1:3000"
    }

    private lateinit var webView: WebView
    private lateinit var layoutLoading: LinearLayout
    private lateinit var tvLoadingStatus: TextView
    private lateinit var btnOpenSettings: ImageView

    private var serverReadyReceiver: BroadcastReceiver? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE)
        enableFullscreen()

        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        layoutLoading = findViewById(R.id.layoutLoading)
        tvLoadingStatus = findViewById(R.id.tvLoadingStatus)
        btnOpenSettings = findViewById(R.id.btnOpenSettings)

        btnOpenSettings.setOnClickListener {
            showServerSwitchDialog()
        }

        setupWebView()
        setupServerReceiver()

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val mode = prefs.getString(KEY_SERVER_MODE, "local")

        if (mode == "remote") {
            val remoteUrl = prefs.getString(KEY_REMOTE_URL, "")
            if (!remoteUrl.isNullOrBlank()) {
                loadServerUrl(remoteUrl)
            } else {
                startLocalFlow()
            }
        } else {
            startLocalFlow()
        }
    }

    private fun enableFullscreen() {
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
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enableFullscreen()
    }

    private fun setupWebView() {
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
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        webView.addJavascriptInterface(AndroidBridge(this), "AndroidNative")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                consoleMessage?.let {
                    android.util.Log.d("WebViewConsole", "${it.message()} -- From line ${it.lineNumber()} of ${it.sourceId()}")
                }
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                layoutLoading.visibility = View.GONE
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    tvLoadingStatus.text = "连接服务失败，请点击右上角齿轮设置服务器地址。"
                    layoutLoading.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun setupServerReceiver() {
        serverReadyReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                when (intent?.action) {
                    NodeServerService.ACTION_SERVER_READY -> {
                        runOnUiThread {
                            tvLoadingStatus.text = getString(R.string.server_ready)
                            loadServerUrl(DEFAULT_LOCAL_URL)
                        }
                    }
                    NodeServerService.ACTION_SERVER_FAILED -> {
                        val reason = intent.getStringExtra("reason") ?: "未知错误"
                        runOnUiThread {
                            tvLoadingStatus.text = "本地引擎启动提示: $reason\n可点击右上角设置切换至远程服务器。"
                            Toast.makeText(this@MainActivity, reason, Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(NodeServerService.ACTION_SERVER_READY)
            addAction(NodeServerService.ACTION_SERVER_FAILED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(serverReadyReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(serverReadyReceiver, filter)
        }
    }

    private fun startLocalFlow() {
        layoutLoading.visibility = View.VISIBLE
        tvLoadingStatus.text = "正在准备本地运行资源…"

        Thread {
            AssetManagerHelper.ensureAssetsExtracted(this) { msg ->
                runOnUiThread { tvLoadingStatus.text = msg }
            }
            runOnUiThread {
                startLocalServer()
            }
        }.start()
    }

    fun startLocalServer() {
        tvLoadingStatus.text = getString(R.string.server_starting)
        val intent = Intent(this, NodeServerService::class.java).apply {
            action = NodeServerService.ACTION_START
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun loadServerUrl(url: String) {
        runOnUiThread {
            webView.loadUrl(url)
        }
    }

    fun reloadWebView() {
        runOnUiThread {
            webView.reload()
        }
    }

    fun showServerSwitchDialog() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val currentMode = prefs.getString(KEY_SERVER_MODE, "local")
        val currentRemoteUrl = prefs.getString(KEY_REMOTE_URL, "")

        val dialogView = layoutInflater.inflate(R.layout.dialog_server_switch, null)
        val rbLocal = dialogView.findViewById<RadioButton>(R.id.rbLocalMode)
        val rbRemote = dialogView.findViewById<RadioButton>(R.id.rbRemoteMode)
        val etAddress = dialogView.findViewById<EditText>(R.id.etServerAddress)
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

            if (isRemote && (url.isBlank() || (!url.startsWith("http://") && !url.startsWith("https://")))) {
                Toast.makeText(this, "请输入合法的 http:// 或 https:// 服务器地址", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            prefs.edit().apply {
                putString(KEY_SERVER_MODE, if (isRemote) "remote" else "local")
                putString(KEY_REMOTE_URL, url)
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
            unregisterReceiver(it)
        }
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
