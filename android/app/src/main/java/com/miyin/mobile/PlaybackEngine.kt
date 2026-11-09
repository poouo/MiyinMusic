package com.miyin.mobile

import android.content.Context
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

/**
 * 进程内共享的 ExoPlayer。
 * UI 与 MediaSessionService 使用同一个实例，播放中的通知栏/锁屏控制才能和页面同步。
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
object PlaybackEngine {
    private var player: ExoPlayer? = null
    private var controller: PlayerController? = null

    fun controller(context: Context, api: ApiClient): PlayerController = controller ?:
        PlayerController(context.applicationContext, api).also { controller = it }

    fun player(context: Context): ExoPlayer {
        return player ?: ExoPlayer.Builder(context.applicationContext)
            .build()
            .apply {
                val app = context.applicationContext
                addListener(object : Player.Listener {
                    override fun onAudioSessionIdChanged(audioSessionId: Int) {
                        EqualizerEngine.attach(app, audioSessionId)
                    }
                })
                CarLyrics.bind(app, this)
                DesktopLyrics.bind(app, this)
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
        controller?.release()
        controller = null
        EqualizerEngine.release()
        CarLyrics.release()
        DesktopLyrics.release()
        player?.release()
        player = null
    }
}
