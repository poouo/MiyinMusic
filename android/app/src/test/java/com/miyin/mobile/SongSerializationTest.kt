package com.miyin.mobile

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class SongSerializationTest {
    @Test fun importedAndCachedSongsKeepProviderPlaybackIdentifiers() {
        val song = Song(platform = "kg", songmid = "song", hash = "abc123", albumId = "album",
            albumMid = "mid", strMediaMid = "media", copyrightId = "copyright", songId = "123")
        assertEquals(song, Json.decodeFromString<Song>(Json.encodeToString(song)))
    }

    @Test fun lyricTimestampsSupportSeekingToEachRepeatedLine() {
        val lines = PlayerController.parseLrc("[00:12.50][00:25.125]同一句歌词", "[00:12.50]翻译")
        assertEquals(listOf(12500L, 25125L), lines.map { it.timeMs })
        assertEquals("翻译", lines.first().translation)
    }
}
