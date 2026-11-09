package com.miyin.mobile

import android.content.Context
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.exoplayer.ExoPlayer

/**
 * 进程内共享的 ExoPlayer。
 * UI 与 MediaSessionService 使用同一个实例，播放中的通知栏/锁屏控制才能和页面同步。
 */
object PlaybackEngine {
    private var player: ExoPlayer? = null

    fun player(context: Context): ExoPlayer {
        return player ?: ExoPlayer.Builder(context.applicationContext)
            .build()
            .apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                        .build(),
                    true
                )
            }
            .also { player = it }
    }

    fun release() {
        player?.release()
        player = null
    }
}
