package io.github.sganggs.stronghold

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

/**
 * First-run installer: unpacks the packed nodejs-project from APK assets into
 * filesDir/node (see scripts/pack-android.mjs for how the archives are built).
 *
 *  core.zip   → server/ shared/ data/ public/(code) node_modules/ws package.json   (small, re-applied on every code change)
 *  assets.zip → public/assets/ public/fonts/                                       (~280 MB, applied once per asset set)
 *
 * Each archive carries a SHA-256 in pack.json; a marker file in the target records
 * what was extracted, so app updates skip re-extracting identical assets (unlike a
 * plain versionName marker, code-only updates never re-extract 280 MB).
 */
object AssetInstaller {

    private const val BUFFER = 1 shl 20

    data class Progress(val phase: String, val entriesDone: Int, val entriesTotal: Int, val bytes: Long)

    data class PackMeta(val coreSha: String, val assetsSha: String, val coreEntries: Int, val assetsEntries: Int)

    fun nodeRoot(context: Context): File = File(context.filesDir, "node")

    fun readPackMeta(context: Context): PackMeta? = try {
        context.assets.open("pack.json").use {
            JSONObject(it.readBytes().decodeToString())
        }.let {
            PackMeta(
                coreSha = it.getString("coreSha"),
                assetsSha = it.getString("assetsSha"),
                coreEntries = it.optInt("coreEntries", 0),
                assetsEntries = it.optInt("assetsEntries", 0),
            )
        }
    } catch (e: Exception) {
        DebugLog.e("install", "pack.json unreadable", e); null
    }

    fun isInstalled(context: Context): Boolean {
        val meta = readPackMeta(context) ?: return false
        val root = nodeRoot(context)
        return File(root, "server/index.js").isFile &&
                File(root, "package.json").isFile &&
                File(root, "node_modules/ws/index.js").isFile &&
                File(root, "public/index.html").isFile &&
                marker(root, ".core.sha") == meta.coreSha &&
                File(root, "public/assets").isDirectory &&
                marker(root, ".assets.sha") == meta.assetsSha
    }

    /** Install synchronously; call on a worker thread. Reports progress to [onProgress]. */
    fun install(context: Context, onProgress: (Progress) -> Unit) {
        val meta = readPackMeta(context)
            ?: throw IllegalStateException("pack.json 缺失：请先运行 scripts/pack-android.mjs")
        val root = nodeRoot(context)
        root.mkdirs()

        // ---- core.zip: code + data; re-applied whenever its hash changes ----
        if (marker(root, ".core.sha") != meta.coreSha) {
            onProgress(Progress("core", 0, meta.coreEntries, 0))
            wipeCore(root)
            val n = extract(context, "core.zip", root) { done, bytes ->
                onProgress(Progress("core", done, meta.coreEntries, bytes))
            }
            DebugLog.i("install", "core.zip extracted: $n entries")
            writeMarker(root, ".core.sha", meta.coreSha)
        } else {
            DebugLog.i("install", "core.zip unchanged, skipped")
        }

        // ---- assets.zip: the big one; staging dir then swap so a crash can't leave a half set ----
        if (marker(root, ".assets.sha") != meta.assetsSha) {
            onProgress(Progress("assets", 0, meta.assetsEntries, 0))
            val stage = File(context.filesDir, "stage-assets")
            stage.deleteRecursively()
            stage.mkdirs()
            extract(context, "assets.zip", stage) { done, bytes ->
                onProgress(Progress("assets", done, meta.assetsEntries, bytes))
            }
            val pub = File(root, "public")
            pub.mkdirs()
            File(pub, "assets").deleteRecursively()
            File(pub, "fonts").deleteRecursively()
            val staged = stage.listFiles().orEmpty() // archive roots: public/assets, public/fonts
            for (f in staged) {
                val target = File(pub, f.name)
                if (target.exists()) target.deleteRecursively()
                if (!f.renameTo(target)) {
                    f.copyRecursively(target, overwrite = true)
                    f.delete()
                }
            }
            stage.deleteRecursively()
            writeMarker(root, ".assets.sha", meta.assetsSha)
            DebugLog.i("install", "assets.zip extracted & swapped")
        } else {
            DebugLog.i("install", "assets.zip unchanged, skipped")
        }
    }

    /** Drop everything the installer owns so the next [install] re-extracts from scratch. */
    fun invalidate(context: Context) {
        val root = nodeRoot(context)
        File(root, ".core.sha").delete()
        File(root, ".assets.sha").delete()
        File(context.filesDir, "stage-assets").deleteRecursively()
        DebugLog.i("install", "markers invalidated — resources will be re-extracted")
    }

    // ---------------------------------------------------------------- internals

    private fun marker(root: File, name: String): String? =
        File(root, name).takeIf { it.isFile }?.readText()?.trim()

    private fun writeMarker(root: File, name: String, value: String) {
        File(root, name).writeText(value)
    }

    /** Remove everything that belongs to core.zip, keeping public/assets + public/fonts. */
    private fun wipeCore(root: File) {
        listOf("server", "shared", "data", "node_modules", "package.json").forEach {
            File(root, it).deleteRecursively()
        }
        File(root, "public").listFiles()?.forEach {
            if (it.name != "assets" && it.name != "fonts") it.deleteRecursively()
        }
    }

    private fun extract(context: Context, assetName: String, outDir: File, onEntry: (Int, Long) -> Unit): Int {
        val outRoot = outDir.canonicalPath + File.separator
        var done = 0
        var bytes = 0L
        context.assets.open(assetName).use { raw ->
            ZipInputStream(raw.buffered(BUFFER)).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    if (!entry.isDirectory) {
                        val outFile = File(outDir, entry.name)
                        if (!outFile.canonicalPath.startsWith(outRoot)) {
                            throw SecurityException("zip-slip: ${entry.name}")
                        }
                        outFile.parentFile?.mkdirs()
                        FileOutputStream(outFile).use { out ->
                            val buf = ByteArray(BUFFER)
                            while (true) {
                                val r = zip.read(buf)
                                if (r < 0) break
                                out.write(buf, 0, r)
                            }
                        }
                        bytes += if (entry.size >= 0) entry.size else outFile.length()
                    }
                    zip.closeEntry()
                    done++
                    if (done % 50 == 0) onEntry(done, bytes)
                }
            }
        }
        onEntry(done, bytes)
        return done
    }
}
