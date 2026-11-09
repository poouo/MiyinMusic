import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { config } from './config.js'
import { getDb, sql } from './db.js'
import { getAppConfig } from './app-config.js'
import { sourceManager } from './lx/manager.js'
import { assertPublicUrl } from './stream.js'
import { logger } from './log.js'
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

const QUALITY_RANK: Record<Quality, number> = { flac24bit: 4, flac: 3, '320k': 2, '128k': 1 }

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
  key: string
  quality: Quality
  bytes: number
  platform: string
  songmid: string
}

const inflight = new Map<string, Promise<CachedAudio | null>>()
const warmQueue: Song[] = []
const warmQueued = new Set<string>()
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

function normalizeQualities(input: unknown): Quality[] {
  const list = Array.isArray(input) ? input : []
  const out = QUALITIES.filter((quality) => list.includes(quality))
  return out.length ? out : (['320k', '128k'] as Quality[])
}

function cacheKeyFor(song: Song, quality: Quality): string {
  return crypto.createHash('sha1').update(songKey(song) + '|' + quality).digest('hex').slice(0, 24)
}

function extensionOf(quality: Quality): string {
  return quality === 'flac' || quality === 'flac24bit' ? 'flac' : 'mp3'
}

function rowToCached(row: CacheRow): CachedAudio {
  return {
    key: row.cache_key,
    quality: row.quality as Quality,
    bytes: Number(row.bytes) || 0,
    platform: row.platform,
    songmid: row.songmid,
  }
}

function deleteRow(cacheKeyValue: string): void {
  try {
    sql('DELETE FROM audio_cache WHERE cache_key = ?').run(cacheKeyValue)
  } catch {
    /* ignore */
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
    const response = await fetch(safe, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: controller.signal,
      redirect: 'follow',
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
    return received
  } finally {
    clearTimeout(timer)
  }
}

/** 超过总容量时按最久未访问顺序删除 */
export function enforceLimit(): void {
  const cfg = getAppConfig().cache
  const max = cfg.maxBytes
  let rows: CacheRow[]
  try {
    rows = sql('SELECT * FROM audio_cache ORDER BY last_access_at ASC').all() as unknown as CacheRow[]
  } catch {
    return
  }
  let total = rows.reduce((sum, row) => sum + (Number(row.bytes) || 0), 0)
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
}

/** 缓存一首歌（已有则直接返回） */
export async function ensure(song: Song, requested?: Quality[]): Promise<CachedAudio | null> {
  const cfg = getAppConfig().cache
  if (!cfg.enabled) return null
  ensureDir()
  const qualities = normalizeQualities(requested ?? cfg.qualities)
  const existing = lookup(song, qualities)
  if (existing) return existing

  const key = songKey(song) + '|' + qualities.join(',')
  const running = inflight.get(key)
  if (running) return running

  const task = (async (): Promise<CachedAudio | null> => {
    let resolved: { url: string; quality: Quality }
    try {
      resolved = await Promise.race([
        sourceManager.getMusicUrl(song, qualities),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('解析音源超时')), 45000)),
      ])
    } catch (err) {
      log.warn('缓存解析音源失败：' + song.name + ' · ' + (err instanceof Error ? err.message : String(err)))
      return null
    }
    if (!resolved.url) return null
    const quality = resolved.quality
    const cacheKeyValue = cacheKeyFor(song, quality)
    const fileName = cacheKeyValue + '.' + extensionOf(quality)
    const target = filePathOf(fileName)
    const temp = target + '.part'

    try {
      const bytes = await downloadToFile(resolved.url, temp, Math.min(MAX_FILE_BYTES, cfg.maxBytes))
      if (bytes <= 0) throw new Error('音频为空')
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
      enforceLimit()
      if (!fileExists(fileName)) return null
      log.info('已缓存：' + song.singer + ' - ' + song.name + ' (' + quality + ', ' + Math.round(bytes / 1024) + 'KB)')
      return { key: cacheKeyValue, quality, bytes, platform: song.platform, songmid: song.songmid }
    } catch (err) {
      try {
        fs.unlinkSync(temp)
      } catch {
        /* ignore */
      }
      log.warn('缓存下载失败：' + song.name + ' · ' + (err instanceof Error ? err.message : String(err)))
      return null
    }
  })().finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, task)
  return task
}

/** 歌单 / 收藏变更后异步预热缓存 */
export function warm(song: Song): void {
  const cfg = getAppConfig().cache
  if (!cfg.enabled || !cfg.warmCollections) return
  const key = songKey(song)
  if (warmQueued.has(key)) return
  warmQueued.add(key)
  warmQueue.push(song)
  pumpWarm()
}

function pumpWarm(): void {
  while (warmActive < WARM_CONCURRENCY && warmQueue.length) {
    const song = warmQueue.shift()
    if (!song) break
    warmActive++
    void ensure(song)
      .catch(() => undefined)
      .finally(() => {
        warmQueued.delete(songKey(song))
        warmActive--
        pumpWarm()
      })
  }
}

export function stats(): { enabled: boolean; count: number; bytes: number; maxBytes: number; dir: string; warming: number } {
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
  return {
    enabled: cfg.enabled,
    count,
    bytes,
    maxBytes: cfg.maxBytes,
    dir: cacheDir(),
    warming: warmQueue.length + warmActive,
  }
}

/** 清空服务端缓存 */
export function clear(): { removed: number; bytes: number } {
  let removed = 0
  let bytes = 0
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
    getDb().exec('DELETE FROM audio_cache')
  } catch (err) {
    log.warn('清空缓存失败：', err instanceof Error ? err.message : String(err))
  }
  return { removed, bytes }
}

/** 把现有收藏 / 歌单里的歌曲补进缓存队列（管理员手动触发） */
export function warmCollections(limit = 200): number {
  let queued = 0
  try {
    const rows = getDb()
      .prepare(
        `SELECT song_json FROM favorites
         UNION SELECT song_json FROM playlist_songs
         LIMIT ?`,
      )
      .all(limit) as { song_json: string }[]
    for (const row of rows) {
      try {
        const song = JSON.parse(row.song_json) as Song
        if (song && song.platform && song.songmid) {
          warm(song)
          queued++
        }
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    log.warn('预热收藏歌单失败：', err instanceof Error ? err.message : String(err))
  }
  return queued
}

/** 服务端缓存文件流（支持 Range，下载时加 attachment） */
export async function streamCached(
  req: IncomingMessage,
  res: ServerResponse,
  cacheKeyValue: string,
  options: { attachment?: string } = {},
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
  const kind = row.file_name.endsWith('.flac') ? 'flac' : 'mp3'
  const headers: Record<string, string | number> = {
    'Content-Type': kind === 'flac' ? 'audio/flac' : 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=0',
  }
  if (options.attachment) {
    const ascii = options.attachment.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    headers['Content-Disposition'] =
      'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(options.attachment)
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
