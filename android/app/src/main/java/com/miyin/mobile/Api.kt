package com.miyin.mobile

import android.content.Context
import android.util.Base64
import kotlinx.coroutines.Dispatchers
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
            val builder = Request.Builder()
                .url(BASE_URL + path)
                .header("User-Agent", USER_AGENT)
                .header("Accept", "application/json")
            when (method) {
                "GET" -> builder.get()
                "DELETE" -> builder.delete()
                else -> builder.method(method, (body ?: "").toRequestBody(JSON_TYPE))
            }
            client.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val message = runCatching {
                        json.decodeFromString<ApiErrorEnvelope>(text).error?.message
                    }.getOrNull().orEmpty().ifBlank { "请求失败（" + response.code + "）" }
                    throw ApiException(response.code, message)
                }
                text
            }
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

    suspend fun search(platform: String, query: String, page: Int = 1, limit: Int = 30): SearchResult {
        val encoded = java.net.URLEncoder.encode(query, "UTF-8")
        return get<SearchResult>("/api/search?platform=" + platform + "&q=" + encoded + "&page=" + page + "&limit=" + limit)
    }

    suspend fun playlist(id: String): PlaylistDetailResult =
        get<PlaylistDetailResult>("/api/playlist/" + java.net.URLEncoder.encode(id, "UTF-8"))

    suspend fun chartSongs(id: String): SearchResult =
        get<SearchResult>("/api/charts/" + java.net.URLEncoder.encode(id, "UTF-8"))

    suspend fun lyric(song: Song): LyricResult =
        post<LyricRequest, LyricResponse>("/api/lyric", LyricRequest(song)).lyric

    suspend fun playUrl(song: Song): UrlResult =
        post<UrlRequest, UrlResult>(
            "/api/url",
            UrlRequest(song, listOf("320k", "128k"))
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
