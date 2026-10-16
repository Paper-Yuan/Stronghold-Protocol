package com.paper.stronghold

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.MessageDigest

/**
 * 「本地全量素材」加速（连**别人的**服务器时用）。
 *
 * 安卓端把整包美术/音频装进了 app_bundle（含已应用的热更补丁），所以这些字节本来就在手机上。而服务端发出的 URL 是
 * **内容寻址**的（`assetViews.js`）：`/assets/~<hash>/<rel>`、`/fonts/~<hash>/<rel>`，音频到客户端变成
 * `/media/~<hash>/<rel>`（`public/js/media.js`）。哈希规则是公开且确定的：
 *
 *   * 普通文件：`sha256(bytes)` 的前 16 位十六进制（`server/http/assetIndex.js` 的 `hash16`）；
 *   * Spine 模型：skeleton / atlas / pages **共用一个哈希** = `sha256(成员各自的哈希按 \n 连接)` 的前 16 位
 *     （同文件的 `modelHashOf`）。成员可由 `skel`、同目录同名 `.atlas`、`<stem>.png` 约定推出；多页模型推不全 → 放弃。
 *
 * 于是：本地有同名文件且**哈希对得上** → 就地发（毫秒级、零网络、也不占服务器带宽）；对不上（对方服务器上的素材与手机
 * 这版不同）→ 返回 null，让 WebView 照常走网络。**绝不猜**：发错图比慢更糟。
 *
 * 结果按 (路径, 大小, mtime) 缓存自己的哈希、按 skeleton 路径缓存模型哈希，所以每份文件只算一次。
 */
object AssetFastPath {
    private const val HASH_HEX = 16
    private const val IMMUTABLE = "public, max-age=2592000, immutable"
    private val AUDIO_EXTS = listOf(".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav")
    private val HASHED = Regex("^/(assets|fonts|media)/~([0-9a-f]{$HASH_HEX})/(.+)$", RegexOption.IGNORE_CASE)

    private class Stamp(val size: Long, val mtime: Long)

    /** 本地文件 → 它自己的哈希（只算一次）。 */
    private val ownHash = HashMap<String, Pair<Stamp, String>>()
    /** skeleton 相对路径 → 模型哈希（null = 算不出来，别反复试）。 */
    private val modelHashCache = HashMap<String, Pair<Stamp, String?>>()
    private var hits = 0
    private var misses = 0

    /** 命中/未命中的统计（诊断面板与日志用）。 */
    fun stats(): String = "local asset fast path: $hits hit, $misses miss"

    /** 清空缓存（换服务器/换包之后调用）。 */
    fun reset() { ownHash.clear(); modelHashCache.clear(); hits = 0; misses = 0 }

    /**
     * 一条 `/assets/~h/rel`（或 fonts/media）请求能不能就地回答。
     * @param bundleDir `AssetManagerHelper.getBundleDir`
     * @param mimeOf 与现有拦截同一套 MIME 判定
     * @return 就地发的响应，或 null（交给网络）
     */
    fun open(context: Context, bundleDir: File, uri: Uri, mimeOf: (String) -> String): WebResourceResponse? {
        if (!bundleDir.exists()) return null
        // 只对**别人的**服务器生效：手机内置引擎（127.0.0.1 / localhost）本来就从本地磁盘读，对它的请求做哈希校验
        // 纯属烧 CPU（每张图一次 SHA-256，真机上这是最重的一环）。连别人的服务器时才走快路径。
        if (isOwnServer(uri)) return null
        val path = uri.path ?: return null
        val m = HASHED.find(path) ?: return null
        val kind = m.groupValues[1].lowercase()
        val hash = m.groupValues[2].lowercase()
        val rel = m.groupValues[3]
        if (rel.isEmpty() || rel.split('/').any { it.isEmpty() || it == "." || it == ".." }) return null
        val file = localFile(bundleDir, kind, rel) ?: run { count(false); return null }
        if (!verify(file, hash)) { count(false); return null }
        count(true)
        return try {
            WebResourceResponse(mimeOf(file.name), null, FileInputStream(file)).apply {
                responseHeaders = mapOf(
                    "Access-Control-Allow-Origin" to "*",
                    "Cache-Control" to IMMUTABLE,
                    "Content-Length" to file.length().toString(),
                    "Accept-Ranges" to "bytes",
                )
            }
        } catch (e: Exception) {
            FileLogger.w("fastpath", "open failed: $path (${e.message})")
            null
        }
    }

    /** 这条请求指向手机自己的内置服务？那就不需要本地快路径。 */
    private fun isOwnServer(uri: Uri): Boolean {
        val h = uri.host?.lowercase() ?: return false
        return h == "127.0.0.1" || h == "localhost" || h == "::1"
    }

    private fun count(hit: Boolean) {
        if (hit) {
            hits++
            if (hits == 1 || hits % 200 == 0) FileLogger.i("fastpath", stats())
        } else {
            misses++
            if (misses == 1 || misses % 500 == 0) FileLogger.i("fastpath", stats())
        }
    }

    /** 这条 URL 对应的本地文件：assets/fonts 是 `public/<kind>/<rel>`，media 是 `public/assets/audio/<rel>.<ext>`。 */
    private fun localFile(bundleDir: File, kind: String, rel: String): File? {
        if (kind == "assets" || kind == "fonts") {
            val f = File(bundleDir, "public/$kind/$rel")
            return if (f.isFile) f else null
        }
        // /media/bgm/x ← /assets/audio/bgm/x.mp3：客户端去掉了扩展名
        for (ext in AUDIO_EXTS) {
            val f = File(bundleDir, "public/assets/audio/$rel$ext")
            if (f.isFile) return f
        }
        return null
    }

    /** 本地字节与 URL 里的哈希是否一致：文件自己的哈希，或它所属 Spine 模型的哈希。 */
    private fun verify(file: File, hash: String): Boolean {
        val own = ownHashOf(file)
        if (own == hash) return true
        val skel = skeletonOf(file) ?: return false
        return modelHashOf(skel) == hash
    }

    private fun stamp(file: File): Stamp = Stamp(file.length(), file.lastModified())

    private fun ownHashOf(file: File): String {
        val key = file.absolutePath
        val st = stamp(file)
        ownHash[key]?.let { (s, h) -> if (s.size == st.size && s.mtime == st.mtime) return h }
        val h = sha16 { FileInputStream(file) }
        ownHash[key] = st to h
        return h
    }

    /** 这张图/骨骼属于哪个 Spine 模型（以 `<dir>/<stem>.skel` 相对 public/ 的路径标识），或 null。 */
    private fun skeletonOf(file: File): File? {
        val name = file.name
        val stem = when {
            name.endsWith(".skel") -> name.removeSuffix(".skel")
            name.endsWith(".atlas") -> name.removeSuffix(".atlas")
            name.endsWith(".png") -> name.removeSuffix(".png").trimEnd('0', '1', '2', '3', '4', '5', '6', '7', '8', '9')
            else -> return null
        }
        if (stem.isEmpty()) return null
        val dir = file.parentFile ?: return null
        val skel = File(dir, "$stem.skel")
        return if (skel.isFile && dir.name != "avatar" && dir.name != "portrait") skel else null
    }

    /**
     * Spine 模型的哈希：`sha256(成员哈希按 \n 连接)` 的前 16 位（与 server/http/assetIndex.js modelHashOf 同规则）。
     * 成员 = skeleton、同目录同名 atlas、同目录同名 `<stem>.png`；atlas 缺席或有多页时算出来的值自然对不上 → 走网络。
     */
    private fun modelHashOf(skel: File): String? {
        val key = skel.absolutePath
        val st = stamp(skel)
        modelHashCache[key]?.let { (s, h) -> if (s.size == st.size && s.mtime == st.mtime) return h }
        val stem = skel.name.removeSuffix(".skel")
        val dir = skel.parentFile
        val members = listOf(File(dir, "$stem.skel"), File(dir, "$stem.atlas"), File(dir, "$stem.png"))
            .filter { it.isFile }
        val h = if (members.isEmpty()) null else {
            val joined = members.joinToString("\n") { ownHashOf(it) }
            sha16 { joined.byteInputStream() }
        }
        modelHashCache[key] = st to h
        return h
    }

    /** `sha256` 前 16 位十六进制。 */
    private inline fun sha16(open: () -> InputStream): String {
        val md = MessageDigest.getInstance("SHA-256")
        open().use { ins ->
            val buf = ByteArray(1 shl 16)
            while (true) {
                val n = ins.read(buf)
                if (n <= 0) break
                md.update(buf, 0, n)
            }
        }
        val hex = md.digest().joinToString("") { "%02x".format(it) }
        return hex.take(HASH_HEX)
    }
}
