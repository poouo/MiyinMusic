package com.miyin.mobile

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.PixelFormat
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.abs

/** Playback-service-owned overlay; no Activity reference is retained. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
object DesktopLyrics {
    val styles = listOf("emerald" to "翡翠流光", "sky" to "晴空蓝紫", "rose" to "落霞粉金", "classic" to "经典白色", "glass" to "半透明玻璃")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var job: Job? = null
    private var player: ExoPlayer? = null
    private var song: Song? = null
    private var lines: List<LyricLine> = emptyList()
    private var overlay: LyricView? = null
    private var manager: WindowManager? = null

    fun bind(context: Context, value: ExoPlayer) { player = value; configure(context) }
    fun setSong(value: Song) { song = value; lines = emptyList() }
    fun setLyrics(value: List<LyricLine>) { lines = value }

    fun configure(context: Context) {
        job?.cancel(); job = null
        val app = context.applicationContext
        val prefs = AppPrefs(app)
        remove()
        if (!prefs.desktopLyrics || !Settings.canDrawOverlays(app) || player == null) return
        manager = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        job = scope.launch {
            while (isActive) {
                val current = player
                val track = song
                if (current != null && track != null && current.currentMediaItem?.mediaId == track.key) {
                    val lyricPosition = current.currentPosition + ListeningStore(app).lyricOffset
                    val index = lines.indexOfLast { it.timeMs <= lyricPosition }
                    val text = lines.getOrNull(index)?.text?.takeIf { it.isNotBlank() } ?: "${track.name} · ${track.singer}"
                    val next = lines.getOrNull(index + 1)?.text ?: track.singer
                    val progress = if (index >= 0 && index + 1 < lines.size)
                        ((lyricPosition - lines[index].timeMs).toFloat() / (lines[index + 1].timeMs - lines[index].timeMs).coerceAtLeast(1)).coerceIn(0f, 1f) else 1f
                    try {
                        val view = overlay ?: LyricView(app).also {
                            manager?.addView(it, it.params); overlay = it
                        }
                        view.update(text, next, progress)
                    } catch (_: RuntimeException) { remove(); job?.cancel(); break }
                } else remove()
                delay(180)
            }
        }
    }

    private fun remove() {
        overlay?.let { runCatching { manager?.removeView(it) } }
        overlay = null
    }
    fun release() { job?.cancel(); job = null; remove(); player = null; song = null; lines = emptyList(); manager = null }

    private class LyricView(context: Context) : View(context) {
        private val prefs = AppPrefs(context)
        private val density = resources.displayMetrics.density
        private val scaled = resources.displayMetrics.scaledDensity
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        private var first = ""
        private var second = ""
        private var progress = 0f
        private var downY = 0f
        private var initialY = 0
        private var moved = false
        private val heightPx = ((if (prefs.lyricDoubleLine) 120 else 88) * density).toInt()
        val params = WindowManager.LayoutParams(
            resources.displayMetrics.widthPixels - (24 * density).toInt(), heightPx,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                (if (prefs.lyricLocked) WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE else 0),
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; y = clampY(prefs.lyricY) }

        init { contentDescription = "觅音悬浮歌词"; setLayerType(LAYER_TYPE_SOFTWARE, null) }
        private fun clampY(y: Int) = y.coerceIn(0, (resources.displayMetrics.heightPixels - heightPx - 32 * density).toInt().coerceAtLeast(0))
        fun update(text: String, next: String, value: Float) {
            if (first == text && second == next && abs(progress - value) < .015f) return
            first = text; second = next; progress = value; invalidate()
        }
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            if (prefs.lyricStyle == "glass") {
                paint.shader = null; paint.style = Paint.Style.FILL; paint.color = Color.argb(205, 18, 28, 34)
                canvas.drawRoundRect(0f, 0f, width.toFloat(), height.toFloat(), 20 * density, 20 * density, paint)
            }
            val colors = when (prefs.lyricStyle) {
                "sky" -> intArrayOf(0xff64deff.toInt(), 0xffb79dff.toInt())
                "rose" -> intArrayOf(0xffff88bf.toInt(), 0xffffd78f.toInt())
                "classic" -> intArrayOf(Color.WHITE, Color.WHITE)
                else -> intArrayOf(0xff5affbf.toInt(), 0xffffe580.toInt())
            }
            drawLine(canvas, first, 41 * density, prefs.lyricSize * scaled, colors, progress)
            if (prefs.lyricDoubleLine) drawLine(canvas, second, 78 * density, prefs.lyricSize * scaled * .7f, intArrayOf(0xffdce6f1.toInt(), 0xffdce6f1.toInt()), 1f)
            if (!prefs.lyricLocked) {
                paint.shader = null; paint.clearShadowLayer()
                paint.style = Paint.Style.STROKE; paint.strokeWidth = 1.8f * density; paint.color = Color.LTGRAY
                val centerY = height - 16 * density
                val lockX = width - 88 * density
                canvas.drawRoundRect(lockX - 6 * density, centerY - 2 * density, lockX + 6 * density,
                    centerY + 7 * density, 2 * density, 2 * density, paint)
                canvas.drawArc(lockX - 4 * density, centerY - 9 * density, lockX + 4 * density,
                    centerY + 3 * density, 180f, 180f, false, paint)
                val closeX = width - 32 * density
                canvas.drawLine(closeX - 5 * density, centerY - 5 * density, closeX + 5 * density, centerY + 5 * density, paint)
                canvas.drawLine(closeX + 5 * density, centerY - 5 * density, closeX - 5 * density, centerY + 5 * density, paint)
            }
        }
        private fun drawLine(canvas: Canvas, text: String, baseline: Float, size: Float, colors: IntArray, value: Float) {
            paint.shader = null; paint.typeface = android.graphics.Typeface.DEFAULT_BOLD; paint.textSize = size
            val available = width - 28 * density
            val measured = paint.measureText(text)
            if (measured > available) paint.textSize *= available / measured
            paint.textAlign = Paint.Align.CENTER
            paint.style = Paint.Style.STROKE; paint.strokeWidth = 2.5f * density; paint.color = 0xee0a161f.toInt()
            paint.setShadowLayer(3 * density, 0f, density, Color.BLACK)
            canvas.drawText(text, width / 2f, baseline, paint)
            paint.clearShadowLayer(); paint.style = Paint.Style.FILL; paint.color = 0xffdce6f1.toInt()
            canvas.drawText(text, width / 2f, baseline, paint)
            paint.shader = LinearGradient(0f, baseline - size, 0f, baseline, colors, null, Shader.TileMode.CLAMP)
            val actualWidth = paint.measureText(text)
            canvas.save(); canvas.clipRect((width - actualWidth) / 2 - 3 * density, 0f,
                (width - actualWidth) / 2 + (actualWidth + 6 * density) * value, height.toFloat())
            canvas.drawText(text, width / 2f, baseline, paint); canvas.restore(); paint.shader = null
        }
        override fun onTouchEvent(event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downY = event.rawY; initialY = params.y; moved = false; return true }
                MotionEvent.ACTION_MOVE -> {
                    if (abs(event.rawY - downY) > 6 * density) moved = true
                    if (moved) { params.y = clampY(initialY + (event.rawY - downY).toInt()); runCatching { manager?.updateViewLayout(this, params) } }
                    return true
                }
                MotionEvent.ACTION_UP -> {
                    if (moved) prefs.lyricY = params.y
                    else if (event.y > height - 32 * density && event.x > width - 120 * density) {
                        if (event.x > width - 65 * density) prefs.desktopLyrics = false else prefs.lyricLocked = true
                        configure(context)
                    } else performClick()
                    return true
                }
                MotionEvent.ACTION_CANCEL -> return true
            }
            return super.onTouchEvent(event)
        }
        override fun performClick(): Boolean { super.performClick(); return true }
    }
}
