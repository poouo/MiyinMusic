package com.miyin.mobile

import android.app.DownloadManager
import android.content.Context
import android.os.Environment
import androidx.core.net.toUri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.security.MessageDigest

@Serializable
data class DownloadResponse(val url: String, val quality: String, val filename: String = "")
@Serializable
data class OfflineTrack(val song: Song, val id: Long, val path: String, val quality: String)
data class DownloadProgress(val status: Int, val bytes: Long, val total: Long)

/** DownloadManager owns transfer lifetime; only successful complete files can be played offline. */
class OfflineDownloads(context: Context) {
    companion object { private val startMutex = Mutex() }
    private val app = context.applicationContext
    private val manager = app.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private val prefs = app.getSharedPreferences("offline_downloads", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    fun tracks(): List<OfflineTrack> = runCatching { json.decodeFromString<List<OfflineTrack>>(prefs.getString("index", "[]").orEmpty()) }.getOrDefault(emptyList())
    private fun save(tracks: List<OfflineTrack>) { prefs.edit().putString("index", json.encodeToString(tracks)).apply() }
    fun progress(track: OfflineTrack): DownloadProgress {
        manager.query(DownloadManager.Query().setFilterById(track.id)).use { cursor ->
            if (cursor?.moveToFirst() == true) return DownloadProgress(cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
                cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)), cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
        }
        return DownloadProgress(DownloadManager.STATUS_FAILED, 0, 0)
    }
    fun completed(key: String): OfflineTrack? = tracks().find { it.song.key == key &&
        progress(it).status == DownloadManager.STATUS_SUCCESSFUL && File(it.path).let { file -> file.isFile && file.length() > 0 } }
    suspend fun start(api: ApiClient, song: Song) = startMutex.withLock {
        val existing = tracks().find { it.song.key == song.key }
        if (existing != null) {
            val status = progress(existing).status
            if (status != DownloadManager.STATUS_FAILED && (status != DownloadManager.STATUS_SUCCESSFUL || File(existing.path).let { it.isFile && it.length() > 0 })) return@withLock
        }
        if (existing != null) remove(existing)
        val result = api.post<FavoriteRequest, DownloadResponse>("/api/download", FavoriteRequest(song))
        val directory = File(app.getExternalFilesDir(Environment.DIRECTORY_MUSIC) ?: app.filesDir, "downloads").apply { mkdirs() }
        val key = MessageDigest.getInstance("SHA-256").digest(song.key.toByteArray()).joinToString("") { "%02x".format(it) }
        val extension = result.filename.substringAfterLast('.', "mp3").takeIf { it in listOf("mp3", "flac", "m4a", "wav", "ogg") } ?: "mp3"
        val file = File(directory, "$key.$extension")
        if (file.exists()) file.delete()
        val request = DownloadManager.Request(api.absoluteUrl(result.url).toUri())
            .setTitle(song.name).setDescription(song.singer)
            .setDestinationUri(file.toUri())
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .addRequestHeader("User-Agent", ApiClient.USER_AGENT)
        api.cookieHeader()?.let { request.addRequestHeader("Cookie", it) }
        val id = manager.enqueue(request)
        save(tracks().filterNot { it.song.key == song.key } + OfflineTrack(song, id, file.absolutePath, result.quality))
    }
    fun remove(track: OfflineTrack) {
        manager.remove(track.id)
        val directory = File(app.getExternalFilesDir(Environment.DIRECTORY_MUSIC) ?: app.filesDir, "downloads").canonicalFile
        val file = File(track.path).canonicalFile
        if (file.parentFile == directory) file.delete()
        save(tracks().filterNot { it.id == track.id })
    }
}

@Composable
fun OfflineLibraryButton(onPlay: (List<Song>, Int) -> Unit) {
    val context = LocalContext.current
    val downloads = remember { OfflineDownloads(context) }
    var open by remember { mutableStateOf(false) }
    var tracks by remember { mutableStateOf(downloads.tracks()) }
    var progress by remember { mutableStateOf(emptyMap<Long, DownloadProgress>()) }
    LaunchedEffect(open) {
        while (open) { tracks = downloads.tracks(); progress = tracks.associate { it.id to downloads.progress(it) }; delay(1000) }
    }
    AppTextButton(onClick = { open = true }) { Text("离线下载") }
    if (open) AppDialog(onDismissRequest = { open = false }, title = { Text("离线下载") }, text = {
        LazyColumn(Modifier.heightIn(max = 420.dp)) {
            item { Text("主动下载长期保留；自动音频缓存会随容量回收") }
            if (tracks.isEmpty()) item { Text("在歌曲的更多菜单中选择下载") }
            items(tracks, key = { it.id }) { track ->
                val state = progress[track.id]
                val complete = state?.status == DownloadManager.STATUS_SUCCESSFUL && File(track.path).let { it.isFile && it.length() > 0 }
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                    Text(track.song.name, maxLines = 1)
                    Text(when (state?.status) {
                        DownloadManager.STATUS_SUCCESSFUL -> if (complete) "已下载 · ${track.quality}" else "文件已缺失，移除后可重新下载"
                        DownloadManager.STATUS_FAILED -> "下载失败，可移除后重试"
                        else -> if ((state?.total ?: 0) > 0) "下载中 ${state!!.bytes * 100 / state.total}%" else "等待下载"
                    }, style = MaterialTheme.typography.bodySmall)
                    Row {
                        AppTextButton(enabled = complete, onClick = { onPlay(listOf(track.song), 0) }) { Text("播放") }
                        AppTextButton(onClick = { downloads.remove(track); tracks = downloads.tracks() }) { Text(if (state?.status == DownloadManager.STATUS_SUCCESSFUL) "删除文件" else "取消 / 移除") }
                    }
                }
            }
        }
    }, confirmButton = { AppTextButton(onClick = { open = false }) { Text("关闭") } })
}
