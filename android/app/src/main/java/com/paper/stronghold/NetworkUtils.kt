package com.paper.stronghold

import android.content.Context
import android.net.wifi.WifiManager
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.Executors

object NetworkUtils {
    // Cellular / bridge adapters: not useful for hosting
    private val HARD_IGNORED_IFACES = setOf("lo", "ppp", "ifb", "dummy", "br", "rndis")

    /** Address description for host UI showing Wi-Fi / VPN / LAN IPs. */
    data class HostAddress(
        val ip: String,
        val ifaceName: String,
        val typeLabel: String, // "Wi-Fi 局域网", "虚拟专网 (UU/Tailscale/ZeroTier)", "以太网/热点"
        val isVpnOrVirtual: Boolean,
    )

    /**
     * The device's best LAN IPv4 — the one to publish for co-op — or "127.0.0.1" when there is none.
     * See [lanAddresses] for why this is a ranking rather than the first adapter found.
     */
    fun getLocalIpAddress(context: Context): String = lanAddresses(context).firstOrNull() ?: "127.0.0.1"

    /**
     * Checks if an IPv4 address is in RFC 6598 CGNAT range (100.64.0.0/10),
     * heavily used by Tailscale, ZeroTier, UU, and mobile carriers.
     */
    private fun isCgnat(addr: Inet4Address): Boolean {
        val bytes = addr.address
        if (bytes.size != 4) return false
        val b0 = bytes[0].toInt() and 0xff
        val b1 = bytes[1].toInt() and 0xff
        return b0 == 100 && (b1 in 64..127)
    }

    /**
     * Returns all usable IPv4 addresses for hosting a game, categorized by interface type.
     * Includes Wi-Fi LAN as well as virtual LANs (Tailscale, ZeroTier, UU booster).
     */
    fun allUsableAddresses(context: Context): List<HostAddress> {
        val result = mutableListOf<HostAddress>()
        val seenIps = mutableSetOf<String>()

        // 1. Check Wi-Fi manager first (standard Wi-Fi IP)
        try {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val ipInt = wifiManager?.connectionInfo?.ipAddress ?: 0
            if (ipInt != 0) {
                val ip = "%d.%d.%d.%d".format(ipInt and 0xff, ipInt shr 8 and 0xff, ipInt shr 16 and 0xff, ipInt shr 24 and 0xff)
                if (seenIps.add(ip)) {
                    result.add(HostAddress(ip, "wlan0", "Wi-Fi 局域网", false))
                }
            }
        } catch (_: Exception) {
        }

        // 2. Enumerate all active network interfaces
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces != null && interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (iface.isLoopback || !iface.isUp) continue
                val name = iface.name.lowercase()
                if (name.startsWith("rmnet") || HARD_IGNORED_IFACES.any { name.startsWith(it) }) continue

                val isVpn = name.startsWith("tun") || name.startsWith("tap") || name.contains("vpn") ||
                        name.contains("tailscale") || name.contains("wg")
                val isWifi = name.startsWith("wlan") || name.startsWith("swlan") || name.startsWith("ap") || name.startsWith("ath")
                val isEth = name.startsWith("eth") || name.startsWith("usb")

                val typeLabel = when {
                    isVpn -> "虚拟专网 (异地联机/UU/Tailscale)"
                    isWifi -> "Wi-Fi 局域网"
                    isEth -> "以太网 / 共享网络"
                    else -> "网络接口 ($name)"
                }

                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (addr !is Inet4Address || addr.isLoopbackAddress || addr.isLinkLocalAddress) continue
                    // Accept site-local (10.x, 172.16-31.x, 192.168.x) or CGNAT (100.64.0.0/10) or any valid IPv4 on VPN
                    if (addr.isSiteLocalAddress || isCgnat(addr) || isVpn) {
                        val host = addr.hostAddress ?: continue
                        if (seenIps.add(host)) {
                            result.add(HostAddress(host, iface.name, typeLabel, isVpn))
                        }
                    }
                }
            }
        } catch (_: Exception) {
        }

        // Wi-Fi first, then Ethernet, then VPN
        return result.sortedWith(compareBy({ if (it.isVpnOrVirtual) 1 else 0 }, { rank(it.ifaceName) }))
    }

    /** One Stronghold server answered on the local network. `app` is the server's release, `protocol` the wire version. */
    data class LanHost(val ip: String, val app: String, val protocol: Int, val rooms: Int, val self: Boolean)

    /**
     * Every site-local IPv4 the device currently holds, Wi-Fi first.
     */
    fun lanAddresses(context: Context): List<String> {
        return allUsableAddresses(context).map { it.ip }
    }

    private fun rank(name: String): Int = when {
        name == "wlan0" -> 0
        name.startsWith("wlan") || name.startsWith("swlan") -> 1
        name.startsWith("ap") || name.startsWith("ath") -> 2
        name.startsWith("eth") -> 3
        name.startsWith("tun") || name.startsWith("tap") -> 4
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
