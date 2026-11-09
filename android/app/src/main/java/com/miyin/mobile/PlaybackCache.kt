package com.miyin.mobile

import android.content.Context
import androidx.media3.common.C
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheEvictor
import androidx.media3.datasource.cache.CacheSpan
import androidx.media3.datasource.cache.SimpleCache
import java.io.File
import java.util.TreeSet

/** Resizing/clearing removes spans without releasing a cache used by active playback. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
object PlaybackCache {
    private var cache: SimpleCache? = null
    private var evictor: ResizableCacheEvictor? = null

    @Synchronized
    fun get(context: Context): SimpleCache = cache ?: run {
        val policy = ResizableCacheEvictor(AppPrefs(context).audioCacheMb * 1024L * 1024L)
        evictor = policy
        SimpleCache(File(context.cacheDir, "audio"), policy, StandaloneDatabaseProvider(context.applicationContext))
            .also { cache = it }
    }

    fun resize(context: Context, mb: Int) {
        val current = get(context)
        synchronized(current) { evictor?.resize(current, mb * 1024L * 1024L) }
    }

    fun clear(context: Context) {
        val current = get(context)
        current.keys.toList().forEach { current.removeResource(it) }
    }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
private class ResizableCacheEvictor(private var maxBytes: Long) : CacheEvictor {
    private val spans = TreeSet<CacheSpan>(compareBy<CacheSpan> { it.lastTouchTimestamp }.thenBy { it.key }.thenBy { it.position })
    private var bytes = 0L
    override fun requiresCacheSpanTouches() = true
    override fun onCacheInitialized() {}
    override fun onStartFile(cache: Cache, key: String, position: Long, length: Long) {
        evict(cache, if (length == C.LENGTH_UNSET.toLong()) 0 else length)
    }
    override fun onSpanAdded(cache: Cache, span: CacheSpan) {
        if (spans.add(span)) bytes += span.length
        evict(cache, 0)
    }
    override fun onSpanRemoved(cache: Cache, span: CacheSpan) {
        if (spans.remove(span)) bytes -= span.length
    }
    override fun onSpanTouched(cache: Cache, oldSpan: CacheSpan, newSpan: CacheSpan) {
        onSpanRemoved(cache, oldSpan)
        onSpanAdded(cache, newSpan)
    }
    fun resize(cache: Cache, limit: Long) {
        maxBytes = limit
        evict(cache, 0)
    }
    private fun evict(cache: Cache, incoming: Long) {
        while (bytes + incoming > maxBytes && spans.isNotEmpty()) cache.removeSpan(spans.first())
    }
}
