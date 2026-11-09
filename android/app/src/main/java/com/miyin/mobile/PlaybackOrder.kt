package com.miyin.mobile

import kotlin.random.Random

enum class PlaybackMode(val label: String) {
    SEQUENTIAL("顺序播放"), ALL("列表循环"), ONE("单曲循环"), SHUFFLE("随机播放");

    fun next(): PlaybackMode = entries[(ordinal + 1) % entries.size]
}

object PlaybackOrder {
    /** null stops at the end; manual next advances even during single repeat. */
    fun nextIndex(index: Int, count: Int, mode: PlaybackMode, auto: Boolean,
                  random: (Int) -> Int = { Random.nextInt(it) }): Int? {
        if (count <= 0) return null
        if (auto && mode == PlaybackMode.ONE) return index
        if (mode == PlaybackMode.SHUFFLE && count > 1) {
            val slot = random(count - 1).coerceIn(0, count - 2)
            return if (slot >= index) slot + 1 else slot
        }
        if (index + 1 < count) return index + 1
        return if (!auto || mode != PlaybackMode.SEQUENTIAL) 0 else null
    }
}
