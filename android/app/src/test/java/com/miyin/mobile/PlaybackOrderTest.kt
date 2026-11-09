package com.miyin.mobile

import org.junit.Assert.*
import org.junit.Test

class PlaybackOrderTest {
    @Test fun modesAreExclusiveAndCycle() {
        assertEquals(PlaybackMode.ALL, PlaybackMode.SEQUENTIAL.next())
        assertEquals(PlaybackMode.ONE, PlaybackMode.ALL.next())
        assertEquals(PlaybackMode.SHUFFLE, PlaybackMode.ONE.next())
        assertEquals(PlaybackMode.SEQUENTIAL, PlaybackMode.SHUFFLE.next())
    }
    @Test fun autoCompletionAndManualNextHaveDifferentBoundaries() {
        assertNull(PlaybackOrder.nextIndex(2, 3, PlaybackMode.SEQUENTIAL, true))
        assertEquals(0, PlaybackOrder.nextIndex(2, 3, PlaybackMode.SEQUENTIAL, false))
        assertEquals(0, PlaybackOrder.nextIndex(2, 3, PlaybackMode.ALL, true))
        assertEquals(1, PlaybackOrder.nextIndex(1, 3, PlaybackMode.ONE, true))
        assertEquals(2, PlaybackOrder.nextIndex(1, 3, PlaybackMode.ONE, false))
        assertNull(PlaybackOrder.nextIndex(0, 0, PlaybackMode.ALL, true))
    }
    @Test fun shuffleNeverRepeatsCurrentTrack() {
        for (count in 2..40) for (index in 0 until count) for (slot in 0 until count - 1) {
            val next = PlaybackOrder.nextIndex(index, count, PlaybackMode.SHUFFLE, true) { slot }!!
            assertNotEquals(index, next)
            assertTrue(next in 0 until count)
        }
        assertEquals(0, PlaybackOrder.nextIndex(0, 1, PlaybackMode.SHUFFLE, true))
    }
}
