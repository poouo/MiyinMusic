package com.miyin.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class PlaylistLinkTest {
    private fun id(text: String) = PlaylistLink.playlistId(PlaylistLink.extract(text))

    @Test fun parsesDesktopAndMobileQQLinks() {
        assertEquals("tx-123456", id("分享歌单 https://y.qq.com/n/ryqq/playlist/123456，快来听"))
        assertEquals("tx-123456", id("https://i.y.qq.com/n2/m/share/details/taoge.html?disstid=123456&foo=1"))
        assertEquals("tx-123456", id("https://y.qq.com/n/yqq/playlist/123456.html"))
    }

    @Test fun parsesNeteaseHashRouterAndMobileLinks() {
        assertEquals("wy-123456", id("http://music.163.com/#/playlist?id=123456&userid=88"))
        assertEquals("wy-123456", id("https://music.163.com/m/playlist?id=123456"))
        assertEquals("wy-123456", id("https://y.music.163.com/m/playlist?app_version=9&id=123456"))
    }

    @Test fun leavesShortLinksForTheRedirectResolver() {
        assertNull(id("https://c.y.qq.com/base/fcgi-bin/u?__=abcdef"))
        assertNull(id("https://163cn.tv/abcDEF"))
    }

    @Test fun rejectsSongsAndMalformedIds() {
        assertNull(id("https://music.163.com/song?id=123456"))
        assertNull(id("https://y.qq.com/n/ryqq/songDetail/123456"))
        assertNull(id("https://music.163.com/playlist?id=oops"))
    }

    @Test fun rejectsUntrustedRedirectTargetsAndCredentials() {
        for (url in listOf("https://y.qq.com.evil.com/playlist/12", "http://127.0.0.1/playlist/12",
            "https://evil.com@music.163.com/playlist?id=12", "https://music.163.com:444/playlist?id=12")) {
            assertThrows(IllegalArgumentException::class.java) { PlaylistLink.extract(url) }
        }
    }
}
