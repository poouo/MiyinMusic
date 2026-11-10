import * as audioCache from './audio-cache.js'
import { sourceManager } from './lx/manager.js'
import { HttpError } from './errors.js'
import type { Song, Quality } from './types.js'

export function deadline<T>(promise: Promise<T>, ms: number, message = '音源请求超时，请稍后重试'): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new HttpError(504, message, 'upstream_timeout')), ms)
    promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

/** Shared cache validation and source selection for browser and hardware clients. */
export async function resolveAudio(song: Song, allowed: Quality[], options: {
  sourceId?: string; excluded?: string[]; preferCache?: boolean; timeoutMs?: number
} = {}) {
  if (!allowed.length) throw new HttpError(403, '当前账号不支持所选音质', 'quality_forbidden')
  const cached = options.sourceId || options.excluded?.length ? null : await audioCache.lookupValidated(song, allowed)
  const cachedResult = () => ({ target: 'cache:' + cached!.key, quality: cached!.quality, platform: song.platform,
    cached: true, sourceId: cached!.sourceId, sourceName: cached!.sourceName, duration: cached!.duration })
  if (cached && (options.preferCache || cached.quality === allowed[0])) return cachedResult()
  const preferred = cached ? allowed.slice(0, allowed.indexOf(cached.quality)) : allowed
  try {
    const result = await deadline(sourceManager.getMusicUrl(song, preferred, options.sourceId, true, options.excluded), options.timeoutMs ?? 12000)
    if (!allowed.includes(result.quality)) throw new HttpError(403, '返回音质超出权限范围', 'quality_forbidden')
    return { target: result.url, quality: result.quality, platform: result.platform, cached: false,
      sourceId: result.sourceId, sourceName: result.sourceName, duration: result.duration }
  } catch (error) {
    if (cached) return cachedResult()
    throw error
  }
}

export function safeAudioFilename(song: Song, quality: Quality): string {
  const base = song.name + (song.singer ? ' - ' + song.singer : '') || 'music'
  return base.replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
    + (quality === 'flac' || quality === 'flac24bit' ? '.flac' : '.mp3')
}
