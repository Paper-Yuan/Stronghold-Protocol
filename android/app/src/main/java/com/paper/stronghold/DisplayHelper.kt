package com.paper.stronghold

import android.view.Window
import android.view.WindowManager
import kotlin.math.abs

/**
 * High-refresh-rate support (120 Hz+).
 *
 * Many OEM skins (incl. ColorOS) park apps on a 60 Hz mode unless the app opts in.
 * We pick the highest-refresh display mode that matches the current resolution and
 * pin it via preferredDisplayModeId. When the user turns the toggle off we fall back
 * to the mode closest to 60 Hz (battery friendly).
 */
object DisplayHelper {

    @Suppress("DEPRECATION")
    fun apply(window: Window, highRefresh: Boolean) {
        try {
            val wm = window.context.getSystemService(WindowManager::class.java)
            val display = wm.defaultDisplay ?: return
            val current = display.mode
            val candidates = display.supportedModes.filter {
                it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight
            }
            if (candidates.isEmpty()) return
            val target = if (highRefresh) {
                candidates.maxByOrNull { it.refreshRate } ?: current
            } else {
                candidates.minByOrNull { abs(it.refreshRate - 60f) } ?: current
            }

            val lp = window.attributes
            // Guard: only touch the window when the pinned mode actually changes, so repeated
            // calls (onCreate + onWindowFocusChanged) stay cheap.
            if (lp.preferredDisplayModeId != target.modeId) {
                lp.preferredDisplayModeId = target.modeId
                window.attributes = lp
                FileLogger.i("display", "refresh target=${target.refreshRate}Hz (mode ${target.modeId}), highRefresh=$highRefresh")
            }
        } catch (e: Exception) {
            FileLogger.e("display", "apply failed", e)
        }
    }
}
