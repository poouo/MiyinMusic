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
    fun context(): Context = appContext
    var preferredQuality by mutableStateOf(AppPrefs(appContext).preferredQuality)
        private set
    val exoPlayer: ExoPlayer = PlaybackEngine.player(context)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var loadJob: Job? = null
    private var wantsPlayback = false
    private var requestedQualities = emptyList<String>()
    private var loadedQuality: String? = null
    private var loadedOffline = false
    var selectedSourceId by mutableStateOf<String?>(null)
        private set
    var sourceName by mutableStateOf("")
        private set
    private var loadedSourceId = ""
    private val rejectedSources = mutableSetOf<String>()
    private val listeningStore = ListeningStore(appContext)
    private data class Prefetched(val key: String, val at: Long, var result: UrlResult? = null)
    private var prefetched: Prefetched? = null
    private fun prefetchNext() {
        if (!isPlaying || shuffle || repeatMode == RepeatMode.ONE || stopAfterTrack || durationMs - positionMs !in 1..25000) return
        if (sleepUntil > 0 && sleepUntil < System.currentTimeMillis() + 25000) return
        val next = PlaybackOrder.nextIndex(queueIndex, queue.size, playbackMode, true) ?: return
        if (next == queueIndex || next !in queue.indices || (repeatMode == RepeatMode.OFF && queueIndex == queue.lastIndex)) return
        val song = queue[next]
        if (OfflineDownloads(appContext).completed(song.key) != null) return
        val key = song.key + ":" + preferredQuality
        if (prefetched?.key == key) return
        val pending = Prefetched(key, System.currentTimeMillis())
        prefetched = pending
        scope.launch { runCatching { api.playUrl(song) }.onSuccess { if (prefetched === pending) pending.result = it } }
    }
    var sleepUntil by mutableLongStateOf(0L)
        private set
    var stopAfterTrack by mutableStateOf(false)
        private set
    var lyricOffsetMs by mutableLongStateOf(listeningStore.lyricOffset)
        private set
    fun setSleep(minutes: Int) {
        stopAfterTrack = minutes == -1
        sleepUntil = if (minutes > 0) System.currentTimeMillis() + minutes * 60000L else 0L
    }
    fun setLyricOffset(ms: Long) { lyricOffsetMs = ms.coerceIn(-10000, 10000); listeningStore.lyricOffset = lyricOffsetMs; updateActiveLyric() }
    private fun checkpoint() { listeningStore.snapshot = PlaybackSnapshot(queue, queueIndex, positionMs) }

    private val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(playing: Boolean) {
            isPlaying = playing
        }

        override fun onPlaybackStateChanged(state: Int) {
            when (state) {
                Player.STATE_BUFFERING -> isBuffering = true
                Player.STATE_READY -> {
                    val d = exoPlayer.duration
                    val song = current
                    if (song != null && d > 0 && song.interval > 0 && d < song.interval * 800L && song.interval * 1000L - d > 10000) {
                        if (loadedOffline || (loadedSourceId.isNotBlank() && rejectedSources.add(loadedSourceId) && rejectedSources.size <= 8)) {
                            selectedSourceId = null
                            loadSong(song, positionMs.coerceAtMost(d), wantsPlayback, useOffline = false)
                        } else {
                            exoPlayer.pause(); isBuffering = false
                            errorMessage = "音源返回了不完整歌曲，请切换播放源"
                        }
                        return
                    }
                    isBuffering = false
                    if (d > 0) durationMs = d
                }
                Player.STATE_ENDED -> {
                    isBuffering = false
                    next(auto = true)
                }
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            val song = current
            val lower = if (loadedOffline) requestedQualities else PlaybackQuality.below(loadedQuality, requestedQualities)
            if (song != null && lower.isNotEmpty() && exoPlayer.currentMediaItem?.mediaId == song.key) {
                loadSong(song, positionMs, wantsPlayback, lower, useOffline = false)
                return
            }
            isBuffering = false
            errorMessage = "播放失败：已尝试可用音质，请稍后重试"
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
    var repeatMode by mutableStateOf(when (AppPrefs(appContext).playbackMode) {
        "SEQUENTIAL" -> RepeatMode.OFF
        "ONE" -> RepeatMode.ONE
        else -> RepeatMode.ALL
    })
        private set
    var shuffle by mutableStateOf(AppPrefs(appContext).playbackMode == "SHUFFLE")
        private set
    val playbackMode: PlaybackMode
        get() = if (shuffle) PlaybackMode.SHUFFLE else when (repeatMode) {
            RepeatMode.ALL -> PlaybackMode.ALL
            RepeatMode.ONE -> PlaybackMode.ONE
            RepeatMode.OFF -> PlaybackMode.SEQUENTIAL
        }
    private val shuffleHistory = ArrayDeque<String>()
    var lyrics by mutableStateOf<List<LyricLine>>(emptyList())
        private set
    var activeLyricIndex by mutableIntStateOf(-1)
        private set
    var qualityLabel by mutableStateOf("")
        private set

    init {
        val saved = listeningStore.snapshot
        if (saved.index in saved.queue.indices && exoPlayer.mediaItemCount == 0) {
            queue = saved.queue; queueIndex = saved.index; current = saved.queue[saved.index]
            positionMs = saved.position.coerceAtLeast(0); durationMs = current!!.interval * 1000L
        }
        exoPlayer.addListener(playerListener)
        PlaybackBridge.next = { next() }
        PlaybackBridge.previous = { previous() }
        PlaybackBridge.hasQueue = { queue.size > 1 }

        scope.launch {
            var ticks = 0
            while (isActive) {
                if (exoPlayer.isPlaying || exoPlayer.playbackState == Player.STATE_READY) {
                    positionMs = exoPlayer.currentPosition.coerceAtLeast(0L)
                    val d = exoPlayer.duration
                    if (d > 0) durationMs = d
                }
                updateActiveLyric()
                prefetchNext()
                if (sleepUntil > 0 && System.currentTimeMillis() >= sleepUntil) {
                    loadJob?.cancel(); exoPlayer.playWhenReady = false; exoPlayer.pause(); isBuffering = false; setSleep(0)
                }
                if (++ticks % 20 == 0) checkpoint()
                delay(250)
            }
        }
    }

    fun play(songs: List<Song>, index: Int) {
        if (songs.isEmpty()) return
        shuffleHistory.clear()
        queue = songs
        queueIndex = index.coerceIn(0, songs.lastIndex)
        loadSong(queue[queueIndex])
    }

    fun enqueue(song: Song, next: Boolean = false) {
        if (current?.key == song.key) return
        val currentKey = current?.key
        val list = queue.filterNot { it.key == song.key }.toMutableList()
        val currentIndex = list.indexOfFirst { it.key == currentKey }
        list.add(if (next && currentIndex >= 0) currentIndex + 1 else list.size, song)
        queue = list
        queueIndex = list.indexOfFirst { it.key == currentKey }
        if (current == null) { queueIndex = 0; loadSong(queue[0], autoPlay = false) }
        checkpoint()
    }

    fun removeFromQueue(index: Int) {
        if (index !in queue.indices) return
        val wasCurrent = index == queueIndex
        val shouldPlay = exoPlayer.playWhenReady || (isBuffering && wantsPlayback)
        val list = queue.toMutableList().apply { removeAt(index) }
        if (list.isEmpty()) { clearQueue(); return }
        queue = list
        if (wasCurrent) {
            loadJob?.cancel()
            exoPlayer.stop()
            queueIndex = index.coerceAtMost(list.lastIndex)
            loadSong(list[queueIndex], autoPlay = shouldPlay)
        } else if (index < queueIndex) queueIndex--
        checkpoint()
    }

    fun moveQueue(from: Int, to: Int) {
        if (from !in queue.indices || to !in queue.indices) return
        val key = current?.key
        queue = queue.toMutableList().apply { add(to, removeAt(from)) }
        queueIndex = queue.indexOfFirst { it.key == key }
        checkpoint()
    }

    fun clearQueue() {
        loadJob?.cancel()
        exoPlayer.stop()
        exoPlayer.clearMediaItems()
        queue = emptyList(); queueIndex = -1; current = null
        lyrics = emptyList(); positionMs = 0; durationMs = 0
        isPlaying = false; isBuffering = false; shuffleHistory.clear()
        wantsPlayback = false; requestedQualities = emptyList(); loadedQuality = null; loadedOffline = false
        selectedSourceId = null; sourceName = ""; rejectedSources.clear()
        checkpoint()
    }

    fun playAt(index: Int) {
        if (index !in queue.indices) return
        queueIndex = index
        loadSong(queue[index])
    }

    private fun loadSong(song: Song, startPositionMs: Long = 0L, autoPlay: Boolean = true,
        qualities: List<String> = PlaybackQuality.order(preferredQuality), useOffline: Boolean = true) {
        loadJob?.cancel()
        if (current?.key != song.key) { selectedSourceId = null; rejectedSources.clear() }
        wantsPlayback = autoPlay
        requestedQualities = qualities
        loadedQuality = null
        loadedOffline = false
        loadedSourceId = ""
        sourceName = ""
        exoPlayer.pause()
        exoPlayer.clearMediaItems()
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
        checkpoint()

        loadJob = scope.launch {
            try {
                val offline = if (useOffline && selectedSourceId == null && rejectedSources.isEmpty()) OfflineDownloads(appContext).completed(song.key) else null
                val cached = prefetched?.takeIf { selectedSourceId == null && rejectedSources.isEmpty() && qualities == PlaybackQuality.order(preferredQuality) && it.key == song.key + ":" + preferredQuality && System.currentTimeMillis() - it.at < 45000 }?.result
                prefetched = null
                val result = if (offline != null) UrlResult(playUrl = java.io.File(offline.path).toURI().toString(), quality = offline.quality) else cached ?: api.playUrl(song, qualities, selectedSourceId, rejectedSources.toList())
                if (result.playUrl.isBlank()) throw IllegalStateException("没有获取到播放地址")
                loadedQuality = result.quality
                loadedOffline = offline != null
                loadedSourceId = result.sourceId
                sourceName = if (offline != null) "离线下载" else result.sourceName.ifBlank { if (result.cached) "服务端缓存" else "自动选源" }
                qualityLabel = when (result.quality) {
                    "flac24bit" -> "Hi-Res"
                    "flac" -> "SQ"
                    "320k" -> "HQ"
                    else -> "标准"
                }
                val url = if (offline != null) result.playUrl else api.absoluteUrl(result.playUrl)
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
                    .setCustomCacheKey("verified-v2:" + song.key + ":" + result.quality + ":" + result.sourceId + ":" + result.cached)
                    .setMediaMetadata(metadata)
                    .build()
                val cachedSource = CacheDataSource.Factory()
                    .setCache(PlaybackCache.get(appContext))
                    .setUpstreamDataSourceFactory(sourceFactory)
                    .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
                val mediaSource = ProgressiveMediaSource.Factory(if (offline != null) androidx.media3.datasource.DefaultDataSource.Factory(appContext) else cachedSource)
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
                val lower = PlaybackQuality.below(loadedQuality, qualities)
                if (lower.isNotEmpty() && PlaybackQuality.canRetry((e as? ApiException)?.statusCode)) {
                    loadSong(song, startPositionMs, autoPlay, lower, useOffline = false)
                    return@launch
                }
                isBuffering = false
                errorMessage = e.userMessage("无法播放这首歌，请稍后重试")
            }
        }
    }

    fun toggle() {
        if (current == null) return
        if (isBuffering && wantsPlayback) { wantsPlayback = false; loadJob?.cancel(); exoPlayer.pause(); isBuffering = false; return }
        if (exoPlayer.mediaItemCount == 0) { loadSong(current!!, positionMs); return }
        wantsPlayback = !exoPlayer.isPlaying
        if (exoPlayer.isPlaying) exoPlayer.pause() else if (exoPlayer.playerError != null) loadSong(current!!, positionMs) else exoPlayer.play()
    }

    fun setDefaultQuality(value: String) {
        preferredQuality = value
        AppPrefs(appContext).preferredQuality = value
    }

    fun changeQuality(value: String) {
        setDefaultQuality(value)
        current?.let { loadSong(it, exoPlayer.currentPosition.coerceAtLeast(0), exoPlayer.playWhenReady) }
    }

    fun changeSource(id: String?) {
        val song = current ?: return
        selectedSourceId = id
        rejectedSources.clear()
        val playing = exoPlayer.playWhenReady || (isBuffering && wantsPlayback)
        loadSong(song, positionMs, playing, useOffline = id == null)
    }

    fun next(auto: Boolean = false) {
        if (queue.isEmpty()) return
        if (auto && stopAfterTrack) { setSleep(0); exoPlayer.pause(); checkpoint(); return }
        if (auto && repeatMode == RepeatMode.ONE) {
            exoPlayer.seekTo(0)
            exoPlayer.play()
            return
        }
        val nextIndex = PlaybackOrder.nextIndex(queueIndex, queue.size, playbackMode, auto)
        if (nextIndex == null) {
            exoPlayer.pause()
            return
        }
        if (shuffle) {
            current?.key?.let { shuffleHistory.addLast(it) }
            if (shuffleHistory.size > 100) shuffleHistory.removeFirst()
        }
        playAt(nextIndex)
    }

    fun previous() {
        if (queue.isEmpty()) return
        if (exoPlayer.currentPosition > 3000) {
            exoPlayer.seekTo(0)
            return
        }
        if (shuffle) {
            while (shuffleHistory.isNotEmpty()) {
                val key = shuffleHistory.removeLast()
                val previousIndex = queue.indexOfFirst { it.key == key }
                if (previousIndex >= 0) { playAt(previousIndex); return }
            }
            PlaybackOrder.nextIndex(queueIndex, queue.size, PlaybackMode.SHUFFLE, false)?.let { playAt(it) }
            return
        }
        val prevIndex = if (queueIndex <= 0) {
            if (repeatMode == RepeatMode.OFF) 0 else queue.lastIndex
        } else queueIndex - 1
        playAt(prevIndex)
    }

    fun seekTo(ms: Long) {
        val target = if (durationMs > 0) ms.coerceIn(0L, durationMs) else ms.coerceAtLeast(0L)
        exoPlayer.seekTo(target)
        positionMs = target
        checkpoint()
        updateActiveLyric()
    }

    fun setVolume(value: Float) {
        exoPlayer.volume = value.coerceIn(0f, 1f)
    }

    fun toggleRepeat() {
        val nextMode = playbackMode.next()
        shuffle = nextMode == PlaybackMode.SHUFFLE
        repeatMode = when (nextMode) {
            PlaybackMode.SEQUENTIAL -> RepeatMode.OFF
            PlaybackMode.ONE -> RepeatMode.ONE
            else -> RepeatMode.ALL
        }
        shuffleHistory.clear()
        AppPrefs(appContext).playbackMode = nextMode.name
    }

    fun toggleShuffle() {
        shuffle = !shuffle
        repeatMode = RepeatMode.ALL
        shuffleHistory.clear()
        AppPrefs(appContext).playbackMode = playbackMode.name
    }

    fun clearError() {
        errorMessage = null
    }

    private fun updateActiveLyric() {
        if (lyrics.isEmpty()) {
            activeLyricIndex = -1
            return
        }
        val index = lyrics.indexOfLast { it.timeMs <= positionMs + lyricOffsetMs }
        if (index != activeLyricIndex) activeLyricIndex = index
    }

    fun release() {
        checkpoint()
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
