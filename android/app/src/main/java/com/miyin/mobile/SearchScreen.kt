package com.miyin.mobile

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException

private val platforms = listOf(
    "tx" to "QQ音乐",
    "wy" to "网易云",
    "kw" to "酷我",
    "kg" to "酷狗",
    "mg" to "咪咕"
)

@Composable
fun SearchScreen(
    api: ApiClient,
    favorites: Set<String>,
    onPlay: (List<Song>, Int) -> Unit,
    onFavorite: (Song) -> Unit
) {
    var query by remember { mutableStateOf("") }
    var platform by remember { mutableStateOf("tx") }
    var result by remember { mutableStateOf<SearchResult?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var loadingMore by remember { mutableStateOf(false) }
    var moreError by remember { mutableStateOf<String?>(null) }
    var searchJob by remember { mutableStateOf<Job?>(null) }
    var version by remember { mutableStateOf(0) }
    var activeKeyword by remember { mutableStateOf("") }
    var activePlatform by remember { mutableStateOf("tx") }
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val store = ListeningStore(androidx.compose.ui.platform.LocalContext.current)
    var history by remember { mutableStateOf(store.history) }

    DisposableEffect(Unit) { onDispose { version++; searchJob?.cancel() } }

    fun search(append: Boolean = false) {
        if (append && (loading || loadingMore || result?.hasMore != true)) return
        val text = if (append) activeKeyword else query.trim()
        if (text.isEmpty()) return
        if (!append) { history = (listOf(text) + history.filterNot { it == text }).take(20); store.history = history }
        val target = if (append) activePlatform else platform
        val page = if (append) (result?.page ?: 1) + 1 else 1
        val token = ++version
        searchJob?.cancel()
        keyboard?.hide()
        if (append) { loadingMore = true; moreError = null } else {
            loading = true; loadingMore = false; error = null; moreError = null; result = null
            activeKeyword = text; activePlatform = target
        }
        searchJob = scope.launch {
            try {
                val next = api.search(target, text, page)
                if (token == version) result = next.copy(list = if (append)
                    (result?.list.orEmpty() + next.list).distinctBy { it.key } else next.list.distinctBy { it.key })
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                if (token == version) {
                    if (append) moreError = e.userMessage("加载失败，点击重试") else error = e.userMessage("搜索失败，请稍后重试")
                }
            } finally { if (token == version) { loading = false; loadingMore = false } }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "搜索",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground
            )
            Spacer(Modifier.weight(1f))
            Text(
                "多平台曲库",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
            placeholder = { Text("搜索歌曲、歌手、专辑") },
            singleLine = true,
            shape = RoundedCornerShape(50),
            leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
            trailingIcon = {
                IconButton(onClick = { search() }) {
                    Icon(Icons.Rounded.Search, contentDescription = "搜索")
                }
            },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { search() })
        )

        LazyRow(
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(platforms.size) { index ->
                val (value, label) = platforms[index]
                FilterChip(
                    selected = platform == value,
                    onClick = {
                        platform = value
                        if (query.isNotBlank()) search()
                    },
                    label = { Text(label) },
                    shape = RoundedCornerShape(50),
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.18f),
                        selectedLabelColor = MaterialTheme.colorScheme.primary
                    )
                )
            }
        }

        if (result == null && !loading && history.isNotEmpty()) {
            LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(history) { keyword -> TextButton(onClick = { query = keyword; search() }) { Text(keyword) } }
                item { TextButton(onClick = { history = emptyList(); store.history = emptyList() }) { Text("清空历史") } }
            }
        }
        when {
            loading -> Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            }

            error != null -> Column(
                Modifier
                    .fillMaxWidth()
                    .padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(error!!, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { search() }) { Text("重试") }
            }

            result != null && result!!.list.isEmpty() -> EmptyHint("没有找到相关歌曲，换个关键词试试")

            result != null -> {
                Text(
                    "共 " + result!!.total + " 首 · 已加载 " + result!!.list.size + " 首",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 22.dp, vertical = 4.dp)
                )
                LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = LocalChromePadding.current)) {
                    itemsIndexed(result!!.list, key = { _, song -> song.key }) { index, song ->
                        SongRow(
                            song = song,
                            index = index,
                            api = api,
                            isFavorite = song.key in favorites,
                            onPlay = { onPlay(result!!.list, index) },
                            onFavorite = { onFavorite(song) }
                        )
                    }
                    if (result!!.hasMore) item {
                        Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                            TextButton(onClick = { search(true) }, enabled = !loadingMore) {
                                Text(if (loadingMore) "加载中…" else moreError ?: "加载更多")
                            }
                        }
                    }
                }
            }

            else -> Column(
                Modifier
                    .fillMaxSize()
                    .padding(top = 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(
                    Icons.Rounded.Search,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                    modifier = Modifier.height(52.dp)
                )
                Text(
                    "搜索你想听的音乐",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 10.dp)
                )
            }
        }
    }
}
