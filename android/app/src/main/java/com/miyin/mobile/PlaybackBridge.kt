package com.miyin.mobile

import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player

/** 让系统媒体通知的上一首 / 下一首按钮可以驱动应用自己的队列。 */
object PlaybackBridge {
    var next: (() -> Unit)? = null
    var previous: (() -> Unit)? = null
    var hasQueue: () -> Boolean = { false }
}

class MiYinSessionPlayer(
    player: Player,
    private val onNext: () -> Unit,
    private val onPrevious: () -> Unit
) : ForwardingPlayer(player) {

    private fun hasQueue(): Boolean = PlaybackBridge.hasQueue()

    override fun isCommandAvailable(command: Int): Boolean {
        if (command == COMMAND_SEEK_TO_NEXT ||
            command == COMMAND_SEEK_TO_NEXT_MEDIA_ITEM ||
            command == COMMAND_SEEK_TO_PREVIOUS ||
            command == COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM
        ) {
            return hasQueue()
        }
        return super.isCommandAvailable(command)
    }

    override fun hasNextMediaItem(): Boolean = hasQueue()
    override fun hasPreviousMediaItem(): Boolean = hasQueue()
    override fun seekToNext() = onNext()
    override fun seekToNextMediaItem() = onNext()
    override fun seekToPrevious() = onPrevious()
    override fun seekToPreviousMediaItem() = onPrevious()
}
