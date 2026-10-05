package io.github.sganggs.stronghold

import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicReference

/**
 * Embedded Node.js server runtime (nodejs-mobile libnode + JNI glue, see cpp/node_start.cpp).
 *
 * The upstream game server (server/index.js) is started in-process on a dedicated thread;
 * it serves the web client and the WebSocket lobby on `port` exactly like `npm start` on a PC.
 * Combat runs in each player's browser (WebView), so LAN latency only affects round sync —
 * inherently low-latency for this game.
 */
object NodeRuntime {

    private const val TAG = "NodeRuntime"

    sealed class State {
        data object Idle : State()
        data class Starting(val port: Int) : State()
        data class Running(val port: Int) : State()
        data class Exited(val message: String?) : State()
    }

    private val state = AtomicReference<State>(State.Idle)
    private var thread: Thread? = null

    init {
        System.loadLibrary("node_start")
    }

    val currentState: State get() = state.get()

    /** Set an environment variable inside the native process before node starts. */
    external fun setNativeEnv(key: String, value: String)

    /** Blocks (native) until the node program exits — call on a worker thread. */
    external fun startNodeWithArguments(args: Array<String>, logPath: String)

    /**
     * Health check against ALL of the device's own addresses (loopback first, then
     * every LAN IP). Some VPN/TUN setups intercept plain-http loopback traffic,
     * which made a live server look dead from inside the app — probing the LAN IP
     * too keeps the check immune to that.
     */
    fun isHealthy(port: Int, timeoutMs: Int = 700): Boolean =
        healthCandidates(port).any { host -> probeHealth(host, port, timeoutMs) }

    private fun healthCandidates(port: Int): List<String> {
        val out = mutableListOf("127.0.0.1")
        try {
            val en = java.net.NetworkInterface.getNetworkInterfaces() ?: return out
            while (en.hasMoreElements()) {
                en.nextElement().inetAddresses.asSequence()
                    .filter { !it.isLoopbackAddress && it.address.size == 4 }
                    .forEach { out.add(it.hostAddress ?: "") }
            }
        } catch (_: Exception) { }
        return out.filter { it.isNotEmpty() }.distinct()
    }

    private fun probeHealth(host: String, port: Int, timeoutMs: Int): Boolean = try {
        val conn = URL("http://$host:$port/healthz").openConnection() as HttpURLConnection
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        conn.requestMethod = "GET"
        val body = conn.inputStream.use { it.readBytes().decodeToString() }
        conn.disconnect()
        body.contains("\"ok\":true")
    } catch (_: Exception) {
        false
    }

    /**
     * Start the server rooted at [root] (the extracted nodejs-project) if not already running.
     * Returns immediately; poll [isHealthy] (see [awaitHealthy]) for readiness.
     */
    @Synchronized
    fun ensureStarted(root: File, logFile: File, port: Int): State {
        state.get().let { when (it) {
            is State.Starting, is State.Running -> return it
            else -> {}
        } }
        if (isHealthy(port)) {
            val s = State.Running(port); state.set(s); return s
        }

        setNativeEnv("HOST", "0.0.0.0")
        setNativeEnv("PORT", port.toString())
        // Android WebView / LAN clients are not behind a proxy; skip proxy-header trust.
        setNativeEnv("TRUST_PROXY", "0")

        val entry = File(root, "server/index.js")
        // 16 MB stack: the default ~1 MB JVM thread stack can SIGSEGV V8 on deep
        // recursion while parsing large scripts (lesson from Paper-Yuan's port).
        val t = Thread(null, {
            state.set(State.Starting(port))
            try {
                startNodeWithArguments(arrayOf("node", entry.absolutePath), logFile.absolutePath)
                state.set(State.Exited(null))
            } catch (e: Throwable) {
                Log.e(TAG, "node runtime exited", e)
                DebugLog.e("node", "runtime exited", e)
                state.set(State.Exited(e.message))
            }
        }, "node-server", 16L * 1024 * 1024)
        t.start()
        thread = t
        return State.Starting(port)
    }

    /**
     * Pick a free port starting at [preferred]. Some OEM images run services on
     * common ports (e.g. ColorOS occupies loopback 3000 on this test device), so
     * the embedded server just moves up until it can bind.
     */
    fun freePort(preferred: Int, tries: Int = 20): Int {
        for (offset in 0 until tries) {
            val p = preferred + offset
            try {
                java.net.ServerSocket().use { s ->
                    s.reuseAddress = true // TIME_WAIT from the last session must not fake "busy"
                    s.bind(java.net.InetSocketAddress(p))
                    return p
                }
            } catch (_: Exception) { /* busy — try next */ }
        }
        return preferred
    }

    /** Poll [isHealthy] until ready or [timeoutMs] elapsed. Callback always fires on the caller thread. */
    fun awaitHealthy(port: Int, timeoutMs: Long, onResult: (Boolean) -> Unit) {
        val deadline = System.currentTimeMillis() + timeoutMs
        Thread {
            while (System.currentTimeMillis() < deadline) {
                if (isHealthy(port)) {
                    state.set(State.Running(port)); onResult(true); return@Thread
                }
                val s = state.get()
                if (s is State.Exited) { onResult(false); return@Thread }
                try { Thread.sleep(250) } catch (_: InterruptedException) { onResult(false); return@Thread }
            }
            onResult(false)
        }.apply { name = "node-health-poll" }.start()
    }
}
