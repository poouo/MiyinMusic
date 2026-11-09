package com.miyin.mobile

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Explore
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import kotlin.math.roundToInt

/** Backdrop catalog inspired: refracting capsule with an elastic, draggable selection lens. */
@Composable
fun LiquidNavigation(backdrop: Backdrop, selectedTab: Int, onTab: (Int) -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    var dragPosition by remember { mutableStateOf<Float?>(null) }
    val position by animateFloatAsState(dragPosition ?: selectedTab.toFloat(),
        spring(dampingRatio = 0.78f, stiffness = 420f), label = "liquid-tab")
    val scale by animateFloatAsState(if (pressed || dragPosition != null) 1.025f else 1f,
        spring(dampingRatio = 0.6f, stiffness = 480f), label = "liquid-press")
    GlassPanel(
        backdrop = backdrop,
        modifier = Modifier.fillMaxWidth().graphicsLayer { scaleX = scale; scaleY = scale },
        shape = RoundedCornerShape(50),
        tint = MaterialTheme.colorScheme.surface.copy(alpha = 0.24f)
    ) {
        BoxWithConstraints(Modifier.fillMaxWidth().height(68.dp).padding(4.dp)) {
            val tabWidth = maxWidth / 3
            val tabWidthPx = with(LocalDensity.current) { tabWidth.toPx() }
            GlassPanel(
                backdrop = backdrop,
                modifier = Modifier.width(tabWidth).height(60.dp)
                    .graphicsLayer { translationX = position * tabWidthPx },
                shape = RoundedCornerShape(50),
                tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f)
            ) {}
            val tabs = listOf("发现" to Icons.Rounded.Explore, "搜索" to Icons.Rounded.Search, "我的" to Icons.Rounded.Person)
            Row(Modifier.fillMaxWidth().selectableGroup()
                .pointerInput(selectedTab, tabWidthPx) {
                    detectHorizontalDragGestures(
                        onDragStart = { dragPosition = selectedTab.toFloat() },
                        onDragCancel = { dragPosition = null },
                        onDragEnd = {
                            val index = (dragPosition ?: selectedTab.toFloat()).roundToInt().coerceIn(0, 2)
                            onTab(index)
                            dragPosition = null
                        },
                        onHorizontalDrag = { change, delta ->
                            change.consume()
                            dragPosition = ((dragPosition ?: selectedTab.toFloat()) + delta / tabWidthPx).coerceIn(0f, 2f)
                        }
                    )
                }) {
                tabs.forEachIndexed { index, (label, icon) ->
                    val selected = selectedTab == index
                    val color by animateColorAsState(if (selected) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant, label = "tab-color")
                    Column(
                        Modifier.weight(1f).height(60.dp).clip(RoundedCornerShape(50))
                            .selectable(selected, interactionSource = interaction, indication = null,
                                role = Role.Tab, onClick = { onTab(index) })
                            .padding(vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(icon, null, tint = color, modifier = Modifier.size(23.dp))
                        Text(label, color = color, style = MaterialTheme.typography.labelSmall,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium)
                    }
                }
            }
        }
    }
}
