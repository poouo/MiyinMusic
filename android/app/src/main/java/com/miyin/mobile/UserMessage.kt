package com.miyin.mobile

/** Keep connection details in the implementation rather than in user-visible error messages. */
fun Throwable.userMessage(fallback: String): String {
    if (this is java.net.UnknownHostException) return "网络暂不可用，请检查网络后重试"
    if (this is java.net.SocketTimeoutException) return "请求超时，请稍后重试"
    if (this is java.io.IOException) return "连接失败，请检查网络后重试"
    val text = message?.takeIf { it.isNotBlank() } ?: return fallback
    if (Regex("(?i)https?://|/api/|music\\.poouo\\.com|failed to connect|hostname|SSL|certificate").containsMatchIn(text)) return fallback
    return text.take(160)
}
