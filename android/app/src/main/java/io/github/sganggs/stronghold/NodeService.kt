package io.github.sganggs.stronghold

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service that pins the embedded game server while it runs, so a hosting
 * phone survives brief app switches and aggressive battery managers (same lesson as
 * Paper-Yuan's port; we target API 36 which requires an FGS type — `specialUse`).
 */
class NodeService : Service() {

    companion object {
        private const val CHANNEL_ID = "stronghold_server"
        private const val NOTIFICATION_ID = 1001
        private const val EXTRA_PORT = "port"

        fun start(context: Context, port: Int) {
            val intent = Intent(context, NodeService::class.java).putExtra(EXTRA_PORT, port)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, NodeService::class.java))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val port = intent?.getIntExtra(EXTRA_PORT, 3000) ?: 3000
        startInForeground(port)
        return START_NOT_STICKY
    }

    private fun startInForeground(port: Int) {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "游戏服务器", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "本机作为房主时保持服务器运行"
                    setShowBadge(false)
                }
            )
        }
        val notification: Notification = androidx.core.app.NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_server)
            .setContentTitle("卫戍协议服务器运行中")
            .setContentText("端口 $port · 同一 Wi-Fi 下的朋友可以加入")
            .setOngoing(true)
            .setForegroundServiceBehavior(androidx.core.app.NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        DebugLog.i("service", "foreground service started (port=$port)")
    }

    /**
     * Swiping the app away must stop EVERYTHING (user request: 划掉后要能立刻重开).
     * A surviving process holding the embedded server would leave a zombie that
     * blocks an immediate relaunch — so exit the whole process deterministically.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        DebugLog.i("service", "task removed — stopping server process")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        android.os.Process.killProcess(android.os.Process.myPid())
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        DebugLog.i("service", "foreground service destroyed")
        super.onDestroy()
    }
}
