package io.github.sganggs.stronghold

import android.view.Window
import android.view.WindowManager
import kotlin.math.abs

/**
 * High-refresh-rate support (user request: 适配 120 帧以上).
 *
 * Many OEM skins (incl. ColorOS) park apps on a 60 Hz mode unless they opt in.
 * We pick the highest-refresh display mode that matches the current resolution and
 * pin it via preferredDisplayModeId (Ace5: 60/90/120 Hz modes, picks 120).
 * When the user turns the toggle off we fall back to the mode closest to 60 Hz
 * (perf/battery friendly, user request: 不吃性能).
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
            if (lp.preferredDisplayModeId != target.modeId) {
                lp.preferredDisplayModeId = target.modeId
                window.attributes = lp
                DebugLog.i("display", "refresh target=${target.refreshRate}Hz (mode ${target.modeId}), highRefresh=$highRefresh")
            }
        } catch (e: Exception) {
            DebugLog.e("display", "apply failed", e)
        }
    }
}
