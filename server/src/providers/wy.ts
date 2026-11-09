import crypto from 'node:crypto'
import { request } from '../http-client.js'
import type { LyricResult, PlaylistInfo, Quality, SearchResult, Song } from '../types.js'
import type { ChartInfo, Provider } from './types.js'
import { clampLimit, clampPage, normalizeLrc, sortQualities, text, toSeconds } from './util.js'

const EAPI_KEY = Buffer.from('e82ckenh8dichen8')
const API_HOST = 'http://interface.music.163.com'
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
  origin: 'https://music.163.com',
  Referer: 'https://music.163.com/',
}

function eapiPayload(url: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  const digest = crypto.createHash('md5').update('nobody' + url + 'use' + payload + 'md5forencrypt').digest('hex')
  const plain = url + '-36cd479b6b5-' + payload + '-36cd479b6b5-' + digest
  const cipher = crypto.createCipheriv('aes-128-ecb', EAPI_KEY, '')
  return Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]).toString('hex').toUpperCase()
}

async function eapi(url: string, data: unknown): Promise<any> {
  const res = await request(API_HOST + '/eapi/batch', {
    method: 'POST',
    headers: HEADERS,
    form: { params: eapiPayload(url, data) },
    timeoutMs: 12000,
  })
  return res.json
}

function httpsUrl(url: string): string {
  return url ? url.replace(/^http:\/\//, 'https://') : url
}

function mapSong(item: Record<string, any>): Song | null {
  const simple = item?.baseInfo?.simpleSongData ?? item
  if (!simple) return null
  const id = text(simple.id ?? item.resourceId)
  const name = text(simple.name)
  if (!id || !name) return null
  const singers: any[] = Array.isArray(simple.ar) ? simple.ar : []
  const singer = singers.map((s) => text(s.name)).filter(Boolean).join('、')
  const album = simple.al ?? {}
  const qualities: Quality[] = []
  const privilege = simple.privilege ?? {}
  if (simple.hr) qualities.push('flac24bit')
  if (simple.sq) qualities.push('flac')
  if (simple.h) qualities.push('320k')
  if (simple.l ?? simple.m) qualities.push('128k')
  return {
    platform: 'wy',
    songmid: id,
    songId: id,
    name,
    singer,
    artists: singers.filter(s => s.id && s.name).map(s => ({ id: String(s.id), name: String(s.name) })),
    albumName: text(album.name),
    albumId: text(album.id),
    interval: toSeconds(Number(simple.dt) / 1000),
    img: httpsUrl(text(album.picUrl)) || null,
    qualities: sortQualities(qualities.length ? qualities : ['128k']),
  }
}

/** 歌单 / 新歌里的曲目结构（artists + album + duration）与排行榜一致 */
function mapTrack(item: Record<string, any>): Song | null {
  const id = text(item?.id)
  const name = text(item?.name)
  if (!id || !name) return null
  const singers: any[] = Array.isArray(item.artists) ? item.artists : Array.isArray(item.ar) ? item.ar : []
  const album = item.album ?? item.al ?? {}
  return {
    platform: 'wy',
    songmid: id,
    songId: id,
    name,
    singer: singers.map((s) => text(s.name)).filter(Boolean).join('、'),
    artists: singers.filter(s => s.id && s.name).map(s => ({ id: String(s.id), name: String(s.name) })),
    albumName: text(album.name),
    albumId: text(album.id),
    interval: toSeconds(Number(item.duration ?? item.dt) / 1000),
    img: httpsUrl(text(album.picUrl ?? album.blurPicUrl)) || null,
    qualities: ['320k', '128k'],
  }
}

export const wyProvider: Provider = {
  id: 'wy',
  async album(id) {
    if (!/^\d{1,20}$/.test(id)) throw new Error('专辑 ID 不合法')
    const response = await request('https://music.163.com/api/v1/album/' + id, { headers: HEADERS, timeoutMs: 12000 })
    const data = response.json
    if (data?.code !== 200 || !Array.isArray(data.songs)) throw new Error('专辑暂不可用')
    return { id: 'wy-' + id, name: text(data.album?.name), singer: text(data.album?.artist?.name), cover: httpsUrl(text(data.album?.picUrl)), songs: data.songs.map(mapTrack).filter((song: Song | null): song is Song => !!song) }
  },
  async singerSongs(id, page, limit) {
    if (!/^\d{1,20}$/.test(id)) throw new Error('歌手 ID 不合法')
    const response = await request('https://music.163.com/api/v1/artist/songs?'+new URLSearchParams({ id, offset: String((page - 1) * limit), limit: String(limit), order: 'hot', work_type: '1' }), { headers: HEADERS, timeoutMs: 12000 })
    const data = response.json
    if (data?.code !== 200 || !Array.isArray(data.songs)) throw new Error('歌手作品暂不可用')
    const songs = data.songs.map(mapTrack).filter((song: Song | null): song is Song => !!song)
    const artist = songs.flatMap((song: Song) => song.artists ?? []).find((s: any) => s.id === id)
    return { singer: { id: 'wy-' + id, platform: 'wy', name: artist?.name ?? '' }, songs, total: Number(data.total ?? songs.length), hasMore: Boolean(data.more) }
  },

  async search(keyword: string, page: number, limit: number): Promise<SearchResult> {
    const p = clampPage(page)
    const size = clampLimit(limit, 30, 50)
    const json = await eapi('/api/search/song/list/page', {
      keyword,
      needCorrect: '1',
      channel: 'typing',
      offset: size * (p - 1),
      scene: 'normal',
      total: p === 1,
      limit: size,
    })
    if (!json || json.code !== 200) throw new Error('网易云搜索失败')
    const resources: Record<string, any>[] = Array.isArray(json.data?.resources) ? json.data.resources : []
    const list = resources.map(mapSong).filter((s): s is Song => !!s)
    const total = Number(json.data?.totalCount ?? list.length) || list.length
    return { platform: 'wy', list, total, page: p, limit: size, hasMore: p * size < total }
  },

  async lyric(song: Song): Promise<LyricResult> {
    const url =
      'https://music.163.com/api/song/lyric?id=' +
      encodeURIComponent(song.songmid) +
      '&lv=1&kv=1&tv=-1'
    const res = await request(url, { headers: HEADERS, timeoutMs: 12000 })
    const json = res.json
    if (!json || json.code !== 200) throw new Error('暂无歌词')
    const lyric = text(json.lrc?.lyric)
    const tlyric = text(json.tlyric?.lyric)
    if (!lyric) throw new Error('暂无歌词')
    return { lyric: normalizeLrc(lyric), tlyric: normalizeLrc(tlyric) }
  },
  async charts(): Promise<ChartInfo[]> {
    const res = await request('https://music.163.com/api/toplist', { headers: HEADERS, timeoutMs: 10000 })
    const raw: Record<string, any>[] = Array.isArray(res.json?.list) ? res.json.list : []
    const list: ChartInfo[] = []
    for (const item of raw) {
      const id = Number(item.id)
      const name = text(item.name)
      if (!id || !name) continue
      list.push({ id: 'wy-' + id, name, platform: 'wy', cover: httpsUrl(text(item.coverImgUrl)) || undefined })
      if (list.length >= 12) break
    }
    return list
  },

  async chartSongs(chartId: string, page: number, limit: number): Promise<SearchResult> {
    const id = chartId.replace(/^wy-/, '')
    const p = clampPage(page)
    const size = clampLimit(limit, 60, 120)
    const res = await request('https://music.163.com/api/playlist/detail?id=' + encodeURIComponent(id), {
      headers: HEADERS,
      timeoutMs: 12000,
    })
    const tracks: Record<string, any>[] = Array.isArray(res.json?.result?.tracks) ? res.json.result.tracks : []
    const all: Song[] = tracks.map(mapTrack).filter((song): song is Song => !!song)
    const list = all.slice((p - 1) * size, p * size)
    return { platform: 'wy', list, total: all.length, page: p, limit: size, hasMore: p * size < all.length }
  },

  async playlists(page: number, limit: number): Promise<PlaylistInfo[]> {
    const p = clampPage(page)
    const size = clampLimit(limit, 18, 60)
    const res = await request(
      'https://music.163.com/api/personalized/playlist?limit=' + size + '&offset=' + (p - 1) * size,
      { headers: HEADERS, timeoutMs: 12000 },
    )
    const raw: Record<string, any>[] = Array.isArray(res.json?.result) ? res.json.result : []
    const list: PlaylistInfo[] = []
    for (const item of raw) {
      const id = text(item.id)
      const name = text(item.name)
      if (!id || !name) continue
      list.push({
        id: 'wy-' + id,
        platform: 'wy',
        name,
        cover: httpsUrl(text(item.picUrl)) || undefined,
        playCount: Number(item.playCount) || 0,
        trackCount: Number(item.trackCount) || 0,
      })
    }
    return list
  },

  async playlistSongs(playlistId: string) {
    const id = playlistId.replace(/^wy-/, '')
    const res = await request('https://music.163.com/api/v6/playlist/detail?id=' + encodeURIComponent(id) + '&n=1000', {
      headers: HEADERS,
      timeoutMs: 15000,
    })
    const playlist = res.json?.playlist
    if (!playlist) throw new Error('歌单不存在或已下架')

    // v6 接口只回传前 10 首，其余曲目按 trackIds 补齐
    const trackIds: string[] = Array.isArray(playlist.trackIds)
      ? playlist.trackIds.map((item: any) => text(item?.id)).filter(Boolean)
      : []
    const byId = new Map<string, Record<string, any>>()
    for (const track of Array.isArray(playlist.tracks) ? playlist.tracks : []) {
      const trackId = text(track?.id)
      if (trackId) byId.set(trackId, track)
    }
    const missing = trackIds.filter((trackId) => !byId.has(trackId))
    for (let i = 0; i < missing.length; i += 100) {
      try {
        const batch = missing.slice(i, i + 100)
        const detail = await request('https://music.163.com/api/song/detail?ids=[' + batch.join(',') + ']', {
          headers: HEADERS,
          timeoutMs: 15000,
        })
        for (const song of Array.isArray(detail.json?.songs) ? detail.json.songs : []) {
          const songId = text(song?.id)
          if (songId) byId.set(songId, song)
        }
      } catch {
        /* 部分曲目取不到不影响其余歌曲 */
      }
    }
    const ordered = trackIds.length
      ? trackIds.map((trackId) => byId.get(trackId)).filter((track): track is Record<string, any> => !!track)
      : Array.from(byId.values())
    const songs: Song[] = ordered.map(mapTrack).filter((song): song is Song => !!song)
    return {
      playlist: {
        id: 'wy-' + id,
        platform: 'wy' as const,
        name: text(playlist.name),
        cover: httpsUrl(text(playlist.coverImgUrl)) || undefined,
        description: text(playlist.description).replace(/\s+/g, ' ').slice(0, 240),
        creator: text(playlist.creator?.nickname),
        tags: Array.isArray(playlist.tags) ? playlist.tags.map((tag: any) => text(tag)).filter(Boolean) : [],
        playCount: Number(playlist.playCount) || 0,
        trackCount: Number(playlist.trackCount) || songs.length,
      },
      songs,
    }
  },

  async newSongs(limit: number): Promise<Song[]> {
    const size = clampLimit(limit, 12, 30)
    const res = await request(
      'https://music.163.com/api/personalized/newsong?type=recommend&limit=' + size,
      { headers: HEADERS, timeoutMs: 12000 },
    )
    const raw: Record<string, any>[] = Array.isArray(res.json?.result) ? res.json.result : []
    return raw.map((item) => mapTrack(item?.song ?? item)).filter((song): song is Song => !!song)
  },
}
