package com.miyin.mobile

import android.content.res.Configuration
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlin.math.max

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
                modifier = Modifier.fillMaxSize()
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

    LaunchedEffect(player.activeLyricIndex) {
        val index = player.activeLyricIndex
        if (index >= 0 && index < player.lyrics.size) {
            listState.animateScrollToItem(index)
        }
    }

    Box(modifier) {
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
                contentPadding = PaddingValues(vertical = 20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                itemsIndexed(player.lyrics) { index, line ->
                    val active = index == player.activeLyricIndex
                    val lineColor by animateColorAsState(
                        targetValue = if (active) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.42f),
                        animationSpec = tween(240),
                        label = "lyric-color"
                    )
                    val lineSize by animateFloatAsState(
                        targetValue = if (active) 19f else 14f,
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
                        Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = line.text,
                            style = MaterialTheme.typography.bodyLarge,
                            fontSize = lineSize.sp,
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
        }
    }
}

@Composable
private fun ProgressControls(player: PlayerController) {
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
        value = player.positionMs.coerceIn(0L, duration).toFloat(),
        onValueChange = { player.seekTo(it.toLong()) },
        valueRange = 0f..duration.toFloat(),
        colors = SliderDefaults.colors(
            thumbColor = MaterialTheme.colorScheme.primary,
            activeTrackColor = MaterialTheme.colorScheme.primary,
            inactiveTrackColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.16f)
        ),
        modifier = Modifier.fillMaxWidth()
    )
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(formatDuration(player.positionMs), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
