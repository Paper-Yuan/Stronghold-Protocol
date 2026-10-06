package com.paper.stronghold

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
 * Rotating on-device file logging.
 *
 * Key shell events (server start/ready/fail, WebView page lifecycle and errors,
 * renderer crashes, dialog decisions, embedded node stdout) are appended to
 * <external files>/logs/debug.log, rotated at 2 MB with three generations kept.
 * Writes are serialized on a single-thread executor; logging must never crash or
 * block the app. File logs are the source of truth because several OEM skins
 * filter third-party logcat output, so "it works in my logcat" is not evidence.
 *
 * 「分享日志」 in the diagnostics dialog exports every generation via any share target.
 * The in-memory ring in NodeServerService (getLogs) is unaffected and keeps working.
 */
object FileLogger {

    private const val TAG = "FileLogger"
    private const val MAX_BYTES = 2L * 1024 * 1024
    private const val KEEP = 3
    private const val TAIL_CHARS = 8192

    private lateinit var logDir: File
    private val logQueue = java.util.concurrent.LinkedBlockingQueue<Runnable>(500)
    private val writer = java.util.concurrent.ThreadPoolExecutor(
        1, 1, 0L, java.util.concurrent.TimeUnit.MILLISECONDS,
        logQueue,
        java.util.concurrent.ThreadPoolExecutor.DiscardOldestPolicy()
    )
    private val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
    @Volatile private var currentLogBytes: Long = 0L

    /**
     * logs/ under the app's external files dir (visible to the user over MTP / file
     * managers without root); falls back to internal storage if external is unavailable.
     */
    private fun dir(context: Context): File =
        File(context.getExternalFilesDir(null) ?: context.filesDir, "logs")

    fun init(context: Context) {
        logDir = dir(context).apply { mkdirs() }
        val current = File(logDir, "debug.log")
        currentLogBytes = if (current.isFile) current.length() else 0L
        rotateIfNeeded()
        i("app", "==== Stronghold Protocol Android ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) ====")
        i("app", "device: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} " +
                "(SDK ${Build.VERSION.SDK_INT}), abi=${Build.SUPPORTED_ABIS.firstOrNull()}")
    }

    /** All generations, newest first (debug.log, debug-1.log, debug-2.log). */
    val logFiles: List<File>
        get() = if (this::logDir.isInitialized) {
            logDir.listFiles()?.filter { it.name.startsWith("debug") }?.sortedByDescending { it.name }
                ?: emptyList()
        } else emptyList()

    fun i(tag: String, msg: String) = write("I", tag, msg)
    fun w(tag: String, msg: String) = write("W", tag, msg)
    fun e(tag: String, msg: String, tr: Throwable? = null) =
        write("E", tag, msg + (tr?.let { " :: ${it.javaClass.simpleName}: ${it.message}" } ?: ""))

    /** WebView console (console.log/warn/error from the game) -> file. */
    fun console(levelName: String?, message: String, source: String) {
        val lv = when (levelName) {
            "ERROR" -> "E"
            "WARNING" -> "W"
            else -> "I"
        }
        write(lv, "webview", "$message  ($source)")
    }

    /** Last [TAIL_CHARS] characters of the current debug.log, for the diagnostics dialog. */
    fun tail(): String {
        if (!this::logDir.isInitialized) return ""
        return try {
            val f = File(logDir, "debug.log")
            if (!f.isFile) "" else {
                val text = f.readText(Charsets.UTF_8)
                if (text.length > TAIL_CHARS) "…" + text.takeLast(TAIL_CHARS) else text
            }
        } catch (_: Exception) { "" }
    }

    private fun write(level: String, tag: String, msg: String) {
        when (level) {
            "W" -> Log.w(tag, msg)
            "E" -> Log.e(tag, msg)
            else -> Log.i(tag, msg)
        }
        if (!this::logDir.isInitialized) return
        val timestamp = System.currentTimeMillis()
        writer.execute {
            try {
                // fmt is executed strictly on the single-thread executor to prevent SimpleDateFormat race/freeze
                val line = "${fmt.format(Date(timestamp))} [$level/$tag] $msg\n"
                rotateIfNeeded()
                FileWriter(File(logDir, "debug.log"), true).use {
                    it.write(line)
                }
                currentLogBytes += line.toByteArray(Charsets.UTF_8).size
            } catch (_: Exception) { /* logging must never crash the app */ }
        }
    }

    private fun rotateIfNeeded() {
        if (currentLogBytes > MAX_BYTES) {
            val current = File(logDir, "debug.log")
            File(logDir, "debug-${KEEP - 1}.log").delete()
            for (i in KEEP - 2 downTo 1) {
                File(logDir, "debug-$i.log").renameTo(File(logDir, "debug-${i + 1}.log"))
            }
            current.renameTo(File(logDir, "debug-1.log"))
            currentLogBytes = 0L
        }
    }

    /** Share every log file via any app that accepts text files (ACTION_SEND_MULTIPLE + FileProvider). */
    fun share(context: Context) {
        val uris = ArrayList<android.net.Uri>()
        for (f in logFiles) {
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
