package io.github.sganggs.stronghold

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Comprehensive on-device debug logging (user request: 全面 debug 日志写入).
 *
 * Everything the app does — lifecycle, asset extraction, embedded node boot/health,
 * NSD discovery, WebView console output and page errors — is appended to
 * files/logs/debug.log (rotated at 2 MB, three generations kept). The embedded
 * server additionally writes its own stdout/stderr to files/logs/node.log
 * (dup2'd there by cpp/node_start.cpp). File logs are the source of truth because
 * several OEM skins (e.g. vivo OriginOS) filter third-party logcat output.
 *
 * 「分享日志」 on the launcher screen exports all of it via any share target.
 */
object DebugLog {

    private const val TAG = "DebugLog"
    private const val MAX_BYTES = 2L * 1024 * 1024
    private const val KEEP = 3

    private lateinit var logDir: File
    private val writer = Executors.newSingleThreadExecutor()
    private val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)

    val nodeLogFile: File get() = File(logDir, "node.log")

    fun init(context: Context) {
        logDir = File(context.filesDir, "logs").apply { mkdirs() }
        rotateIfNeeded()
        i("app", "==== Stronghold Protocol Android ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) ====")
        i("app", "device: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} " +
                "(SDK ${Build.VERSION.SDK_INT}), abi=${Build.SUPPORTED_ABIS.firstOrNull()}, " +
                "mem=${(Runtime.getRuntime().maxMemory() / (1024 * 1024))}MB")
    }

    val logFiles: List<File>
        get() = if (this::logDir.isInitialized) logDir.listFiles()?.sortedByDescending { it.name } ?: emptyList() else emptyList()

    fun i(tag: String, msg: String) = write("I", tag, msg)
    fun w(tag: String, msg: String) = write("W", tag, msg)
    fun e(tag: String, msg: String, tr: Throwable? = null) =
        write("E", tag, msg + (tr?.let { " :: ${it.javaClass.simpleName}: ${it.message}" } ?: ""))

    /** WebView console (console.log/warn/error from the game) → file. */
    fun console(level: Int, message: String, source: String) {
        val lv = when (level) {
            3 -> "W"; 4 -> "E"; else -> "I"
        }
        write(lv, "webview", "$message  ($source)")
    }

    private fun write(level: String, tag: String, msg: String) {
        when (level) {
            "W" -> Log.w(tag, msg)
            "E" -> Log.e(tag, msg)
            else -> Log.i(tag, msg)
        }
        if (!this::logDir.isInitialized) return
        val line = "${fmt.format(Date())} [$level/$tag] $msg\n"
        writer.execute {
            try {
                rotateIfNeeded()
                FileWriter(File(logDir, "debug.log"), true).use { it.write(line) }
            } catch (_: Exception) { /* logging must never crash the app */ }
        }
    }

    private fun rotateIfNeeded() {
        val current = File(logDir, "debug.log")
        if (current.isFile && current.length() > MAX_BYTES) {
            File(logDir, "debug-${KEEP - 1}.log").delete()
            for (i in KEEP - 2 downTo 1) {
                File(logDir, "debug-$i.log").renameTo(File(logDir, "debug-${i + 1}.log"))
            }
            current.renameTo(File(logDir, "debug-1.log"))
        }
    }

    /** Share every log file (debug*.log + node.log) via any app that accepts text files. */
    fun share(context: Context) {
        val uris = ArrayList<android.net.Uri>()
        for (f in logFiles + listOf(nodeLogFile)) {
            if (f.isFile && f.length() > 0) {
                uris.add(FileProvider.getUriForFile(context, context.packageName + ".logs", f))
            }
        }
        if (uris.isEmpty()) {
            android.widget.Toast.makeText(context, "暂无日志", android.widget.Toast.LENGTH_SHORT).show()
            return
        }
        val intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "text/plain"
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "分享调试日志"))
    }
}
