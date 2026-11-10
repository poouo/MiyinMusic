import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { once } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { config } from './config.js'
import { getDb, sql } from './db.js'
import { getAppConfig } from './app-config.js'
import { sourceManager } from './lx/manager.js'
import { assertPublicUrl } from './stream.js'
import { inspectFile, assertComplete, assertQuality, fetchAudio } from './media-validation.js'
import { logger } from './log.js'
import * as lyricCache from './lyric-cache.js'
import { QUALITIES, songKey, type Quality, type Song } from './types.js'

const log = logger('audio-cache')

/** 单个缓存文件上限：500MB，避免异常地址拖垮磁盘 */
const MAX_FILE_BYTES = 500 * 1024 * 1024
/** 同时进行的缓存任务数 */
const WARM_CONCURRENCY = 2
/** 每次播放访问时，最多 30 秒写一次 last_access_at */
const TOUCH_INTERVAL = 30 * 1000

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface CacheRow {
  cache_key: string
  song_key: string
  platform: string
  songmid: string
  quality: string
  file_name: string
  bytes: number
  created_at: number
  last_access_at: number
  hits: number
}

export interface CachedAudio {
  sourceId?: string
  sourceName?: string
  duration?: number
  key: string
  quality: Quality
  bytes: number
  platform: string
  songmid: string
}

const inflight = new Map<string, Promise<CachedAudio | null>>()
const warmQueue: Song[] = []
const warmQueued = new Map<string, Song>()
let generation = 0
let warmActive = 0
let initialized = false

function cacheDir(): string {
  return config.audioCacheDir
}

function ensureDir(): void {
  fs.mkdirSync(cacheDir(), { recursive: true })
}

function filePathOf(name: string): string {
  return path.join(cacheDir(), name)
}

function fileExists(name: string): boolean {
  try {
    return fs.statSync(filePathOf(name)).isFile()
  } catch {
    return false
  }
}

function cacheKeyFor(song: Song, quality: Quality): string {
  return crypto.createHash('sha1').update(songKey(song) + '|' + quality).digest('hex').slice(0, 24)
}

function extensionOf(quality: Quality): string {
  return quality === 'flac' || quality === 'flac24bit' ? 'flac' : 'mp3'
}

function rowToCached(row: CacheRow): CachedAudio {
  const checked = validation(row)
  return {
    sourceId: checked?.source_id || undefined,
    sourceName: checked?.source_name || '服务端缓存',
    duration: checked?.duration,
    key: row.cache_key,
    quality: row.quality as Quality,
    bytes: Number(row.bytes) || 0,
    platform: row.platform,
    songmid: row.songmid,
  }
}

function deleteRow(cacheKeyValue: string): void {
  try {
    sql('DELETE FROM audio_validation WHERE cache_key = ?').run(cacheKeyValue)
    sql('DELETE FROM audio_cache WHERE cache_key = ?').run(cacheKeyValue)
  } catch {
    /* ignore */
  }
}

interface Validation { duration: number; mime: string; source_id: string; source_name: string }
function validation(row: CacheRow): Validation | undefined {
  let stat: fs.Stats
  try { stat = fs.statSync(filePathOf(row.file_name)) } catch { return undefined }
  return sql('SELECT * FROM audio_validation WHERE cache_key = ? AND bytes = ? AND mtime = ?')
    .get(row.cache_key, stat.size, stat.mtimeMs) as unknown as Validation | undefined
}
const validating = new Map<string, Promise<void>>()

/** Verify legacy files on first access, then reuse metadata until the file changes. */
export async function lookupValidated(song: Song, allowed: Quality[]): Promise<CachedAudio | null> {
  for (;;) {
    const candidate = lookup(song, allowed)
    if (!candidate) return null
    const row = sql('SELECT * FROM audio_cache WHERE cache_key = ?').get(candidate.key) as unknown as CacheRow
    const epoch = generation
    const identity = candidate.key + ':' + epoch
    let task = validating.get(identity)
    if (!task) {
      task = (async () => {
        try {
          let checked = validation(row)
          if (!checked) {
            const stat = fs.statSync(filePathOf(row.file_name))
            if (stat.size !== Number(row.bytes)) throw new Error('缓存文件大小不完整')
            const info = await inspectFile(filePathOf(row.file_name))
            assertComplete(info, song.interval, true)
            assertQuality(info, row.quality)
            if (epoch !== generation) return
            sql('INSERT OR REPLACE INTO audio_validation (cache_key, bytes, mtime, duration, mime) VALUES (?, ?, ?, ?, ?)')
              .run(row.cache_key, stat.size, stat.mtimeMs, info.duration!, info.mime ?? 'application/octet-stream')
            checked = validation(row)
          }
          assertComplete({ duration: checked?.duration }, song.interval, true)
        } catch (error) {
          if (epoch !== generation) return
          deleteRow(row.cache_key)
          try { fs.unlinkSync(filePathOf(row.file_name)) } catch { /* already removed */ }
          log.warn('剔除异常缓存：' + song.name + ' · ' + (error instanceof Error ? error.message : '音频校验失败'))
        }
      })().finally(() => validating.delete(identity))
      validating.set(identity, task)
    }
    await task
    if (epoch !== generation) return null
    if (sql('SELECT cache_key FROM audio_cache WHERE cache_key = ?').get(candidate.key)) {
      // Recheck against this caller's metadata after a shared validation.
      const checked = validation(row)
      try { assertComplete({ duration: checked?.duration }, song.interval, true) }
      catch { deleteRow(row.cache_key); try { fs.unlinkSync(filePathOf(row.file_name)) } catch {}; continue }
      return rowToCached(row)
    }
  }
}

function touch(row: CacheRow): void {
  if (Date.now() - Number(row.last_access_at) < TOUCH_INTERVAL) return
  try {
    sql('UPDATE audio_cache SET last_access_at = ?, hits = hits + 1 WHERE cache_key = ?').run(Date.now(), row.cache_key)
  } catch {
    /* ignore */
  }
}

/** 查找某首歌在允许音质范围内、且文件真实存在的缓存 */
export function lookup(song: Song, allowed: Quality[]): CachedAudio | null {
  if (!initialized) return null
  if (!getAppConfig().cache.enabled) return null
  const rows = sql('SELECT * FROM audio_cache WHERE song_key = ?').all(songKey(song)) as unknown as CacheRow[]
  const matches = rows.filter((row) => allowed.includes(row.quality as Quality))
  // The caller's preference order also applies when serving cached files.
  matches.sort((a, b) => allowed.indexOf(a.quality as Quality) - allowed.indexOf(b.quality as Quality))
  for (const row of matches) {
    if (!fileExists(row.file_name)) {
      deleteRow(row.cache_key)
      continue
    }
    touch(row)
    return rowToCached(row)
  }
  return null
}

async function downloadToFile(url: string, target: string, maxBytes: number): Promise<number> {
  let safe: URL
  try {
    safe = await assertPublicUrl(url)
  } catch {
    throw new Error('音频地址不合法')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120000)
  try {
    const response = await fetchAudio(safe.href, {
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Encoding': 'identity' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('音频下载失败 HTTP ' + response.status)
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    if (/json|html|text\//.test(contentType)) throw new Error('音频地址返回了非音频内容')
    const declared = Number(response.headers.get('content-length')) || 0
    if (declared > maxBytes) throw new Error('音频超过缓存单文件上限')
    if (!response.body) throw new Error('音频响应为空')

    let received = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > maxBytes) callback(new Error('音频超过缓存单文件上限'))
        else callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body as never), counter, fs.createWriteStream(target))
    if (declared && declared !== received) throw new Error('音频下载不完整')
    return received
  } finally {
    clearTimeout(timer)
  }
}

/** 超过总容量时按最久未访问顺序删除 */
export function enforceLimit(): void {
  const cfg = getAppConfig().cache
  try {
    const max = Math.max(0, cfg.maxBytes - lyricCache.stats().bytes)
    let total = Number(sql('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM audio_cache').get()!.bytes)
    if (total <= max) return
    const rows = sql('SELECT * FROM audio_cache ORDER BY last_access_at ASC').all() as unknown as CacheRow[]
    for (const row of rows) {
      if (total <= max) break
      try {
        fs.unlinkSync(filePathOf(row.file_name))
      } catch {
        /* 文件可能已不存在 */
      }
      deleteRow(row.cache_key)
      total -= Number(row.bytes) || 0
    }
  } catch (err) {
    log.warn('检查缓存容量失败：', err instanceof Error ? err.message : String(err))
  }
}

/** Cache each available quality independently; one existing file cannot skip the others. */
export async function ensure(song: Song): Promise<CachedAudio[]> {
  const epoch = generation
  const result: CachedAudio[] = []
  for (const quality of QUALITIES) {
    if (epoch !== generation || !getAppConfig().cache.enabled) break
    const cached = await ensureQuality(song, quality)
    if (cached) result.push(cached)
  }
  return result
}

async function ensureQuality(song: Song, requested: Quality): Promise<CachedAudio | null> {
  const cfg = getAppConfig().cache
  if (!cfg.enabled) return null
  ensureDir()
  const existing = await lookupValidated(song, [requested])
  if (existing) return existing

  const epoch = generation
  // Global identity intentionally excludes user and playlist IDs.
  const key = cacheKeyFor(song, requested) + '|' + epoch
  const running = inflight.get(key)
  if (running) return running

  const task = (async (): Promise<CachedAudio | null> => {
    const excluded: string[] = []
    for (let attempt = 0; attempt < 3; attempt++) {
      let resolved: { url: string; quality: Quality; sourceId?: string; sourceName?: string }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        resolved = await Promise.race([
          // Old clients may only list 128k; probe all source-supported qualities.
          sourceManager.getMusicUrl({ ...song, qualities: [...QUALITIES] }, [requested], undefined, true, excluded),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('解析音源超时')), 45000) }),
        ])
      } catch (err) {
        log.debug('缓存音质不可用：' + song.name + ' (' + requested + ') · ' + (err instanceof Error ? err.message : String(err)))
        return null
      } finally {
        clearTimeout(timer)
      }
      if (!resolved.url || resolved.quality !== requested || epoch !== generation || !getAppConfig().cache.enabled) return null
      const quality = resolved.quality
      const cacheKeyValue = cacheKeyFor(song, quality)
      const fileName = cacheKeyValue + '.' + extensionOf(quality)
      const target = filePathOf(fileName)
      const temp = target + '.' + epoch + '.part'

      try {
        const bytes = await downloadToFile(resolved.url, temp, Math.min(MAX_FILE_BYTES, cfg.maxBytes))
        if (bytes <= 0) throw new Error('音频为空')
        const info = await inspectFile(temp)
        assertComplete(info, song.interval, true)
        assertQuality(info, quality)
        if (epoch !== generation || !getAppConfig().cache.enabled) {
          fs.unlinkSync(temp)
          return null
        }
        fs.renameSync(temp, target)
        if (bytes > cfg.maxBytes) {
          fs.unlinkSync(target)
          return null
        }
        const now = Date.now()
        sql(
          `INSERT INTO audio_cache
            (cache_key, song_key, platform, songmid, quality, file_name, bytes, created_at, last_access_at, hits)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT(cache_key) DO UPDATE SET bytes = excluded.bytes, created_at = excluded.created_at, last_access_at = excluded.last_access_at`,
        ).run(cacheKeyValue, songKey(song), song.platform, song.songmid, quality, fileName, bytes, now, now)
        sql(`INSERT OR REPLACE INTO audio_validation (cache_key, bytes, mtime, duration, mime, source_id, source_name) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(cacheKeyValue, bytes, fs.statSync(target).mtimeMs, info.duration!, info.mime ?? 'application/octet-stream', resolved.sourceId ?? null, resolved.sourceName ?? null)
        enforceLimit()
        if (!fileExists(fileName)) return null
        log.info('已缓存：' + song.singer + ' - ' + song.name + ' (' + quality + ', ' + Math.round(bytes / 1024) + 'KB)')
        return { key: cacheKeyValue, quality, bytes, platform: song.platform, songmid: song.songmid, duration: info.duration, sourceId: resolved.sourceId, sourceName: resolved.sourceName }
      } catch (err) {
        try {
          fs.unlinkSync(temp)
        } catch {
          /* ignore */
        }
        log.warn('缓存下载失败：' + song.name + ' · ' + (err instanceof Error ? err.message : String(err)))
        // Metadata may be at the end of a file. If the complete download exposes
        // a preview or a broken response, continue with another source.
        if (resolved.sourceId && !excluded.includes(resolved.sourceId) && epoch === generation && getAppConfig().cache.enabled) {
          excluded.push(resolved.sourceId)
          continue
        }
        return null
      }
    }
    return null
  })().finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, task)
  return task
}

/** 歌单 / 收藏变更后异步预热缓存 */
export function warm(song: Song, manual = false): boolean {
  const cfg = getAppConfig().cache
  if (!cfg.enabled || (!manual && !cfg.warmCollections)) return false
  const key = songKey(song)
  const queued = warmQueued.get(key)
  if (queued) {
    // Different clients can supply different quality metadata for the same track.
    queued.qualities = [...new Set([...queued.qualities, ...(Array.isArray(song.qualities) ? song.qualities : [])])]
    return false
  }
  const copy = { ...song, qualities: Array.isArray(song.qualities) ? [...song.qualities] : [] }
  warmQueued.set(key, copy)
  warmQueue.push(copy)
  pumpWarm()
  return true
}

function pumpWarm(): void {
  while (warmActive < WARM_CONCURRENCY && warmQueue.length) {
    const song = warmQueue.shift()
    if (!song) break
    warmActive++
    void Promise.allSettled([ensure(song), lyricCache.get(song)])
      .finally(() => {
        if (warmQueued.get(songKey(song)) === song) warmQueued.delete(songKey(song))
        enforceLimit()
        warmActive--
        pumpWarm()
      })
  }
}

export function stats(): { enabled: boolean; count: number; bytes: number; maxBytes: number; dir: string; warming: number; lyricCount: number; lyricBytes: number } {
  let count = 0
  let bytes = 0
  try {
    const row = sql('SELECT COUNT(*) AS c, COALESCE(SUM(bytes), 0) AS b FROM audio_cache').get() as
      | { c: number; b: number }
      | undefined
    count = Number(row?.c) || 0
    bytes = Number(row?.b) || 0
  } catch {
    /* ignore */
  }
  const cfg = getAppConfig().cache
  const lyrics = lyricCache.stats()
  return {
    enabled: cfg.enabled,
    count,
    bytes: bytes + lyrics.bytes,
    lyricCount: lyrics.count,
    lyricBytes: lyrics.bytes,
    maxBytes: cfg.maxBytes,
    dir: cacheDir(),
    warming: warmQueue.length + warmActive,
  }
}

/** 清空服务端缓存 */
export function clear(): { removed: number; bytes: number } {
  generation++
  warmQueue.length = 0
  warmQueued.clear()
  const lyrics = lyricCache.clear()
  let removed = lyrics.count
  let bytes = lyrics.bytes
  try {
    const rows = sql('SELECT * FROM audio_cache').all() as unknown as CacheRow[]
    for (const row of rows) {
      try {
        fs.unlinkSync(filePathOf(row.file_name))
      } catch {
        /* ignore */
      }
      removed++
      bytes += Number(row.bytes) || 0
    }
    getDb().exec('DELETE FROM audio_cache; DELETE FROM audio_validation')
  } catch (err) {
    log.warn('清空缓存失败：', err instanceof Error ? err.message : String(err))
  }
  return { removed, bytes }
}

/** Queue every unique track across all accounts, merging metadata before work starts. */
export function warmCollections(manual = true): number {
  if (!getAppConfig().cache.enabled || (!manual && !getAppConfig().cache.warmCollections)) return 0
  const songs = new Map<string, Song>()
  try {
    const rows = getDb().prepare('SELECT song_json FROM favorites UNION ALL SELECT song_json FROM playlist_songs').iterate()
    for (const row of rows) {
      try {
        const song = JSON.parse(String(row.song_json)) as Song
        if (!song || !song.platform || !song.songmid) continue
        const previous = songs.get(songKey(song))
        if (previous) previous.qualities = [...new Set([
          ...(Array.isArray(previous.qualities) ? previous.qualities : []),
          ...(Array.isArray(song.qualities) ? song.qualities : []),
        ])]
        else songs.set(songKey(song), song)
      } catch { /* Ignore malformed legacy entries. */ }
    }
  } catch (err) {
    log.warn('预热收藏歌单失败：', err instanceof Error ? err.message : String(err))
  }
  let queued = 0
  for (const song of songs.values()) if (warm(song, manual)) queued++
  return queued
}

/** 服务端缓存文件流（支持 Range，下载时加 attachment） */
export async function streamCached(
  req: IncomingMessage,
  res: ServerResponse,
  cacheKeyValue: string,
  options: {
    attachment?: string
    beforeStream?: (bytes: number) => void
    beforeChunk?: (bytes: number) => void
    afterStream?: () => void
  } = {},
): Promise<void> {
  const row = sql('SELECT * FROM audio_cache WHERE cache_key = ?').get(cacheKeyValue) as CacheRow | undefined
  if (!row) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('缓存不存在')
    return
  }
  const file = filePathOf(row.file_name)
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    deleteRow(row.cache_key)
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('缓存文件已丢失')
    return
  }
  touch(row)
  const checked = validation(row)
  if (!checked) {
    res.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8' }).end('缓存需要重新校验，请重新获取播放地址')
    return
  }
  const kind = row.file_name.endsWith('.flac') ? 'flac' : 'mp3'
  const headers: Record<string, string | number> = {
    'Content-Type': checked.mime || (kind === 'flac' ? 'audio/flac' : 'audio/mpeg'),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=0',
  }
  if (options.attachment) {
    const ascii = options.attachment.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    headers['Content-Disposition'] =
      'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(options.attachment)
  }

  // Download tickets are claimed only after verifying the shared file exists.
  options.beforeStream?.(stat.size)
  if (options.beforeChunk) {
    const stream = fs.createReadStream(file)
    const controller = new AbortController()
    const cancel = () => { stream.destroy(); controller.abort() }
    res.on('close', cancel)
    res.writeHead(200, { ...headers, 'Accept-Ranges': 'none', 'Content-Length': stat.size })
    try {
      for await (const chunk of stream) {
        if (res.destroyed) break
        options.beforeChunk(chunk.length)
        if (!res.write(chunk)) await once(res, 'drain', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) })
      }
    } catch (error) {
      if (!res.writableEnded) res.destroy(error instanceof Error ? error : undefined)
    } finally {
      stream.destroy()
      res.off('close', cancel)
      options.afterStream?.()
      if (!res.writableEnded) res.end()
    }
    return
  }

  const range = options.attachment ? undefined : req.headers.range
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }).end()
      return
    }
    let start = match[1] ? Number(match[1]) : 0
    let end = match[2] ? Number(match[2]) : stat.size - 1
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }).end()
      return
    }
    end = Math.min(end, stat.size - 1)
    res.writeHead(206, {
      ...headers,
      'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
      'Content-Length': end - start + 1,
    })
    const stream = fs.createReadStream(file, { start, end })
    res.on('close', () => stream.destroy())
    stream.pipe(res)
    return
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = fs.createReadStream(file)
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

/** 启动时清理失效记录、续期容量限制 */
export function init(): void {
  if (initialized) return
  initialized = true
  ensureDir()
  try {
    const rows = sql('SELECT * FROM audio_cache').all() as unknown as CacheRow[]
    let missing = 0
    for (const row of rows) {
      if (!fileExists(row.file_name)) {
        deleteRow(row.cache_key)
        missing++
      }
    }
    for (const entry of fs.readdirSync(cacheDir())) {
      if (entry.endsWith('.part')) {
        try {
          fs.unlinkSync(filePathOf(entry))
        } catch {
          /* ignore */
        }
      }
    }
    enforceLimit()
    const info = stats()
    log.info(
      '音频缓存：' +
        info.count +
        ' 个文件 / ' +
        Math.round(info.bytes / 1024 / 1024) +
        'MB（上限 ' +
        Math.round(info.maxBytes / 1024 / 1024) +
        'MB）' +
        (missing ? '，清理失效记录 ' + missing + ' 条' : ''),
    )
  } catch (err) {
    log.warn('初始化音频缓存失败：', err instanceof Error ? err.message : String(err))
  }
}
