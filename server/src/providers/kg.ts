import zlib from 'node:zlib'
import { request } from '../http-client.js'
import type { LyricResult, SearchResult, Song } from '../types.js'
import type { ChartInfo, Provider } from './types.js'
import { clampLimit, clampPage, decodeKrcContent, krcToLrc, normalizeLrc, sortQualities, text, toSeconds } from './util.js'
import type { Quality } from '../types.js'

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

const LYRIC_HEADERS = {
  'KG-RC': '1',
  'KG-THash': 'expand_search_manager.cpp:852736169:451',
  'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
}

function pickImage(raw: Record<string, any>): string | null {
  const url = text(raw.Image ?? raw.AlbumImage ?? raw.AlbumImageLarge)
  if (!url) return null
  return url.replace(/\{size\}/g, '400')
}

function mapSong(raw: Record<string, any>): Song | null {
  const songmid = text(raw.Audioid ?? raw.Audioid)
  const hash = text(raw.FileHash)
  if (!songmid || !hash) return null
  const name = text(raw.SongName ?? raw.OriSongName)
  if (!name) return null
  const qualities: Quality[] = []
  if (Number(raw.FileSize) > 0) qualities.push('128k')
  if (Number(raw.HQFileSize) > 0) qualities.push('320k')
  if (Number(raw.SQFileSize) > 0) qualities.push('flac')
  if (Number(raw.ResFileSize) > 0) qualities.push('flac24bit')
  const singers: any[] = Array.isArray(raw.Singers) ? raw.Singers : []
  const singer = singers.length
    ? singers.map((s) => text(s.name ?? s.singer)).filter(Boolean).join('、')
    : text(raw.SingerName)
  return {
    platform: 'kg',
    songmid,
    hash,
    name,
    singer,
    albumName: text(raw.AlbumName),
    albumId: text(raw.AlbumID),
    interval: toSeconds(raw.Duration ?? raw.HQDuration ?? raw.SQDuration),
    img: pickImage(raw),
    qualities: sortQualities(qualities.length ? qualities : ['128k']),
  }
}

export const kgProvider: Provider = {
  id: 'kg',

  async search(keyword: string, page: number, limit: number): Promise<SearchResult> {
    const p = clampPage(page)
    const size = clampLimit(limit)
    const url =
      'http://songsearch.kugou.com/song_search_v2?platform=AndroidFilter&iscorrection=1&keyword=' +
      encodeURIComponent(keyword) +
      '&hifiquality=0&pagesize=' +
      size +
      '&PrivilegeFilter=0&page=' +
      p
    const res = await request(url, { headers: HEADERS, timeoutMs: 12000 })
    const json = res.json
    if (!json || json.error_code !== 0) {
      throw new Error('酷狗搜索失败')
    }
    const rawLists: Record<string, any>[] = Array.isArray(json.data?.lists) ? json.data.lists : []
    const seen = new Set<string>()
    const list: Song[] = []
    const push = (raw: Record<string, any>) => {
      const key = text(raw.Audioid) + text(raw.FileHash)
      if (seen.has(key)) return
      seen.add(key)
      const song = mapSong(raw)
      if (song) list.push(song)
    }
    for (const raw of rawLists) {
      push(raw)
      if (Array.isArray(raw.Grp)) for (const child of raw.Grp) push(child)
    }
    const total = Number(json.data?.total ?? list.length) || list.length
    return { platform: 'kg', list, total, page: p, limit: size, hasMore: p * size < total }
  },

  async lyric(song: Song): Promise<LyricResult> {
    if (!song.hash) throw new Error('暂无歌词')
    const searchUrl =
      'http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=' +
      encodeURIComponent(song.name) +
      '&hash=' +
      encodeURIComponent(song.hash) +
      '&timelength=' +
      Math.round(song.interval * 1000) +
      '&lrctxt=1'
    const searchRes = await request(searchUrl, { headers: LYRIC_HEADERS, timeoutMs: 12000 })
    const candidates: Record<string, any>[] = Array.isArray(searchRes.json?.candidates) ? searchRes.json.candidates : []
    const candidate = candidates.find((c) => Number(c.krctype) === 1 || Number(c.contenttype) === 1) ?? candidates[0]
    if (!candidate) throw new Error('暂无歌词')
    const fmt = Number(candidate.krctype) === 1 && Number(candidate.contenttype) !== 1 ? 'krc' : 'lrc'
    const downloadUrl =
      'http://lyrics.kugou.com/download?ver=1&client=pc&id=' +
      candidate.id +
      '&accesskey=' +
      encodeURIComponent(String(candidate.accesskey)) +
      '&fmt=' +
      fmt +
      '&charset=utf8'
    const res = await request(downloadUrl, { headers: LYRIC_HEADERS, timeoutMs: 12000 })
    const content = text(res.json?.content)
    if (!content) throw new Error('暂无歌词')
    if (fmt === 'krc') {
      const krc = decodeKrcContent(content, (buf) => zlib.inflateSync(buf))
      const lrc = krcToLrc(krc)
      if (!lrc) throw new Error('暂无歌词')
      return { lyric: normalizeLrc(lrc) }
    }
    return { lyric: normalizeLrc(Buffer.from(content, 'base64').toString('utf8')) }
  },
  async charts(): Promise<ChartInfo[]> {
    const res = await request(
      'http://mobilecdn.kugou.com/api/v3/rank/list?version=9108&plat=0&page=1&pagesize=100&showtype=2',
      { headers: HEADERS, timeoutMs: 12000 },
    )
    const raw: Record<string, any>[] = Array.isArray(res.json?.data?.info) ? res.json.data.info : []
    const list: ChartInfo[] = []
    for (const item of raw) {
      const rankid = Number(item.rankid)
      const name = text(item.rankname)
      if (!rankid || !name) continue
      const cover = (text(item.imgurl) || text(item.album_img_9) || text(item.img_9) || '').replace(/{size}/g, '400')
      list.push({ id: 'kg-' + rankid, name, platform: 'kg', cover: cover || undefined })
      if (list.length >= 12) break
    }
    return list
  },

  async chartSongs(chartId: string, page: number, limit: number): Promise<SearchResult> {
    const rankid = chartId.replace(/^kg-/, '')
    const p = clampPage(page)
    const size = clampLimit(limit, 60, 100)
    const url =
      'http://mobilecdn.kugou.com/api/v3/rank/song?version=9108&rankid=' +
      encodeURIComponent(rankid) +
      '&page=' +
      p +
      '&pagesize=' +
      size +
      '&withsonginfo=1'
    const res = await request(url, { headers: HEADERS, timeoutMs: 12000 })
    const raw: Record<string, any>[] = Array.isArray(res.json?.data?.info) ? res.json.data.info : []
    const list: Song[] = []
    for (const item of raw) {
      const hash = text(item.hash)
      const songmid = text(item.audio_id ?? item.album_audio_id)
      const name = text(item.songname)
      if (!hash || !songmid || !name) continue
      const singers: any[] = Array.isArray(item.authors) ? item.authors : []
      const qualities: Quality[] = []
      if (Number(item.filesize) > 0) qualities.push('128k')
      if (Number(item['320filesize']) > 0) qualities.push('320k')
      if (Number(item.sqfilesize) > 0) qualities.push('flac')
      list.push({
        platform: 'kg',
        songmid,
        hash,
        name,
        singer: singers.map((s) => text(s.author_name)).filter(Boolean).join('、'),
        albumName: '',
        albumId: text(item.album_id),
        interval: toSeconds(item.duration),
        img: null,
        qualities: sortQualities(qualities.length ? qualities : ['128k']),
      })
    }
    const total = Number(res.json?.data?.total ?? list.length) || list.length
    return { platform: 'kg', list, total, page: p, limit: size, hasMore: p * size < total }
  },
}
