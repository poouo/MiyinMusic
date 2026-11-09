package com.miyin.mobile

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class PlaybackSnapshot(val queue: List<Song> = emptyList(), val index: Int = -1, val position: Long = 0)

class ListeningStore(context: Context) {
    private val prefs = context.getSharedPreferences("listening", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    var snapshot: PlaybackSnapshot
        get() = runCatching { json.decodeFromString<PlaybackSnapshot>(prefs.getString("queue", "{}").orEmpty()) }.getOrDefault(PlaybackSnapshot())
        set(value) { prefs.edit().putString("queue", json.encodeToString(value)).apply() }
    var history: List<String>
        get() = runCatching { json.decodeFromString<List<String>>(prefs.getString("history", "[]").orEmpty()) }.getOrDefault(emptyList())
        set(value) { prefs.edit().putString("history", json.encodeToString(value.take(20))).apply() }
    var lyricOffset: Long
        get() = prefs.getLong("offset", 0)
        set(value) { prefs.edit().putLong("offset", value.coerceIn(-10000, 10000)).apply() }
}

@Composable
fun ListeningTools(player: PlayerController) {
    var open by remember { mutableStateOf(false) }
    TextButton(onClick = { open = true }) { Text(if (player.stopAfterTrack) "本曲后停止" else if (player.sleepUntil > 0) "已定时" else "听歌设置") }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text("听歌设置") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("睡眠定时")
            Row {
                for (minute in listOf(15, 30, 60)) TextButton(onClick = { player.setSleep(minute); open = false }) { Text("${minute}分") }
            }
            TextButton(onClick = { player.setSleep(-1); open = false }) { Text("播完本曲停止") }
            TextButton(onClick = { player.setSleep(0) }) { Text("取消定时") }
            Text("歌词偏移 ${player.lyricOffsetMs / 1000f} 秒（正值提前）")
            Slider(value = player.lyricOffsetMs.toFloat(), onValueChange = { player.setLyricOffset(it.toLong()) }, valueRange = -10000f..10000f, steps = 39)
            TextButton(onClick = { player.setLyricOffset(0) }) { Text("重置偏移") }
        }
    }, confirmButton = { TextButton(onClick = { open = false }) { Text("完成") } })
}
