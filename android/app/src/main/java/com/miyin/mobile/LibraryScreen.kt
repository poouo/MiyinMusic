package com.miyin.mobile

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Login
import androidx.compose.material.icons.rounded.Logout
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.QueueMusic
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
fun LibraryScreen(
    api: ApiClient,
    library: LibraryData,
    user: User?,
    favorites: Set<String>,
    onPlay: (List<Song>, Int) -> Unit,
    onFavorite: (Song) -> Unit,
    onLogin: () -> Unit,
    onLogout: () -> Unit
) {
    var tab by remember { mutableIntStateOf(0) }
    val favoriteSongs = library.favorites.map { it.song }
    val historySongs = library.history.map { it.song }

    Column(Modifier.fillMaxSize()) {
        Text(
            "我的",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.padding(start = 20.dp, top = 8.dp, bottom = 12.dp)
        )

        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.48f))
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier
                    .size(54.dp)
                    .clip(CircleShape)
                    .background(
                        if (user == null) MaterialTheme.colorScheme.surfaceVariant
                        else MaterialTheme.colorScheme.primary.copy(alpha = 0.20f)
                    ),
                contentAlignment = Alignment.Center
            ) {
                if (user == null) {
                    Icon(
                        Icons.Rounded.MusicNote,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary
                    )
                } else {
                    Text(
                        user.initial,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    user?.nickname ?: "未登录",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onBackground
                )
                Text(
                    if (user == null) "登录后同步收藏、歌单和播放记录" else user.roleText + " · 已同步",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (user == null) {
                Button(
                    onClick = onLogin,
                    shape = RoundedCornerShape(50),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 7.dp)
                ) {
                    Icon(Icons.Rounded.Login, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("登录")
                }
            } else {
                Icon(
                    Icons.Rounded.Logout,
                    contentDescription = "退出登录",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .size(24.dp)
                        .clickable(onClick = onLogout)
                )
            }
        }

        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            LibraryTab("喜欢", Icons.Rounded.Favorite, tab == 0, favoriteSongs.size) { tab = 0 }
            LibraryTab("最近", Icons.Rounded.History, tab == 1, historySongs.size) { tab = 1 }
            LibraryTab("歌单", Icons.Rounded.QueueMusic, tab == 2, library.playlists.size) { tab = 2 }
        }

        AnimatedContent(
            targetState = tab,
            transitionSpec = {
                fadeIn(tween(200)) togetherWith fadeOut(tween(140))
            },
            label = "library-tab"
        ) { currentTab ->
            when (currentTab) {
                0 -> SongList(api, favoriteSongs, favorites, onPlay, onFavorite, "还没有喜欢的歌曲，去发现好音乐吧")
                1 -> SongList(api, historySongs, favorites, onPlay, onFavorite, "还没有播放记录")
                else -> PlaylistList(library.playlists, onPlay)
            }
        }
    }
}

@Composable
private fun LibraryTab(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    count: Int,
    onClick: () -> Unit
) {
    Row(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(
                if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)
                else MaterialTheme.colorScheme.surface.copy(alpha = 0.35f)
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(15.dp)
        )
        Spacer(Modifier.width(5.dp))
        Text(
            if (count > 0) label + " " + count else label,
            style = MaterialTheme.typography.labelMedium,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal
        )
    }
}

@Composable
private fun SongList(
    api: ApiClient,
    songs: List<Song>,
    favorites: Set<String>,
    onPlay: (List<Song>, Int) -> Unit,
    onFavorite: (Song) -> Unit,
    emptyText: String
) {
    if (songs.isEmpty()) {
        EmptyHint(emptyText)
        return
    }
    LazyColumn(contentPadding = PaddingValues(bottom = 12.dp)) {
        itemsIndexed(songs, key = { _, song -> song.key }) { index, song ->
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
}

@Composable
private fun PlaylistList(playlists: List<Playlist>, onPlay: (List<Song>, Int) -> Unit) {
    if (playlists.isEmpty()) {
        EmptyHint("还没有创建歌单")
        return
    }
    LazyColumn(contentPadding = PaddingValues(bottom = 12.dp)) {
        items(playlists, key = { it.id }) { playlist ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable { if (playlist.songs.isNotEmpty()) onPlay(playlist.songs, 0) }
                    .padding(horizontal = 20.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .size(52.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Rounded.QueueMusic,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        playlist.name,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onBackground,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        playlist.songs.size.toString() + " 首歌曲",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}
