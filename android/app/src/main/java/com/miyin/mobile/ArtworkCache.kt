package com.miyin.mobile

import android.content.Context
import android.graphics.BitmapFactory
import android.util.AtomicFile
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Durable cover snapshots. A changed URL or changed image replaces only that cover. */
class ArtworkCache private constructor(context: Context) {
    data class Entry(val file: File, val version: Long)
    companion object {
        @Volatile private var instance: ArtworkCache? = null
        fun get(context: Context): ArtworkCache = instance ?: synchronized(this) {
            instance ?: ArtworkCache(context.applicationContext).also { instance = it }
        }
        private const val MAX_BYTES = 96L * 1024 * 1024
        private const val MAX_IMAGE_BYTES = 4 * 1024 * 1024
    }
    private val folder = File(context.filesDir, "artwork-snapshots").apply { mkdirs() }
    private val validators = context.getSharedPreferences("artwork-validators", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val slots = Semaphore(3)
    private val active = ConcurrentHashMap.newKeySet<String>()
    private val checked = ConcurrentHashMap<String, Long>()
    private val entries = ConcurrentHashMap<String, MutableStateFlow<Entry?>>()
    private val client = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).callTimeout(15, TimeUnit.SECONDS).build()
    @Volatile private var generation = 0
    private fun key(url: String) = MessageDigest.getInstance("SHA-256").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun file(url: String) = File(folder, key(url) + ".img")
    fun entry(url: String): StateFlow<Entry?> = entries.computeIfAbsent(url) {
        val file = file(url)
        MutableStateFlow(if (file.isFile) Entry(file, file.lastModified()) else null)
    }
    fun warm(urls: List<String>, refresh: Boolean = false) {
        for (url in urls.distinct().take(500)) {
            if (!url.startsWith(ApiClient.BASE_URL + "/api/image?")) continue
            if (!refresh && entry(url).value != null) continue
            if (System.currentTimeMillis() - (checked[url] ?: 0L) < 60000 || !active.add(url)) continue
            val expectedGeneration = generation
            scope.launch {
                try { slots.withPermit { if (generation == expectedGeneration) refresh(url, expectedGeneration) } }
                catch (e: CancellationException) { throw e }
                catch (_: Exception) { /* Keep the previous cover when offline. */ }
                finally { active.remove(url) }
            }
        }
    }
    private fun refresh(url: String, expectedGeneration: Int) {
        val id = key(url)
        val destination = file(url)
        val request = Request.Builder().url(url).header("Cache-Control", "no-cache").header("User-Agent", ApiClient.USER_AGENT)
        if (destination.isFile) {
            validators.getString(id + ":etag", null)?.let { request.header("If-None-Match", it) }
            validators.getString(id + ":modified", null)?.let { request.header("If-Modified-Since", it) }
        }
        client.newCall(request.build()).execute().use { response ->
            if (response.code == 304 && destination.isFile) { checked[url] = System.currentTimeMillis(); return }
            if (!response.isSuccessful) return
            val body = response.body ?: return
            if (body.contentLength() > MAX_IMAGE_BYTES) return
            val buffer = ByteArrayOutputStream()
            val chunk = ByteArray(8192)
            val input = body.byteStream()
            while (buffer.size() <= MAX_IMAGE_BYTES) {
                val count = input.read(chunk, 0, minOf(chunk.size, MAX_IMAGE_BYTES + 1 - buffer.size()))
                if (count < 0) break
                buffer.write(chunk, 0, count)
            }
            val bytes = buffer.toByteArray()
            if (bytes.isEmpty() || bytes.size > MAX_IMAGE_BYTES) return
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth !in 1..8192 || bounds.outHeight !in 1..8192) return
            synchronized(this) {
                if (generation != expectedGeneration) return
                // Byte comparison avoids writing unchanged covers and avoids a UI reload.
                if (!destination.isFile || !destination.readBytes().contentEquals(bytes)) {
                    val atomic = AtomicFile(destination)
                    val output = atomic.startWrite()
                    try { output.write(bytes); atomic.finishWrite(output) }
                    catch (e: Exception) { atomic.failWrite(output); throw e }
                    entries.computeIfAbsent(url) { MutableStateFlow(null) }.value = Entry(destination, destination.lastModified())
                }
                validators.edit().putString(id + ":etag", response.header("ETag"))
                    .putString(id + ":modified", response.header("Last-Modified")).apply()
                checked[url] = System.currentTimeMillis()
                prune()
            }
        }
    }
    private fun prune() {
        val files = folder.listFiles()?.filter { it.extension == "img" }?.sortedBy { it.lastModified() }.orEmpty()
        var size = files.sumOf { it.length() }
        for (file in files) {
            if (size <= MAX_BYTES) break
            val length = file.length()
            if (file.delete()) {
                size -= length
                entries.values.filter { it.value?.file == file }.forEach { it.value = null }
            }
        }
    }
    fun bytes(): Long = folder.listFiles()?.sumOf { it.length() } ?: 0L
    @Synchronized fun clear() {
        generation++
        folder.listFiles()?.forEach { it.delete() }
        entries.values.forEach { it.value = null }
        checked.clear(); validators.edit().clear().apply()
    }
}
