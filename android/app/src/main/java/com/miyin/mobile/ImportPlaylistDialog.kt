package com.miyin.mobile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
fun ImportPlaylistDialog(api: ApiClient, onClose: () -> Unit, onImported: (LibraryData) -> Unit) {
    var link by remember { mutableStateOf("") }
    var preview by remember { mutableStateOf<PlaylistDetailResult?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = { if (!loading) onClose() },
        title = { Text("导入外链歌单") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("粘贴 QQ 音乐或网易云音乐的公开歌单链接，也可以直接粘贴分享文字。")
                OutlinedTextField(
                    value = link,
                    onValueChange = { link = it; preview = null; error = null },
                    enabled = !loading,
                    label = { Text("歌单分享链接") },
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 4,
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(18.dp)
                )
                preview?.let { detail ->
                    ListEntrance {
                        Column {
                            Text(detail.playlist.name, style = MaterialTheme.typography.titleMedium)
                            Text("${if (detail.playlist.platform == "tx") "QQ 音乐" else "网易云音乐"} · ${detail.songs.size} 首可访问歌曲",
                                style = MaterialTheme.typography.bodySmall)
                            if (detail.playlist.trackCount > detail.songs.size) {
                                Text("原歌单共 ${detail.playlist.trackCount} 首，私人、下架或受限歌曲无法导入。",
                                    style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (loading) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        CircularProgressIndicator(modifier = Modifier.padding(4.dp))
                        Text(if (preview == null) "正在读取歌单…" else "正在保存到我的歌单…")
                    }
                }
            }
        },
        confirmButton = {
            Button(enabled = link.isNotBlank() && !loading, onClick = {
                scope.launch {
                    loading = true
                    error = null
                    try {
                        val detail = preview
                        if (detail == null) preview = api.sharedPlaylist(link)
                        else onImported(api.importPlaylist(detail))
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        error = e.userMessage("导入失败，请重试")
                    } finally {
                        loading = false
                    }
                }
            }) { Text(if (preview == null) "读取歌单" else "导入歌单") }
        },
        dismissButton = { TextButton(enabled = !loading, onClick = onClose) { Text("取消") } },
        shape = androidx.compose.foundation.shape.RoundedCornerShape(28.dp)
    )
}
