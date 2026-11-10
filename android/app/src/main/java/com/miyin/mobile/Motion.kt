package com.miyin.mobile

import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer

// Measured floating controls, including the system navigation inset.
val LocalChromePadding = staticCompositionLocalOf { 96.dp }

@Composable
fun ListEntrance(index: Int = 0, content: @Composable () -> Unit) {
    // Animate every newly composed row without hiding or delaying its content.
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { visible = true }
    val progress by animateFloatAsState(if (visible) 1f else 0f, tween(210), label = "list-entrance")
    Box(Modifier.graphicsLayer {
        translationY = (1f - progress) * 10.dp.toPx()
        scaleX = .985f + progress * .015f
        scaleY = .985f + progress * .015f
    }) { content() }
}
