package com.miyin.mobile

/** Fallback is scoped to one load and never changes the saved preference. */
object PlaybackQuality {
    private val descending = listOf("flac24bit", "flac", "320k", "128k")
    fun order(preferred: String): List<String> = descending.drop(descending.indexOf(preferred).takeIf { it >= 0 } ?: 2)
    fun below(actual: String?, requested: List<String>): List<String> {
        val rank = descending.indexOf(actual)
        return if (rank < 0) requested.drop(1) else requested.filter { descending.indexOf(it) > rank }
    }
    fun canRetry(status: Int?): Boolean = status == null || status >= 500 || status in listOf(404, 408, 422)
}
