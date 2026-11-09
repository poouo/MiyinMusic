package com.miyin.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import com.kyant.backdrop.Backdrop
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
fun HomeScreen(
    api: ApiClient,
    backdrop: Backdrop,
    data: HomeData?,
    loading: Boolean,
    error: String?,
    user: User?,
    favorites: Set<String>,
    onRetry: () -> Unit,
    onPlaylist: (PlaylistInfo) -> Unit,
    onChart: (ChartInfo) -> Unit,
    onSinger: (SingerInfo) -> Unit,
    onAllCharts: () -> Unit,
    onPlay: (List<Song>, Int) -> Unit,
    onFavorite: (Song) -> Unit,
    onSearch: () -> Unit,
    onSettings: () -> Unit,
    onLogin: () -> Unit
) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = LocalChromePadding.current)
    ) {
        item {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 12.dp, top = 6.dp, bottom = 14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.18f))
                        .clickable { if (user == null) onLogin() else onSettings() },
                    contentAlignment = Alignment.Center
                ) {
                    if (user == null) {
                        Icon(
                            Icons.Rounded.MusicNote,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp)
                        )
                    } else {
                        Text(
                            user.initial,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        "发现",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Text(
                        if (user == null) "好音乐，随时听" else "你好，" + user.nickname,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                GlassButton(backdrop, onClick = onSearch, modifier = Modifier.size(42.dp),
                    tint = MaterialTheme.colorScheme.surface.copy(alpha = 0.22f)) {
                    Icon(
                        Icons.Rounded.Search,
                        contentDescription = "搜索",
                        tint = MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier.align(Alignment.Center).size(22.dp)
                    )
                }
                Spacer(Modifier.width(8.dp))
                GlassButton(backdrop, onClick = onSettings, modifier = Modifier.size(42.dp),
                    tint = MaterialTheme.colorScheme.surface.copy(alpha = 0.22f)) {
                    Icon(
                        Icons.Rounded.Settings,
                        contentDescription = "设置",
                        tint = MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier.align(Alignment.Center).size(22.dp)
                    )
                }
            }
        }

        item {
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .height(164.dp)
                    .clip(RoundedCornerShape(26.dp))
                    .background(
                        Brush.linearGradient(
                            listOf(Color(0xFF252525), Color(0xFF1C1C1C))
                        )
                    )
                    .clickable { data?.songs?.let { if (it.isNotEmpty()) onPlay(it, 0) } }
                    .padding(20.dp)
            ) {
                Column {
                    Text(
                        "听见此刻",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                    Text(
                        "从新歌开始，听见新的喜欢",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.78f),
                        modifier = Modifier.padding(top = 2.dp)
                    )
                    Button(
                        onClick = { data?.songs?.let { if (it.isNotEmpty()) onPlay(it, 0) } },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color.White.copy(alpha = 0.18f),
                            contentColor = Color.White
                        ),
                        shape = RoundedCornerShape(50),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 7.dp),
                        enabled = !data?.songs.isNullOrEmpty(),
                        modifier = Modifier.padding(top = 12.dp)
                    ) {
                        Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(5.dp))
                        Text("播放新歌", style = MaterialTheme.typography.labelMedium)
                    }
                }
                Icon(
                    Icons.Rounded.MusicNote,
                    contentDescription = null,
                    tint = Color.White.copy(alpha = 0.10f),
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .size(120.dp)
                )
            }
        }

        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp)
                .clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.surface.copy(alpha = 0.62f))
                .clickable(onClick = onSearch).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Search, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(19.dp))
                Text("搜索歌曲、歌手、专辑", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 10.dp))
            }
        }
        item { DiscoveryTools() }

        if (loading && data != null) {
            item {
                LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 24.dp).height(2.dp),
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f), trackColor = Color.Transparent)
            }
        }
        if (error != null && data != null) {
            item {
                Text("部分内容暂未更新，点此重试", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 22.dp, vertical = 4.dp).clickable(onClick = onRetry))
            }
        }

        if (loading && data == null) {
            item {
                Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
            }
        }

        if (error != null && data == null) {
            item {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        error,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Button(
                        onClick = onRetry,
                        modifier = Modifier.padding(top = 12.dp),
                        shape = RoundedCornerShape(50)
                    ) { Text("重试") }
                }
            }
        }

        val playlists = data?.playlists.orEmpty()
        if (playlists.isNotEmpty()) {
            item { SectionHeader("推荐歌单", "刷新", onRetry) }
            item {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    itemsIndexed(playlists, key = { _, p -> p.platform + "_" + p.id }) { index, playlist ->
                        ListEntrance(index) {
                        PlaylistCard(playlist, api, { onPlaylist(playlist) })
                        }
                    }
                }
            }
        }

        val charts = data?.charts.orEmpty()
        if (charts.isNotEmpty()) {
            item { SectionHeader("排行榜", "全部", onAllCharts) }
            item {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    itemsIndexed(charts, key = { _, c -> c.platform + "_" + c.id }) { index, chart ->
                        ListEntrance(index) {
                        ChartCard(chart, api, { onChart(chart) })
                        }
                    }
                }
            }
        }

        val songs = data?.songs.orEmpty()
        if (songs.isNotEmpty()) {
            item {
                SectionHeader("新歌速递", "播放全部", {
                    onPlay(songs, 0)
                })
            }
            itemsIndexed(songs.take(8), key = { _, s -> s.key }) { index, song ->
                SongRow(
                    song = song,
                    index = index,
                    api = api,
                    isFavorite = song.key in favorites,
                    onPlay = { onPlay(songs, index) },
                    onFavorite = { onFavorite(song) }
                )
            }
        }

        val singers = data?.singers.orEmpty()
        if (singers.isNotEmpty()) {
            item { SectionHeader("热门歌手") }
            item {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    itemsIndexed(singers, key = { _, s -> s.platform + "_" + s.id }) { _, singer ->
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.width(66.dp).clip(RoundedCornerShape(12.dp)).clickable { onSinger(singer) }
                        ) {
                            CoverImage(singer.pic, api, Modifier.size(62.dp), corner = 31)
                            Text(
                                singer.name,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(top = 5.dp)
                            )
                        }
                    }
                }
            }
        }

        if (songs.isEmpty() && singers.isEmpty() && !loading && data != null) {
            item { EmptyHint("已经到底啦，稍后再来看看") }
        }

    }
}
