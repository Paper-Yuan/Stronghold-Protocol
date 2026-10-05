package com.paper.stronghold

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import com.sun.jna.Function
import com.sun.jna.Library
import com.sun.jna.Native
import com.sun.jna.NativeLibrary
import java.io.File
import java.io.RandomAccessFile
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Proxy
import java.net.ServerSocket
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

interface PosixLib : Library {
    companion object {
        val INSTANCE: PosixLib by lazy {
            Native.load("c", PosixLib::class.java)
        }
    }
    fun setenv(name: String, value: String, overwrite: Int): Int
    fun chdir(path: String): Int
    fun open(path: String, flags: Int, mode: Int): Int
    fun dup2(oldfd: Int, newfd: Int): Int
    fun close(fd: Int): Int
}

fun interface ServerStateListener {
    fun onServerStateChanged(action: String, extras: Map<String, Any>?)
}

class NodeServerService : Service() {
    companion object {
        private const val TAG = "NodeServerService"
        const val CHANNEL_ID = "stronghold_server_channel"
        const val NOTIFICATION_ID = 1001

        const val ACTION_START = "com.paper.stronghold.START_SERVER"
        const val ACTION_STOP = "com.paper.stronghold.STOP_SERVER"
        const val ACTION_SERVER_READY = "com.paper.stronghold.SERVER_READY"
        const val ACTION_SERVER_FAILED = "com.paper.stronghold.SERVER_FAILED"
        const val ACTION_SERVER_EXITED = "com.paper.stronghold.SERVER_EXITED"

        /** The port the embedded server is configured to start on; fallback may move it up (see pickFreePort). */
        const val DEFAULT_PORT = 3000

        /**
         * The port the embedded server actually committed to. Every health probe and every URL the UI
         * builds must poll this — never a hardcoded 3000 — because OEM port squatters can push the
         * server onto a fallback port.
         */
        @Volatile
        var committedPort: Int = DEFAULT_PORT

        /**
         * WHY multi-address: a VPN/TUN interface can intercept plain-http loopback traffic and make a
         * LIVE server look dead from inside the app. So a health probe must try 127.0.0.1 AND every
         * other IPv4 the device currently holds, and succeed if ANY of them answers ok:true.
         */
        fun healthCandidates(): List<String> {
            val out = mutableListOf("127.0.0.1")
            try {
                val interfaces = NetworkInterface.getNetworkInterfaces() ?: return out
                while (interfaces.hasMoreElements()) {
                    interfaces.nextElement().inetAddresses.asSequence()
                        // Skip loopback (already first); address.size == 4 keeps IPv4 only.
                        .filter { !it.isLoopbackAddress && it.address.size == 4 }
                        .forEach { out.add(it.hostAddress ?: "") }
                }
            } catch (_: Exception) {}
            return out.filter { it.isNotEmpty() }.distinct()
        }

        /**
         * The first candidate address (see [healthCandidates]) whose /healthz answers ok:true on
         * [port], or null when none does. Call on a background thread — it can block for a timeout
         * per candidate.
         */
        fun firstHealthyAddress(client: OkHttpClient, port: Int): String? =
            healthCandidates().firstOrNull { host -> probeHost(client, host, port) }

        private fun probeHost(client: OkHttpClient, host: String, port: Int): Boolean = try {
            val request = Request.Builder().url("http://$host:$port/healthz").build()
            client.newCall(request).execute().use { response ->
                response.isSuccessful && response.body?.string()?.contains("\"ok\":true") == true
            }
        } catch (_: Exception) {
            false // connect refused/timeout: server booting, or this address is intercepted
        }

        @Volatile
        var stateListener: ServerStateListener? = null

        val serverLogs = ArrayDeque<String>(250)
        @Synchronized
        fun addLog(line: String) {
            if (serverLogs.size >= 250) serverLogs.removeFirst()
            serverLogs.addLast(line)
        }

        @Synchronized
        fun getRecentLogs(limit: Int = 100): List<String> {
            val count = minOf(limit, serverLogs.size)
            return serverLogs.toList().takeLast(count)
        }
    }

    private val binder = LocalBinder()
    private val isRunning = AtomicBoolean(false)
    private val isStopped = AtomicBoolean(false)
    // WHY NO_PROXY: a VPN profile or system-wide proxy can divert plain-http requests — loopback
    // ones included — into a tunnel where the embedded server is unreachable, so a LIVE server
    // looks dead. Health probes must always go direct.
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(1, TimeUnit.SECONDS)
        .readTimeout(1, TimeUnit.SECONDS)
        .proxy(Proxy.NO_PROXY)
        .build()

    private val nodeStartFunction: Function by lazy {
        NativeLibrary.getInstance("node")
            .getFunction("_ZN4node5StartEiPPc") // node::Start(int argc, char** argv)
    }

    private fun notifyServerReady() {
        // The port rides along so the UI enters on the port the runtime actually committed to.
        sendBroadcast(Intent(ACTION_SERVER_READY).setPackage(packageName).putExtra("port", committedPort))
        stateListener?.onServerStateChanged(ACTION_SERVER_READY, mapOf("port" to committedPort))
    }

    private fun notifyServerFailed(reason: String) {
        sendBroadcast(Intent(ACTION_SERVER_FAILED).setPackage(packageName).putExtra("reason", reason))
        stateListener?.onServerStateChanged(ACTION_SERVER_FAILED, mapOf("reason" to reason))
    }

    private fun notifyServerExited(code: Int) {
        sendBroadcast(Intent(ACTION_SERVER_EXITED).setPackage(packageName).putExtra("exitCode", code))
        stateListener?.onServerStateChanged(ACTION_SERVER_EXITED, mapOf("exitCode" to code))
    }

    inner class LocalBinder : Binder() {
        fun getService(): NodeServerService = this@NodeServerService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startNodeServer()
            ACTION_STOP -> stopNodeServer()
        }
        return START_NOT_STICKY
    }

    private fun startNodeServer() {
        if (isRunning.get() && !isStopped.get()) {
            checkHealthAndNotify()
            return
        }

        isStopped.set(false)
        isRunning.set(true)

        try {
            val notification = buildNotification("正在启动作战模拟服务…")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Foreground service start caught: ${e.message}")
        }

        val bundleDir = AssetManagerHelper.getBundleDir(this)
        val serverScript = File(bundleDir, "server/index.js")
        val serverLogFile = File(filesDir, "server.log")

        if (!serverScript.exists()) {
            val msg = "Server script not found in ${serverScript.absolutePath}"
            Log.e(TAG, msg)
            addLog("[ERROR] $msg")
            isStopped.set(true)
            isRunning.set(false)
            notifyServerFailed(msg)
            return
        }

        // 1. Ensure C++ shared runtime and libnode.so are loaded
        try {
            System.loadLibrary("c++_shared")
        } catch (e: Throwable) {
            Log.w(TAG, "c++_shared load note: ${e.message}")
        }
        try {
            System.loadLibrary("node")
            Log.i(TAG, "libnode.so loaded via System.loadLibrary successfully")
        } catch (e: Throwable) {
            val msg = "Failed to load libnode.so: ${e.message}"
            Log.e(TAG, msg, e)
            addLog("[ERROR] $msg")
            isStopped.set(true)
            isRunning.set(false)
            notifyServerFailed(msg)
            return
        }

        // 2. Redirect stdout (fd 1) and stderr (fd 2) to filesDir/server.log
        try {
            // O_WRONLY(1) | O_CREAT(64) | O_TRUNC(512) = 577, mode 0644 (420)
            val logFd = PosixLib.INSTANCE.open(serverLogFile.absolutePath, 577, 420)
            if (logFd >= 0) {
                PosixLib.INSTANCE.dup2(logFd, 1)
                PosixLib.INSTANCE.dup2(logFd, 2)
                PosixLib.INSTANCE.close(logFd)
                addLog("[BOOT] stdio redirected to ${serverLogFile.absolutePath}")
            } else {
                addLog("[WARN] Posix open server.log returned $logFd")
            }
        } catch (e: Throwable) {
            Log.w(TAG, "Stdio redirection warning: ${e.message}")
            addLog("[WARN] Stdio redirection failed: ${e.message}")
        }

        // 0. Pre-flight: if the preferred port already serves a healthy server, attach to it
        //    (covers relaunches after the user backed out of the game).
        try {
            val req = Request.Builder().url("http://127.0.0.1:$DEFAULT_PORT/healthz").build()
            httpClient.newCall(req).execute().use { response ->
                if (response.isSuccessful) {
                    committedPort = DEFAULT_PORT
                    Log.i(TAG, "Port $DEFAULT_PORT is already active and healthy, attaching to existing server.")
                    addLog("[READY] 本地服务已在运行 (端口 $DEFAULT_PORT)，直接连接。")
                    isRunning.set(true)
                    isStopped.set(false)
                    notifyServerReady()
                    return
                }
            }
        } catch (_: Exception) {}

        // 3. Set POSIX environment variables: bind to 0.0.0.0 for LAN co-op + local solo.
        // WHY port fallback: some OEM images run squatters on common ports (ColorOS occupies
        // loopback 3000 on the test device), which used to kill startup outright. Pick the first
        // bindable port at/above the configured one and setenv("PORT") BEFORE node starts.
        committedPort = pickFreePort(DEFAULT_PORT)
        if (committedPort != DEFAULT_PORT) {
            addLog("[BOOT] Port $DEFAULT_PORT is occupied — falling back to $committedPort")
        }
        try {
            PosixLib.INSTANCE.setenv("PORT", committedPort.toString(), 1)
            PosixLib.INSTANCE.setenv("HOST", "0.0.0.0", 1)
            PosixLib.INSTANCE.setenv("NODE_ENV", "production", 1)
            PosixLib.INSTANCE.setenv("SP_EMBEDDED", "1", 1)
            val prefs = getSharedPreferences("stronghold_prefs", Context.MODE_PRIVATE)
            if (prefs.getBoolean("compat_mode", false)) {
                PosixLib.INSTANCE.setenv("SP_COMBAT", "server", 1)
            }
            PosixLib.INSTANCE.chdir(bundleDir.absolutePath)
        } catch (e: Throwable) {
            Log.w(TAG, "Posix env configuration warning: ${e.message}")
        }

        // 4. Start log tailer thread to mirror server.log into serverLogs deque
        startLogTailer(serverLogFile)

        // 5. Start healthcheck poller
        startHealthChecker()

        val argv = arrayOf("node", "--no-warnings", serverScript.absolutePath)

        // 6. Launch in-process Node on an expanded 8 MB stack thread (prevents V8 StackOverflow)
        val nodeThread = Thread(null, {
            try {
                addLog("[BOOT] Calling node::Start(_ZN4node5StartEiPPc) with args: ${argv.joinToString(" ")}")

                val exitCode = nodeStartFunction.invokeInt(arrayOf(argv.size, argv))

                isRunning.set(false)
                isStopped.set(true)
                Log.i(TAG, "In-process Node engine stopped with code $exitCode")
                addLog("[EXIT] Node server stopped with code $exitCode")
                notifyServerExited(exitCode)
                if (exitCode != 0) {
                    notifyServerFailed("引擎异常退出 (code $exitCode)")
                }
            } catch (t: Throwable) {
                isRunning.set(false)
                isStopped.set(true)
                val msg = "In-process Node execution failed: ${t.message}"
                Log.e(TAG, msg, t)
                addLog("[ERROR] $msg")
                notifyServerFailed(msg)
            }
        }, "node-main", 8 * 1024 * 1024)

        nodeThread.start()
    }

    private fun startLogTailer(logFile: File) {
        Thread({
            var lastPos = 0L
            while (!isStopped.get()) {
                if (logFile.exists() && logFile.length() > lastPos) {
                    try {
                        RandomAccessFile(logFile, "r").use { raf ->
                            raf.seek(lastPos)
                            var line: String?
                            while (raf.readLine().also { line = it } != null) {
                                line?.let {
                                    val decoded = String(it.toByteArray(Charsets.ISO_8859_1), Charsets.UTF_8)
                                    if (decoded.isNotBlank()) {
                                        addLog(decoded)
                                    }
                                }
                            }
                            lastPos = raf.filePointer
                        }
                    } catch (_: Exception) {}
                }
                try {
                    Thread.sleep(300)
                } catch (_: InterruptedException) {
                    break
                }
            }
        }, "server-log-tailer").start()
    }

    private fun startHealthChecker() {
        Thread({
            // Poll the port the runtime actually committed to, not a hardcoded 3000 (see pickFreePort).
            val port = committedPort
            val maxAttempts = 30
            var attempt = 0
            while (!isStopped.get() && attempt < maxAttempts) {
                Thread.sleep(500)
                attempt++
                // WHY multi-address: a VPN/TUN can intercept plain-http loopback traffic and make a
                // LIVE server look dead — so 127.0.0.1 AND every LAN IPv4 get a vote, and any one
                // answering ok:true means the server is up (see healthCandidates).
                val answeredBy = firstHealthyAddress(httpClient, port)
                if (answeredBy != null) {
                    Log.i(TAG, "Local server is healthy and responding on $answeredBy:$port!")
                    addLog("[READY] Local game server running at http://$answeredBy:$port (ok:true)")
                    val notif = buildNotification("本地服务已就绪 · 端口 $port")
                    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    manager.notify(NOTIFICATION_ID, notif)
                    notifyServerReady()
                    return@Thread
                }
            }
            if (!isStopped.get()) {
                val timeoutReason = "15 秒内 /healthz 未响应，服务启动超时"
                Log.e(TAG, timeoutReason)
                addLog("[ERROR] $timeoutReason")
                notifyServerFailed(timeoutReason)
            }
        }, "health-checker").start()
    }

    private fun checkHealthAndNotify() {
        Thread({
            // Same multi-address rule as the boot poller (see startHealthChecker): a VPN/TUN can
            // intercept loopback, so a live server must be recognized via its LAN address too.
            if (firstHealthyAddress(httpClient, committedPort) != null) {
                notifyServerReady()
            }
        }, "health-check-instant").start()
    }

    /**
     * First port at or above [preferred] this process can actually bind, walking up [tries] slots.
     * WHY: some OEM images squat on common ports (ColorOS occupies loopback 3000 on the test
     * device), so blindly starting on the configured port breaks startup. SO_REUSEADDR keeps
     * leftover TIME_WAIT sockets from faking "busy". Must run BEFORE node starts so the result
     * can be pushed into the PORT environment variable.
     */
    private fun pickFreePort(preferred: Int, tries: Int = 20): Int {
        for (offset in 0 until tries) {
            val candidate = preferred + offset
            try {
                ServerSocket().use { socket ->
                    socket.reuseAddress = true
                    socket.bind(InetSocketAddress(candidate))
                    return candidate
                }
            } catch (_: Exception) {
                // Port busy — try the next one.
            }
        }
        return preferred // nothing free in range: let node fail visibly on the configured port
    }

    private fun stopNodeServer() {
        isStopped.set(true)
        isRunning.set(false)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
        } catch (e: Exception) {
            Log.w(TAG, "stopForeground caught: ${e.message}")
        }
        stopSelf()
    }

    override fun onDestroy() {
        stopNodeServer()
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        // WHY deterministic exit: the Node server lives inside this process, so swiping the app
        // away used to leave a headless process with a live server behind — a zombie holding its
        // port that blocked an immediate relaunch. Tear the foreground service down and kill the
        // process outright instead of hoping the OS reaps it (START_NOT_STICKY alone is not
        // enough: the process itself would still be alive).
        addLog("[EXIT] Task removed: stopping service and exiting process")
        stopNodeServer()
        android.os.Process.killProcess(android.os.Process.myPid())
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Stronghold Local Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps the local Node.js battle simulator running in background"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(statusText: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("卫戍协议：盟约")
            .setContentText(statusText)
            .setSmallIcon(R.drawable.ic_stat_stronghold)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }
}
