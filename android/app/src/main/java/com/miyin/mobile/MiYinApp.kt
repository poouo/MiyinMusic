package com.miyin.mobile

import android.app.Activity
import android.content.pm.ActivityInfo
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.zIndex
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import kotlinx.coroutines.delay
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
data class HomeData(
    val playlists: List<PlaylistInfo> = emptyList(),
    val charts: List<ChartInfo> = emptyList(),
    val songs: List<Song> = emptyList(),
    val singers: List<SingerInfo> = emptyList()
)

private data class ScreenRoute(val tab: Int, val playlist: PlaylistInfo?, val chart: ChartInfo?, val allCharts: Boolean, val singer: SingerInfo?) {
    val key: String get() = playlist?.let { "playlist:${it.id}" } ?: chart?.let { "chart:${it.id}" } ?: singer?.let { "singer:${it.id}" } ?: if (allCharts) "charts" else "tab:$tab"
}

@Composable
fun MiYinApp() {
    val context = LocalContext.current
    val prefs = remember { AppPrefs(context) }
    val api = remember { ApiClient(context) }
    val player = remember { PlaybackEngine.controller(context, api) }
    val scope = rememberCoroutineScope()
    val libraryMutex = remember { kotlinx.coroutines.sync.Mutex() }
    val view = LocalView.current
    val density = LocalDensity.current
    val savedScreens = rememberSaveableStateHolder()
    val cachedSession = remember { api.cache.session() }
    var chromePadding by remember { mutableStateOf(96.dp) }
    var homeLoadJob by remember { mutableStateOf<Job?>(null) }

    var themeMode by remember { mutableStateOf(prefs.themeMode) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var user by remember { mutableStateOf(cachedSession.user) }
    var library by remember { mutableStateOf(cachedSession.library) }
    var homeData by remember { mutableStateOf(if (prefs.showCachedHome) api.cache.home() else null) }
    var homeLoading by remember { mutableStateOf(true) }
    var homeError by remember { mutableStateOf<String?>(null) }
    var playlistDetail by remember { mutableStateOf<PlaylistInfo?>(null) }
    var chartDetail by remember { mutableStateOf<ChartInfo?>(null) }
    var singerDetail by remember { mutableStateOf<SingerInfo?>(null) }
    var showCharts by rememberSaveable { mutableStateOf(false) }
    var showNowPlaying by remember { mutableStateOf(false) }
    var showLogin by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    var showImport by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }

    val dark = when (themeMode) {
        "light" -> false
        "dark" -> true
        else -> androidx.compose.foundation.isSystemInDarkTheme()
    }

    fun reloadHome() {
        if (homeLoadJob?.isActive == true) return
        homeLoadJob = scope.launch {
            homeLoading = true
            homeError = null
            val failures = mutableListOf<String>()
            fun failed(e: Throwable) {
                if (e is CancellationException) throw e
                failures += e.userMessage("内容加载失败")
            }
            coroutineScope {
                launch { runCatching { api.discoverPlaylists(12) }.onSuccess {
                    homeData = (homeData ?: HomeData()).copy(playlists = it)
                }.onFailure(::failed) }
                launch { runCatching { api.charts() }.onSuccess {
                    homeData = (homeData ?: HomeData()).copy(charts = it)
                }.onFailure(::failed) }
                launch { runCatching { api.newSongs(12) }.onSuccess {
                    homeData = (homeData ?: HomeData()).copy(songs = it)
                }.onFailure(::failed) }
                launch { runCatching { api.singers(12) }.onSuccess {
                    homeData = (homeData ?: HomeData()).copy(singers = it)
                }.onFailure(::failed) }
            }
            homeError = failures.firstOrNull()
            homeData?.let { api.cache.saveHome(it) }
            homeLoading = false
        }
    }

    fun playSongs(songs: List<Song>, index: Int) {
        if (songs.isEmpty()) return
        showNowPlaying = true
        player.play(songs, index)
        scope.launch {
            delay(600)
            library = runCatching { api.library() }.getOrDefault(library)
        }
    }

    fun toggleFavorite(song: Song) {
        if (user == null) {
            showLogin = true
            return
        }
        scope.launch {
            val isFavorite = library.favorites.any { it.song.key == song.key }
            runCatching {
                if (isFavorite) api.removeFavorite(song) else api.addFavorite(song)
            }.onSuccess {
                library = it
            }.onFailure {
                toast = it.userMessage("操作失败，请重试")
            }
        }
    }

    LaunchedEffect(Unit) {
        AppCache.sessionUpdates.collect { snapshot ->
            if (snapshot != null) {
                user = snapshot.user
                library = snapshot.library
            }
        }
    }

    LaunchedEffect(Unit) {
        reloadHome()
        val owner = user?.id
        try {
            val refreshedUser = api.me()
            if (owner != user?.id) return@LaunchedEffect
            if (refreshedUser?.id != user?.id) library = api.cache.libraryFor(refreshedUser)
            user = refreshedUser
            val refreshedLibrary = runCatching { api.library() }.getOrNull()
            if (user?.id == refreshedUser?.id && refreshedLibrary != null) library = refreshedLibrary
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Retain the last visible session during a network failure.
        }
    }

    LaunchedEffect(user, library) {
        api.cache.saveSession(user, library)
    }

    LaunchedEffect(toast) {
        if (toast != null) {
            delay(2400)
            toast = null
        }
    }

    LaunchedEffect(themeMode) {
        prefs.themeMode = themeMode
    }

    // 播放页保持用户方向；暂停不改变歌词布局。
    LaunchedEffect(showNowPlaying) {
        val activity = context as? Activity
        activity?.requestedOrientation = if (showNowPlaying) {
            ActivityInfo.SCREEN_ORIENTATION_USER
        } else {
            ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
    }

    BackHandler(
        enabled = showNowPlaying || showLogin || showSettings || playlistDetail != null || chartDetail != null || singerDetail != null || showCharts
    ) {
        when {
            showNowPlaying -> showNowPlaying = false
            showLogin -> showLogin = false
            showSettings -> showSettings = false
            playlistDetail != null -> playlistDetail = null
            chartDetail != null -> chartDetail = null
            singerDetail != null -> singerDetail = null
            showCharts -> showCharts = false
        }
    }

    MiYinTheme(themeMode) {
        SideEffect {
            val window = (context as? Activity)?.window ?: return@SideEffect
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = !dark
            controller.isAppearanceLightNavigationBars = !dark
        }

        val backdrop = rememberLayerBackdrop()
        val wallpaperBackdrop = rememberLayerBackdrop()
        val favorites = library.favorites.map { it.song.key }.toSet()

        Box(Modifier.fillMaxSize()) {
            Box(
                Modifier
                    .fillMaxSize()
                    .layerBackdrop(backdrop)
            ) {
                // Header controls sample only wallpaper, never the layer that contains themselves.
                Box(Modifier.fillMaxSize().layerBackdrop(wallpaperBackdrop)) {
                    AppBackground(api, player.current?.img, dark)
                }
                val route = ScreenRoute(tab, playlistDetail, chartDetail, showCharts, singerDetail)
                Box(
                    Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                ) {
                    val libraryOwner = user?.id
                    CompositionLocalProvider(LocalChromePadding provides chromePadding,
                        LocalLibraryActions provides LibraryActions(library, player, api,
                            { if (libraryOwner == user?.id) library = it }, { toast = it }, { if (user == null) { showLogin = true; false } else true }, libraryMutex, { singerDetail = it })) {
                    AnimatedContent(
                        targetState = route,
                        transitionSpec = {
                            val opening = targetState.playlist != null || targetState.chart != null || targetState.singer != null ||
                                (targetState.allCharts && !initialState.allCharts)
                            val direction = if (opening || targetState.tab > initialState.tab) 1 else -1
                            val enter = fadeIn(tween(260, 40)) + slideInHorizontally(tween(360)) { it / 7 * direction }
                            val exit = fadeOut(tween(160)) + slideOutHorizontally(tween(280)) { -it / 12 * direction }
                            enter togetherWith exit
                        },
                        label = "screen",
                        modifier = Modifier.fillMaxSize()
                    ) { currentRoute ->
                        savedScreens.SaveableStateProvider(currentRoute.key) {
                        val playlist = currentRoute.playlist
                        val chart = currentRoute.chart
                        val singer = currentRoute.singer
                        when {
                            singer != null -> SingerDetailScreen(
                                api = api, singer = singer, favorites = favorites,
                                onBack = { singerDetail = null },
                                onPlay = { songs, index -> playSongs(songs, index) },
                                onFavorite = ::toggleFavorite
                            )
                            playlist != null -> androidx.compose.runtime.CompositionLocalProvider(
                                LocalEditingPlaylist provides library.playlists.find { "local:${it.id}" == playlist.id }) { PlaylistDetailScreen(
                                api = api,
                                playlist = playlist,
                                localSongs = library.playlists.find { "local:${it.id}" == playlist.id }?.songs,
                                favorites = favorites,
                                onBack = { playlistDetail = null },
                                onPlay = { songs, index -> playSongs(songs, index) },
                                onFavorite = ::toggleFavorite
                            ) }

                            chart != null -> ChartDetailScreen(
                                api = api,
                                chart = chart,
                                favorites = favorites,
                                onBack = { chartDetail = null },
                                onPlay = { songs, index -> playSongs(songs, index) },
                                onFavorite = ::toggleFavorite
                            )

                            currentRoute.allCharts -> ChartsScreen(api, homeData?.charts.orEmpty(),
                                onBack = { showCharts = false }, onChart = { chartDetail = it })

                            currentRoute.tab == 0 -> HomeScreen(
                                api = api,
                                backdrop = wallpaperBackdrop,
                                data = homeData,
                                loading = homeLoading,
                                error = homeError,
                                user = user,
                                favorites = favorites,
                                onFavorite = ::toggleFavorite,
                                onRetry = ::reloadHome,
                                onPlaylist = { playlistDetail = it },
                                onChart = { chartDetail = it },
                                onSinger = { singerDetail = it },
                                onAllCharts = { showCharts = true },
                                onPlay = { songs, index -> playSongs(songs, index) },
                                onSearch = { tab = 1 },
                                onSettings = { showSettings = true },
                                onLogin = { showLogin = true }
                            )

                            currentRoute.tab == 1 -> SearchScreen(
                                api = api,
                                favorites = favorites,
                                onPlay = { songs, index -> playSongs(songs, index) },
                                onFavorite = ::toggleFavorite
                            )

                            else -> LibraryScreen(
                                api = api,
                                library = library,
                                user = user,
                                favorites = favorites,
                                onPlay = { songs, index -> playSongs(songs, index) },
                                onFavorite = ::toggleFavorite,
                                onLogin = { showLogin = true },
                                onSettings = { showSettings = true },
                                onImport = { if (user == null) showLogin = true else showImport = true },
                                onPlaylist = { playlist ->
                                    playlistDetail = PlaylistInfo(id = "local:${playlist.id}", name = playlist.name,
                                        description = playlist.description, trackCount = playlist.songs.size)
                                },
                                onLogout = {
                                    scope.launch {
                                        runCatching { api.logout() }
                                        user = null
                                        library = LibraryData()
                                    }
                                }
                            )
                        }
                    }
                        }
                    }
                }
            }

            Box(Modifier.align(Alignment.BottomCenter).zIndex(2f).onSizeChanged {
                chromePadding = with(density) { it.height.toDp() } + 12.dp
            }) {
                BottomArea(
                    backdrop = backdrop,
                    player = player,
                    api = api,
                    selectedTab = tab,
                    onTab = {
                        tab = it
                        playlistDetail = null
                        chartDetail = null
                        singerDetail = null
                        showCharts = false
                    },
                    onOpenNowPlaying = { showNowPlaying = true }
                )
            }

            AnimatedVisibility(
                visible = showNowPlaying,
                enter = fadeIn(tween(220)) + slideInVertically(tween(300)) { it },
                exit = fadeOut(tween(160)) + slideOutVertically(tween(260)) { it },
                modifier = Modifier
                    .fillMaxSize()
                    .zIndex(3f)
            ) {
                NowPlayingScreen(
                    api = api,
                    player = player,
                    isFavorite = player.current?.key?.let { it in favorites } == true,
                    onFavorite = ::toggleFavorite,
                    onBack = { showNowPlaying = false }
                )
            }

            if (showLogin) {
                LoginDialog(
                    api = api,
                    onClose = { showLogin = false },
                    onSuccess = { loggedIn ->
                        library = api.cache.libraryFor(loggedIn)
                        user = loggedIn
                        showLogin = false
                        scope.launch {
                            val refreshed = runCatching { api.library() }.getOrNull()
                            if (user?.id == loggedIn.id && refreshed != null) library = refreshed
                        }
                    }
                )
            }

            AnimatedVisibility(
                visible = showSettings,
                enter = fadeIn(tween(240)) + slideInHorizontally(tween(340)) { it / 6 },
                exit = fadeOut(tween(160)) + slideOutHorizontally(tween(280)) { it / 6 },
                modifier = Modifier.fillMaxSize().zIndex(4f)
            ) {
                SettingsScreen(
                    user = user,
                    themeMode = themeMode,
                    onTheme = { themeMode = it },
                    onQuality = { player.setDefaultQuality(it) },
                    onLogin = { showLogin = true; showSettings = false },
                    onLogout = {
                        scope.launch {
                            runCatching { api.logout() }
                            user = null
                            library = api.cache.libraryFor(null)
                            showSettings = false
                        }
                    },
                    onBack = { showSettings = false }
                )
            }

            if (showImport) {
                ImportPlaylistDialog(api, onClose = { showImport = false }, onImported = {
                    library = it
                    showImport = false
                    toast = "已导入到我的歌单"
                })
            }

            AnimatedVisibility(
                visible = toast != null,
                enter = fadeIn(tween(160)) + slideInVertically(tween(200)) { -it },
                exit = fadeOut(tween(120)) + slideOutVertically(tween(160)) { -it },
                modifier = Modifier.align(Alignment.TopCenter)
            ) {
                Box(
                    Modifier
                        .statusBarsPadding()
                        .padding(top = 12.dp)
                        .clip(RoundedCornerShape(50))
                        .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.94f))
                        .padding(horizontal = 18.dp, vertical = 10.dp)
                ) {
                    Text(toast.orEmpty(), color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun BottomArea(
    backdrop: com.kyant.backdrop.Backdrop,
    player: PlayerController,
    api: ApiClient,
    selectedTab: Int,
    onTab: (Int) -> Unit,
    onOpenNowPlaying: () -> Unit
) {
    Column(
        Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        val song = player.current
        AnimatedVisibility(
            visible = song != null,
            enter = fadeIn(tween(220)) + expandVertically(tween(280), expandFrom = Alignment.Bottom),
            exit = fadeOut(tween(150)) + shrinkVertically(tween(220), shrinkTowards = Alignment.Bottom)
        ) {
            song?.let { current ->
                GlassPanel(
                    backdrop = backdrop,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(onClick = onOpenNowPlaying),
                    shape = RoundedCornerShape(22.dp),
                    tint = MaterialTheme.colorScheme.surface.copy(alpha = 0.28f)
                ) {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .padding(10.dp)
                    ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CoverImage(current.img, api, Modifier.size(44.dp), corner = 12)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                current.name,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                current.singer,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Icon(
                            imageVector = if (player.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                            contentDescription = "播放/暂停",
                            tint = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShapeCompat)
                                .clickable { player.toggle() }
                                .padding(5.dp)
                        )
                        Icon(
                            imageVector = Icons.Rounded.SkipNext,
                            contentDescription = "下一首",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier
                                .size(30.dp)
                                .clickable { player.next() }
                                .padding(4.dp)
                        )
                    }
                    val progress = if (player.durationMs > 0) {
                        (player.positionMs.toFloat() / player.durationMs.toFloat()).coerceIn(0f, 1f)
                    } else 0f
                    LinearProgressIndicator(
                        progress = { progress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp)
                            .height(2.dp)
                            .clip(RoundedCornerShape(50)),
                        color = MaterialTheme.colorScheme.primary,
                        trackColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f)
                    )
                    }
                }
            }
        }

        LiquidNavigation(backdrop, selectedTab, onTab)
    }
}

private val CircleShapeCompat = RoundedCornerShape(50)
