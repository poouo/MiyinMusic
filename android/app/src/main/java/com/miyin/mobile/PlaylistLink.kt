package com.miyin.mobile

import java.net.URI
import java.net.URLDecoder

/** Accept share text as well as desktop, mobile and hash-router playlist URLs. */
object PlaylistLink {
    private val urlPattern = Regex("https?://[^\\s<>\"，。！【】「」『』（）()“”]+", RegexOption.IGNORE_CASE)
    private val hosts = setOf("y.qq.com", "i.y.qq.com", "c.y.qq.com", "music.qq.com",
        "music.163.com", "y.music.163.com", "m.music.163.com", "163cn.tv")

    fun extract(text: String): URI {
        val value = urlPattern.find(text)?.value?.replace("&amp;", "&")
            ?: throw IllegalArgumentException("请粘贴 QQ 音乐或网易云音乐的歌单分享链接")
        return requireAllowed(URI(value))
    }

    fun requireAllowed(uri: URI): URI {
        val host = uri.host?.lowercase().orEmpty()
        require(uri.scheme in setOf("https", "http") &&
            (host in hosts || host.endsWith(".y.qq.com") || host.endsWith(".music.163.com")) &&
            uri.userInfo == null && uri.port in setOf(-1, 80, 443)) { "只支持 QQ 音乐和网易云音乐的官方歌单链接" }
        // Share links sometimes contain http. Always resolve them over TLS.
        return if (uri.scheme == "http") URI("https" + uri.toString().removePrefix("http")) else uri
    }

    fun playlistId(uri: URI): String? {
        requireAllowed(uri)
        val host = uri.host.lowercase()
        val route = uri.path.orEmpty() + "?" + uri.rawQuery.orEmpty() + "&" + uri.rawFragment.orEmpty()
        val params = Regex("(?:[?&#]|^)([a-zA-Z]+)=([^&#]*)").findAll(route).associate {
            it.groupValues[1].lowercase() to URLDecoder.decode(it.groupValues[2], "UTF-8")
        }
        val qq = host.endsWith("qq.com")
        val id = if (qq) {
            params["disstid"] ?: params["dissid"] ?: params["playlistid"] ?:
                Regex("/(?:playlist|taoge)/(\\d+)").find(route)?.groupValues?.get(1) ?:
                if (route.contains("playlist") || route.contains("taoge")) params["id"] else null
        } else {
            if (route.contains("playlist")) params["id"] ?:
                Regex("/playlist/(\\d+)").find(route)?.groupValues?.get(1) else null
        }
        return id?.takeIf { it.matches(Regex("[0-9]{1,20}")) }?.let { (if (qq) "tx-" else "wy-") + it }
    }
}
