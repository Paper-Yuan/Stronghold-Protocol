package io.github.sganggs.stronghold

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.window.OnBackInvokedDispatcher
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject
import org.json.JSONTokener

/**
 * Fullscreen immersive WebView that plays the (unmodified) web client served by the
 * embedded server, or by a LAN host in join mode.
 *
 * Adaptation features (user requests):
 *  - 120 Hz+ : DisplayHelper pins the highest refresh mode (toggleable, 60 Hz fallback).
 *  - 异形屏  : edge padding slider shrinks the WebView horizontally so game UI keeps
 *              clear of notches / punch-holes; value = distance to each side in px.
 *  - 全面适配 : immersive bars, cutout shortEdges, keep-screen-on, back = Esc,
 *              audio suspend on pause, renderer priority policy, boot watchdog with a
 *              2D compatibility fallback (?board=2d&render=fallback) that needs no
 *              changes to the web client.
 */
class GameActivity : AppCompatActivity() {

    companion object {
        private const val EXTRA_URL = "url"
        private const val PREFS = "stronghold_android"
        private const val P_HIGH_REFRESH = "high_refresh"
        private const val P_EDGE_PADDING = "edge_padding_px"

        fun start(context: Context, url: String) {
            context.startActivity(Intent(context, GameActivity::class.java).putExtra(EXTRA_URL, url))
        }

        /** Probe what the page can see about itself; runs against the STOCK client, no web changes. */
        private const val PROBE_JS = "(function(){" +
                "var gl=function(t){try{var c=document.createElement('canvas');return !!(c.getContext&&c.getContext(t))}catch(e){return false}};" +
                "try{return JSON.stringify({booted:!!(globalThis.__SP__&&globalThis.__SP__.store)," +
                "canvases:document.querySelectorAll('canvas').length," +
                "root:(document.getElementById('app')||{}).childElementCount||0," +
                "webgl:gl('webgl'),webgl2:gl('webgl2'),dpr:window.devicePixelRatio||0," +
                "w:window.innerWidth||0,h:window.innerHeight||0})}catch(e){return JSON.stringify({err:String(e)})}})()"
    }

    private lateinit var webView: WebView
    private lateinit var overlay: LinearLayout
    private lateinit var overlayText: TextView
    private lateinit var prefs: android.content.SharedPreferences
    private val handler = Handler(Looper.getMainLooper())
    private var baseUrl: String = ""
    private var baseHost: String = ""
    private var probeAttempts = 0

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        DebugLog.i("lifecycle", "GameActivity onCreate url=${intent.getStringExtra(EXTRA_URL)}")
        super.onCreate(savedInstanceState)
        baseUrl = intent.getStringExtra(EXTRA_URL) ?: "http://127.0.0.1:3000/"
        baseHost = try { Uri.parse(baseUrl).host ?: "127.0.0.1" } catch (_: Exception) { "127.0.0.1" }
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE)

        DisplayHelper.apply(window, prefs.getBoolean(P_HIGH_REFRESH, true))
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        immersive()

        setContentView(R.layout.activity_game)
        webView = findViewById(R.id.webView)
        overlay = findViewById(R.id.overlay)
        overlayText = findViewById(R.id.overlayText)

        applyEdgePadding()
        setupWebView()
        webView.loadUrl(baseUrl)
    }

    // ---------------------------------------------------------------- webview

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            // the game scales itself via its own rem logic; do not multiply by system font size
            textZoom = 100
            cacheMode = WebSettings.LOAD_DEFAULT
            if (Build.VERSION.SDK_INT >= 26) safeBrowsingEnabled = false
        }
        if (Build.VERSION.SDK_INT >= 29) {
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true)
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                DebugLog.console(
                    consoleMessage.messageLevel().ordinal,
                    "[${consoleMessage.messageLevel()}] ${consoleMessage.message()}",
                    "${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}"
                )
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host ?: return false
                if (host == baseHost || host == "127.0.0.1" || host == "localhost") return false
                // external links (GitHub, notices…) open in the browser
                DebugLog.i("webview", "external link -> ${request.url}")
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (e: Exception) { DebugLog.e("webview", "no browser for ${request.url}", e) }
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                DebugLog.i("webview", "page finished: $url")
                scheduleBootProbe()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) {
                    DebugLog.e("webview", "main frame error: ${error.description} (${error.errorCode})")
                    showOverlay("页面加载失败：${error.description}\n\n" +
                            "请确认房主设备已开服、双方在同一网络。")
                }
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                DebugLog.e("webview", "renderer process gone — recreating activity")
                recreate()
                return true
            }
        }
    }

    /** First-run UI clearance for irregular screens: distance to each side, in px. */
    private fun applyEdgePadding() {
        val px = prefs.getInt(P_EDGE_PADDING, 0)
        if (px <= 0) return
        (webView.layoutParams as? FrameLayout.LayoutParams)?.let { lp ->
            lp.leftMargin = px
            lp.rightMargin = px
            webView.layoutParams = lp
        }
        DebugLog.i("webview", "edge padding applied: ${px}px each side")
    }

    // ------------------------------------------------------- boot watchdog (2D fallback)

    private fun scheduleBootProbe() {
        probeAttempts = 0
        handler.postDelayed({ runBootProbe() }, 4_000)
    }

    private fun runBootProbe() {
        webView.evaluateJavascript(PROBE_JS) { raw ->
            val json = try {
                JSONTokener(raw).nextValue()
            } catch (_: Exception) { null }
            val obj: JSONObject? = when (json) {
                is JSONObject -> json
                is String -> try { JSONObject(json) } catch (_: Exception) { null }
                else -> null
            }
            DebugLog.i("watchdog", "probe: $obj")
            val booted = obj?.optBoolean("booted", false) == true
            if (booted) {
                hideOverlay()
            } else {
                probeAttempts++
                if (probeAttempts <= 2) {
                    handler.postDelayed({ runBootProbe() }, 3_000)
                } else {
                    val diag = buildString {
                        append("游戏页面长时间没有启动。\n\n")
                        append("WebGL: ${obj?.optBoolean("webgl", false)} · WebGL2: ${obj?.optBoolean("webgl2", false)}\n")
                        append("canvas 数量: ${obj?.optInt("canvases", -1)} · 视口: ${obj?.optInt("w", 0)}x${obj?.optInt("h", 0)}\n")
                        append(obj?.optString("err", "")?.takeIf { it.isNotEmpty() }?.let { "错误: $it\n" } ?: "")
                        append("\n可尝试「兼容模式」（2D 棋盘 + 简化渲染），或分享日志排查。")
                    }
                    showOverlay(diag)
                }
            }
        }
    }

    private fun showOverlay(text: String) {
        overlayText.text = text
        overlay.visibility = View.VISIBLE
        findViewById<Button>(R.id.btnReload).setOnClickListener {
            hideOverlay(); webView.loadUrl(baseUrl)
        }
        findViewById<Button>(R.id.btnCompat).setOnClickListener {
            hideOverlay()
            val sep = if (baseUrl.contains('?')) '&' else '?'
            webView.loadUrl("$baseUrl${sep}board=2d&render=fallback")
        }
        findViewById<Button>(R.id.btnCopy).setOnClickListener {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("sp-diagnostics", text))
            android.widget.Toast.makeText(this, "诊断信息已复制", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    private fun hideOverlay() {
        overlay.visibility = View.GONE
    }

    // ---------------------------------------------------------------- lifecycle

    override fun onPause() {
        DebugLog.i("lifecycle", "GameActivity onPause")
        // stock client exposes globalThis.__SP__.audio — suspend BGM/SFX in background
        webView.evaluateJavascript("try{globalThis.__SP__&&globalThis.__SP__.audio&&globalThis.__SP__.audio.suspend&&globalThis.__SP__.audio.suspend()}catch(e){}", null)
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        DebugLog.i("lifecycle", "GameActivity onResume")
        webView.onResume()
        webView.evaluateJavascript("try{globalThis.__SP__&&globalThis.__SP__.audio&&globalThis.__SP__.audio.resume&&globalThis.__SP__.audio.resume()}catch(e){}", null)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) immersive()
    }

    override fun onDestroy() {
        DebugLog.i("lifecycle", "GameActivity onDestroy")
        handler.removeCallbacksAndMessages(null)
        webView.destroy()
        super.onDestroy()
    }

    // ---------------------------------------------------------------- back & immersive

    /**
     * Back / edge-swipe asks twice before leaving (防误触): the first press only
     * shows a hint, the second within 2 s finishes the game page. The embedded
     * server keeps running under the foreground service either way, so re-entering
     * via 「开始游戏」 is instant.
     */
    private var lastBackAt = 0L

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        val now = System.currentTimeMillis()
        if (now - lastBackAt < 2_000) {
            finish()
            return
        }
        lastBackAt = now
        android.widget.Toast.makeText(this, "再按一次退出游戏（服务器保持运行）", android.widget.Toast.LENGTH_SHORT).show()
    }

    private fun immersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (Build.VERSION.SDK_INT >= 28) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
    }
}
