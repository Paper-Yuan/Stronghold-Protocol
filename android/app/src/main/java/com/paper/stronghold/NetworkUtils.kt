package com.paper.stronghold

import android.content.Context
import android.net.wifi.WifiManager
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.Executors

object NetworkUtils {
    // Cellular / point-to-point / bridge adapters: never the LAN the friends are on.
    private val IGNORED_IFACES = setOf("lo", "tun0", "tap0", "ppp0", "ifb0", "dummy0", "br0", "rndis0", "usb0")

    /**
     * The device's best LAN IPv4 — the one to publish for co-op — or "127.0.0.1" when there is none.
     * See [lanAddresses] for why this is a ranking rather than the first adapter found.
     */
    fun getLocalIpAddress(context: Context): String = lanAddresses(context).firstOrNull() ?: "127.0.0.1"

    /** One Stronghold server answered on the local network. `app` is the server's release, `protocol` the wire version. */
    data class LanHost(val ip: String, val app: String, val protocol: Int, val rooms: Int, val self: Boolean)

    /**
     * Every site-local IPv4 the device currently holds, Wi-Fi first.
     *
     * Two things make this more than "ask Wi-Fi": without a location permission `WifiManager.connectionInfo`
     * reports 0 on Android 12+, and `NetworkInterface` enumeration order is not guaranteed — taking the first
     * address lands on a hotspot / USB-tethering / VPN adapter often enough to break LAN play, which then shows
     * friends an unreachable host and sweeps the wrong /24.
     */
    fun lanAddresses(context: Context): List<String> {
        val out = LinkedHashMap<String, Int>()
        try {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val ipInt = wifiManager?.connectionInfo?.ipAddress ?: 0
            if (ipInt != 0) {
                out["%d.%d.%d.%d".format(ipInt and 0xff, ipInt shr 8 and 0xff, ipInt shr 16 and 0xff, ipInt shr 24 and 0xff)] = 0
            }
        } catch (_: Exception) {
        }
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces != null && interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (iface.isLoopback || !iface.isUp || iface.name in IGNORED_IFACES || iface.name.startsWith("rmnet")) continue
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (addr !is Inet4Address || !addr.isSiteLocalAddress) continue
                    val host = addr.hostAddress ?: continue
                    out.putIfAbsent(host, rank(iface.name))
                }
            }
        } catch (_: Exception) {
        }
        return out.entries.sortedBy { it.value }.map { it.key }
    }

    private fun rank(name: String): Int = when {
        name == "wlan0" -> 0
        name.startsWith("wlan") || name.startsWith("swlan") -> 1
        name.startsWith("ap") || name.startsWith("ath") -> 2
        name.startsWith("eth") -> 3
        else -> 5
    }

    /**
     * Find which machine on the local network is hosting the co-op room [code], so a guest never has to type an
     * address. Uses the server's `/lan/room` probe, which answers only for a room that exists and is open.
     *
     * Blocking: a sweep is ~254 short HTTP requests per /24, done 32 at a time with a [timeoutMs] connect/read
     * budget — about two to three seconds per subnet on a home network. Call it from a background thread.
     */
    fun findRoom(localIps: List<String>, code: String, port: Int = 3000, timeoutMs: Int = 350): List<LanHost> {
        val prefixes = localIps.mapNotNull { prefixOf(it) }.distinct()
        if (prefixes.isEmpty() || code.isBlank()) return emptyList()
        val own = localIps.toSet()
        val targets = prefixes.flatMap { p -> (1..254).map { "$p.$it" } }.distinct()
        val pool = Executors.newFixedThreadPool(32)
        val found = java.util.concurrent.ConcurrentLinkedQueue<LanHost>()
        val latch = java.util.concurrent.CountDownLatch(targets.size)
        for (ip in targets) {
            pool.execute {
                try {
                    probeRoom(ip, port, code, own, timeoutMs)?.let { found.add(it) }
                } catch (_: Exception) {
                } finally {
                    latch.countDown()
                }
            }
        }
        latch.await()
        pool.shutdown()
        return found.sortedBy { it.ip.substringAfterLast('.').toIntOrNull() ?: 0 }
    }

    private fun probeRoom(ip: String, port: Int, code: String, ownIps: Set<String>, timeoutMs: Int): LanHost? {
        val conn = (java.net.URL("http://$ip:$port/lan/room?code=${java.net.URLEncoder.encode(code, "UTF-8")}")
            .openConnection() as java.net.HttpURLConnection).apply {
            connectTimeout = timeoutMs
            readTimeout = timeoutMs
            useCaches = false
        }
        return try {
            val j = org.json.JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            if (!j.optBoolean("ok")) return null
            LanHost(ip, j.optString("app"), 1, j.optInt("humans"), ip in ownIps)
        } catch (_: Exception) {
            null // 404 is the normal answer: this host has no room with that code
        } finally {
            conn.disconnect()
        }
    }

    private fun prefixOf(ip: String): String? {
        val parts = ip.split('.')
        if (parts.size != 4) return null
        return "${parts[0]}.${parts[1]}.${parts[2]}"
    }
}
