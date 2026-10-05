package io.github.sganggs.stronghold

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import java.util.LinkedHashMap

/**
 * LAN multiplayer discovery (user request: 同一局域网联机功能).
 *
 * Host mode registers an mDNS service of type `_stronghold._tcp.` advertising the
 * embedded server's port; the join screen discovers and resolves those services,
 * so a friend only needs two taps to find the host phone. Manual IP entry remains
 * as fallback for networks that block multicast.
 */
class LanDiscovery(private val context: Context, private val onUpdate: (List<SpHost>) -> Unit) {

    data class SpHost(val name: String, val host: String?, val port: Int, val key: String)

    companion object {
        const val TYPE = "_stronghold._tcp."
        fun serviceName(): String = "卫戍协议·" + (Build.MODEL ?: "Android").trim()
    }

    private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private var multicastLock: WifiManager.MulticastLock? = null
    private val services = LinkedHashMap<String, SpHost>()
    private var discovering = false

    // ---------------------------------------------------------------- discovery

    private val discoveryListener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(regType: String) { DebugLog.i("nsd", "discovery started: $regType") }
        override fun onDiscoveryStopped(serviceType: String) { DebugLog.i("nsd", "discovery stopped") }
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
            DebugLog.e("nsd", "start discovery failed: $serviceType code=$errorCode")
            discovering = false
        }
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) { /* ignore */ }
        override fun onServiceLost(serviceInfo: NsdServiceInfo) {
            val key = serviceInfo.serviceName
            services.remove(key)
            DebugLog.i("nsd", "lost: $key")
            publish()
        }
        override fun onServiceFound(serviceInfo: NsdServiceInfo) {
            DebugLog.i("nsd", "found: ${serviceInfo.serviceName}")
            resolve(serviceInfo)
        }
    }

    private fun resolve(info: NsdServiceInfo) {
        val resolved = object : NsdManager.ResolveListener {
            override fun onServiceResolved(sInfo: NsdServiceInfo) {
                val name: String = sInfo.serviceName
                val host: String? = sInfo.host?.hostAddress
                val port: Int = sInfo.port
                DebugLog.i("nsd", "resolved: $name -> $host:$port")
                if (host != null) {
                    services[name] = SpHost(name, host, port, name)
                    publish()
                }
            }

            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                DebugLog.e("nsd", "resolve failed: ${info.serviceName} code=$errorCode")
            }
        }
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                nsd.resolveService(info, context.mainExecutor, resolved)
            } catch (e: Exception) {
                DebugLog.e("nsd", "resolve (api34) failed", e)
                @Suppress("DEPRECATION")
                nsd.resolveService(info, resolved)
            }
        } else {
            @Suppress("DEPRECATION")
            nsd.resolveService(info, resolved)
        }
    }

    fun start() {
        if (discovering) return
        try {
            multicastLock = wifi?.createMulticastLock("sp-mdns")?.apply {
                setReferenceCounted(false); acquire()
            }
            nsd.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
            discovering = true
        } catch (e: Exception) {
            DebugLog.e("nsd", "discoverServices threw", e)
        }
    }

    fun stop() {
        if (!discovering) return
        discovering = false
        try { nsd.stopServiceDiscovery(discoveryListener) } catch (e: Exception) { DebugLog.w("nsd", "stop failed") }
        services.clear(); publish()
        multicastLock?.takeIf { it.isHeld }?.release()
        multicastLock = null
    }

    // ------------------------------------------------------------ registration

    private var registrationListener: NsdManager.RegistrationListener? = null

    fun register(port: Int) {
        unregister()
        val info = NsdServiceInfo().apply {
            serviceName = serviceName()
            serviceType = TYPE
            setPort(port)
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(nsdServiceInfo: NsdServiceInfo) {
                DebugLog.i("nsd", "registered: ${nsdServiceInfo.serviceName}:$port")
            }
            override fun onRegistrationFailed(nsdServiceInfo: NsdServiceInfo, errorCode: Int) {
                DebugLog.e("nsd", "register failed code=$errorCode")
            }
            override fun onServiceUnregistered(nsdServiceInfo: NsdServiceInfo) {
                DebugLog.i("nsd", "unregistered")
            }
            override fun onUnregistrationFailed(nsdServiceInfo: NsdServiceInfo, errorCode: Int) { /* ignore */ }
        }
        try {
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
            registrationListener = listener
        } catch (e: Exception) {
            DebugLog.e("nsd", "registerService threw", e)
        }
    }

    fun unregister() {
        registrationListener?.let {
            try { nsd.unregisterService(it) } catch (_: Exception) { }
            registrationListener = null
        }
    }

    private fun publish() = onUpdate(services.values.toList())
}
