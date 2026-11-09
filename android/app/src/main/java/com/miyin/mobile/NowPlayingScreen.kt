package com.miyin.mobile

import android.content.res.Configuration
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.RepeatOne
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlin.math.max
import kotlin.math.abs
import kotlinx.coroutines.delay
import androidx.compose.material3.HorizontalDivider

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NowPlayingScreen(
    api: ApiClient,
    player: PlayerController,
    isFavorite: Boolean,
    onFavorite: (Song) -> Unit,
    onBack: () -> Unit
) {
    val song = player.current
    var showQueue by remember { mutableStateOf(false) }
    var showQuality by remember { mutableStateOf(false) }
    var lyricsExpanded by rememberSaveable { mutableStateOf(false) }
    val background = MaterialTheme.colorScheme.background
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE

    Box(Modifier.fillMaxSize().background(background)) {
        val cover = api.imageUrl(song?.img)
        if (cover != null) {
            AsyncImage(
                model = cover,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                alpha = 0.28f,
                modifier = Modifier.fillMaxSize().blur(36.dp)
            )
        }
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(
                            background.copy(alpha = 0.30f),
                            background.copy(alpha = 0.70f),
                            background.copy(alpha = 0.98f)
                        )
                    )
                )
        )

        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = if (landscape) 28.dp else 18.dp)
        ) {
            NowPlayingHeader(
                albumName = song?.albumName.orEmpty(),
                onBack = onBack,
                onQueue = { showQueue = true }
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { lyricsExpanded = !lyricsExpanded }) {
                    Text(if (lyricsExpanded) "封面" else "展开歌词", style = MaterialTheme.typography.labelMedium)
                }
                TextButton(onClick = { showQuality = true }) {
                    Text("${player.qualityLabel.ifBlank { "音质" }} ⌄", style = MaterialTheme.typography.labelMedium)
                }
            }

            if (landscape) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(30.dp)
                ) {
                    Column(
                        Modifier
                            .weight(0.42f)
                            .fillMaxHeight()
                            .padding(top = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        CoverImage(
                            url = song?.img,
                            api = api,
                            modifier = Modifier
                                .fillMaxWidth(0.70f)
                                .aspectRatio(1f),
                            corner = 26
                        )
                        SongTitle(
                            song = song,
                            isFavorite = isFavorite,
                            onFavorite = onFavorite,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 14.dp)
                        )
                    }

                    Column(
                        Modifier
                            .weight(0.58f)
                            .fillMaxHeight()
                    ) {
                        LyricsPane(
                            player = player,
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f)
                        )
                        ProgressControls(player)
                    }
                }
            } else {
                AnimatedVisibility(visible = !lyricsExpanded,
                    enter = fadeIn(tween(240)) + expandVertically(tween(320)),
                    exit = fadeOut(tween(160)) + shrinkVertically(tween(280))) {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                CoverImage(
                    url = song?.img,
                    api = api,
                    modifier = Modifier
                        .fillMaxWidth(0.78f)
                        .aspectRatio(1f)
                        .align(Alignment.CenterHorizontally)
                        .padding(top = 14.dp),
                    corner = 30
                )
                }
                }
                SongTitle(
                    song = song,
                    isFavorite = isFavorite,
                    onFavorite = onFavorite,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 18.dp)
                )
                LyricsPane(
                    player = player,
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .padding(top = 8.dp)
                )
                ProgressControls(player)
            }
        }
    }

    if (showQuality) QualitySheet(player) { showQuality = false }

    if (showQueue) {
        ModalBottomSheet(onDismissRequest = { showQueue = false }) {
            Text(
                "播放列表（" + player.queue.size + "）",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)
            )
            LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                itemsIndexed(player.queue, key = { _, s -> s.key }) { index, item ->
                    ListEntrance(index) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable {
                                player.playAt(index)
                                showQueue = false
                            }
                            .padding(horizontal = 20.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            (index + 1).toString(),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (index == player.queueIndex) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.width(26.dp)
                        )
                        Column(Modifier.weight(1f)) {
                            Text(
                                item.name,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                color = if (index == player.queueIndex) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurface,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                item.singer,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    }
                }
            }
        }
    }
}

@Composable
private fun NowPlayingHeader(
    albumName: String,
    onBack: () -> Unit,
    onQueue: () -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 2.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconButton(onClick = onBack) {
            Icon(
                Icons.Rounded.KeyboardArrowDown,
                contentDescription = "返回",
                tint = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.size(28.dp)
            )
        }
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "正在播放",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                albumName,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        IconButton(onClick = onQueue) {
            Icon(
                Icons.Rounded.QueueMusic,
                contentDescription = "播放列表",
                tint = MaterialTheme.colorScheme.onBackground
            )
        }
    }
}

@Composable
private fun SongTitle(
    song: Song?,
    isFavorite: Boolean,
    onFavorite: (Song) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(
                song?.name ?: "未在播放",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                song?.singer.orEmpty(),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
        if (song != null) {
            IconButton(onClick = { onFavorite(song) }) {
                Icon(
                    if (isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                    contentDescription = "喜欢",
                    tint = if (isFavorite) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun LyricsPane(
    player: PlayerController,
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()
    val dragging by listState.interactionSource.collectIsDraggedAsState()
    var scrubbing by remember(player.current?.key) { mutableStateOf(false) }
    val previewIndex by remember {
        derivedStateOf {
            val layout = listState.layoutInfo
            val center = (layout.viewportStartOffset + layout.viewportEndOffset) / 2
            layout.visibleItemsInfo.minByOrNull { abs(it.offset + it.size / 2 - center) }?.index ?: -1
        }
    }
    LaunchedEffect(dragging) { if (dragging) scrubbing = true }
    // Wait for both the finger and fling to settle; playback ticks must not steal the scroll.
    LaunchedEffect(listState.isScrollInProgress, scrubbing, dragging) {
        if (scrubbing && !dragging && !listState.isScrollInProgress) {
            delay(180)
            player.lyrics.getOrNull(previewIndex)?.let { player.seekTo(it.timeMs) }
            scrubbing = false
        }
    }
    val density = LocalDensity.current
    LaunchedEffect(player.activeLyricIndex, scrubbing, player.current?.key, player.lyrics) {
        val index = player.activeLyricIndex.coerceAtLeast(0)
        if (!scrubbing && index in player.lyrics.indices) {
            // Symmetric content padding puts the chosen lyric at the viewport's center.
            val item = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == index }
            val halfHeight = item?.size?.div(2) ?: with(density) { 24.dp.roundToPx() }
            listState.animateScrollToItem(index, halfHeight)
        }
    }

    BoxWithConstraints(modifier) {
        val centerPadding = maxHeight / 2
        if (player.lyrics.isEmpty()) {
            Text(
                if (player.isBuffering) "歌词加载中…" else "暂无歌词",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.Center)
            )
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = centerPadding),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                itemsIndexed(player.lyrics) { index, line ->
                    val active = index == if (scrubbing) previewIndex else player.activeLyricIndex
                    val lineColor by animateColorAsState(
                        targetValue = if (active) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.42f),
                        animationSpec = tween(240),
                        label = "lyric-color"
                    )
                    val lineSize by animateFloatAsState(
                        targetValue = if (active) 20f else 16f,
                        animationSpec = tween(240),
                        label = "lyric-size"
                    )
                    val translationColor by animateColorAsState(
                        targetValue = if (active) MaterialTheme.colorScheme.onSurfaceVariant
                        else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.28f),
                        animationSpec = tween(240),
                        label = "translation-color"
                    )
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                            .clickable { player.seekTo(line.timeMs) }
                            .padding(horizontal = 28.dp, vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = line.text,
                            style = MaterialTheme.typography.bodyLarge,
                            fontSize = 20.sp,
                            modifier = Modifier.graphicsLayer { scaleX = lineSize / 20f; scaleY = lineSize / 20f },
                            fontWeight = if (active) FontWeight.Bold else FontWeight.Normal,
                            color = lineColor,
                            textAlign = TextAlign.Center
                        )
                        if (line.translation.isNotBlank()) {
                            Text(
                                text = line.translation,
                                style = MaterialTheme.typography.bodySmall,
                                color = translationColor,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(top = 3.dp)
                            )
                        }
                    }
                }
            }
            if (scrubbing) {
                Row(Modifier.align(Alignment.Center).fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically) {
                    HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.primary.copy(alpha = 0.18f))
                    Text(formatDuration(player.lyrics.getOrNull(previewIndex)?.timeMs ?: 0),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(horizontal = 6.dp))
                }
                Text("松手跳转到这句", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 4.dp))
            }
        }
    }
}

@Composable
private fun ProgressControls(player: PlayerController) {
    var pendingPosition by remember(player.current?.key) { mutableStateOf<Float?>(null) }
    player.errorMessage?.let {
        Text(
            it,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 4.dp),
            textAlign = TextAlign.Center
        )
    }

    val duration = max(player.durationMs, 1L)
    Slider(
        value = (pendingPosition ?: player.positionMs.toFloat()).coerceIn(0f, duration.toFloat()),
        onValueChange = { pendingPosition = it },
        onValueChangeFinished = {
            pendingPosition?.let { player.seekTo(it.toLong()) }
            pendingPosition = null
        },
        valueRange = 0f..duration.toFloat(),
        colors = SliderDefaults.colors(
            thumbColor = MaterialTheme.colorScheme.primary,
            activeTrackColor = MaterialTheme.colorScheme.primary,
            inactiveTrackColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.16f)
        ),
        modifier = Modifier.fillMaxWidth()
    )
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(formatDuration(pendingPosition?.toLong() ?: player.positionMs), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(formatDuration(player.durationMs), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }

    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 6.dp, bottom = 14.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically
    ) {
        PlayerControl(
            icon = Icons.Rounded.Shuffle,
            active = player.shuffle,
            onClick = { player.toggleShuffle() }
        )
        PlayerControl(Icons.Rounded.SkipPrevious, onClick = { player.previous() })
        Box(
            Modifier
                .size(if (LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE) 58.dp else 66.dp)
                .clip(RoundedCornerShape(50))
                .background(MaterialTheme.colorScheme.primary)
                .clickable { player.toggle() },
            contentAlignment = Alignment.Center
        ) {
            if (player.isBuffering) {
                CircularProgressIndicator(
                    modifier = Modifier.size(26.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp
                )
            } else {
                Icon(
                    if (player.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                    contentDescription = "播放/暂停",
                    tint = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(32.dp)
                )
            }
        }
        PlayerControl(Icons.Rounded.SkipNext, onClick = { player.next() })
        PlayerControl(
            icon = if (player.repeatMode == RepeatMode.ONE) Icons.Rounded.RepeatOne else Icons.Rounded.Repeat,
            active = player.repeatMode != RepeatMode.OFF,
            onClick = { player.toggleRepeat() }
        )
    }
}

@Composable
private fun PlayerControl(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    active: Boolean = false,
    onClick: () -> Unit
) {
    IconButton(onClick = onClick) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
