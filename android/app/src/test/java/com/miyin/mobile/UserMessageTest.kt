package com.miyin.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

class UserMessageTest {
    @Test fun connectionErrorsDoNotRevealServerAddresses() {
        assertEquals("加载失败", Exception("GET https://music.poouo.com/api/library").userMessage("加载失败"))
        assertEquals("加载失败", Exception("music.poouo.com failed").userMessage("加载失败"))
        assertEquals("加载失败", Exception("/api/admin/users failed").userMessage("加载失败"))
    }
    @Test fun meaningfulBusinessErrorsRemainReadable() {
        assertEquals("歌单数量已达上限", Exception("歌单数量已达上限").userMessage("操作失败"))
        assertEquals("请求超时，请稍后重试", java.net.SocketTimeoutException("private host").userMessage("操作失败"))
        assertEquals("网络暂不可用，请检查网络后重试", java.net.UnknownHostException("private host").userMessage("操作失败"))
    }
}
