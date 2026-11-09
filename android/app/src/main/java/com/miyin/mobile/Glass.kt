package com.miyin.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.vibrancy

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
                    blur(18.dp.toPx())
                },
                onDrawSurface = {
                    drawRect(tint)
                }
            )
            .border(1.dp, Color.White.copy(alpha = 0.16f), shape)
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
    Box(
        modifier
            .drawBackdrop(
                backdrop = backdrop,
                shape = { shape },
                effects = {
                    vibrancy()
                    blur(14.dp.toPx())
                },
                onDrawSurface = { drawRect(tint) }
            )
            .border(1.dp, Color.White.copy(alpha = 0.18f), shape)
            .clip(shape)
            .clickable(onClick = onClick),
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
                modifier = Modifier.fillMaxSize()
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


