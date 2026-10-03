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
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class NodeServerService : Service() {
    companion object {
        private const val TAG = "NodeServerService"
        const val CHANNEL_ID = "stronghold_server_channel"
        const val NOTIFICATION_ID = 1001

        const val ACTION_START = "com.paper.stronghold.START_SERVER"
        const val ACTION_STOP = "com.paper.stronghold.STOP_SERVER"
        const val ACTION_SERVER_READY = "com.paper.stronghold.SERVER_READY"
        const val ACTION_SERVER_FAILED = "com.paper.stronghold.SERVER_FAILED"

        val serverLogs = ArrayDeque<String>(250)
        @Synchronized
        fun addLog(line: String) {
            if (serverLogs.size >= 250) serverLogs.removeFirst()
            serverLogs.addLast(line)
        }
    }

    private val binder = LocalBinder()
    private var nodeProcess: Process? = null
    private val isRunning = AtomicBoolean(false)
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(1, TimeUnit.SECONDS)
        .readTimeout(1, TimeUnit.SECONDS)
        .build()

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
        if (isRunning.get()) {
            checkHealthAndNotify()
            return
        }

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

        Thread {
            try {
                val bundleDir = AssetManagerHelper.getBundleDir(this)
                val serverScript = File(bundleDir, "server/index.js")

                // Locate libnode.so in native library directory (executable permission guaranteed by OS installer)
                val nativeLibDir = applicationInfo.nativeLibraryDir
                val nodeBinary = File(nativeLibDir, "libnode.so")

                if (!nodeBinary.exists()) {
                    val msg = "Native libnode.so not found in $nativeLibDir. Please build with Node.js runtime or use Remote Server mode."
                    Log.w(TAG, msg)
                    addLog("[WARN] $msg")
                    sendBroadcast(Intent(ACTION_SERVER_FAILED).putExtra("reason", msg))
                    return@Thread
                }

                if (!serverScript.exists()) {
                    val msg = "Server script not found in ${serverScript.absolutePath}"
                    Log.e(TAG, msg)
                    addLog("[ERROR] $msg")
                    sendBroadcast(Intent(ACTION_SERVER_FAILED).putExtra("reason", msg))
                    return@Thread
                }

                Log.i(TAG, "Launching Node server: ${nodeBinary.absolutePath} ${serverScript.absolutePath}")
                addLog("[BOOT] Starting Node.js game server on 127.0.0.1:3000...")

                val pb = ProcessBuilder(
                    nodeBinary.absolutePath,
                    serverScript.absolutePath
                )
                pb.directory(bundleDir)
                pb.environment()["PORT"] = "3000"
                pb.environment()["HOST"] = "127.0.0.1"
                pb.environment()["NODE_ENV"] = "production"
                pb.redirectErrorStream(true)

                val process = pb.start()
                nodeProcess = process
                isRunning.set(true)

                // Background thread to consume stdout/stderr
                Thread {
                    try {
                        BufferedReader(InputStreamReader(process.inputStream)).use { reader ->
                            var line: String?
                            while (reader.readLine().also { line = it } != null) {
                                line?.let {
                                    Log.d(TAG, "[Node] $it")
                                    addLog(it)
                                }
                            }
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error reading Node output", e)
                    }
                }.start()

                // Health check poller
                waitForHealth()

                val exitCode = process.waitFor()
                Log.w(TAG, "Node process exited with code $exitCode")
                addLog("[EXIT] Node process stopped with code $exitCode")
                isRunning.set(false)
            } catch (e: Exception) {
                Log.e(TAG, "Exception running Node server", e)
                addLog("[ERROR] ${e.message}")
                sendBroadcast(Intent(ACTION_SERVER_FAILED).putExtra("reason", e.message))
                isRunning.set(false)
            }
        }.start()
    }

    private fun waitForHealth() {
        val maxAttempts = 30
        var attempt = 0
        while (attempt < maxAttempts && isRunning.get()) {
            Thread.sleep(500)
            attempt++
            try {
                val request = Request.Builder()
                    .url("http://127.0.0.1:3000/healthz")
                    .build()
                httpClient.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        Log.i(TAG, "Local server is healthy and responding!")
                        addLog("[READY] Local game server running at http://127.0.0.1:3000")
                        val notif = buildNotification("本地服务已就绪 · 端口 3000")
                        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                        manager.notify(NOTIFICATION_ID, notif)
                        sendBroadcast(Intent(ACTION_SERVER_READY))
                        return
                    }
                }
            } catch (_: Exception) {
                // Server still booting up
            }
        }
        if (isRunning.get()) {
            addLog("[WARN] Healthcheck timed out after 15s")
        }
    }

    private fun checkHealthAndNotify() {
        Thread {
            try {
                val request = Request.Builder()
                    .url("http://127.0.0.1:3000/healthz")
                    .build()
                httpClient.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        sendBroadcast(Intent(ACTION_SERVER_READY))
                    }
                }
            } catch (_: Exception) {}
        }.start()
    }

    private fun stopNodeServer() {
        isRunning.set(false)
        try {
            nodeProcess?.destroy()
            nodeProcess = null
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping Node process", e)
        }
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
            .setSmallIcon(android.R.drawable.sym_def_app_icon)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }
}
