package com.paper.stronghold

import java.io.File

/**
 * Thin Kotlin wrapper around the compiled JNI shim (node_start.cpp) that boots
 * the embedded Node.js runtime in-process. Replaces the previous JNA-based
 * lookup of node::Start by its C++ mangled name, which was ABI-fragile across
 * NDK/libc++ versions.
 */
object NodeRuntime {
    init {
        System.loadLibrary("node_start")
    }

    external fun setNativeEnv(key: String, value: String)

    external fun setWorkingDirectory(path: String)

    /**
     * Redirects stdout/stderr to [logPath] and calls node::Start, which blocks
     * until the Node program exits and returns its exit code. Must be invoked
     * on a dedicated thread.
     */
    external fun startNodeWithArguments(args: Array<String>, logPath: String): Int

    /**
     * Boots the Node server with the given [root] as working directory.
     *
     * Runs on a thread with a 16 MB stack — larger than the JVM default 8 MB —
     * because V8's JS stack shares the native thread stack and deep recursion
     * in uncaught paths can SIGSEGV before the engine can throw RangeError.
     * Blocks the calling thread until the server stops; returns its exit code.
     */
    fun start(root: File, logFile: File, port: Int): Int {
        setNativeEnv("PORT", port.toString())
        setNativeEnv("HOST", "0.0.0.0")
        setNativeEnv("NODE_ENV", "production")
        setWorkingDirectory(root.absolutePath)
        return startNodeWithArguments(
            arrayOf("node", "--no-warnings", File(root, "server/index.js").absolutePath),
            logFile.absolutePath
        )
    }
}
