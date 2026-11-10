package com.miyin.mobile

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color

val MiYinGreen = Color(0xFFE8A06F)
val MiYinGreenDark = Color(0xFFA64B22)

private val DarkScheme = darkColorScheme(
    primary = MiYinGreen,
    onPrimary = Color(0xFF211C18),
    primaryContainer = Color(0xFF352B24),
    onPrimaryContainer = Color(0xFFF0BC96),
    secondary = Color(0xFF9CC8FF),
    background = Color(0xFF151515),
    onBackground = Color(0xFFF0EEEA),
    surface = Color(0xFF202020),
    surfaceTint = MiYinGreen,
    surfaceContainerLowest = Color(0xFF151515),
    surfaceContainerLow = Color(0xFF1C1C1C),
    surfaceContainer = Color(0xFF202020),
    surfaceContainerHigh = Color(0xFF262626),
    surfaceContainerHighest = Color(0xFF2C2C2C),
    onSurface = Color(0xFFF0EEEA),
    surfaceVariant = Color(0xFF282828),
    onSurfaceVariant = Color(0xFFB4B1AC),
    outline = Color(0xFF484542),
    error = Color(0xFFFF6B81)
)

private val LightScheme = lightColorScheme(
    primary = MiYinGreenDark,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFF6E6DB),
    onPrimaryContainer = Color(0xFF813D20),
    secondary = Color(0xFF3D6FA8),
    background = Color(0xFFFAF9F6),
    onBackground = Color(0xFF252321),
    surface = Color(0xFFFFFFFF),
    surfaceTint = MiYinGreenDark,
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFFAF9F6),
    surfaceContainer = Color(0xFFF6F4F0),
    surfaceContainerHigh = Color(0xFFF0EEEA),
    surfaceContainerHighest = Color(0xFFEAE7E2),
    onSurface = Color(0xFF252321),
    surfaceVariant = Color(0xFFF0EEEA),
    onSurfaceVariant = Color(0xFF66615B),
    outline = Color(0xFFDEDAD2),
    error = Color(0xFFC43C52)
)

@Composable
fun MiYinTheme(
    themeMode: String = "system",
    content: @Composable () -> Unit
) {
    val dark = when (themeMode) {
        "light" -> false
        "dark" -> true
        else -> isSystemInDarkTheme()
    }
    MaterialTheme(
        colorScheme = if (dark) DarkScheme else LightScheme,
        content = {
            CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onBackground, content = content)
        }
    )
}
