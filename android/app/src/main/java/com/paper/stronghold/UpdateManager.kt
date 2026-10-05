package com.paper.stronghold

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.*
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream

/**
 * UpdateManager — 负责热更新检测、下载、SHA-256 完整性校验、原子目录切换与自愈回滚。
 *
 * 核心设计原则：
 * 1. 离线优先：网络不可达时立即静默跳过，绝无阻塞、绝不阻碍本地单机与局域网运行。
 * 2. 原子性与安全看门狗：更新先解压到 staging 目录，校验通过后原子改名切换，写入 pending 标记；
 *    若新版本启动崩溃或异常，下次开机自动回滚至 backup 或内置包，绝不黑屏或假死。
 */
object UpdateManager {
    private const val TAG = "UpdateManager"
    private const val PREFS_NAME = "stronghold_update_prefs"
    const val KEY_MANIFEST_URL = "update_manifest_url"

    // 默认自建 Cloudflare R2 / CDN 根清单地址
    const val DEFAULT_MANIFEST_URL = "https://cdn.example.com/manifest.json"

    private val isUpdating = AtomicBoolean(false)
    private val mainHandler = Handler(Looper.getMainLooper())

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    data class UpdateManifest(
        val buildTag: String,
        val appVersion: String,
        val minApk: Int,
        val bundleUrl: String,
        val bundleSha256: String,
        val bundleSize: Long,
        val changelog: String,
        val updatedAt: String
    )

    fun getManifestUrl(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_MANIFEST_URL, DEFAULT_MANIFEST_URL) ?: DEFAULT_MANIFEST_URL
    }

    fun setManifestUrl(context: Context, url: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_MANIFEST_URL, url.trim())
            .apply()
    }

    fun getCurrentBuildTag(context: Context): String {
        val targetDir = AssetManagerHelper.getBundleDir(context)
        val versionFile = File(targetDir, ".bundle_version")
        if (versionFile.exists()) {
            val v = versionFile.readText().trim()
            if (v.isNotEmpty()) return v
        }
        return AssetManagerHelper.getExpectedBundleVersion(context)
    }

    /**
     * 异步检测是否有新版本。
     * @param manual 是否为用户主动点击（手动检测会在无网络时提示）
     */
    fun checkForUpdate(context: Context, manual: Boolean = false, onResult: (manifest: UpdateManifest?, message: String?) -> Unit) {
        val url = getManifestUrl(context)
        if (url.isBlank() || url.contains("example.com")) {
            if (manual) onResult(null, "未配置有效的自建 R2 更新清单地址")
            return
        }

        Thread {
            try {
                val req = Request.Builder().url(url).build()
                httpClient.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) {
                        mainHandler.post {
                            if (manual) onResult(null, "检查更新失败: HTTP ${resp.code}")
                        }
                        return@Thread
                    }
                    val bodyStr = resp.body?.string() ?: ""
                    val json = JSONObject(bodyStr)
                    val manifest = UpdateManifest(
                        buildTag = json.optString("buildTag", ""),
                        appVersion = json.optString("appVersion", ""),
                        minApk = json.optInt("minApk", 1),
                        bundleUrl = json.optString("bundleUrl", ""),
                        bundleSha256 = json.optString("bundleSha256", ""),
                        bundleSize = json.optLong("bundleSize", 0L),
                        changelog = json.optString("changelog", "有新的热更新可用"),
                        updatedAt = json.optString("updatedAt", "")
                    )

                    val currentTag = getCurrentBuildTag(context)
                    val pInfo = try { context.packageManager.getPackageInfo(context.packageName, 0) } catch (_: Exception) { null }
                    val currentApkVersionCode = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                        pInfo?.longVersionCode?.toInt() ?: 1
                    } else {
                        @Suppress("DEPRECATION")
                        pInfo?.versionCode ?: 1
                    }

                    if (currentApkVersionCode < manifest.minApk) {
                        mainHandler.post {
                            onResult(null, "需要更新基础 APK 安装包 (要求 v${manifest.minApk}+)")
                        }
                        return@Thread
                    }

                    if (manifest.buildTag.isNotBlank() && manifest.buildTag != currentTag) {
                        mainHandler.post {
                            onResult(manifest, "发现新版本: ${manifest.buildTag}")
                        }
                    } else {
                        mainHandler.post {
                            if (manual) onResult(null, "当前已是最新版本 ($currentTag)")
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Update check failed: ${e.message}")
                mainHandler.post {
                    if (manual) onResult(null, "无法连接更新服务器: ${e.message}")
                }
            }
        }.start()
    }

    /**
     * 执行下载与原子替换。
     */
    fun downloadAndApply(
        context: Context,
        manifest: UpdateManifest,
        onProgress: (stage: String, percent: Int) -> Unit,
        onComplete: (success: Boolean, message: String) -> Unit
    ) {
        if (!isUpdating.compareAndSet(false, true)) {
            onComplete(false, "已有更新任务正在进行中")
            return
        }

        Thread {
            val filesDir = context.filesDir
            val bundleDir = File(filesDir, "bundle")
            val stagingDir = File(filesDir, "bundle.staging")
            val backupDir = File(filesDir, "bundle.old")
            val pendingFile = File(filesDir, "bundle.pending")
            val tempZipFile = File(filesDir, "download_temp.zip")

            try {
                mainHandler.post { onProgress("正在下载热更新包…", 0) }

                // 1. 下载文件
                val req = Request.Builder().url(manifest.bundleUrl).build()
                httpClient.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) {
                        throw IOException("下载失败 HTTP ${resp.code}")
                    }
                    val body = resp.body ?: throw IOException("响应体为空")
                    val totalBytes = if (manifest.bundleSize > 0) manifest.bundleSize else body.contentLength()

                    body.byteStream().use { input ->
                        FileOutputStream(tempZipFile).use { output ->
                            val buffer = ByteArray(65536)
                            var read: Int
                            var downloaded: Long = 0
                            var lastPercent = -1

                            while (input.read(buffer).also { read = it } != -1) {
                                output.write(buffer, 0, read)
                                downloaded += read
                                if (totalBytes > 0) {
                                    val percent = ((downloaded * 100) / totalBytes).toInt().coerceIn(0, 100)
                                    if (percent != lastPercent) {
                                        lastPercent = percent
                                        mainHandler.post { onProgress("正在下载热更新包 ($percent%)", percent) }
                                    }
                                }
                            }
                        }
                    }
                }

                // 2. SHA-256 完整性哈希校验
                mainHandler.post { onProgress("正在校验包完整性…", 100) }
                val computedHash = computeSha256(tempZipFile)
                if (!computedHash.equals(manifest.bundleSha256, ignoreCase = true)) {
                    tempZipFile.delete()
                    throw IOException("哈希校验不匹配: 期望 ${manifest.bundleSha256.take(8)}..., 实际 ${computedHash.take(8)}...")
                }
                Log.i(TAG, "Bundle SHA-256 verified successfully.")

                // 3. 解压到 staging 临时目录
                mainHandler.post { onProgress("正在解压更新内容…", 100) }
                if (stagingDir.exists()) stagingDir.deleteRecursively()
                stagingDir.mkdirs()

                unzip(FileInputStream(tempZipFile), stagingDir)
                tempZipFile.delete()

                // 写入版本标记
                File(stagingDir, ".bundle_version").writeText(manifest.buildTag)

                // 4. 原子目录切换
                mainHandler.post { onProgress("正在应用更新…", 100) }
                if (backupDir.exists()) backupDir.deleteRecursively()

                if (bundleDir.exists()) {
                    if (!bundleDir.renameTo(backupDir)) {
                        throw IOException("无法备份当前运行版本")
                    }
                }

                if (!stagingDir.renameTo(bundleDir)) {
                    // 紧急回滚
                    backupDir.renameTo(bundleDir)
                    throw IOException("无法激活新版本目录")
                }

                // 写入看门狗 pending 文件
                pendingFile.writeText(manifest.buildTag)
                Log.i(TAG, "Hot update applied atomically. Tag: ${manifest.buildTag}")

                mainHandler.post {
                    isUpdating.set(false)
                    onComplete(true, "热更新已就绪！即将重新载入新版本。")
                }
            } catch (t: Throwable) {
                Log.e(TAG, "Update apply failed", t)
                tempZipFile.delete()
                stagingDir.deleteRecursively()
                isUpdating.set(false)
                mainHandler.post {
                    onComplete(false, "更新失败: ${t.message}")
                }
            }
        }.start()
    }

    /**
     * 自愈与回滚保护看门狗：
     * 若上次热更未能健康启动（pendingFile 存在），立刻回退至 backupDir 或内置包。
     */
    fun rollbackIfPending(context: Context) {
        val filesDir = context.filesDir
        val pendingFile = File(filesDir, "bundle.pending")
        if (!pendingFile.exists()) return

        Log.w(TAG, "Detected unfinalized update (bundle.pending exists). Initiating rollback...")
        val bundleDir = File(filesDir, "bundle")
        val backupDir = File(filesDir, "bundle.old")

        try {
            if (backupDir.exists() && backupDir.list()?.isNotEmpty() == true) {
                bundleDir.deleteRecursively()
                backupDir.renameTo(bundleDir)
                Log.i(TAG, "Rollback to bundle.old succeeded.")
            } else {
                bundleDir.deleteRecursively()
                Log.i(TAG, "Purged faulty bundle; will re-extract embedded assets.")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Rollback error: ${e.message}", e)
        } finally {
            pendingFile.delete()
        }
    }

    /**
     * 标记当前版本运行健康：服务与渲染均已成功。
     */
    fun markHealthy(context: Context) {
        val filesDir = context.filesDir
        val pendingFile = File(filesDir, "bundle.pending")
        if (pendingFile.exists()) {
            pendingFile.delete()
            Log.i(TAG, "Update marked healthy and finalized.")
        }
        val backupDir = File(filesDir, "bundle.old")
        if (backupDir.exists()) {
            Thread {
                try {
                    backupDir.deleteRecursively()
                    Log.i(TAG, "Cleaned legacy backup directory.")
                } catch (_: Exception) {}
            }.start()
        }
    }

    private fun computeSha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { fis ->
            val buf = ByteArray(65536)
            var n: Int
            while (fis.read(buf).also { n = it } != -1) {
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun unzip(inputStream: InputStream, targetDir: File) {
        val buffer = ByteArray(65536)
        ZipInputStream(BufferedInputStream(inputStream, 65536)).use { zis ->
            var entry: ZipEntry? = zis.nextEntry
            while (entry != null) {
                val file = File(targetDir, entry.name)
                if (entry.isDirectory) {
                    file.mkdirs()
                } else {
                    file.parentFile?.mkdirs()
                    FileOutputStream(file).use { fos ->
                        var len: Int
                        while (zis.read(buffer).also { len = it } > 0) {
                            fos.write(buffer, 0, len)
                        }
                    }
                }
                zis.closeEntry()
                entry = zis.nextEntry
            }
        }
    }
}
