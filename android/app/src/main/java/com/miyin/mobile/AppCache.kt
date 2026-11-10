package com.miyin.mobile

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

@Serializable
data class SessionSnapshot(val user: User? = null, val library: LibraryData = LibraryData())

/** Small, versioned UI snapshots. Audio and artwork keep their own disk caches. */
class AppCache(context: Context) {
    companion object {
        private val changes = MutableStateFlow<SessionSnapshot?>(null)
        val sessionUpdates = changes.asStateFlow()
    }
    private val prefs = context.getSharedPreferences("miyin_snapshot_v1", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    fun home(): HomeData? = runCatching {
        prefs.getString("home", null)?.let { json.decodeFromString<HomeData>(it) }
    }.getOrNull()

    fun playlist(id: String): PlaylistDetailResult? = runCatching {
        prefs.getString("playlist:$id", null)?.let { json.decodeFromString<PlaylistDetailResult>(it) }
    }.getOrNull()

    suspend fun savePlaylist(id: String, value: PlaylistDetailResult) = withContext(Dispatchers.IO) {
        val encoded = json.encodeToString(value)
        if (prefs.getString("playlist:$id", null) == encoded) return@withContext
        val recent = (listOf(id) + prefs.getString("playlist-index", "").orEmpty().split('|').filter { it.isNotBlank() && it != id })
        val editor = prefs.edit().putString("playlist:$id", encoded).putString("playlist-index", recent.take(20).joinToString("|"))
        recent.drop(20).forEach { editor.remove("playlist:$it") }
        editor.apply()
    }

    fun session(): SessionSnapshot = changes.value ?: (runCatching {
        prefs.getString("session", null)?.let { json.decodeFromString<SessionSnapshot>(it) }
    }.getOrNull() ?: SessionSnapshot()).also { changes.value = it }

    fun libraryFor(user: User?): LibraryData = runCatching {
        prefs.getString("library:" + (user?.id ?: "guest"), null)?.let { json.decodeFromString<LibraryData>(it) }
    }.getOrNull() ?: LibraryData()

    suspend fun saveHome(value: HomeData) = withContext(Dispatchers.IO) {
        prefs.edit().putString("home", json.encodeToString(value)).apply()
    }

    suspend fun saveSession(user: User?, library: LibraryData) = withContext(Dispatchers.IO) {
        prefs.edit().putString("session", json.encodeToString(SessionSnapshot(user, library))).apply()
        prefs.edit().putString("library:" + (user?.id ?: "guest"), json.encodeToString(library)).apply()
        changes.value = SessionSnapshot(user, library)
    }
}
