package com.miyin.mobile

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.media3.common.Player
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionError
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.SettableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException

/**
 * 媒体会话与前台服务：
 * - 通知栏 / 锁屏的封面、标题、播放暂停、进度拖动
 * - 退到后台继续播放
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var mediaSession: MediaSession? = null
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val favoriteCommand = SessionCommand("com.miyin.TOGGLE_FAVORITE", Bundle.EMPTY)
    private lateinit var api: ApiClient
    private lateinit var controller: PlayerController
    private var favoriteBusy = false
    private val metadataListener = object : Player.Listener {
        override fun onMediaMetadataChanged(mediaMetadata: androidx.media3.common.MediaMetadata) { updateFavoriteButton() }
    }

    private fun updateFavoriteButton() {
        val snapshot = api.cache.session()
        val song = controller.current
        val favorite = snapshot.library.favorites.any { it.song.key == song?.key }
        val button = CommandButton.Builder(if (favorite) CommandButton.ICON_HEART_FILLED else CommandButton.ICON_HEART_UNFILLED)
            .setDisplayName(if (snapshot.user == null) "登录后喜欢" else if (favorite) "取消喜欢" else "喜欢")
            .setSessionCommand(favoriteCommand)
            .setEnabled(song != null && !favoriteBusy)
            .setSlots(CommandButton.SLOT_FORWARD_SECONDARY, CommandButton.SLOT_OVERFLOW)
            .build()
        mediaSession?.setMediaButtonPreferences(listOf(button))
    }

    override fun onCreate() {
        super.onCreate()
        api = ApiClient(this)
        controller = PlaybackEngine.controller(this, api)
        val player = PlaybackEngine.player(this)
        player.addListener(metadataListener)
        val sessionActivity = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val sessionPlayer = MiYinSessionPlayer(
            player = player,
            onNext = { PlaybackBridge.next?.invoke() },
            onPrevious = { PlaybackBridge.previous?.invoke() }
        )
        mediaSession = MediaSession.Builder(this, sessionPlayer)
            .setSessionActivity(sessionActivity)
            .setCallback(object : MediaSession.Callback {
                override fun onConnect(session: MediaSession, info: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
                    val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                    if (session.isMediaNotificationController(info) || info.isTrusted || info.packageName == packageName) {
                        commands.add(favoriteCommand)
                    }
                    return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                        .setAvailableSessionCommands(commands.build()).build()
                }

                override fun onCustomCommand(session: MediaSession, info: MediaSession.ControllerInfo,
                    command: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
                    if (command.customAction != favoriteCommand.customAction) {
                        return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
                    }
                    val snapshot = api.cache.session()
                    val song = controller.current
                    if (snapshot.user == null || song == null) {
                        Toast.makeText(this@PlaybackService, "请先打开觅音登录后收藏", Toast.LENGTH_SHORT).show()
                        return Futures.immediateFuture(SessionResult(SessionError.ERROR_PERMISSION_DENIED))
                    }
                    if (favoriteBusy) return Futures.immediateFuture(SessionResult(SessionError.ERROR_INVALID_STATE))
                    val future = SettableFuture.create<SessionResult>()
                    favoriteBusy = true
                    updateFavoriteButton()
                    serviceScope.launch {
                        try {
                            val favorite = snapshot.library.favorites.any { it.song.key == song.key }
                            val library = if (favorite) api.removeFavorite(song) else api.addFavorite(song)
                            // A logout while the request was in flight must not revive the old account.
                            if (api.cache.session().user?.id == snapshot.user.id) api.cache.saveSession(snapshot.user, library)
                            future.set(SessionResult(SessionResult.RESULT_SUCCESS))
                        } catch (e: CancellationException) {
                            future.cancel(false)
                            throw e
                        } catch (_: Exception) {
                            Toast.makeText(this@PlaybackService, "收藏更新失败，请检查网络", Toast.LENGTH_SHORT).show()
                            future.set(SessionResult(SessionError.ERROR_UNKNOWN))
                        } finally {
                            favoriteBusy = false
                            updateFavoriteButton()
                        }
                    }
                    return future
                }
            })
            .build()
        // 即使 UI 没有创建 MediaController，也要把 session 注册到 Service，
        // 否则 Media3 不会创建媒体通知、也不会进入前台服务。
        mediaSession?.let { addSession(it) }
        updateFavoriteButton()
        serviceScope.launch { AppCache.sessionUpdates.collect { updateFavoriteButton() } }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
        return mediaSession
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = mediaSession?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        serviceScope.cancel()
        controller.exoPlayer.removeListener(metadataListener)
        mediaSession?.release()
        mediaSession = null
        PlaybackEngine.release()
        super.onDestroy()
    }
}
