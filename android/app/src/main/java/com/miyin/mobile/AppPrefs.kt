package com.miyin.mobile

import android.content.Context

class AppPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("miyin_prefs", Context.MODE_PRIVATE)

    var themeMode: String
        get() = prefs.getString("theme_mode", "system") ?: "system"
        set(value) {
            prefs.edit().putString("theme_mode", value).apply()
        }
}
