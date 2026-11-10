package com.miyin.mobile

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.sin

/** Local artwork keeps the first frame independent of image and network requests. */
@Composable
fun StartupScreen() {
    val colors = MaterialTheme.colorScheme
    val dark = colors.background.luminance() < .5f
    val motion = rememberInfiniteTransition(label = "startup")
    val rotation by motion.animateFloat(0f, 360f,
        infiniteRepeatable(tween(20_000, easing = LinearEasing)), label = "record-light")
    val phase by motion.animateFloat(0f, (2 * PI).toFloat(),
        infiniteRepeatable(tween(1300, easing = LinearEasing)), label = "waveform")

    BoxWithConstraints(Modifier.fillMaxSize().background(colors.background)
        .pointerInput(Unit) {
            awaitPointerEventScope {
                while (true) awaitPointerEvent().changes.forEach { it.consume() }
            }
        }) {
        Canvas(Modifier.fillMaxSize()) {
            drawRect(Brush.radialGradient(
                listOf(colors.primary.copy(alpha = if (dark) .13f else .09f), Color.Transparent),
                center = Offset(size.width * .8f, size.height * .28f), radius = size.width * .9f))
            drawRect(Brush.radialGradient(
                listOf(Color(0xFF84A69A).copy(alpha = .09f), Color.Transparent),
                center = Offset(size.width * .1f, size.height * .6f), radius = size.width * .8f))
        }
        val artSize = if (maxHeight < 480.dp) 140.dp else 224.dp
        Column(Modifier.align(Alignment.Center).offset(y = (-28).dp),
            horizontalAlignment = Alignment.CenterHorizontally) {
            Canvas(Modifier.size(artSize)) {
                scale(size.minDimension / 224f, pivot = Offset.Zero) {
                    val hub = Offset(112f, 112f)
                    drawCircle(Brush.radialGradient(listOf(colors.primary.copy(alpha = .10f), Color.Transparent), hub, 112f), 112f, hub)
                    drawCircle(Brush.linearGradient(if (dark) listOf(Color(0xFF3A322C), Color(0xFF211F1D))
                        else listOf(Color.White, Color(0xFFE9DFD4)), Offset(32f, 32f), Offset(190f, 192f)), 80f, hub)
                    for (radius in 36..74 step 7) {
                        drawCircle(colors.onSurface.copy(alpha = if (dark) .08f else .045f), radius.toFloat(), hub, style = Stroke(.7f))
                    }
                    rotate(rotation, hub) {
                        drawArc(Color.White.copy(alpha = if (dark) .23f else .85f), -155f, 85f, false,
                            Offset(32f, 32f), Size(160f, 160f), style = Stroke(1.5f, cap = StrokeCap.Round))
                        drawArc(colors.primary.copy(alpha = .16f), 22f, 100f, false,
                            Offset(10f, 10f), Size(204f, 204f), style = Stroke(.8f, cap = StrokeCap.Round))
                        drawCircle(colors.primary.copy(alpha = .4f), 2.5f, Offset(210f, 82f))
                    }
                    drawCircle(Brush.linearGradient(listOf(colors.primary.copy(alpha = .85f), colors.primary),
                        Offset(90f, 90f), Offset(135f, 140f)), 25f, hub)
                    val mark = Path().apply {
                        moveTo(97f, 121f); lineTo(97f, 106f)
                        cubicTo(97f, 102f, 101f, 101f, 104f, 105f)
                        lineTo(110f, 114f); quadraticTo(112f, 117f, 114f, 114f)
                        lineTo(120f, 105f); cubicTo(123f, 101f, 127f, 102f, 127f, 106f)
                        lineTo(127f, 121f)
                    }
                    drawPath(mark, colors.onPrimary, style = Stroke(3.5f, cap = StrokeCap.Round))
                    drawCircle(colors.onPrimary, 1.8f, Offset(112f, 128f))
                }
            }
            Text(stringResource(R.string.app_name), color = colors.onBackground, fontSize = 34.sp,
                fontWeight = FontWeight.Medium, letterSpacing = 6.sp)
            Spacer(Modifier.height(12.dp))
            Text(stringResource(R.string.startup_tagline), color = colors.onSurfaceVariant, fontSize = 14.sp, letterSpacing = 1.sp)
            Spacer(Modifier.height(18.dp))
            Text(stringResource(R.string.startup_wordmark), color = colors.onSurfaceVariant.copy(alpha = .5f), fontSize = 9.sp, letterSpacing = 3.sp)
        }
        Column(Modifier.align(Alignment.BottomCenter).safeDrawingPadding().padding(bottom = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally) {
            Canvas(Modifier.size(40.dp, 22.dp)) {
                for (bar in 0..4) {
                    val height = (5 + 10 * ((sin(phase + bar * .8f) + 1) / 2)).dp.toPx()
                    val x = size.width * (bar + 1) / 6
                    drawLine(colors.primary.copy(alpha = .55f), Offset(x, center.y - height / 2),
                        Offset(x, center.y + height / 2), 2.dp.toPx(), StrokeCap.Round)
                }
            }
            Spacer(Modifier.height(10.dp))
            Text(stringResource(R.string.startup_loading), color = colors.onSurfaceVariant.copy(alpha = .65f), fontSize = 11.sp, letterSpacing = 1.sp)
        }
    }
}
