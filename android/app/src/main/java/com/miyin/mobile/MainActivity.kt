package com.miyin.mobile

import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: Context) {
        val mode = when (AppPrefs(newBase).themeMode) {
            "dark" -> Configuration.UI_MODE_NIGHT_YES
            "light" -> Configuration.UI_MODE_NIGHT_NO
            else -> null
        }
        val base = if (mode == null) newBase else newBase.createConfigurationContext(
            Configuration(newBase.resources.configuration).apply {
                uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or mode
            })
        super.attachBaseContext(base)
    }

    override fun onResume() {
        super.onResume()
        DesktopLyrics.configure(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        splash.setOnExitAnimationListener { provider ->
            provider.view.animate().alpha(0f).setDuration(160)
                .withEndAction { provider.remove() }.start()
        }
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT)
        )
        startService(Intent(this, PlaybackService::class.java))
        setContent {
            MiYinApp()
        }
    }
}
