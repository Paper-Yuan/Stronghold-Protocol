package com.paper.stronghold

import android.view.Window
import android.view.WindowManager
import kotlin.math.abs

/**
 * High-refresh-rate support (120 Hz+).
 *
 * Many OEM skins (incl. ColorOS, HyperOS) park apps on a 60 Hz mode unless the app opts in.
 * We pick the highest-refresh display mode that matches the current resolution and
 * pin it via preferredDisplayModeId. When the user turns the toggle off we unpin the high
 * mode and clamp the maximum refresh rate to 60 Hz (battery friendly).
 */
object DisplayHelper {

    @Suppress("DEPRECATION")
    fun apply(window: Window, highRefresh: Boolean) {
        try {
            val wm = window.context.getSystemService(WindowManager::class.java) ?: return
            val display = wm.defaultDisplay ?: return
            val current = display.mode ?: return
            val candidates = display.supportedModes?.filter {
                it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight
            } ?: emptyList()

            val lp = window.attributes
            var changed = false

            if (highRefresh) {
                // Find highest refresh rate mode (>= 90Hz preferred)
                val target = candidates.maxByOrNull { it.refreshRate } ?: current
                if (lp.preferredDisplayModeId != target.modeId) {
                    lp.preferredDisplayModeId = target.modeId
                    changed = true
                }
                if (lp.preferredRefreshRate != target.refreshRate) {
                    lp.preferredRefreshRate = target.refreshRate
                    changed = true
                }
                FileLogger.i("display", "high refresh ON: targetMode=${target.modeId} (${target.refreshRate}Hz)")
            } else {
                // Fallback to 60Hz:
                // 1. Check if there's an explicit ~60Hz mode in candidates (between 58Hz and 62Hz)
                val mode60 = candidates.firstOrNull { abs(it.refreshRate - 60f) <= 2f }
                val targetModeId = mode60?.modeId ?: 0 // 0 resets override to default
                if (lp.preferredDisplayModeId != targetModeId) {
                    lp.preferredDisplayModeId = targetModeId
                    changed = true
                }

                // 2. Clamp preferred refresh rate to 60Hz
                if (lp.preferredRefreshRate != 60f) {
                    lp.preferredRefreshRate = 60f
                    changed = true
                }
                FileLogger.i("display", "high refresh OFF: targetModeId=$targetModeId, preferredRefreshRate=60Hz")
            }

            if (changed) {
                window.attributes = lp
            }
        } catch (e: Exception) {
            FileLogger.e("display", "apply failed", e)
        }
    }
}
