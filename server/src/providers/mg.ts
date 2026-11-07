import crypto from 'node:crypto'
import { request } from '../http-client.js'
import type { LyricResult, Quality, SearchResult, Song } from '../types.js'
import type { Provider } from './types.js'
import { clampLimit, clampPage, normalizeLrc, sortQualities, text, toSeconds } from './util.js'

const DEVICE_ID = '963B7AA0D21511ED807EE5846EC87D20'
const SIGN_SECRET = '6cdc72a439cef99a3418d2a78aa28c73'
const SIGN_SALT = 'yyapp2d16148780a1dcc7408e06336b98cfd50'
const IMAGE_HOST = 'https://d.musicapp.migu.cn'
const HEADERS = {
  uiVersion: 'A_music_3.6.1',
  channel: '0146921',
  'User-Agent':
    'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
}

function signature(timestamp: string, keyword: string): string {
  return crypto.createHash('md5').update(keyword + SIGN_SECRET + SIGN_SALT + DEVICE_ID + timestamp).digest('hex')
}

function imageUrl(raw: string): string | null {
  if (!raw) return null
  if (/^https?:\/\//.test(raw)) return raw
  return IMAGE_HOST + (raw.startsWith('/') ? raw : '/' + raw)
}

function mapSong(item: Record<string, any>): Song | null {
  const songmid = text(item.songId ?? item.id)
  const name = text(item.name ?? item.songName)
  if (!songmid || !name) return null
  const singers: any[] = Array.isArray(item.singerList) ? item.singerList : []
  const singer = singers.map((s) => text(s.name)).filter(Boolean).join('、')
  const formats: any[] = Array.isArray(item.audioFormats) ? item.audioFormats : []
  const qualities: Quality[] = []
  for (const format of formats) {
    switch (text(format.formatType).toUpperCase()) {
      case 'PQ':
        qualities.push('128k')
        break
      case 'HQ':
        qualities.push('320k')
        break
      case 'SQ':
        qualities.push('flac')
        break
      case 'ZQ':
        qualities.push('flac24bit')
        break
      default:
        break
    }
  }
  const album = Array.isArray(item.albums) && item.albums.length ? item.albums[0] : null
  return {
    platform: 'mg',
    songmid,
    songId: songmid,
    name,
    singer,
    albumName: text(item.album ?? album?.name),
    albumId: text(item.albumId ?? album?.id),
    copyrightId: text(item.copyrightId),
    interval: toSeconds(item.duration ?? item.interval),
    img: imageUrl(text(item.img1 ?? item.img2 ?? item.img3 ?? item.imgItems?.[0]?.img)),
    lrcUrl: text(item.lrcUrl) || undefined,
    qualities: sortQualities(qualities.length ? qualities : ['128k']),
  }
}

export const mgProvider: Provider = {
  id: 'mg',

  async search(keyword: string, page: number, limit: number): Promise<SearchResult> {
    const p = clampPage(page)
    const size = clampLimit(limit, 20, 40)
    const timestamp = Date.now().toString()
    const searchSwitch = JSON.stringify({
      song: 1,
      album: 0,
      singer: 0,
      tagSong: 1,
      mvSong: 0,
      bestShow: 1,
      songlist: 0,
      lyricSong: 0,
    })
    const url =
      'https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=' +
      encodeURIComponent(searchSwitch) +
      '&pageSize=' +
      size +
      '&text=' +
      encodeURIComponent(keyword) +
      '&pageNo=' +
      p +
      '&sort=0&sid=USS'
    const res = await request(url, {
      headers: {
        ...HEADERS,
        deviceId: DEVICE_ID,
        timestamp,
        sign: signature(timestamp, keyword),
      },
      timeoutMs: 12000,
    })
    const json = res.json
    if (!json || String(json.code) !== '000000') throw new Error('咪咕搜索失败')
    const groups: any[] = Array.isArray(json.songResultData?.resultList) ? json.songResultData.resultList : []
    const seen = new Set<string>()
    const list: Song[] = []
    for (const group of groups) {
      if (!Array.isArray(group)) continue
      for (const item of group) {
        const song = mapSong(item)
        if (!song || seen.has(song.songmid)) continue
        seen.add(song.songmid)
        list.push(song)
      }
    }
    const total = Number(json.resultNum ?? json.songResultData?.totalCount ?? list.length) || list.length
    return { platform: 'mg', list, total, page: p, limit: size, hasMore: p * size < total }
  },

  async lyric(song: Song): Promise<LyricResult> {
    const urls: string[] = []
    if (song.lrcUrl) urls.push(song.lrcUrl)
    urls.push('https://music.migu.cn/v3/api/music/audioPlayer/getLyric?songId=' + encodeURIComponent(song.songmid))
    let lastError: Error | null = null
    for (const url of urls) {
      try {
        const res = await request(url, {
          headers: { ...HEADERS, Referer: 'https://app.c.nf.migu.cn/' },
          timeoutMs: 10000,
        })
        let content = res.text
        if (res.json) content = text(res.json.lyric ?? res.json.data?.lyric ?? '')
        const lyric = normalizeLrc(String(content ?? ''))
        if (lyric) return { lyric }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }
    throw lastError ?? new Error('暂无歌词')
  },
}
