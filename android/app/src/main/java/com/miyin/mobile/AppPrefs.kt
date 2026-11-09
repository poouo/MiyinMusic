package com.miyin.mobile

import android.content.Context

class AppPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("miyin_prefs", Context.MODE_PRIVATE)

    var themeMode: String
        get() = prefs.getString("theme_mode", "system") ?: "system"
        set(value) {
            prefs.edit().putString("theme_mode", value).apply()
        }

    var audioCacheMb: Int
        get() = prefs.getInt("audio_cache_mb", 512).coerceIn(128, 2048)
        set(value) { prefs.edit().putInt("audio_cache_mb", value.coerceIn(128, 2048)).apply() }

    var showCachedHome: Boolean
        get() = prefs.getBoolean("show_cached_home", true)
        set(value) { prefs.edit().putBoolean("show_cached_home", value).apply() }

    var preferredQuality: String
        get() = prefs.getString("preferred_quality", "320k") ?: "320k"
        set(value) { prefs.edit().putString("preferred_quality", value).apply() }

    var carLyrics: Boolean
        get() = prefs.getBoolean("car_lyrics", false)
        set(value) { prefs.edit().putBoolean("car_lyrics", value).apply() }

    var eqEnabled: Boolean
        get() = prefs.getBoolean("eq_enabled", false)
        set(value) { prefs.edit().putBoolean("eq_enabled", value).apply() }

    var eqPreset: String
        get() = prefs.getString("eq_preset", "flat") ?: "flat"
        set(value) { prefs.edit().putString("eq_preset", value).apply() }

    var eqCustomBands: List<Float>
        get() = prefs.getString("eq_custom_bands", "0,0,0,0,0").orEmpty().split(',')
            .map { (it.toFloatOrNull() ?: 0f).coerceIn(-12f, 12f) }.let { if (it.size == 5) it else List(5) { 0f } }
        set(value) { prefs.edit().putString("eq_custom_bands", value.take(5).joinToString(",")).apply() }
    var desktopLyrics: Boolean
        get() = prefs.getBoolean("desktop_lyrics", false)
        set(value) { prefs.edit().putBoolean("desktop_lyrics", value).apply() }
    var lyricStyle: String
        get() = prefs.getString("lyric_style", "emerald") ?: "emerald"
        set(value) { prefs.edit().putString("lyric_style", value).apply() }
    var lyricSize: Int
        get() = prefs.getInt("lyric_size", 26).coerceIn(20, 34)
        set(value) { prefs.edit().putInt("lyric_size", value.coerceIn(20, 34)).apply() }
    var lyricDoubleLine: Boolean
        get() = prefs.getBoolean("lyric_double", true)
        set(value) { prefs.edit().putBoolean("lyric_double", value).apply() }
    var lyricLocked: Boolean
        get() = prefs.getBoolean("lyric_locked", false)
        set(value) { prefs.edit().putBoolean("lyric_locked", value).apply() }
    var lyricY: Int
        get() = prefs.getInt("lyric_y", 160)
        set(value) { prefs.edit().putInt("lyric_y", value).apply() }

}
