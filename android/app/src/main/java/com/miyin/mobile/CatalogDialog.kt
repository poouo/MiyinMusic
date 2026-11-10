package com.miyin.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch

@Composable
fun CatalogDialog(api: ApiClient, id: String?, player: PlayerController, onClose: () -> Unit) {
    var album by remember(id) { mutableStateOf<AlbumDetail?>(null) }
    var items by remember(id) { mutableStateOf<List<Recommendation>>(emptyList()) }
    var error by remember(id) { mutableStateOf<String?>(null) }
    var loading by remember(id) { mutableStateOf(true) }
    var attempt by remember(id) { mutableStateOf(0) }
    LaunchedEffect(id, attempt) {
        loading = true; error = null
        try {
            if (id != null) album = api.get<AlbumDetail>("/api/album/$id")
            else items = api.get<Recommendations>("/api/discover/for-you").items
        } catch (e: Exception) { error = e.userMessage("内容加载失败") }
        finally { loading = false }
    }
    val songs = album?.songs ?: items.map { it.song }
    val actions = LocalLibraryActions.current
    val scope = rememberCoroutineScope()
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.statusBarsPadding().navigationBarsPadding()) {
                Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(album?.name ?: if (id == null) "为你选歌" else "专辑", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                    AppTextButton(onClick = onClose) { Text("返回") }
                }
                when {
                    loading -> CircularProgressIndicator(Modifier.padding(24.dp))
                    error != null -> Column(Modifier.padding(20.dp)) { Text(error!!); AppTextButton(onClick = { attempt++ }) { Text("重试") } }
                    songs.isEmpty() -> Text("暂无可读取歌曲", Modifier.padding(20.dp))
                    else -> LazyColumn {
                        itemsIndexed(songs, key = { index, song -> song.key + index }) { index, song ->
                            Column {
                                items.getOrNull(index)?.let { Text(it.reason, Modifier.padding(start = 20.dp), style = MaterialTheme.typography.labelSmall) }
                                SongRow(song, index, api, actions?.library?.favorites?.any { it.song.key == song.key } == true,
                                    onPlay = { player.play(songs, index) }, onFavorite = {
                                        if (actions?.requireLogin() == true) scope.launch {
                                            try { actions.update(if (actions.library.favorites.any { it.song.key == song.key }) api.removeFavorite(song) else api.addFavorite(song)) }
                                            catch (e: Exception) { actions.message(e.userMessage("收藏操作失败")) }
                                        }
                                    })
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun DiscoveryTools() {
    val actions = LocalLibraryActions.current ?: return
    var recommendations by remember { mutableStateOf(false) }
    var following by remember { mutableStateOf(false) }
    Row(Modifier.padding(horizontal = 16.dp)) {
        AppTextButton(onClick = { recommendations = true }) { Text("为你选歌") }
        AppTextButton(onClick = { following = true }) { Text("关注的歌手 · ${actions.library.favoriteSingers.size}") }
    }
    if (recommendations) CatalogDialog(actions.api, null, actions.player) { recommendations = false }
    if (following) AppDialog(onDismissRequest = { following = false }, title = { Text("关注的歌手") }, text = {
        LazyColumn(Modifier.heightIn(max = 360.dp)) {
            if (actions.library.favoriteSingers.isEmpty()) item { Text("在歌手详情页关注，三端同步") }
            itemsIndexed(actions.library.favoriteSingers) { _, singer -> AppTextButton(onClick = { following = false; actions.openSinger(singer) }) { Text(singer.name) } }
        }
    }, confirmButton = { AppTextButton(onClick = { following = false }) { Text("关闭") } })
}
