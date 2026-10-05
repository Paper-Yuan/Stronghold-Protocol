package io.github.sganggs.stronghold

import android.Manifest
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.updatePadding
import java.io.File
import java.net.NetworkInterface

/**
 * Launcher: installs the bundled nodejs-project, boots the embedded server (host mode)
 * or joins a LAN host (client mode), and hosts the adaptation settings
 * (120 Hz toggle, irregular-screen edge padding, log export).
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val PREFS = "stronghold_android"
        private const val P_HIGH_REFRESH = "high_refresh"
        private const val P_EDGE_PADDING = "edge_padding_px"
        private const val P_LAST_HOST = "last_host"
        private const val REQ_NOTIFICATIONS = 41
    }

    private lateinit var prefs: SharedPreferences
    private lateinit var status: TextView
    private lateinit var progress: ProgressBar
    private lateinit var progressText: TextView
    private lateinit var btnHost: Button
    private lateinit var btnJoin: Button
    private lateinit var swHighRefresh: SwitchCompat
    private lateinit var sbEdge: SeekBar
    private lateinit var lblEdge: TextView
    private lateinit var hostHint: TextView

    private var installing = false
    private var discovery: LanDiscovery? = null
    private var activePort = 3000

    private val port: Int get() = prefs.getInt("port", 3000)

    override fun onCreate(savedInstanceState: Bundle?) {
        DebugLog.init(applicationContext)
        DebugLog.i("lifecycle", "MainActivity onCreate")
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = getSharedPreferences(PREFS, MODE_PRIVATE)

        val root = findViewById<View>(R.id.rootScroll)
        // edge-to-edge: keep content clear of the status bar
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            v.updatePadding(top = bars.top + (10 * resources.displayMetrics.density).toInt())
            insets
        }

        status = findViewById(R.id.status)
        progress = findViewById(R.id.progress)
        progressText = findViewById(R.id.progressText)
        btnHost = findViewById(R.id.btnHost)
        btnJoin = findViewById(R.id.btnJoin)
        swHighRefresh = findViewById(R.id.swHighRefresh)
        sbEdge = findViewById(R.id.sbEdge)
        lblEdge = findViewById(R.id.lblEdge)
        hostHint = findViewById(R.id.hostHint)

        swHighRefresh.isChecked = prefs.getBoolean(P_HIGH_REFRESH, true)
        swHighRefresh.setOnCheckedChangeListener { _, checked ->
            prefs.edit().putBoolean(P_HIGH_REFRESH, checked).apply()
            DisplayHelper.apply(window, checked)
        }

        val savedPadding = prefs.getInt(P_EDGE_PADDING, 0)
        sbEdge.max = 200
        sbEdge.progress = savedPadding
        updateEdgeLabel(savedPadding)
        applyEdgePaddingToRoot(savedPadding)
        sbEdge.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {
                updateEdgeLabel(value)
                // live preview: the whole launcher UI shrinks in from both sides as you slide
                applyEdgePaddingToRoot(value)
            }
            override fun onStartTrackingTouch(bar: SeekBar?) {}
            override fun onStopTrackingTouch(bar: SeekBar?) {
                val v = bar?.progress ?: 0
                prefs.edit().putInt(P_EDGE_PADDING, v).apply()
                DebugLog.i("settings", "edge padding = $v px")
                Toast.makeText(this@MainActivity, "已应用到游戏画面（进游戏即可看到）", Toast.LENGTH_SHORT).show()
            }
        })

        btnHost.setOnClickListener { startHostFlow() }
        btnJoin.setOnClickListener { showJoinDialog() }
        findViewById<TextView>(R.id.btnShareLogs).setOnClickListener { DebugLog.share(this) }
        findViewById<TextView>(R.id.btnReinstall).setOnClickListener { confirmReinstall() }

        DisplayHelper.apply(window, swHighRefresh.isChecked)
        updateLanHint()
        ensureInstalled()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) updateLanHint()
    }

    override fun onDestroy() {
        DebugLog.i("lifecycle", "MainActivity onDestroy (finishing=$isFinishing)")
        discovery?.unregister()
        if (isFinishing) NodeService.stop(this)
        super.onDestroy()
    }

    // ---------------------------------------------------------------- installation

    private fun ensureInstalled() {
        if (AssetInstaller.isInstalled(this)) {
            status.text = getString(R.string.status_ready)
            setButtonsEnabled(true)
            return
        }
        if (installing) return
        installing = true
        setButtonsEnabled(false)
        progress.visibility = View.VISIBLE
        progressText.visibility = View.VISIBLE
        status.text = getString(R.string.status_installing)
        Thread {
            try {
                AssetInstaller.install(applicationContext) { p ->
                    runOnUiThread {
                        progress.max = p.entriesTotal.coerceAtLeast(1)
                        progress.progress = p.entriesDone
                        val phase = if (p.phase == "core") "游戏代码" else "美术与音频"
                        progressText.text = "解压$phase ${p.entriesDone}/${p.entriesTotal} · ${p.bytes / (1024 * 1024)} MB"
                    }
                }
                runOnUiThread {
                    installing = false
                    progress.visibility = View.GONE
                    progressText.visibility = View.GONE
                    status.text = getString(R.string.status_ready)
                    setButtonsEnabled(true)
                    DebugLog.i("install", "install finished")
                }
            } catch (e: Exception) {
                DebugLog.e("install", "install failed", e)
                runOnUiThread {
                    installing = false
                    progress.visibility = View.GONE
                    progressText.visibility = View.GONE
                    status.text = "资源安装失败：${e.message}"
                    setButtonsEnabled(true)
                }
            }
        }.apply { name = "asset-install" }.start()
    }

    private fun confirmReinstall() {
        AlertDialog.Builder(this)
            .setTitle("重装资源包")
            .setMessage("清除已解压的游戏文件并重新解压（约 1 分钟）。用于升级失败或文件损坏时排查。")
            .setPositiveButton("重装") { _, _ ->
                AssetInstaller.invalidate(applicationContext)
                ensureInstalled()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    // ---------------------------------------------------------------- host flow

    private fun startHostFlow() {
        if (installing) {
            Toast.makeText(this, "资源解压中，请稍候", Toast.LENGTH_SHORT).show()
            return
        }

        // A server left running from the previous game (e.g. backed out of GameActivity)
        // is reused as-is — second tap re-enters instantly instead of failing on ports.
        when (val s = NodeRuntime.currentState) {
            is NodeRuntime.State.Running, is NodeRuntime.State.Starting -> {
                val existingPort = when (s) {
                    is NodeRuntime.State.Running -> s.port
                    else -> (s as NodeRuntime.State.Starting).port
                }
                if (NodeRuntime.isHealthy(existingPort)) {
                    DebugLog.i("host", "reusing running server on port $existingPort")
                    status.text = "服务器已在运行 · 端口 $existingPort"
                    updateLanHint()
                    NodeService.start(this, existingPort)
                    discovery = discovery ?: LanDiscovery(this) { }.also { it.register(existingPort) }
                    GameActivity.start(this, "http://127.0.0.1:$existingPort/")
                    return
                }
            }
            else -> { }
        }

        val port = NodeRuntime.freePort(prefs.getInt("port", 3000))
        activePort = port
        DebugLog.i("host", "host flow started (port=$port)")
        status.text = getString(R.string.status_starting_server)

        val root = AssetInstaller.nodeRoot(applicationContext)
        val state = NodeRuntime.ensureStarted(root, DebugLog.nodeLogFile, port)
        // always poll the port the runtime actually committed to, never the probed one
        val pollPort = when (state) {
            is NodeRuntime.State.Running -> state.port
            is NodeRuntime.State.Starting -> state.port
            else -> port
        }
        NodeRuntime.awaitHealthy(pollPort, 20_000) { ok ->
            runOnUiThread {
                if (ok) {
                    status.text = "服务器已就绪 · 端口 $pollPort"
                    updateLanHint()
                    if (Build.VERSION.SDK_INT >= 33 &&
                        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED
                    ) {
                        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATIONS)
                    }
                    NodeService.start(this, pollPort)
                    discovery = discovery ?: LanDiscovery(this) { }.also { it.register(pollPort) }
                    GameActivity.start(this, "http://127.0.0.1:$pollPort/")
                } else {
                    val tail = tailOf(DebugLog.nodeLogFile, 500)
                    status.text = getString(R.string.status_start_failed, tail)
                    DebugLog.e("host", "server failed to become healthy on port $pollPort; node.log tail:\n$tail")
                }
            }
        }
    }

    // ---------------------------------------------------------------- join flow

    private fun showJoinDialog() {
        DebugLog.i("join", "join dialog opened")
        val view = layoutInflater.inflate(R.layout.dialog_join, null)
        val hostsBox = view.findViewById<android.widget.LinearLayout>(R.id.lvHosts)
        val address = view.findViewById<EditText>(R.id.etAddress)
        address.setText(prefs.getString(P_LAST_HOST, ""))

        fun renderHosts(services: List<LanDiscovery.SpHost>) {
            hostsBox.removeAllViews()
            if (services.isEmpty()) {
                val empty = TextView(this).apply {
                    text = "（搜索中… 找不到就手动输入）"
                    textSize = 12f
                    setTextColor(ContextCompat.getColor(context, R.color.textDim))
                    setPadding(4, 8, 4, 8)
                }
                hostsBox.addView(empty)
                return
            }
            for (s in services) {
                val row = TextView(this).apply {
                    text = "${s.name}  ·  ${s.host}:${s.port}"
                    textSize = 14f
                    setTextColor(ContextCompat.getColor(context, R.color.textPrimary))
                    val pad = (8 * resources.displayMetrics.density).toInt()
                    setPadding(pad, pad / 2, pad, pad / 2)
                    background = getDrawable(R.drawable.host_row_bg)
                    isClickable = true
                    isFocusable = true
                    setOnClickListener {
                        address.setText("${s.host}:${s.port}")
                        Toast.makeText(context, "已填入房主地址", Toast.LENGTH_SHORT).show()
                    }
                }
                hostsBox.addView(row)
            }
            DebugLog.i("join", "discovered ${services.size} host(s)")
        }

        val d = LanDiscovery(this) { found ->
            runOnUiThread { renderHosts(found) }
        }
        discovery = d
        d.start()

        view.findViewById<TextView>(R.id.btnRefresh)?.setOnClickListener {
            renderHosts(emptyList())
            d.stop(); d.start()
        }

        val dialog = AlertDialog.Builder(this)
            .setTitle("加入对局")
            .setView(view)
            .setPositiveButton("连接") { _, _ ->
                val url = normalizeServerUrl(address.text.toString())
                if (url == null) {
                    Toast.makeText(this, "地址无效，示例：192.168.1.5:3000", Toast.LENGTH_LONG).show()
                } else {
                    prefs.edit().putString(P_LAST_HOST, address.text.toString().trim()).apply()
                    DebugLog.i("join", "connecting to $url")
                    GameActivity.start(this, url)
                }
            }
            .setNegativeButton("取消", null)
            .create()
        dialog.window?.setSoftInputMode(
            android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE or
                    android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        )
        dialog.setOnDismissListener {
            d.stop()
            if (discovery === d) discovery = null
        }
        dialog.show()
    }

    // ---------------------------------------------------------------- helpers

    private fun normalizeServerUrl(raw: String): String? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null
        val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "http://$trimmed"
        return try {
            val uri = android.net.Uri.parse(withScheme)
            if (uri.host.isNullOrBlank()) null else withScheme
        } catch (_: Exception) {
            null
        }
    }

    private fun updateEdgeLabel(px: Int) {
        val dp = (px / resources.displayMetrics.density).toInt()
        lblEdge.text = getString(R.string.edge_padding_label, px, dp)
    }

    /** Live preview of the irregular-screen padding: pull the UI in from both sides. */
    private fun applyEdgePaddingToRoot(px: Int) {
        val root = findViewById<View>(R.id.rootScroll)
        val lp = root.layoutParams as? android.view.ViewGroup.MarginLayoutParams ?: return
        if (lp.leftMargin != px || lp.rightMargin != px) {
            lp.leftMargin = px
            lp.rightMargin = px
            root.layoutParams = lp
        }
    }

    private fun updateLanHint() {
        val ips = lanAddresses()
        val port = activePort
        hostHint.text = if (ips.isEmpty()) {
            getString(R.string.host_hint_no_lan)
        } else {
            getString(R.string.host_hint, ips.joinToString(" 或 ") { "http://$it:$port" })
        }
    }

    private fun lanAddresses(): List<String> = try {
        val out = ArrayList<String>()
        val en = NetworkInterface.getNetworkInterfaces() ?: return emptyList()
        while (en.hasMoreElements()) {
            val nif = en.nextElement()
            nif.inetAddresses.asSequence()
                .filter { !it.isLoopbackAddress && it.address.size == 4 }
                .forEach { out.add(it.hostAddress ?: "") }
        }
        out.filter { it.isNotEmpty() }.distinct()
    } catch (_: Exception) {
        emptyList()
    }

    private fun setButtonsEnabled(enabled: Boolean) {
        btnHost.isEnabled = enabled
        btnJoin.isEnabled = enabled
    }

    private fun tailOf(file: File, maxChars: Int): String = try {
        val text = file.takeIf { it.isFile }?.readText() ?: "(无日志)"
        if (text.length > maxChars) "…" + text.takeLast(maxChars) else text
    } catch (_: Exception) {
        "(无法读取日志)"
    }
}
