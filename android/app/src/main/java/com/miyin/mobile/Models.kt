package com.miyin.mobile

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Song(
    val artists: List<ArtistRef> = emptyList(),
    val platform: String = "tx",
    val songmid: String = "",
    val name: String = "",
    val singer: String = "",
    @SerialName("albumName") val albumName: String = "",
    val interval: Int = 0,
    val img: String? = null,
    val qualities: List<String> = emptyList(),
    val hash: String? = null,
    val albumId: String? = null,
    val albumMid: String? = null,
    val strMediaMid: String? = null,
    val copyrightId: String? = null,
    val lrcUrl: String? = null,
    val songId: String? = null
) {
    val key: String get() = platform + "_" + songmid
    val durationText: String get() = formatDuration(interval * 1000L)
}
@Serializable data class ArtistRef(val id: String = "", val name: String = "")
@Serializable data class AlbumDetail(val id: String = "", val name: String = "", val singer: String = "", val cover: String? = null, val songs: List<Song> = emptyList())
@Serializable data class Recommendation(val song: Song, val reason: String = "")
@Serializable data class Recommendations(val items: List<Recommendation> = emptyList())

@Serializable
data class PlaylistInfo(
    val id: String = "",
    val platform: String = "tx",
    val name: String = "",
    val cover: String? = null,
    val description: String = "",
    val creator: String = "",
    val playCount: Long = 0,
    val trackCount: Int = 0
)

@Serializable
data class ChartInfo(
    val id: String = "",
    val name: String = "",
    val platform: String = "tx",
    val cover: String? = null
)

@Serializable
data class SingerInfo(
    val id: String = "",
    val platform: String = "tx",
    val name: String = "",
    val pic: String? = null
)

@Serializable
data class SearchResponse(val result: SearchResult = SearchResult())

@Serializable
data class ChartSongsResponse(val result: SearchResult = SearchResult())

@Serializable
data class SearchResult(
    val platform: String = "tx",
    val list: List<Song> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val hasMore: Boolean = false
)

@Serializable
data class PlaylistDetailResult(
    val playlist: PlaylistInfo = PlaylistInfo(),
    val songs: List<Song> = emptyList(),
    val total: Int = 0,
    val hasMore: Boolean = false
)

@Serializable
data class DiscoverPlaylistsResponse(
    val playlists: List<PlaylistInfo> = emptyList(),
    val hasMore: Boolean = false
)

@Serializable
data class ChartsResponse(val charts: List<ChartInfo> = emptyList())

@Serializable
data class NewSongsResponse(val songs: List<Song> = emptyList())

@Serializable
data class SingersResponse(val singers: List<SingerInfo> = emptyList())

@Serializable
data class SingerDetailResult(val singer: SingerInfo = SingerInfo(), val songs: List<Song> = emptyList(), val total: Int = 0, val hasMore: Boolean = false, val page: Int = 1, val source: String = "search")

@Serializable
data class LyricResult(
    val lyric: String = "",
    val tlyric: String = "",
    val lxlyric: String = ""
)

@Serializable
data class LyricResponse(val lyric: LyricResult = LyricResult())

@Serializable
data class LyricRequest(val song: Song)

@Serializable
data class UrlResult(
    @SerialName("playUrl") val playUrl: String = "",
    val quality: String = "",
    val platform: String = "",
    @SerialName("sourceName") val sourceName: String = "",
    val sourceId: String = "",
    val cached: Boolean = false
)

@Serializable
data class UrlRequest(
    val song: Song,
    val qualities: List<String> = listOf("320k", "128k"),
    val sourceId: String? = null,
    val excludedSourceIds: List<String> = emptyList()
)

@Serializable
data class PlaybackSource(val id: String = "", val name: String = "", val enabled: Boolean = false,
    val status: String = "", val platforms: List<SourcePlatform> = emptyList())
@Serializable
data class SourcePlatform(val platform: String = "", val actions: List<String> = emptyList(), val qualitys: List<String> = emptyList())
@Serializable
data class SourcesResponse(val sources: List<PlaybackSource> = emptyList())

@Serializable
data class User(
    val id: String = "",
    val username: String = "",
    val nickname: String = "",
    @SerialName("avatarColor") val avatarColor: String = "",
    val role: String = "user"
) {
    val initial: String get() = (nickname.ifBlank { username }).take(1).uppercase()
    val roleText: String get() = when (role) {
        "admin" -> "管理员"
        "vip" -> "会员"
        else -> "普通用户"
    }
}

@Serializable
data class LoginRequest(val username: String, val password: String)

@Serializable
data class RegisterRequest(val username: String, val password: String, val nickname: String? = null)

@Serializable
data class LoginResponse(val user: User)

@Serializable
data class MeResponse(val user: User? = null)

@Serializable
data class FavoriteEntry(val song: Song, val addedAt: Long = 0)

@Serializable
data class HistoryEntry(val song: Song, val playedAt: Long = 0)

@Serializable
data class Playlist(
    val id: String = "",
    val name: String = "",
    val description: String = "",
    val songs: List<Song> = emptyList()
)

@Serializable
data class LibraryData(
    val favoriteSingers: List<SingerInfo> = emptyList(),
    val favorites: List<FavoriteEntry> = emptyList(),
    val playlists: List<Playlist> = emptyList(),
    val history: List<HistoryEntry> = emptyList()
)

@Serializable
data class LibraryResponse(val library: LibraryData = LibraryData())

@Serializable
data class LibraryImportRequest(val playlists: List<Playlist>)

@Serializable
data class HistoryRequest(val song: Song)

@Serializable
data class FavoriteRequest(val song: Song)

@Serializable
data class ApiErrorBody(
    val message: String = "",
    val code: String = ""
)

@Serializable
data class ApiErrorEnvelope(val error: ApiErrorBody? = null)

fun formatDuration(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    val m = total / 60
    val s = total % 60
    return "%d:%02d".format(m, s)
}

fun formatCount(value: Long): String {
    return when {
        value >= 100_000_000 -> "%.1f亿".format(value / 100_000_000.0)
        value >= 10_000 -> "%.1f万".format(value / 10_000.0)
        else -> value.toString()
    }
}
