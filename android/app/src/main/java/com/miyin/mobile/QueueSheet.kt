package com.miyin.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Equalizer
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
fun QueueSheet(api: ApiClient, player: PlayerController, onClose: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = player.queueIndex.coerceIn(0, (player.queue.size - 1).coerceAtLeast(0)))
    AppSheet(onClose, "播放列表", "${player.queue.size} 首歌曲 · 点击歌曲立即播放") {
        Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AppTextButton(onClick = { player.clearQueue(); onClose() }, enabled = player.queue.isNotEmpty()) { Text("清空队列") }
            ListeningTools(player)
        }
        if (player.queue.isEmpty()) {
            Text("队列还是空的，去选一首喜欢的歌吧", color = colors.onSurfaceVariant, modifier = Modifier.padding(vertical = 30.dp))
        } else LazyColumn(state = listState, modifier = Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            itemsIndexed(player.queue, key = { index, song -> song.key + ":" + index }) { index, song ->
                val current = index == player.queueIndex
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                    .background(if (current) colors.primary.copy(alpha = .1f) else androidx.compose.ui.graphics.Color.Transparent)
                    .clickable { player.playAt(index); onClose() }.padding(horizontal = 10.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (current) Icon(Icons.Rounded.Equalizer, "正在播放", Modifier.size(24.dp), tint = colors.primary)
                    else Text((index + 1).toString(), modifier = Modifier.width(24.dp), style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
                    CoverImage(song.img, api, modifier = Modifier.size(42.dp), corner = 12)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(song.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium,
                            fontWeight = if (current) FontWeight.Bold else FontWeight.Medium, color = if (current) colors.primary else colors.onSurface)
                        Text(song.singer, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
                    }
                    Text(song.durationText, style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
                }
            }
        }
    }
}
