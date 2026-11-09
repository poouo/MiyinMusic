package com.miyin.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class LibraryActions(
    val library: LibraryData,
    val player: PlayerController,
    val api: ApiClient,
    val update: (LibraryData) -> Unit,
    val message: (String) -> Unit,
    val requireLogin: () -> Boolean,
    val mutex: Mutex,
    val openSinger: (SingerInfo) -> Unit
)
val LocalLibraryActions = staticCompositionLocalOf<LibraryActions?> { null }
val LocalEditingPlaylist = staticCompositionLocalOf<Playlist?> { null }

@Composable
fun SongActions(song: Song) {
    val actions = LocalLibraryActions.current ?: return
    val editing = LocalEditingPlaylist.current
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var choosePlaylist by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var album by remember { mutableStateOf<String?>(null) }
    fun mutate(block: suspend () -> LibraryData) {
        if (busy || !actions.requireLogin()) return
        busy = true
        scope.launch {
            try { actions.mutex.withLock { actions.update(block()) } }
            catch (e: Exception) { actions.message(e.userMessage("操作失败，请重试")) }
            finally { busy = false }
        }
    }
    Box {
        IconButton(onClick = { menu = true }, enabled = !busy) { Icon(Icons.Rounded.MoreVert, "更多操作") }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            for (artist in song.artists) DropdownMenuItem(text = { Text("歌手 · ${artist.name}") }, onClick = { menu = false; actions.openSinger(SingerInfo(id = song.platform + "-" + artist.id, platform = song.platform, name = artist.name)) })
            if (song.platform in listOf("tx", "wy") && !song.albumId.isNullOrBlank()) DropdownMenuItem(text = { Text("查看专辑") }, onClick = { menu = false; album = song.platform + "-" + (song.albumMid ?: song.albumId) })
            DropdownMenuItem(text = { Text("下一首播放") }, onClick = { menu = false; actions.player.enqueue(song, true); actions.message("已设为下一首") })
            DropdownMenuItem(text = { Text("加入队列") }, onClick = { menu = false; actions.player.enqueue(song); actions.message("已加入队列") })
            DropdownMenuItem(text = { Text("加入歌单") }, onClick = { menu = false; if (actions.requireLogin()) choosePlaylist = true })
            DropdownMenuItem(text = { Text("下载到离线音乐") }, onClick = {
                menu = false; busy = true
                scope.launch {
                    try { OfflineDownloads(actions.player.context()).start(actions.api, song); actions.message("已加入系统下载任务") }
                    catch (e: Exception) { actions.message(e.userMessage("无法下载此歌曲")) }
                    finally { busy = false }
                }
            })
            if (editing != null) {
                DropdownMenuItem(text = { Text("移出此歌单") }, onClick = { menu = false; mutate { actions.api.removePlaylistSong(editing.id, song) } })
                val index = editing.songs.indexOfFirst { it.key == song.key }
                for ((label, delta) in listOf("上移" to -1, "下移" to 1)) {
                    DropdownMenuItem(text = { Text(label) }, enabled = index + delta in editing.songs.indices, onClick = {
                        menu = false
                        mutate {
                            val latest = actions.library.playlists.find { it.id == editing.id } ?: editing
                            val list = latest.songs.toMutableList()
                            val from = list.indexOfFirst { it.key == song.key }
                            if (from + delta in list.indices) list.add(from + delta, list.removeAt(from))
                            actions.api.reorderPlaylist(editing.id, list)
                        }
                    })
                }
            }
        }
    }
    album?.let { CatalogDialog(actions.api, it, actions.player) { album = null } }
    if (choosePlaylist) AlertDialog(onDismissRequest = { choosePlaylist = false }, title = { Text("加入歌单") },
        text = {
            LazyColumn(Modifier.heightIn(max = 360.dp)) {
                if (actions.library.playlists.isEmpty()) item { Text("请先在“我的”中新建歌单") }
                items(actions.library.playlists, key = { it.id }) { playlist ->
                    TextButton(onClick = { choosePlaylist = false; mutate { actions.api.addPlaylistSong(playlist.id, song) } }, modifier = Modifier.fillMaxWidth()) {
                        Text(playlist.name + " · " + playlist.songs.size + " 首")
                    }
                }
            }
        }, confirmButton = { TextButton(onClick = { choosePlaylist = false }) { Text("关闭") } })
}

@Composable
fun PlaylistManager() {
    val actions = LocalLibraryActions.current ?: return
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Playlist?>(null) }
    var naming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<Playlist?>(null) }
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    fun mutate(block: suspend () -> LibraryData) {
        if (busy || !actions.requireLogin()) return
        busy = true
        scope.launch {
            try { actions.mutex.withLock { actions.update(block()) }; naming = false; deleting = null }
            catch (e: Exception) { actions.message(e.userMessage("歌单操作失败")) }
            finally { busy = false }
        }
    }
    Row(Modifier.padding(horizontal = 8.dp), horizontalArrangement = Arrangement.End) {
        TextButton(onClick = { if (actions.requireLogin()) { editing = null; name = ""; naming = true } }) { Text("新建歌单") }
        TextButton(onClick = { if (actions.requireLogin()) open = true }) { Text("管理歌单") }
    }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text("管理歌单") }, text = {
        LazyColumn(Modifier.heightIn(max = 360.dp)) {
            items(actions.library.playlists, key = { it.id }) { playlist ->
                Column {
                    Text(playlist.name, maxLines = 1)
                    Row {
                        TextButton(onClick = { editing = playlist; name = playlist.name; naming = true }) { Text("改名") }
                        TextButton(onClick = { deleting = playlist }) { Text("删除") }
                    }
                }
            }
        }
    }, confirmButton = { TextButton(onClick = { open = false }) { Text("完成") } })
    if (naming) AlertDialog(onDismissRequest = { if (!busy) naming = false }, title = { Text(if (editing == null) "新建歌单" else "重命名") },
        text = { OutlinedTextField(value = name, onValueChange = { name = it.take(80) }, label = { Text("歌单名称") }, singleLine = true) },
        confirmButton = { TextButton(enabled = !busy && name.isNotBlank(), onClick = { mutate {
            editing?.let { actions.api.renamePlaylist(it.id, name.trim()) } ?: actions.api.createPlaylist(name.trim())
        } }) { Text(if (busy) "保存中" else "保存") } }, dismissButton = { TextButton(enabled = !busy, onClick = { naming = false }) { Text("取消") } })
    deleting?.let { playlist -> AlertDialog(onDismissRequest = { if (!busy) deleting = null }, title = { Text("删除《${playlist.name}》？") },
        text = { Text("删除后无法恢复，歌曲和我的喜欢不受影响") },
        confirmButton = { TextButton(enabled = !busy, onClick = { mutate { actions.api.deletePlaylist(playlist.id) } }) { Text("删除") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { deleting = null }) { Text("取消") } }) }
}
