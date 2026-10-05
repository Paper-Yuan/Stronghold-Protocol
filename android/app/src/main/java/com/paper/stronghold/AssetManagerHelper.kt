package com.paper.stronghold

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

/**
 * First-run / incremental installer: unpacks the packed game from APK assets into
 * filesDir/bundle (see tools/bundle-android.mjs for how the archives are built).
 *
 *  core.zip   → server/ shared/ data/ public/(code) node_modules/ws package.json  (small, re-applied on every code change)
 *  assets.zip → public/assets/ public/fonts/                                      (~280 MB, applied once per asset set)
 *
 * Each archive carries a SHA-256 in pack.json; marker files in the target dir record what was
 * extracted. Archives whose hash is unchanged are skipped, so a code-only app update no longer
 * re-extracts the full ~280 MB asset set (the old versionName marker forced that on every
 * update). assets.zip is applied through a staging dir + swap, so a crash can never leave a
 * half-installed asset set behind.
 */
object AssetManagerHelper {
    private const val TAG = "AssetManagerHelper"
    private const val BUNDLE_DIR_NAME = "bundle"
    private const val STAGE_DIR_NAME = "stage-assets"
    private const val CORE_MARKER = ".core.sha"
    private const val ASSETS_MARKER = ".assets.sha"
    private const val LEGACY_VERSION_FILE = ".bundle_version"
    private const val BUFFER = 1 shl 20

    /** Extraction progress; [phase] is "core", "assets" or "done". */
    data class Progress(val phase: String, val entriesDone: Int, val entriesTotal: Int)

    private data class PackMeta(
        val coreSha: String,
        val assetsSha: String,
        val coreEntries: Int,
        val assetsEntries: Int,
    )

    fun getBundleDir(context: Context): File = File(context.filesDir, BUNDLE_DIR_NAME)

    /**
     * The build tag of the bundle embedded in THIS APK (assets/bundle.sha256, written by
     * tools/bundle-android.mjs via tools/build-tag.mjs). UpdateManager uses it as the fallback
     * "current tag" until a hot update has been applied and written its own .bundle_version.
     */
    fun getExpectedBundleVersion(context: Context): String {
        return try {
            context.assets.open("bundle.sha256").bufferedReader().use { it.readText().trim() }
        } catch (_: Exception) {
            try {
                val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
                "${pInfo.versionName}"
            } catch (_: Exception) {
                "0.1.1-default"
            }
        }
    }

    /**
     * Extracts the bundled game into filesDir/bundle if needed. Call on a worker thread; reports
     * per-phase progress with entry counts. Returns false when pack.json is missing or an
     * archive fails to extract — safe to retry on the next launch.
     */
    fun ensureAssetsExtracted(context: Context, onProgress: (Progress) -> Unit): Boolean {
        val meta = readPackMeta(context)
        if (meta == null) {
            Log.e(TAG, "pack.json missing or unreadable — was the asset bundle built (tools/bundle-android.mjs)?")
            return false
        }
        val root = getBundleDir(context)
        root.mkdirs()

        return try {
            // ---- core.zip: code + data; re-applied whenever its hash changes ----
            if (marker(root, CORE_MARKER) != meta.coreSha) {
                onProgress(Progress("core", 0, meta.coreEntries))
                Log.i(TAG, "Extracting core.zip to ${root.absolutePath}")
                wipeCore(root)
                extract(context, "core.zip", root) { done ->
                    onProgress(Progress("core", done, meta.coreEntries))
                }
                writeMarker(root, CORE_MARKER, meta.coreSha)
                Log.i(TAG, "core.zip extracted (${meta.coreEntries} entries)")
            } else {
                Log.d(TAG, "core.zip unchanged, skipped")
            }

            // ---- assets.zip: the big one; staging dir then swap so a crash cannot leave a half set ----
            if (marker(root, ASSETS_MARKER) != meta.assetsSha) {
                onProgress(Progress("assets", 0, meta.assetsEntries))
                Log.i(TAG, "Extracting assets.zip to staging")
                val stage = File(context.filesDir, STAGE_DIR_NAME)
                stage.deleteRecursively()
                stage.mkdirs()
                extract(context, "assets.zip", stage) { done ->
                    onProgress(Progress("assets", done, meta.assetsEntries))
                }
                // Swap: replace public/assets + public/fonts with the staged copies, then record
                // the hash last — a crash before this point simply re-runs the whole phase.
                val pub = File(root, "public")
                pub.mkdirs()
                for (f in stage.listFiles().orEmpty()) { // archive roots: assets, fonts
                    val target = File(pub, f.name)
                    if (target.exists()) target.deleteRecursively()
                    if (!f.renameTo(target)) {
                        f.copyRecursively(target, overwrite = true)
                        f.deleteRecursively()
                    }
                }
                stage.deleteRecursively()
                writeMarker(root, ASSETS_MARKER, meta.assetsSha)
                Log.i(TAG, "assets.zip extracted & swapped (${meta.assetsEntries} entries)")
            } else {
                Log.d(TAG, "assets.zip unchanged, skipped")
            }

            onProgress(Progress("done", 0, 0))
            true
        } catch (e: Throwable) {
            Log.e(TAG, "Asset extraction failed", e)
            false
        }
    }

    // ---------------------------------------------------------------- internals

    private fun readPackMeta(context: Context): PackMeta? = try {
        val obj = context.assets.open("pack.json").use { JSONObject(it.readBytes().decodeToString()) }
        PackMeta(
            coreSha = obj.getString("coreSha"),
            assetsSha = obj.getString("assetsSha"),
            coreEntries = obj.optInt("coreEntries", 0),
            assetsEntries = obj.optInt("assetsEntries", 0),
        )
    } catch (e: Exception) {
        Log.e(TAG, "pack.json unreadable", e)
        null
    }

    private fun marker(root: File, name: String): String? =
        File(root, name).takeIf { it.isFile }?.readText()?.trim()

    private fun writeMarker(root: File, name: String, value: String) {
        File(root, name).writeText(value)
    }

    /** Remove everything that belongs to core.zip, keeping public/assets + public/fonts. */
    private fun wipeCore(root: File) {
        listOf("server", "shared", "data", "node_modules", "package.json", "licenses", LEGACY_VERSION_FILE).forEach {
            File(root, it).deleteRecursively()
        }
        File(root, "public").listFiles()?.forEach {
            if (it.name != "assets" && it.name != "fonts") it.deleteRecursively()
        }
    }

    private fun extract(context: Context, assetName: String, outDir: File, onEntry: (Int) -> Unit): Int {
        val outRoot = outDir.canonicalPath + File.separator
        var done = 0
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
                    }
                    zip.closeEntry()
                    done++
                    if (done % 50 == 0) onEntry(done)
                }
            }
        }
        onEntry(done)
        return done
    }
}
