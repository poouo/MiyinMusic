package com.miyin.mobile

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
fun PlaylistDetailScreen(
    api: ApiClient,
    playlist: PlaylistInfo,
    localSongs: List<Song>? = null,
    favorites: Set<String>,
    onBack: () -> Unit,
    onPlay: (List<Song>, Int) -> Unit,
    onFavorite: (Song) -> Unit
) {
    val context = LocalContext.current
    val artwork = remember(context) { ArtworkCache.get(context) }
    var detail by remember(playlist.id, localSongs) { mutableStateOf(
        if (localSongs != null) PlaylistDetailResult(playlist, localSongs, localSongs.size) else api.cache.playlist(playlist.id)) }
    var loading by remember(playlist.id) { mutableStateOf(detail == null) }
    var error by remember(playlist.id) { mutableStateOf<String?>(null) }

    LaunchedEffect(playlist.id, localSongs) {
        loading = detail == null
        error = null
        try {
            val fresh = if (localSongs != null) PlaylistDetailResult(playlist, localSongs, localSongs.size) else api.playlist(playlist.id)
            if (fresh != detail) detail = fresh
            if (localSongs == null) api.cache.savePlaylist(playlist.id, fresh)
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { error = e.userMessage("歌单刷新失败，稍后再试")
        } finally { loading = false }
    }
    LaunchedEffect(playlist.id, detail) {
        detail?.let { snapshot ->
            artwork.warm((listOf(snapshot.playlist.cover) + snapshot.songs.map { it.img }).mapNotNull { api.imageUrl(it) }, refresh = true)
        }
    }

    val songs = detail?.songs.orEmpty()
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = LocalChromePadding.current)
    ) {
        item {
            DetailTopBar(onBack)
        }
        item {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                CoverImage(detail?.playlist?.cover ?: playlist.cover, api, Modifier.size(112.dp), corner = 20)
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        detail?.playlist?.name ?: playlist.name,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        (detail?.playlist?.creator ?: playlist.creator).ifBlank { "觅音推荐" } + " · " + songs.size + " 首",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                    val description = detail?.playlist?.description ?: playlist.description
                    if (description.isNotBlank()) {
                        Text(
                            description,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                }
            }
        }
        item {
            if (localSongs == null) SavePublicPlaylist(api, playlist.id)
            AppButton(
                onClick = { if (songs.isNotEmpty()) onPlay(songs, 0) },
                enabled = songs.isNotEmpty(),
                shape = RoundedCornerShape(50),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary
                ),
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp)
            ) {
                Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(5.dp))
                Text("播放全部")
            }
        }
        when {
            loading -> item {
                Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
            }
            error != null && songs.isEmpty() -> item { EmptyHint(error!!) }
            songs.isEmpty() -> item { EmptyHint("歌单里还没有歌曲") }
            else -> itemsIndexed(songs, key = { _, song -> song.key }) { index, song ->
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
}

@Composable
fun ChartDetailScreen(
    api: ApiClient,
    chart: ChartInfo,
    favorites: Set<String>,
    onBack: () -> Unit,
    onPlay: (List<Song>, Int) -> Unit,
    onFavorite: (Song) -> Unit
) {
    var result by remember { mutableStateOf<SearchResult?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(chart.id) {
        loading = true
        runCatching { api.chartSongs(chart.id) }
            .onSuccess { result = it }
            .onFailure { error = it.userMessage("榜单加载失败，请重试") }
        loading = false
    }

    val songs = result?.list.orEmpty()
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = LocalChromePadding.current)
    ) {
        item { DetailTopBar(onBack) }
        item {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .size(94.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.18f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Rounded.PlayArrow,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(42.dp)
                    )
                }
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        chart.name,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Text(
                        "每日更新 · " + songs.size + " 首",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
        item {
            AppButton(
                onClick = { if (songs.isNotEmpty()) onPlay(songs, 0) },
                enabled = songs.isNotEmpty(),
                shape = RoundedCornerShape(50),
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp)
            ) {
                Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(5.dp))
                Text("播放全部")
            }
        }
        when {
            loading -> item {
                Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
            }
            error != null -> item { EmptyHint(error!!) }
            songs.isEmpty() -> item { EmptyHint("榜单暂无歌曲") }
            else -> itemsIndexed(songs, key = { _, song -> song.key }) { index, song ->
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
}

@Composable
private fun DetailTopBar(onBack: () -> Unit, title: String = "歌单详情") {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.Rounded.ArrowBack, contentDescription = "返回", tint = MaterialTheme.colorScheme.onBackground)
        }
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground
        )
    }
}

@Composable
fun SingerDetailScreen(
    api: ApiClient,
    singer: SingerInfo,
    favorites: Set<String>,
    onBack: () -> Unit,
    onPlay: (List<Song>, Int) -> Unit,
    onFavorite: (Song) -> Unit
) {
    var detail by remember(singer.id) { mutableStateOf<SingerDetailResult?>(null) }
    var loading by remember(singer.id) { mutableStateOf(true) }
    var error by remember(singer.id) { mutableStateOf<String?>(null) }
    var attempt by remember(singer.id) { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    val actions = LocalLibraryActions.current
    var moreBusy by remember { mutableStateOf(false) }

    LaunchedEffect(singer.id, attempt) {
        loading = true
        error = null
        try {
            detail = api.singer(singer.id, singer.name)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.userMessage("歌手加载失败，请重试")
        } finally {
            loading = false
        }
    }
    val songs = detail?.songs.orEmpty()
    val info = detail?.singer ?: singer
    val followId = info.platform + "-" + info.id.removePrefix(info.platform + "-")
    val followed = actions?.library?.favoriteSingers?.any { it.id == followId } == true
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = LocalChromePadding.current)) {
        item { DetailTopBar(onBack, "歌手详情") }
        item {
            Row(Modifier.fillMaxWidth().padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                CoverImage(info.pic ?: singer.pic, api, Modifier.size(112.dp), corner = 56)
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(info.name, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground)
                    Text("已加载 ${songs.size} 首 · " + (if (detail?.source == "catalog") "歌手作品" else "搜索到的歌曲"), style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                    AppTextButton(enabled = !moreBusy, modifier = Modifier.padding(top = 12.dp), onClick = {
                        if (actions?.requireLogin() == true) {
                            moreBusy = true
                            scope.launch {
                                try {
                                    val response = if (followed) api.delete<LibraryResponse>("/api/library/singers/$followId")
                                        else api.post<Map<String, SingerInfo>, LibraryResponse>("/api/library/singers", mapOf("singer" to info))
                                    actions.update(response.library)
                                } catch (e: Exception) { actions.message(e.userMessage("关注操作失败")) }
                                finally { moreBusy = false }
                            }
                        }
                    }) { Text(if (followed) "取消关注" else "关注歌手") }
                }
            }
        }
        item {
            AppButton(onClick = { onPlay(songs, 0) }, enabled = songs.isNotEmpty(), modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("播放全部")
            }
        }
        when {
            loading -> item {
                Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            }
            error != null -> item {
                Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    EmptyHint(error!!)
                    AppButton(onClick = { attempt++ }) { Text("重试") }
                }
            }
            songs.isEmpty() -> item { EmptyHint("暂时没有热门歌曲") }
            else -> itemsIndexed(songs, key = { index, song -> song.key + "_" + index }) { index, song ->
                SongRow(song = song, index = index, api = api, isFavorite = song.key in favorites,
                    onPlay = { onPlay(songs, index) }, onFavorite = { onFavorite(song) })
            }
        }
        if (detail?.hasMore == true) item {
            AppTextButton(enabled = !moreBusy, onClick = {
                moreBusy = true
                scope.launch {
                    try {
                        val next = api.get<SingerDetailResult>("/api/singer/" + singer.id + "?name=" + java.net.URLEncoder.encode(singer.name, "UTF-8") + "&page=" + ((detail?.page ?: 1) + 1))
                        detail = next.copy(songs = (songs + next.songs).distinctBy { it.key })
                    } catch (e: Exception) { actions?.message(e.userMessage("加载失败，请重试")) }
                    finally { moreBusy = false }
                }
            }) { Text(if (moreBusy) "加载中" else "加载更多作品") }
        }
    }
}
