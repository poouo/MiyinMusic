package com.miyin.mobile

import android.content.Context
import android.media.audiofx.Equalizer
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlin.math.ln
import kotlin.math.roundToInt

data class EqPreset(val id: String, val name: String, val gains: List<Float>)

object EqualizerEngine {
    val frequencies = listOf(60f, 230f, 910f, 3600f, 14000f)
    val labels = listOf("60 Hz", "230 Hz", "910 Hz", "3.6 kHz", "14 kHz")
    val presets = listOf(
        EqPreset("flat", "原声", listOf(0f, 0f, 0f, 0f, 0f)),
        EqPreset("pop", "流行", listOf(-1f, 2f, 4f, 2f, -1f)),
        EqPreset("rock", "摇滚", listOf(5f, 3f, -2f, 3f, 5f)),
        EqPreset("classical", "古典", listOf(3f, 1f, -1f, 2f, 3f)),
        EqPreset("vocal", "人声", listOf(-3f, 0f, 4f, 3f, -2f)),
        EqPreset("bass", "低音增强", listOf(6f, 4f, 0f, -1f, -2f))
    )
    private var effect: Equalizer? = null
    var status by mutableStateOf("开始播放后生效")
        private set

    fun gains(prefs: AppPrefs): List<Float> = presets.find { it.id == prefs.eqPreset }?.gains ?: prefs.eqCustomBands

    fun attach(context: Context, sessionId: Int) {
        release()
        if (sessionId <= 0) return
        try {
            effect = Equalizer(0, sessionId)
            apply(AppPrefs(context))
        } catch (_: Exception) {
            status = "当前设备或音频输出不支持系统均衡器"
        }
    }

    fun apply(prefs: AppPrefs) {
        val eq = effect ?: return
        try {
            val range = eq.bandLevelRange
            val gains = gains(prefs)
            for (band in 0 until eq.numberOfBands.toInt()) {
                val hz = eq.getCenterFreq(band.toShort()) / 1000f
                eq.setBandLevel(band.toShort(), (gainAt(hz, gains) * 100).roundToInt()
                    .coerceIn(range[0].toInt(), range[1].toInt()).toShort())
            }
            eq.enabled = prefs.eqEnabled
            status = if (prefs.eqEnabled) "均衡器已生效" else "均衡器已关闭"
        } catch (_: Exception) {
            status = "当前设备无法应用均衡器"
        }
    }

    // Map the saved five bands to the actual band count/frequencies offered by the device.
    internal fun gainAt(hz: Float, gains: List<Float>): Float {
        if (hz <= frequencies.first()) return gains.first()
        if (hz >= frequencies.last()) return gains.last()
        val upper = frequencies.indexOfFirst { it >= hz }.coerceAtLeast(1)
        val lower = upper - 1
        val fraction = (ln(hz) - ln(frequencies[lower])) / (ln(frequencies[upper]) - ln(frequencies[lower]))
        return gains[lower] + (gains[upper] - gains[lower]) * fraction
    }

    fun release() {
        runCatching { effect?.release() }
        effect = null
        status = "开始播放后生效"
    }
}
