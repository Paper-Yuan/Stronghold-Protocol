package com.paper.stronghold

import android.content.Context
import android.util.Log
import java.io.*
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream

object AssetManagerHelper {
    private const val TAG = "AssetManagerHelper"
    private const val BUNDLE_DIR_NAME = "bundle"
    private const val VERSION_FILE_NAME = ".bundle_version"
    /** 全部素材解压完之后才说一次（以前每一片都喊一次，看三遍「完成」）。 */
    private const val DONE_MESSAGE = "作战资源释放完成，正在启动引擎…"

    /**
     * One line of `bundle.parts` — `<name>\t<bytes>\t<sha256>[\t<entries>]` (tools/bundle-android.mjs).
     * `entries` is the part's file count: present since 2026-10-29, absent in an older bundle (null → the loading text
     * shows the size only, without inventing a file count).
     */
    private data class PartInfo(val name: String, val bytes: Long, val entries: Int?)

    /** 「1,797」: thousands separators in every locale (a Arabic-locale phone must not show ١٬٧٩٧ here). */
    private fun group(n: Long): String = String.format(Locale.ROOT, "%,d", n)

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

    fun getBundleDir(context: Context): File {
        return File(context.filesDir, BUNDLE_DIR_NAME)
    }

    /**
     * Extracts bundled web & server files into filesDir if needed.
     */
    fun ensureAssetsExtracted(context: Context, onProgress: (String) -> Unit): Boolean {
        val targetDir = getBundleDir(context)
        val versionFile = File(targetDir, VERSION_FILE_NAME)
        val expectedVersion = getExpectedBundleVersion(context)

        if (versionFile.exists()) {
            val installedVersion = versionFile.readText().trim()
            if (installedVersion == expectedVersion) {
                Log.d(TAG, "Assets already up-to-date ($installedVersion)")
                return true
            }
        }

        onProgress("正在解压游戏运行环境与资源…")
        Log.i(TAG, "Extracting bundled assets to ${targetDir.absolutePath} (version: $expectedVersion)")

        if (targetDir.exists()) {
            targetDir.deleteRecursively()
        }
        targetDir.mkdirs()

        // 1. Try extracting the bundled archive — a single `app_bundle.zip`, or **parts**
        // (`app_bundle.partNN.zip`). Parts exist to get past AGP's `:app:compressReleaseAssets`, which cannot handle a
        // single assets file above 2 GiB (`Required array size too large` once the full asset set pushed the archive to
        // 3.03 GB). Each part is a **standalone zip over a disjoint file set**, so extracting them in name order into
        // the same directory is enough — nothing has to be concatenated. `bundle.parts` lists their sizes, sha256 and
        // (since 2026-10-29) file counts (written by tools/bundle-android.mjs); it is read *before* any extraction, so
        // the loading screen can say which pack is being unpacked and how big it is:
        //   「正在解压素材包 2/3（第 2 个包 · 1,797 MB · 2,273 个文件）」
        // 3-column manifests (an older bundle) still work: the size shows, the file count is left out.
        try {
            val partNames = context.assets.list("")
                ?.filter { Regex("^app_bundle\\.part\\d+\\.zip$").matches(it) }
                ?.sorted()
                ?: emptyList()
            if (partNames.isNotEmpty()) {
                val parts = readParts(context)
                Log.i(TAG, "Extracting ${partNames.size} bundle part(s): ${partNames.joinToString()}")
                for ((index, name) in partNames.withIndex()) {
                    val info = parts[name]
                    val last = index == partNames.lastIndex
                    onProgress(partMessage(info, index + 1, partNames.size))
                    context.assets.open(name).use { stream ->
                        // 「作战资源释放完成」 only after the LAST part: a per-part "完成" read like a stall.
                        unzip(stream, targetDir, onProgress, info?.entries, if (last) DONE_MESSAGE else null)
                    }
                }
                versionFile.writeText(expectedVersion)
                Log.i(TAG, "Unzipped ${partNames.size} bundle part(s) successfully ($expectedVersion)")
                return true
            }
            val zipStream = context.assets.open("app_bundle.zip")
            unzip(zipStream, targetDir, onProgress, null, DONE_MESSAGE)
            versionFile.writeText(expectedVersion)
            Log.i(TAG, "Unzipped app_bundle.zip successfully ($expectedVersion)")
            return true
        } catch (e: FileNotFoundException) {
            Log.d(TAG, "no bundle archive present, falling back to direct asset copy")
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to unzip the bundle archive", e)
        }

        // 2. Fallback: Copy directly from assets/bundle folder if present
        try {
            copyAssetFolder(context, "bundle", targetDir)
            versionFile.writeText(expectedVersion)
            return true
        } catch (e: Throwable) {
            Log.e(TAG, "Error copying assets", e)
            return false
        }
    }

    /**
     * Applies a downloaded zip patch on top of the existing bundle without deleting user data.
     */
    fun applyHotUpdatePatch(context: Context, patchInputStream: InputStream, patchVersion: String): Boolean {
        return try {
            val targetDir = getBundleDir(context)
            // `unzip` 的第 3 参是 `onProgress`（后面还有带默认值的 totalEntries / doneMessage），
            // 尾随 lambda 会被绑到最后那个 `String?` 参数上 —— 必须写成具名实参（2026-10-29 加按包文案时踩到）。
            unzip(patchInputStream, targetDir, onProgress = {})
            val versionFile = File(targetDir, VERSION_FILE_NAME)
            versionFile.writeText(patchVersion)
            Log.i(TAG, "Applied hot update patch successfully ($patchVersion)")
            true
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to apply hot update patch", e)
            false
        }
    }

    /**
     * `bundle.parts` → name → [PartInfo]. Format: `<name>\t<bytes>\t<sha256>[\t<entries>]`, one part per line; blank
     * lines and unparsable ones are skipped, and a missing manifest is not an error (the caller then falls back to the
     * old wording). Read from assets (≈ 300 B), never from the zip itself — no extraction, no seek.
     */
    private fun readParts(context: Context): Map<String, PartInfo> {
        val out = HashMap<String, PartInfo>()
        try {
            context.assets.open("bundle.parts").bufferedReader().useLines { lines ->
                for (raw in lines) {
                    val line = raw.trim()
                    if (line.isEmpty()) continue
                    val cols = line.split('\t')
                    if (cols.size < 3) continue
                    val bytes = cols[1].trim().toLongOrNull() ?: continue
                    val entries = if (cols.size >= 4) cols[3].trim().toIntOrNull() else null
                    val name = cols[0].trim()
                    out[name] = PartInfo(name, bytes, entries)
                }
            }
        } catch (e: Exception) {
            // an older APK has no manifest at all: the size/file count simply do not show
            Log.d(TAG, "bundle.parts unavailable: ${e.message}")
        }
        return out
    }

    /**
     * 「正在解压素材包 2/3（第 2 个包 · 1,797 MB · 2,273 个文件）」 — the pack's own size from `bundle.parts` (MiB, shown
     * as MB like the owner's example) and its file count when the manifest has the 4th column. Without a manifest line
     * the old wording stays: enough to see that something is happening.
     */
    private fun partMessage(info: PartInfo?, index: Int, count: Int): String {
        if (info == null) return "正在解压游戏运行环境与资源… ($index/$count)"
        val mb = group(info.bytes / 1048576L)
        val files = info.entries?.let { group(it.toLong()) }
        return if (files != null) {
            "正在解压素材包 $index/$count（第 $index 个包 · $mb MB · $files 个文件）"
        } else {
            "正在解压素材包 $index/$count（第 $index 个包 · $mb MB）"
        }
    }

    /**
     * @param totalEntries this part's file count from `bundle.parts`, the denominator of the in-part progress line;
     *   null (no manifest / 3-column manifest) → the line reports the count without a total instead of the old
     *   hard-coded `/ 9200` (the real total is 44,463 files across the three parts).
     * @param doneMessage spoken after the LAST archive only; null for a part that still has parts behind it (and for a
     *   hot-update patch, which passes a no-op progress callback anyway).
     */
    private fun unzip(
        inputStream: InputStream,
        targetDir: File,
        onProgress: (String) -> Unit,
        totalEntries: Int? = null,
        doneMessage: String? = null,
    ) {
        val buffer = ByteArray(65536)
        var fileCount = 0
        ZipInputStream(BufferedInputStream(inputStream, 65536)).use { zis ->
            var entry: ZipEntry? = zis.nextEntry
            while (entry != null) {
                val file = File(targetDir, entry.name)
                if (entry.isDirectory) {
                    file.mkdirs()
                } else {
                    file.parentFile?.mkdirs()
                    BufferedOutputStream(FileOutputStream(file), 65536).use { fos ->
                        var len: Int
                        while (zis.read(buffer).also { len = it } > 0) {
                            fos.write(buffer, 0, len)
                        }
                    }
                    fileCount++
                    if (fileCount % 300 == 0) {
                        onProgress(
                            if (totalEntries != null && totalEntries > 0) {
                                "正在释放作战资源包 (${group(fileCount.toLong())} / ${group(totalEntries.toLong())})…"
                            } else {
                                "正在释放作战资源包 (${group(fileCount.toLong())} 个文件)…"
                            }
                        )
                    }
                }
                zis.closeEntry()
                entry = zis.nextEntry
            }
        }
        if (doneMessage != null) onProgress(doneMessage)
    }

    private fun copyAssetFolder(context: Context, assetPath: String, targetDir: File) {
        val assets = context.assets.list(assetPath) ?: return
        if (assets.isEmpty()) {
            // It's a file
            val outFile = File(targetDir, File(assetPath).name)
            outFile.parentFile?.mkdirs()
            context.assets.open(assetPath).use { input ->
                FileOutputStream(outFile).use { output ->
                    input.copyTo(output)
                }
            }
        } else {
            // It's a directory
            val subDir = File(targetDir, File(assetPath).name)
            subDir.mkdirs()
            for (asset in assets) {
                copyAssetFolder(context, "$assetPath/$asset", subDir)
            }
        }
    }
}
