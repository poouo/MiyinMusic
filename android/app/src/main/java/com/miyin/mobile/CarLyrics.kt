package com.miyin.mobile

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** AVRCP compatibility mode and the music metadata broadcast used by some head units. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
object CarLyrics {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var job: Job? = null
    private var player: ExoPlayer? = null
    private var song: Song? = null
    private var lines: List<LyricLine> = emptyList()
    private var lastTitle: String? = null
    private var lastPlaying: Boolean? = null

    fun bind(context: Context, current: ExoPlayer) {
        player = current
        configure(context)
    }

    fun setSong(value: Song) {
        song = value
        lines = emptyList()
        lastTitle = null
        lastPlaying = null
    }

    fun setLyrics(value: List<LyricLine>) { lines = value }

    fun configure(context: Context) {
        job?.cancel()
        val app = context.applicationContext
        if (!AppPrefs(app).carLyrics) {
            publish(app, useLyric = false)
            return
        }
        job = scope.launch {
            while (isActive) {
                publish(app, useLyric = true)
                delay(350)
            }
        }
    }

    private fun publish(context: Context, useLyric: Boolean) {
        val current = player ?: return
        val track = song ?: return
        val item = current.currentMediaItem ?: return
        if (item.mediaId != track.key) return
        val lyric = if (useLyric) lines.lastOrNull { it.timeMs <= current.currentPosition + ListeningStore(context).lyricOffset }?.text else null
        val title = lyric ?: track.name
        if (title == lastTitle && current.isPlaying == lastPlaying) return
        lastTitle = title
        lastPlaying = current.isPlaying
        val extras = Bundle(item.mediaMetadata.extras ?: Bundle()).apply {
            putString("android.media.metadata.LYRIC", lyric.orEmpty())
        }
        // Keeping the same URI/media ID lets Media3 update metadata without restarting audio.
        current.replaceMediaItem(current.currentMediaItemIndex, item.buildUpon().setMediaMetadata(
            item.mediaMetadata.buildUpon().setTitle(title).setDisplayTitle(title).setExtras(extras).build()
        ).build())
        context.sendBroadcast(Intent("com.android.music.metachanged").apply {
            putExtra("id", track.key)
            putExtra("artist", track.singer)
            putExtra("album", track.albumName)
            putExtra("track", title)
            putExtra("lyric", lyric.orEmpty())
            putExtra("playing", current.isPlaying)
            putExtra("duration", current.duration.coerceAtLeast(0))
            putExtra("position", current.currentPosition)
        })
    }

    fun release() {
        job?.cancel()
        job = null
        player = null
        song = null
        lines = emptyList()
        lastTitle = null
        lastPlaying = null
    }
}
