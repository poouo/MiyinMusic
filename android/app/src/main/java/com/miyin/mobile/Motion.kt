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
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { visible = true }
    val delay = index.coerceIn(0, 6) * 25
    val progress by animateFloatAsState(if (visible) 1f else 0f, tween(320, delay), label = "list-entrance")
    Box(Modifier.graphicsLayer {
        alpha = progress
        translationY = (1f - progress) * 16.dp.toPx()
    }) { content() }
}
