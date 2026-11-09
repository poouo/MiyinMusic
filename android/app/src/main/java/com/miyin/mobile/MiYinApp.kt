package com.miyin.mobile

import android.app.Activity
import android.content.pm.ActivityInfo
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.material.icons.rounded.Explore
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

data class HomeData(
    val playlists: List<PlaylistInfo>,
    val charts: List<ChartInfo>,
    val songs: List<Song>,
    val singers: List<SingerInfo>
)

@Composable
fun MiYinApp() {
    val context = LocalContext.current
    val prefs = remember { AppPrefs(context) }
    val api = remember { ApiClient(context) }
    val player = remember { PlayerController(context, api) }
    val scope = rememberCoroutineScope()
    val view = LocalView.current

    var themeMode by remember { mutableStateOf(prefs.themeMode) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var user by remember { mutableStateOf<User?>(null) }
    var library by remember { mutableStateOf(LibraryData()) }
    var homeData by remember { mutableStateOf<HomeData?>(null) }
    var homeLoading by remember { mutableStateOf(true) }
    var homeError by remember { mutableStateOf<String?>(null) }
    var playlistDetail by remember { mutableStateOf<PlaylistInfo?>(null) }
    var chartDetail by remember { mutableStateOf<ChartInfo?>(null) }
    var showNowPlaying by remember { mutableStateOf(false) }
    var showLogin by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }

    val dark = when (themeMode) {
        "light" -> false
        "dark" -> true
        else -> androidx.compose.foundation.isSystemInDarkTheme()
    }

    fun reloadHome() {
        scope.launch {
            homeLoading = true
            homeError = null
            runCatching {
                HomeData(
                    playlists = api.discoverPlaylists(12),
                    charts = api.charts(),
                    songs = api.newSongs(12),
                    singers = api.singers(12)
                )
            }.onSuccess {
                homeData = it
            }.onFailure {
                homeError = it.message ?: "内容加载失败"
            }
            homeLoading = false
        }
    }

    fun reloadLibrary() {
        scope.launch {
            library = runCatching { api.library() }.getOrDefault(library)
        }
    }

    fun playSongs(songs: List<Song>, index: Int) {
        if (songs.isEmpty()) return
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
                toast = it.message ?: "操作失败"
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose { player.release() }
    }

    LaunchedEffect(Unit) {
        reloadHome()
        user = runCatching { api.me() }.getOrNull()
        library = runCatching { api.library() }.getOrDefault(LibraryData())
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

    // 只有正在播放音乐时才允许横屏；暂停 / 未播放时锁定竖屏。
    LaunchedEffect(player.isPlaying) {
        val activity = context as? Activity
        activity?.requestedOrientation = if (player.isPlaying || player.isBuffering) {
            ActivityInfo.SCREEN_ORIENTATION_USER
        } else {
            ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
    }

    BackHandler(
        enabled = showNowPlaying || showLogin || showSettings || playlistDetail != null || chartDetail != null
    ) {
        when {
            showNowPlaying -> showNowPlaying = false
            showLogin -> showLogin = false
            showSettings -> showSettings = false
            playlistDetail != null -> playlistDetail = null
            chartDetail != null -> chartDetail = null
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
        val favorites = library.favorites.map { it.song.key }.toSet()

        Box(Modifier.fillMaxSize()) {
            Box(
                Modifier
                    .fillMaxSize()
                    .layerBackdrop(backdrop)
            ) {
                AppBackground(api, player.current?.img, dark)
                val screenKey = when {
                    playlistDetail != null -> "playlist:" + playlistDetail!!.id
                    chartDetail != null -> "chart:" + chartDetail!!.id
                    else -> "tab:" + tab
                }
                Box(
                    Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                        .padding(bottom = if (player.current != null) 230.dp else 150.dp)
                ) {
                    AnimatedContent(
                        targetState = screenKey,
                        transitionSpec = {
                            val enter = fadeIn(tween(230)) + slideInHorizontally(tween(280)) { width ->
                                if (targetState.startsWith("tab:")) width / 10 else width / 5
                            }
                            val exit = fadeOut(tween(150)) + slideOutHorizontally(tween(210)) { width ->
                                if (targetState.startsWith("tab:")) -width / 14 else -width / 7
                            }
                            enter togetherWith exit
                        },
                        label = "screen",
                        modifier = Modifier.fillMaxSize()
                    ) { _ ->
                        val playlist = playlistDetail
                        val chart = chartDetail
                        when {
                            playlist != null -> PlaylistDetailScreen(
                                api = api,
                                playlist = playlist,
                                favorites = favorites,
                                onBack = { playlistDetail = null },
                                onPlay = { songs, index -> playSongs(songs, index) },
                                onFavorite = ::toggleFavorite
                            )

                            chart != null -> ChartDetailScreen(
                                api = api,
                                chart = chart,
                                favorites = favorites,
                                onBack = { chartDetail = null },
                                onPlay = { songs, index -> playSongs(songs, index) },
                                onFavorite = ::toggleFavorite
                            )

                            tab == 0 -> HomeScreen(
                                api = api,
                                data = homeData,
                                loading = homeLoading,
                                error = homeError,
                                user = user,
                                favorites = favorites,
                                onFavorite = ::toggleFavorite,
                                onRetry = ::reloadHome,
                                onPlaylist = { playlistDetail = it },
                                onChart = { chartDetail = it },
                                onPlay = { songs, index -> playSongs(songs, index) },
                                onSearch = { tab = 1 },
                                onSettings = { showSettings = true },
                                onLogin = { showLogin = true }
                            )

                            tab == 1 -> SearchScreen(
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
                                onLogout = {
                                    scope.launch {
                                        runCatching { api.logout() }
                                        user = null
                                        library = runCatching { api.library() }.getOrDefault(LibraryData())
                                    }
                                }
                            )
                        }
                    }
                }
            }

            Box(Modifier.align(Alignment.BottomCenter)) {
                BottomArea(
                    backdrop = backdrop,
                    player = player,
                    api = api,
                    selectedTab = tab,
                    onTab = {
                        tab = it
                        playlistDetail = null
                        chartDetail = null
                    },
                    onOpenNowPlaying = { showNowPlaying = true }
                )
            }

            AnimatedVisibility(
                visible = showNowPlaying,
                enter = fadeIn(tween(220)) + slideInVertically(tween(300)) { it },
                exit = fadeOut(tween(160)) + slideOutVertically(tween(260)) { it },
                modifier = Modifier.fillMaxSize()
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
                        user = loggedIn
                        showLogin = false
                        scope.launch {
                            library = runCatching { api.library() }.getOrDefault(library)
                        }
                    }
                )
            }

            if (showSettings) {
                SettingsDialog(
                    api = api,
                    user = user,
                    themeMode = themeMode,
                    onTheme = { themeMode = it },
                    onLogin = { showLogin = true; showSettings = false },
                    onLogout = {
                        scope.launch {
                            runCatching { api.logout() }
                            user = null
                            library = runCatching { api.library() }.getOrDefault(LibraryData())
                            showSettings = false
                        }
                    },
                    onClose = { showSettings = false }
                )
            }

            toast?.let {
                Box(
                    Modifier
                        .align(Alignment.TopCenter)
                        .statusBarsPadding()
                        .padding(top = 12.dp)
                        .clip(RoundedCornerShape(50))
                        .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.94f))
                        .padding(horizontal = 18.dp, vertical = 10.dp)
                ) {
                    Text(it, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodySmall)
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
            .padding(horizontal = 12.dp, vertical = 8.dp),
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
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(22.dp),
                    tint = MaterialTheme.colorScheme.surface.copy(alpha = 0.28f)
                ) {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clickable(onClick = onOpenNowPlaying)
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

        GlassPanel(
            backdrop = backdrop,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(26.dp),
            tint = MaterialTheme.colorScheme.surface.copy(alpha = 0.30f)
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.SpaceAround
            ) {
                NavItem("发现", Icons.Rounded.Explore, selectedTab == 0) { onTab(0) }
                NavItem("搜索", Icons.Rounded.Search, selectedTab == 1) { onTab(1) }
                NavItem("我的", Icons.Rounded.Person, selectedTab == 2) { onTab(2) }
            }
        }
    }
}

@Composable
private fun NavItem(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, selected: Boolean, onClick: () -> Unit) {
    val color by animateColorAsState(
        targetValue = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
        animationSpec = tween(220),
        label = "nav-color"
    )
    val scale by animateFloatAsState(
        targetValue = if (selected) 1.10f else 1f,
        animationSpec = tween(220),
        label = "nav-scale"
    )
    val pill by animateColorAsState(
        targetValue = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent,
        animationSpec = tween(220),
        label = "nav-pill"
    )
    Column(
        Modifier
            .clip(RoundedCornerShape(18.dp))
            .background(pill)
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            icon,
            contentDescription = label,
            tint = color,
            modifier = Modifier
                .size(22.dp)
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                }
        )
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal
        )
    }
}

private val CircleShapeCompat = RoundedCornerShape(50)
