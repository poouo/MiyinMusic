import { getAppConfig } from './app-config.js'
import { sql } from './db.js'
import { getProvider } from './providers/index.js'
import { logger } from './log.js'
import { songKey, type LyricResult, type Song } from './types.js'

const REFRESH_AFTER = 30 * 24 * 60 * 60 * 1000
const MAX_LYRIC_BYTES = 2 * 1024 * 1024
const MAX_CACHE_BYTES = 64 * 1024 * 1024
const pending = new Map<string, Promise<LyricResult>>()
let generation = 0
const log = logger('lyric-cache')

function read(song: Song): { lyric: LyricResult; fetchedAt: number } | null {
  const key = songKey(song)
  const row = sql('SELECT lyric_json, fetched_at FROM lyric_cache WHERE song_key = ?').get(key) as
    { lyric_json: string; fetched_at: number } | undefined
  if (!row) return null
  let lyric: LyricResult
  try {
    lyric = JSON.parse(row.lyric_json) as LyricResult
    if (typeof lyric.lyric !== 'string' || !lyric.lyric.trim()) throw new Error('empty lyric')
  } catch {
    sql('DELETE FROM lyric_cache WHERE song_key = ?').run(key)
    return null
  }
  try {
    sql('UPDATE lyric_cache SET last_access_at = ? WHERE song_key = ?').run(Date.now(), key)
  } catch { /* Access timestamps must not prevent using an otherwise valid cache. */ }
  return { lyric, fetchedAt: row.fetched_at }
}

/** Original, translated and word-timed lyrics share one persistent entry per platform/song. */
export async function get(song: Song): Promise<LyricResult> {
  if (!getAppConfig().cache.enabled) return getProvider(song.platform).lyric(song)
  const cached = read(song)
  if (cached && Date.now() - cached.fetchedAt < REFRESH_AFTER) return cached.lyric
  const epoch = generation
  const key = songKey(song) + '|' + epoch
  const running = pending.get(key)
  if (running) return running
  const task = (async () => {
    let result: LyricResult
    try {
      result = await getProvider(song.platform).lyric(song)
      if (typeof result?.lyric !== 'string' || !result.lyric.trim()) {
        if (cached) return cached.lyric
        return { lyric: '' }
      }
    } catch (error) {
      // A failed refresh must not discard lyrics needed when the provider is offline.
      if (cached) return cached.lyric
      throw error
    }
    const json = JSON.stringify(result)
    const bytes = Buffer.byteLength(json)
    if (generation === epoch && getAppConfig().cache.enabled && bytes <= MAX_LYRIC_BYTES) try {
      const now = Date.now()
      sql(`INSERT INTO lyric_cache (song_key, lyric_json, bytes, fetched_at, last_access_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(song_key) DO UPDATE SET
        lyric_json = excluded.lyric_json, bytes = excluded.bytes,
        fetched_at = excluded.fetched_at, last_access_at = excluded.last_access_at`)
        .run(songKey(song), json, bytes, now, now)
      let total = stats().bytes
      const rows = total > MAX_CACHE_BYTES
        ? sql('SELECT song_key, bytes FROM lyric_cache ORDER BY last_access_at ASC').all() : []
      for (const row of rows) {
        if (total <= MAX_CACHE_BYTES) break
        sql('DELETE FROM lyric_cache WHERE song_key = ?').run(row.song_key)
        total -= Number(row.bytes)
      }
    } catch (error) {
      // A full disk must not prevent displaying successfully fetched lyrics.
      log.warn('歌词缓存写入失败：', error instanceof Error ? error.message : String(error))
    }
    return result
  })().finally(() => pending.delete(key))
  pending.set(key, task)
  return task
}

export function stats(): { count: number; bytes: number } {
  const row = sql('SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM lyric_cache').get()!
  return { count: Number(row.count), bytes: Number(row.bytes) }
}

export function clear(): { count: number; bytes: number } {
  generation++
  const removed = stats()
  sql('DELETE FROM lyric_cache').run()
  return removed
}
