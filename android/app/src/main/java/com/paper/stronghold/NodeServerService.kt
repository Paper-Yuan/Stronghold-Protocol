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

        @Volatile
        var stateListener: ServerStateListener? = null

        val serverLogs = ArrayDeque<String>(250)
        @Synchronized
        fun addLog(line: String) {
            if (serverLogs.size >= 250) serverLogs.removeFirst()
            serverLogs.addLast(line)
            // Mirror the embedded server's output into the rotating file log (FileLogger) so the
            // shareable debug.log carries server stdout too; the in-memory ring stays as-is.
            FileLogger.i("node", line)
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
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(1, TimeUnit.SECONDS)
        .readTimeout(1, TimeUnit.SECONDS)
        .build()

    private val nodeStartFunction: Function by lazy {
        NativeLibrary.getInstance("node")
            .getFunction("_ZN4node5StartEiPPc") // node::Start(int argc, char** argv)
    }

    private fun notifyServerReady() {
        sendBroadcast(Intent(ACTION_SERVER_READY).setPackage(packageName))
        stateListener?.onServerStateChanged(ACTION_SERVER_READY, null)
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

        // 3. Set POSIX environment variables: bind to 0.0.0.0 for LAN co-op + local solo
        try {
            PosixLib.INSTANCE.setenv("PORT", "3000", 1)
            PosixLib.INSTANCE.setenv("HOST", "0.0.0.0", 1)
            PosixLib.INSTANCE.setenv("NODE_ENV", "production", 1)
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
            val maxAttempts = 30
            var attempt = 0
            while (!isStopped.get() && attempt < maxAttempts) {
                Thread.sleep(500)
                attempt++
                try {
                    val request = Request.Builder()
                        .url("http://127.0.0.1:3000/healthz")
                        .build()
                    httpClient.newCall(request).execute().use { response ->
                        if (response.isSuccessful) {
                            Log.i(TAG, "Local server is healthy and responding!")
                            addLog("[READY] Local game server running at http://127.0.0.1:3000 (code ${response.code})")
                            val notif = buildNotification("本地服务已就绪 · 端口 3000")
                            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                            manager.notify(NOTIFICATION_ID, notif)
                            notifyServerReady()
                            return@Thread
                        }
                    }
                } catch (_: Exception) {
                    // Server still booting up
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
            try {
                val request = Request.Builder()
                    .url("http://127.0.0.1:3000/healthz")
                    .build()
                httpClient.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        notifyServerReady()
                    }
                }
            } catch (_: Exception) {}
        }, "health-check-instant").start()
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
