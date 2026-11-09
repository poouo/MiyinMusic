package com.miyin.mobile

import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.coroutines.launch

@Composable
fun SavePublicPlaylist(api: ApiClient, id: String) {
    val actions = LocalLibraryActions.current ?: return
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<PlaylistDetailResult?>(null) }
    TextButton(enabled = !busy, onClick = {
        if (actions.requireLogin()) {
            busy = true
            scope.launch {
                try { preview = api.fullPlaylist(id) }
                catch (e: Exception) { actions.message(e.userMessage("完整歌单读取失败")) }
                finally { busy = false }
            }
        }
    }) { Text(if (busy) "正在读取完整歌单" else "保存为我的歌单") }
    preview?.let { detail -> AlertDialog(onDismissRequest = { if (!busy) preview = null }, title = { Text(detail.playlist.name) },
        text = { Text("共 ${detail.songs.size} 首，保存为独立副本") },
        confirmButton = { TextButton(enabled = !busy, onClick = {
            busy = true
            scope.launch {
                try { actions.update(api.importPlaylist(detail)); preview = null; actions.message("已保存到我的歌单") }
                catch (e: Exception) { actions.message(e.userMessage("保存失败，请重试")) }
                finally { busy = false }
            }
        }) { Text(if (busy) "保存中" else "保存") } }, dismissButton = { TextButton(enabled = !busy, onClick = { preview = null }) { Text("取消") } }) }
}
