package com.miyin.mobile

import android.content.Context
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.IOException
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class ApiException(val statusCode: Int, override val message: String) : Exception(message)

private suspend fun Call.payload(): Pair<Int, String> = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (continuation.isActive) continuation.resumeWithException(e) }
        override fun onResponse(call: Call, response: Response) {
            try {
                val payload = response.use { it.code to it.body?.string().orEmpty() }
                if (continuation.isActive) continuation.resume(payload)
            } catch (e: Exception) { if (continuation.isActive) continuation.resumeWithException(e) }
        }
    })
}

class PersistentCookieJar(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("miyin_cookies", Context.MODE_PRIVATE)

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val key = url.host
        val current = prefs.getString(key, "").orEmpty()
            .split('\n')
            .filter { it.isNotBlank() }
            .mapNotNull { Cookie.parse(url, it) }
            .associateBy { it.name }
            .toMutableMap()
        cookies.forEach { current[it.name] = it }
        prefs.edit().putString(key, current.values.joinToString("\n") { it.toString() }).apply()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val key = url.host
        val now = System.currentTimeMillis()
        return prefs.getString(key, "").orEmpty()
            .split('\n')
            .filter { it.isNotBlank() }
            .mapNotNull { Cookie.parse(url, it) }
            .filter { it.expiresAt > now }
    }

    fun cookieHeader(url: HttpUrl?): String? {
        if (url == null) return null
        val list = loadForRequest(url)
        if (list.isEmpty()) return null
        return list.joinToString("; ") { it.name + "=" + it.value }
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}

class ApiClient(context: Context) {
    companion object {
        const val BASE_URL = "https://music.poouo.com"
        const val USER_AGENT = "MiYinAndroid/1.0 (Android)"
        private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
    }

    private val appContext = context.applicationContext
    val cache = AppCache(appContext)
    private val cookieJar = PersistentCookieJar(appContext)
    private val client = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(18, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .writeTimeout(25, TimeUnit.SECONDS)
        .build()

    @PublishedApi
    internal val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        encodeDefaults = true
        explicitNulls = false
    }

    fun cookieHeader(): String? = cookieJar.cookieHeader(BASE_URL.toHttpUrlOrNull())

    fun clearSession() = cookieJar.clear()

    @PublishedApi
    internal suspend fun raw(method: String, path: String, body: String? = null): String =
        withContext(Dispatchers.IO) {
            val session = cookieHeader()
            val builder = Request.Builder()
                .url(BASE_URL + path)
                .header("User-Agent", USER_AGENT)
                .header("Accept", "application/json")
            when (method) {
                "GET" -> builder.get()
                "DELETE" -> builder.delete()
                else -> builder.method(method, (body ?: "").toRequestBody(JSON_TYPE))
            }
            val (status, text) = client.newCall(builder.build()).payload()
            if (!path.startsWith("/api/auth/") && session != cookieHeader()) throw kotlinx.coroutines.CancellationException("账号已切换，忽略旧请求")
            if (status !in 200..299) {
                val message = runCatching {
                    json.decodeFromString<ApiErrorEnvelope>(text).error?.message
                }.getOrNull().orEmpty().ifBlank { "请求失败（" + status + "）" }
                throw ApiException(status, message)
            }
            text
        }

    suspend inline fun <reified T> get(path: String): T =
        json.decodeFromString(raw("GET", path))

    suspend inline fun <reified Req : Any, reified Res> post(path: String, body: Req): Res =
        json.decodeFromString(raw("POST", path, json.encodeToString(body)))

    suspend inline fun <reified T> delete(path: String): T =
        json.decodeFromString(raw("DELETE", path))

    suspend fun me(): User? {
        return try {
            get<MeResponse>("/api/auth/me").user
        } catch (e: ApiException) {
            if (e.statusCode == 401) null else throw e
        }
    }

    suspend fun login(username: String, password: String): User =
        post<LoginRequest, LoginResponse>("/api/auth/login", LoginRequest(username, password)).user

    suspend fun register(username: String, password: String, nickname: String?): User =
        post<RegisterRequest, LoginResponse>(
            "/api/auth/register",
            RegisterRequest(username, password, nickname?.ifBlank { null })
        ).user

    suspend fun logout() {
        try {
            raw("POST", "/api/auth/logout", "{}")
        } finally {
            cookieJar.clear()
        }
    }

    suspend fun library(): LibraryData = get<LibraryResponse>("/api/library").library

    suspend fun createPlaylist(name: String): LibraryData =
        json.decodeFromString<LibraryResponse>(raw("POST", "/api/library/playlists", json.encodeToString(mapOf("name" to name)))).library

    suspend fun renamePlaylist(id: String, name: String): LibraryData =
        json.decodeFromString<LibraryResponse>(raw("PATCH", "/api/library/playlists/$id", json.encodeToString(mapOf("name" to name)))).library

    suspend fun deletePlaylist(id: String): LibraryData = delete<LibraryResponse>("/api/library/playlists/$id").library

    suspend fun addPlaylistSong(id: String, song: Song): LibraryData =
        post<FavoriteRequest, LibraryResponse>("/api/library/playlists/$id/songs", FavoriteRequest(song)).library

    suspend fun removePlaylistSong(id: String, song: Song): LibraryData =
        delete<LibraryResponse>("/api/library/playlists/$id/songs/${song.key}").library

    suspend fun reorderPlaylist(id: String, songs: List<Song>): LibraryData =
        json.decodeFromString<LibraryResponse>(raw("PUT", "/api/library/playlists/$id/order",
            json.encodeToString(mapOf("keys" to songs.map { it.key })))).library

    suspend fun addFavorite(song: Song): LibraryData =
        post<FavoriteRequest, LibraryResponse>("/api/library/favorites", FavoriteRequest(song)).library

    suspend fun removeFavorite(song: Song): LibraryData =
        delete<LibraryResponse>("/api/library/favorites/" + song.key).library

    suspend fun addHistory(song: Song): LibraryData =
        post<HistoryRequest, LibraryResponse>("/api/library/history", HistoryRequest(song)).library

    suspend fun discoverPlaylists(limit: Int = 12): List<PlaylistInfo> =
        get<DiscoverPlaylistsResponse>("/api/discover/playlists?limit=" + limit).playlists

    suspend fun charts(): List<ChartInfo> = get<ChartsResponse>("/api/charts").charts

    suspend fun newSongs(limit: Int = 12): List<Song> =
        get<NewSongsResponse>("/api/discover/new-songs?limit=" + limit).songs

    suspend fun singers(limit: Int = 12): List<SingerInfo> =
        get<SingersResponse>("/api/discover/singers?limit=" + limit).singers

    suspend fun singer(id: String, name: String): SingerDetailResult =
        get<SingerDetailResult>("/api/singer/" + java.net.URLEncoder.encode(id, "UTF-8") +
            "?name=" + java.net.URLEncoder.encode(name, "UTF-8"))

    suspend fun search(platform: String, query: String, page: Int = 1, limit: Int = 30): SearchResult {
        val encoded = java.net.URLEncoder.encode(query, "UTF-8")
        return get<SearchResponse>(
            "/api/search?platform=" + platform + "&q=" + encoded + "&page=" + page + "&limit=" + limit
        ).result
    }

    suspend fun playlist(id: String, offset: Int = 0): PlaylistDetailResult =
        get<PlaylistDetailResult>("/api/playlist/" + java.net.URLEncoder.encode(id, "UTF-8") + "?limit=300&offset=" + offset)

    suspend fun resolvePlaylistLink(text: String): String = withContext(Dispatchers.IO) {
        var uri = PlaylistLink.extract(text)
        val resolver = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
            .connectTimeout(15, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
        repeat(6) {
            ensureActive()
            PlaylistLink.playlistId(uri)?.let { return@withContext it }
            resolver.newCall(Request.Builder().url(uri.toString()).header("User-Agent", USER_AGENT).build())
                .execute().use { response ->
                    val location = response.header("Location")
                    if (response.code !in 300..399 || location == null) {
                        throw IllegalArgumentException("无法识别歌单，请使用歌单页面的分享链接（不支持单曲或私人歌单）")
                    }
                    uri = PlaylistLink.requireAllowed(uri.resolve(location))
                }
        }
        throw IllegalArgumentException("分享链接跳转过多，请复制歌单的完整链接")
    }

    suspend fun sharedPlaylist(text: String): PlaylistDetailResult {
        val id = resolvePlaylistLink(text)
        return fullPlaylist(id)
    }

    suspend fun fullPlaylist(id: String): PlaylistDetailResult {
        var detail = playlist(id)
        val songs = detail.songs.toMutableList()
        while (detail.hasMore) {
            val next = playlist(id, songs.size)
            check(next.songs.isNotEmpty()) { "歌单未加载完整，请重试" }
            songs += next.songs
            detail = next
            check(songs.size <= 2000) { "单个歌单最多导入 2000 首，请拆分后再导入" }
        }
        check(songs.isNotEmpty()) { "歌单为空或没有可公开访问的歌曲" }
        check(songs.size <= 2000 && songs.size >= detail.total) { "歌单未读取完整或超过 2000 首限制" }
        return detail.copy(songs = songs.distinctBy { it.key }, hasMore = false)
    }

    suspend fun importPlaylist(detail: PlaylistDetailResult): LibraryData =
        post<LibraryImportRequest, LibraryResponse>("/api/library/import", LibraryImportRequest(
            playlists = listOf(Playlist(name = detail.playlist.name, description = detail.playlist.description,
                songs = detail.songs))
        )).library

    suspend fun chartSongs(id: String): SearchResult =
        get<ChartSongsResponse>("/api/charts/" + java.net.URLEncoder.encode(id, "UTF-8")).result

    suspend fun lyric(song: Song): LyricResult =
        post<LyricRequest, LyricResponse>("/api/lyric", LyricRequest(song)).lyric

    suspend fun playUrl(song: Song, qualities: List<String> = PlaybackQuality.order(AppPrefs(appContext).preferredQuality)): UrlResult =
        post<UrlRequest, UrlResult>(
            "/api/url",
            UrlRequest(song, qualities)
        )

    fun absoluteUrl(url: String): String =
        if (url.startsWith("http://") || url.startsWith("https://")) url else BASE_URL + url

    fun imageUrl(url: String?): String? {
        if (url.isNullOrBlank()) return null
        if (url.startsWith("data:")) return url
        if (url.startsWith("/api/")) return BASE_URL + url
        val encoded = Base64.encodeToString(
            url.toByteArray(Charsets.UTF_8),
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )
        return BASE_URL + "/api/image?u=" + encoded
    }
}
