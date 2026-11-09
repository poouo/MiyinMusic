package com.miyin.mobile

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.math.sqrt

class EqualizerEngineTest {
    @Test fun mapsCurvesToDifferentDeviceFrequencies() {
        val curve = listOf(6f, 4f, 0f, -1f, -2f)
        assertEquals(6f, EqualizerEngine.gainAt(20f, curve), 0.001f)
        assertEquals(-2f, EqualizerEngine.gainAt(20000f, curve), 0.001f)
        assertEquals(4f, EqualizerEngine.gainAt(230f, curve), 0.001f)
        assertEquals(5f, EqualizerEngine.gainAt(sqrt(60f * 230f), curve), 0.001f)
    }

    @Test fun flatPresetDoesNotColorAnyFrequency() {
        for (hz in listOf(30f, 100f, 500f, 2000f, 10000f, 20000f)) {
            assertEquals(0f, EqualizerEngine.gainAt(hz, List(5) { 0f }), 0.001f)
        }
    }
}
