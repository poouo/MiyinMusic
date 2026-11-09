package com.miyin.mobile

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.net.toUri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

enum class RepeatMode { ALL, ONE, OFF }

data class LyricLine(val timeMs: Long, val text: String, val translation: String = "")

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class PlayerController(
    context: Context,
    private val api: ApiClient
) {
    private val appContext = context.applicationContext
    var preferredQuality by mutableStateOf(AppPrefs(appContext).preferredQuality)
        private set
    val exoPlayer: ExoPlayer = PlaybackEngine.player(context)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var loadJob: Job? = null

    private val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(playing: Boolean) {
            isPlaying = playing
        }

        override fun onPlaybackStateChanged(state: Int) {
            when (state) {
                Player.STATE_BUFFERING -> isBuffering = true
                Player.STATE_READY -> {
                    isBuffering = false
                    val d = exoPlayer.duration
                    if (d > 0) durationMs = d
                }
                Player.STATE_ENDED -> {
                    isBuffering = false
                    next(auto = true)
                }
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            isBuffering = false
            errorMessage = "播放失败：音频源暂不可用，请切换音质或重试"
        }
    }

    var queue by mutableStateOf<List<Song>>(emptyList())
        private set
    var queueIndex by mutableIntStateOf(-1)
        private set
    var current by mutableStateOf<Song?>(null)
        private set
    var isPlaying by mutableStateOf(false)
        private set
    var isBuffering by mutableStateOf(false)
        private set
    var positionMs by mutableLongStateOf(0L)
        private set
    var durationMs by mutableLongStateOf(0L)
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set
    var repeatMode by mutableStateOf(RepeatMode.ALL)
        private set
    var shuffle by mutableStateOf(false)
        private set
    var lyrics by mutableStateOf<List<LyricLine>>(emptyList())
        private set
    var activeLyricIndex by mutableIntStateOf(-1)
        private set
    var qualityLabel by mutableStateOf("")
        private set

    init {
        exoPlayer.addListener(playerListener)
        PlaybackBridge.next = { next() }
        PlaybackBridge.previous = { previous() }
        PlaybackBridge.hasQueue = { queue.size > 1 }

        scope.launch {
            while (isActive) {
                if (exoPlayer.isPlaying || exoPlayer.playbackState == Player.STATE_READY) {
                    positionMs = exoPlayer.currentPosition.coerceAtLeast(0L)
                    val d = exoPlayer.duration
                    if (d > 0) durationMs = d
                }
                updateActiveLyric()
                delay(250)
            }
        }
    }

    fun play(songs: List<Song>, index: Int) {
        if (songs.isEmpty()) return
        queue = songs
        queueIndex = index.coerceIn(0, songs.lastIndex)
        loadSong(queue[queueIndex])
    }

    fun playAt(index: Int) {
        if (index !in queue.indices) return
        queueIndex = index
        loadSong(queue[index])
    }

    private fun loadSong(song: Song, startPositionMs: Long = 0L, autoPlay: Boolean = true) {
        loadJob?.cancel()
        current = song
        CarLyrics.setSong(song)
        DesktopLyrics.setSong(song)
        errorMessage = null
        isBuffering = true
        positionMs = startPositionMs
        durationMs = song.interval * 1000L
        lyrics = emptyList()
        activeLyricIndex = -1
        qualityLabel = ""

        loadJob = scope.launch {
            try {
                val result = api.playUrl(song)
                if (result.playUrl.isBlank()) throw IllegalStateException("没有获取到播放地址")
                qualityLabel = when (result.quality) {
                    "flac24bit" -> "Hi-Res"
                    "flac" -> "SQ"
                    "320k" -> "HQ"
                    else -> "标准"
                }
                val url = api.absoluteUrl(result.playUrl)
                val headers = buildMap {
                    api.cookieHeader()?.let { put("Cookie", it) }
                }
                val sourceFactory = DefaultHttpDataSource.Factory()
                    .setUserAgent(ApiClient.USER_AGENT)
                    .setAllowCrossProtocolRedirects(true)
                    .setDefaultRequestProperties(headers)
                val metadata = MediaMetadata.Builder()
                    .setTitle(song.name)
                    .setArtist(song.singer)
                    .setAlbumTitle(song.albumName)
                    .setArtworkUri(api.imageUrl(song.img)?.toUri())
                    .build()
                val mediaItem = MediaItem.Builder()
                    .setMediaId(song.key)
                    .setUri(url)
                    .setCustomCacheKey(song.key + ":" + result.quality)
                    .setMediaMetadata(metadata)
                    .build()
                val cachedSource = CacheDataSource.Factory()
                    .setCache(PlaybackCache.get(appContext))
                    .setUpstreamDataSourceFactory(sourceFactory)
                    .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
                val mediaSource = ProgressiveMediaSource.Factory(cachedSource)
                    .createMediaSource(mediaItem)

                exoPlayer.setMediaSource(mediaSource, startPositionMs)
                exoPlayer.prepare()
                exoPlayer.playWhenReady = autoPlay
                scope.launch {
                    runCatching { api.addHistory(song) }
                }
                coroutineScope {
                    val lyricDeferred = async {
                        runCatching { api.lyric(song) }.getOrNull()
                    }
                    val lyricResult = lyricDeferred.await()
                    if (lyricResult != null) {
                        lyrics = parseLrc(lyricResult.lyric, lyricResult.tlyric)
                        CarLyrics.setLyrics(lyrics)
                        DesktopLyrics.setLyrics(lyrics)
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                isBuffering = false
                errorMessage = e.userMessage("无法播放这首歌，请稍后重试")
            }
        }
    }

    fun toggle() {
        if (current == null) return
        if (exoPlayer.isPlaying) exoPlayer.pause() else exoPlayer.play()
    }

    fun setDefaultQuality(value: String) {
        preferredQuality = value
        AppPrefs(appContext).preferredQuality = value
    }

    fun changeQuality(value: String) {
        setDefaultQuality(value)
        current?.let { loadSong(it, exoPlayer.currentPosition.coerceAtLeast(0), exoPlayer.playWhenReady) }
    }

    fun next(auto: Boolean = false) {
        if (queue.isEmpty()) return
        if (auto && repeatMode == RepeatMode.ONE) {
            exoPlayer.seekTo(0)
            exoPlayer.play()
            return
        }
        val nextIndex = if (shuffle && queue.size > 1) {
            queue.indices.filter { it != queueIndex }.random()
        } else {
            queueIndex + 1
        }
        if (nextIndex > queue.lastIndex) {
            if (repeatMode == RepeatMode.ALL) playAt(0) else exoPlayer.pause()
        } else {
            playAt(nextIndex)
        }
    }

    fun previous() {
        if (queue.isEmpty()) return
        if (exoPlayer.currentPosition > 3000) {
            exoPlayer.seekTo(0)
            return
        }
        val prevIndex = if (queueIndex <= 0) queue.lastIndex else queueIndex - 1
        playAt(prevIndex)
    }

    fun seekTo(ms: Long) {
        val target = if (durationMs > 0) ms.coerceIn(0L, durationMs) else ms.coerceAtLeast(0L)
        exoPlayer.seekTo(target)
        positionMs = target
        updateActiveLyric()
    }

    fun setVolume(value: Float) {
        exoPlayer.volume = value.coerceIn(0f, 1f)
    }

    fun toggleRepeat() {
        repeatMode = when (repeatMode) {
            RepeatMode.ALL -> RepeatMode.ONE
            RepeatMode.ONE -> RepeatMode.OFF
            RepeatMode.OFF -> RepeatMode.ALL
        }
    }

    fun toggleShuffle() {
        shuffle = !shuffle
    }

    fun clearError() {
        errorMessage = null
    }

    private fun updateActiveLyric() {
        if (lyrics.isEmpty()) {
            activeLyricIndex = -1
            return
        }
        val index = lyrics.indexOfLast { it.timeMs <= positionMs }
        if (index != activeLyricIndex) activeLyricIndex = index
    }

    fun release() {
        loadJob?.cancel()
        scope.cancel()
        exoPlayer.removeListener(playerListener)
        PlaybackBridge.next = null
        PlaybackBridge.previous = null
        PlaybackBridge.hasQueue = { false }
        // ExoPlayer 由 PlaybackService / PlaybackEngine 持有，Activity 重建时不停止播放。
    }

    companion object {
        private val timeTag = Regex("\\[(\\d{1,2}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]")

        fun parseLrc(lrc: String, translation: String = ""): List<LyricLine> {
            val translations = HashMap<Long, String>()
            translation.lineSequence().forEach { line ->
                val match = timeTag.find(line) ?: return@forEach
                val text = line.substring(match.range.last + 1).trim()
                if (text.isNotEmpty()) translations[timeToMs(match)] = text
            }
            val result = ArrayList<LyricLine>()
            lrc.lineSequence().forEach { line ->
                val matches = timeTag.findAll(line).toList()
                if (matches.isEmpty()) return@forEach
                val text = line.substring(matches.last().range.last + 1).trim()
                if (text.isEmpty()) return@forEach
                matches.forEach { match ->
                    val ms = timeToMs(match)
                    result += LyricLine(ms, text, translations[ms].orEmpty())
                }
            }
            return result.distinctBy { it.timeMs to it.text }.sortedBy { it.timeMs }
        }

        private fun timeToMs(match: MatchResult): Long {
            val min = match.groupValues[1].toLongOrNull() ?: 0
            val sec = match.groupValues[2].toLongOrNull() ?: 0
            val fracRaw = match.groupValues.getOrNull(3).orEmpty()
            val frac = when (fracRaw.length) {
                0 -> 0L
                1 -> fracRaw.toLong() * 100
                2 -> fracRaw.toLong() * 10
                else -> fracRaw.take(3).toLong()
            }
            return min * 60_000 + sec * 1_000 + frac
        }
    }
}
