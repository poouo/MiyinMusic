package com.miyin.mobile

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color

val MiYinGreen = Color(0xFF2FD07F)
val MiYinGreenDark = Color(0xFF0D9F63)

private val DarkScheme = darkColorScheme(
    primary = MiYinGreen,
    onPrimary = Color(0xFF06130C),
    primaryContainer = Color(0xFF163A2A),
    onPrimaryContainer = Color(0xFF7FF0B6),
    secondary = Color(0xFF9CC8FF),
    background = Color(0xFF080B0A),
    onBackground = Color(0xFFF2F7F3),
    surface = Color(0xFF111714),
    onSurface = Color(0xFFF2F7F3),
    surfaceVariant = Color(0xFF1A211D),
    onSurfaceVariant = Color(0xFFAAB8B0),
    outline = Color(0xFF344039),
    error = Color(0xFFFF6B81)
)

private val LightScheme = lightColorScheme(
    primary = MiYinGreenDark,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFDFF5E9),
    onPrimaryContainer = Color(0xFF064A2D),
    secondary = Color(0xFF3D6FA8),
    background = Color(0xFFF5F7F5),
    onBackground = Color(0xFF111916),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF111916),
    surfaceVariant = Color(0xFFEDF2EE),
    onSurfaceVariant = Color(0xFF5C6A62),
    outline = Color(0xFFD5DFD8),
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
