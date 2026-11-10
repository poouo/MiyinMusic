package com.miyin.mobile

import org.junit.Assert.*
import org.junit.Test

class PlaybackQualityTest {
    @Test fun hiresFallsThroughEveryLowerQuality() {
        val initial = PlaybackQuality.order("flac24bit")
        assertEquals(listOf("flac24bit", "flac", "320k", "128k"), initial)
        assertEquals(listOf("flac", "320k", "128k"), PlaybackQuality.below("flac24bit", initial))
        assertEquals(listOf("128k"), PlaybackQuality.below("320k", initial))
        assertTrue(PlaybackQuality.below("128k", initial).isEmpty())
        assertEquals("flac24bit", initial.first())
    }
    @Test fun standardNeverUpgradesAndErrorsStayBounded() {
        assertEquals(listOf("128k"), PlaybackQuality.order("128k"))
        assertEquals(listOf("320k", "128k"), PlaybackQuality.order("unknown"))
        assertEquals(listOf("128k"), PlaybackQuality.below(null, listOf("320k", "128k")))
        assertFalse(PlaybackQuality.canRetry(401)); assertFalse(PlaybackQuality.canRetry(403)); assertFalse(PlaybackQuality.canRetry(429))
        assertTrue(PlaybackQuality.canRetry(504))
    }
}
