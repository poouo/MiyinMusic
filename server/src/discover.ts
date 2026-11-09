import { logger } from './log.js'
import { providers } from './providers/index.js'
import { PLATFORMS, type Platform, type PlaylistDetail, type PlaylistInfo, type SingerInfo, type Song } from './types.js'

const log = logger('discover')

/** 推荐歌单：10 分钟 */
const PLAYLIST_TTL = 10 * 60 * 1000
/** 歌单详情：10 分钟 */
const DETAIL_TTL = 10 * 60 * 1000
/** 新歌速递：5 分钟 */
const NEW_SONG_TTL = 5 * 60 * 1000
/** 热门歌手：30 分钟 */
const SINGER_TTL = 30 * 60 * 1000
/** 歌手歌曲：10 分钟 */
const SINGER_SONG_TTL = 10 * 60 * 1000

const CACHE_MAX = 400

interface CacheEntry<T> {
  value: T
  expire: number
}

const cache = new Map<string, CacheEntry<unknown>>()
const pending = new Map<string, Promise<unknown>>()

function pruneCache(): void {
  if (cache.size <= CACHE_MAX) return
  const now = Date.now()
  for (const [key, entry] of cache) if (entry.expire <= now) cache.delete(key)
  if (cache.size <= CACHE_MAX) return
  let overflow = cache.size - CACHE_MAX
  for (const key of cache.keys()) {
    if (overflow-- <= 0) break
    cache.delete(key)
  }
}

/**
 * 带缓存的取数：同一 key 并发请求只打一次上游。
 * 上游抖动时退回上一次的结果，页面不会整块消失。
 */
async function remember<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const cached = cache.get(key) as CacheEntry<T> | undefined
  if (cached && cached.expire > Date.now()) return cached.value
  const running = pending.get(key) as Promise<T> | undefined
  if (running) return running

  const task = load().then(
    (value) => {
      pending.delete(key)
      cache.set(key, { value, expire: Date.now() + ttl })
      pruneCache()
      return value
    },
    (err) => {
      pending.delete(key)
      if (cached) {
        log.warn('上游失败，使用缓存兜底：', key, err instanceof Error ? err.message : String(err))
        return cached.value
      }
      throw err
    },
  )
  pending.set(key, task)
  return task
}

/** 各平台结果交替排列，第一屏不会只看到同一个平台 */
function mix<T>(groups: T[][], limit: number): T[] {
  const out: T[] = []
  const longest = Math.max(0, ...groups.map((group) => group.length))
  for (let round = 0; round < longest && out.length < limit; round++) {
    for (const group of groups) {
      if (out.length >= limit) break
      if (round < group.length) out.push(group[round])
    }
  }
  return out
}

async function settle<T>(job: Promise<T[]>): Promise<T[]> {
  try {
    return await job
  } catch (err) {
    log.warn('上游请求失败：', err instanceof Error ? err.message : String(err))
    return []
  }
}

function platformOf(id: string): Platform {
  const prefix = id.split('-')[0]
  if (PLATFORMS.includes(prefix as Platform)) return prefix as Platform
  throw new Error('歌单 ID 不合法')
}

export interface PlaylistFeed {
  playlists: PlaylistInfo[]
  page: number
  hasMore: boolean
}

export interface PlaylistQuery {
  page?: number
  limit?: number
  /** 不传或 all 表示聚合全部平台 */
  platform?: Platform | 'all'
}

export async function getPlaylists(options: PlaylistQuery = {}): Promise<PlaylistFeed> {
  const page = Math.max(1, Math.floor(options.page ?? 1))
  const limit = Math.min(60, Math.max(6, Math.floor(options.limit ?? 18)))
  const platform = options.platform && options.platform !== 'all' ? options.platform : undefined
  const key = 'playlists:' + (platform ?? 'all') + ':' + page + ':' + limit

  return remember(key, PLAYLIST_TTL, async () => {
    const targets: Platform[] = platform ? [platform] : ['wy', 'tx']
    const results = await Promise.all(
      targets.map((id) => {
        const provider = providers[id]
        return settle(provider.playlists ? provider.playlists(page, limit) : Promise.resolve([]))
      }),
    )
    const playlists = mix(results, limit)
    if (!playlists.length) throw new Error('暂无推荐歌单')
    return { playlists, page, hasMore: playlists.length >= limit }
  })
}

export interface PlaylistQueryOptions {
  offset?: number
  limit?: number
}

export async function getPlaylist(id: string, options: PlaylistQueryOptions = {}): Promise<PlaylistDetail> {
  const platform = platformOf(id)
  const provider = providers[platform]
  if (!provider.playlistSongs) throw new Error('不支持该平台的歌单')

  const detail = await remember('playlist:' + id, DETAIL_TTL, () => provider.playlistSongs!(id))
  const offset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset!)) : 0
  const limit = Number.isFinite(options.limit) ? Math.min(300, Math.max(1, Math.floor(options.limit!))) : 100
  const songs = detail.songs.slice(offset, offset + limit)
  return {
    playlist: detail.playlist,
    songs,
    total: detail.songs.length,
    offset,
    limit,
    hasMore: offset + songs.length < detail.songs.length,
  }
}

export async function getNewSongs(limit = 12): Promise<Song[]> {
  const size = Math.min(30, Math.max(4, Math.floor(limit)))
  return remember('new-songs:' + size, NEW_SONG_TTL, async () => {
    const [wy, tx] = await Promise.all([
      settle(providers.wy.newSongs ? providers.wy.newSongs(size) : Promise.resolve([])),
      settle(providers.tx.newSongs ? providers.tx.newSongs(size) : Promise.resolve([])),
    ])
    const seen = new Set<string>()
    const songs: Song[] = []
    for (const song of mix([wy, tx], size * 2)) {
      if (songs.length >= size) break
      const key = song.name.replace(/\s+/g, '').toLowerCase() + '|' + song.singer.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      songs.push(song)
    }
    if (!songs.length) throw new Error('暂无新歌')
    return songs
  })
}

export async function getSingers(limit = 12): Promise<SingerInfo[]> {
  const size = Math.min(30, Math.max(4, Math.floor(limit)))
  return remember('singers:' + size, SINGER_TTL, async () => {
    const list = providers.tx.singers ? await providers.tx.singers(size) : []
    if (!list.length) throw new Error('暂无歌手数据')
    return list
  })
}

export interface SingerDetail {
  singer: SingerInfo
  songs: Song[]
  total: number
  hasMore: boolean
  page: number
  source: 'catalog' | 'search'
}

export async function getSinger(id: string, name?: string, page = 1): Promise<SingerDetail> {
  const platform = id.startsWith('wy-') ? 'wy' : 'tx'
  const mid = id.replace(/^(tx|wy)-/, '').slice(0, 64)
  page = Math.max(1, Math.min(100, Math.floor(page) || 1))
  if (!/^[\w-]{1,64}$/.test(mid)) throw new Error('歌手 ID 不合法')
  try {
    return await remember(`singer-catalog:${platform}:${mid}:${page}`, SINGER_SONG_TTL, async () => {
      const detail = await providers[platform].singerSongs!(mid, page, 40)
      if (!detail.songs.length && page === 1) throw new Error('暂无作品')
      return { ...detail, singer: { ...detail.singer, name: detail.singer.name || name || '' }, page, source: 'catalog' as const }
    })
  } catch { /* Search fallback is labeled and never presented as a complete discography. */ }
  if (!mid) throw new Error('歌手 ID 不合法')
  const known = platform === 'tx' ? (await getSingers(30).catch(() => [])).find((singer) => singer.id === mid) : undefined
  const singerName = (name || known?.name || '').trim().slice(0, 60)
  if (!singerName) throw new Error('缺少歌手名称')

  return remember('singer:' + platform + ':' + mid + ':' + singerName + ':' + page, SINGER_SONG_TTL, async () => {
    const result = await providers[platform].search(singerName, page, 40)
    const matched = result.list.filter((song) => song.singer.split(/[、,&/]/).some(part => part.trim() === singerName))
    return {
      singer: {
        id: platform + '-' + mid,
        platform,
        name: singerName,
        pic: known?.pic ?? (platform === 'tx' ? 'https://y.gtimg.cn/music/photo_new/T001R500x500M000' + mid + '.jpg' : null),
        followers: known?.followers,
        area: known?.area,
      },
      // 搜索里同名歌手的歌不够时，直接用搜索结果兜底
      songs: matched,
      total: result.total, hasMore: result.hasMore, page, source: 'search' as const,
    }
  })
}
