package com.miyin.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.shadow.InnerShadow
import com.kyant.backdrop.shadow.Shadow
import android.os.Build

// Controls sample the wallpaper only, keeping their own text out of the lens.
val LocalControlBackdrop = staticCompositionLocalOf<Backdrop?> { null }

@Composable
internal fun Modifier.glassControlSurface(shape: Shape, selected: Boolean = false, pressed: Boolean = false): Modifier {
    val colors = MaterialTheme.colorScheme
    val dark = colors.background.luminance() < .5f
    // Dialogs live in a different window; use the same finish without sampling
    // coordinates from the Activity's render layer.
    val backdrop = if (LocalView.current.parent is DialogWindowProvider) null else LocalControlBackdrop.current
    val tint = if (selected) colors.primary.copy(alpha = if (dark) .20f else .10f)
        else colors.surface.copy(alpha = .42f)
    val surface = if (backdrop != null && Build.VERSION.SDK_INT >= 31) {
        drawBackdrop(backdrop = backdrop, shape = { shape }, effects = {
            vibrancy()
            blur(4.dp.toPx())
            lens(8.dp.toPx(), 10.dp.toPx())
        }, highlight = { Highlight.Default.copy(alpha = if (dark) .35f else .55f) },
            shadow = { Shadow(radius = 5.dp, color = Color.Black.copy(alpha = if (dark) .08f else .035f)) },
            onDrawSurface = { drawRect(tint) })
    } else {
        background(Brush.verticalGradient(listOf(
            if (dark) Color(0xFF343333).copy(alpha = .92f) else Color.White.copy(alpha = .80f),
            if (dark) Color(0xFF242322).copy(alpha = .92f) else Color(0xFFF7F4F0).copy(alpha = .65f)
        )), shape).background(if (selected) tint else Color.Transparent, shape)
    }
    return surface
        .background(Brush.verticalGradient(listOf(Color.White.copy(alpha = if (pressed) .15f else .06f), Color.Transparent)), shape)
        .border(.75.dp, Brush.linearGradient(listOf(
            Color.White.copy(alpha = if (dark) .30f else .92f),
            if (selected) colors.primary.copy(alpha = .26f) else colors.outline.copy(alpha = .20f),
            Color.White.copy(alpha = if (dark) .10f else .54f)
        )), shape)
}

@Composable
fun GlassPanel(
    backdrop: Backdrop,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(28.dp),
    tint: Color = Color.White.copy(alpha = 0.10f),
    content: @Composable BoxScope.() -> Unit
) {
    Box(
        modifier
            .drawBackdrop(
                backdrop = backdrop,
                shape = { shape },
                effects = {
                    vibrancy()
                    blur(8.dp.toPx())
                    lens(24.dp.toPx(), 24.dp.toPx(), chromaticAberration = true)
                },
                highlight = { Highlight.Default.copy(alpha = 0.85f) },
                shadow = { Shadow(radius = 20.dp, color = Color.Black.copy(alpha = 0.10f)) },
                innerShadow = { InnerShadow(radius = 6.dp, alpha = 0.18f) },
                onDrawSurface = {
                    drawRect(if (Build.VERSION.SDK_INT < 31) tint.copy(alpha = 0.90f) else tint)
                }
            )
            .clip(shape),
        content = content
    )
}

@Composable
fun GlassButton(
    backdrop: Backdrop,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = CircleShape,
    tint: Color = Color.White.copy(alpha = 0.12f),
    content: @Composable BoxScope.() -> Unit
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .94f else 1f,
        spring(dampingRatio = .75f, stiffness = 650f), label = "glass-search-press")
    Box(
        modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .drawBackdrop(
                backdrop = backdrop,
                shape = { shape },
                effects = {
                    vibrancy()
                    blur(6.dp.toPx())
                    lens(12.dp.toPx(), 16.dp.toPx())
                },
                highlight = { Highlight.Default.copy(alpha = .55f) },
                shadow = { Shadow(radius = 5.dp, color = Color.Black.copy(alpha = .035f)) },
                onDrawSurface = { drawRect(if (Build.VERSION.SDK_INT < 31) tint.copy(alpha = .85f) else tint) }
            )
            .border(.75.dp, Brush.verticalGradient(listOf(Color.White.copy(alpha = .6f), Color.White.copy(alpha = .12f))), shape)
            .clip(shape)
            .clickable(interactionSource = interaction, indication = null, role = Role.Button, onClick = onClick),
        content = content
    )
}

@Composable
fun AppBackground(api: ApiClient, cover: String?, dark: Boolean) {
    val bg = MaterialTheme.colorScheme.background
    val accent = MaterialTheme.colorScheme.primary
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.linearGradient(
                        listOf(
                            if (dark) Color(0xFF06251A) else Color(0xFFE9F8F0),
                            bg,
                            if (dark) Color(0xFF111427) else Color(0xFFF2F5FF)
                        )
                    )
                )
        )
        val image = api.imageUrl(cover)
        if (image != null) {
            AsyncImage(
                model = image,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                alpha = if (dark) 0.24f else 0.16f,
                modifier = Modifier.fillMaxSize().blur(40.dp)
            )
        }
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(
                            bg.copy(alpha = 0.10f),
                            bg.copy(alpha = 0.55f),
                            bg.copy(alpha = 0.96f)
                        )
                    )
                )
        )
        Box(
            Modifier
                .size(260.dp)
                .align(Alignment.TopEnd)
                .background(
                    Brush.radialGradient(
                        listOf(accent.copy(alpha = if (dark) 0.24f else 0.16f), Color.Transparent)
                    )
                )
        )
        Box(
            Modifier
                .size(220.dp)
                .align(Alignment.BottomStart)
                .background(
                    Brush.radialGradient(
                        listOf(Color(0xFF4A7BFF).copy(alpha = if (dark) 0.16f else 0.10f), Color.Transparent)
                    )
                )
        )
    }
}

@Composable
fun SectionTitle(title: String, action: String? = null, onAction: (() -> Unit)? = null) {
    androidx.compose.foundation.layout.Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.weight(1f)
        )
        if (action != null && onAction != null) {
            Text(
                text = action,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .clickable(onClick = onAction)
                    .padding(horizontal = 8.dp, vertical = 5.dp)
            )
        }
    }
}
