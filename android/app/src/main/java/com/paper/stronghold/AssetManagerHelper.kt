package com.paper.stronghold

import android.content.Context
import android.util.Log
import java.io.*
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream

object AssetManagerHelper {
    private const val TAG = "AssetManagerHelper"
    private const val BUNDLE_DIR_NAME = "bundle"
    private const val VERSION_FILE_NAME = ".bundle_version"
    private const val CURRENT_BUNDLE_VERSION = "0.1.0-r2"

    fun getBundleDir(context: Context): File {
        return File(context.filesDir, BUNDLE_DIR_NAME)
    }

    /**
     * Extracts bundled web & server files into filesDir if needed.
     */
    fun ensureAssetsExtracted(context: Context, onProgress: (String) -> Unit): Boolean {
        val targetDir = getBundleDir(context)
        val versionFile = File(targetDir, VERSION_FILE_NAME)

        if (versionFile.exists()) {
            val installedVersion = versionFile.readText().trim()
            if (installedVersion == CURRENT_BUNDLE_VERSION) {
                Log.d(TAG, "Assets already up-to-date ($installedVersion)")
                return true
            }
        }

        onProgress("正在解压游戏运行环境与资源…")
        Log.i(TAG, "Extracting bundled assets to ${targetDir.absolutePath}")

        if (targetDir.exists()) {
            targetDir.deleteRecursively()
        }
        targetDir.mkdirs()

        // 1. Try extracting zip bundle if exists
        try {
            val zipStream = context.assets.open("app_bundle.zip")
            unzip(zipStream, targetDir, onProgress)
            versionFile.writeText(CURRENT_BUNDLE_VERSION)
            Log.i(TAG, "Unzipped app_bundle.zip successfully")
            return true
        } catch (e: FileNotFoundException) {
            Log.d(TAG, "app_bundle.zip not present, falling back to direct asset copy")
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to unzip app_bundle.zip", e)
        }

        // 2. Fallback: Copy directly from assets/bundle folder if present
        try {
            copyAssetFolder(context, "bundle", targetDir)
            versionFile.writeText(CURRENT_BUNDLE_VERSION)
            return true
        } catch (e: Throwable) {
            Log.e(TAG, "Error copying assets", e)
            return false
        }
    }

    private fun unzip(inputStream: InputStream, targetDir: File, onProgress: (String) -> Unit) {
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
                        onProgress("正在释放作战资源包 ($fileCount / 9200)…")
                    }
                }
                zis.closeEntry()
                entry = zis.nextEntry
            }
        }
        onProgress("作战资源释放完成，正在启动引擎…")
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
