import zlib from 'node:zlib'
import { request } from '../http-client.js'
import type { LyricResult, Platform, Quality, SearchResult, Song } from '../types.js'
import type { ChartInfo, Provider } from './types.js'
import { clampLimit, clampPage, normalizeLrc, parseKwMinfo, text, toSeconds } from './util.js'

const HEADERS = {
  Referer: 'http://www.kuwo.cn/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

const BOARDS: { id: string; name: string; bangid: string }[] = [
  { id: 'kw-93', name: '飙升榜', bangid: '93' },
  { id: 'kw-16', name: '热歌榜', bangid: '16' },
  { id: 'kw-17', name: '新歌榜', bangid: '17' },
  { id: 'kw-158', name: '抖音热歌榜', bangid: '158' },
  { id: 'kw-104', name: '华语榜', bangid: '104' },
  { id: 'kw-182', name: '粤语榜', bangid: '182' },
  { id: 'kw-22', name: '欧美榜', bangid: '22' },
  { id: 'kw-184', name: '韩语榜', bangid: '184' },
  { id: 'kw-183', name: '日语榜', bangid: '183' },
  { id: 'kw-26', name: '经典怀旧榜', bangid: '26' },
  { id: 'kw-187', name: '流行趋势榜', bangid: '187' },
  { id: 'kw-145', name: '会员畅听榜', bangid: '145' },
  { id: 'kw-242', name: '电音榜', bangid: '242' },
  { id: 'kw-186', name: 'ACG 神曲榜', bangid: '186' },
]

function decodeLyric(buffer: Buffer): string {
  const idx = buffer.indexOf('\r\n\r\n')
  const body = buffer.subarray(idx >= 0 ? idx + 4 : 0)
  let content = ''
  try {
    content = zlib.inflateSync(body).toString('utf8')
  } catch {
    content = body.toString('utf8')
  }
  if (!/^\[\d{1,2}:\d{1,2}/m.test(content)) {
    try {
      const decoded = Buffer.from(content.trim(), 'base64')
      const key = Buffer.from('yeelion')
      const out = Buffer.alloc(decoded.length)
      for (let i = 0; i < decoded.length; i++) out[i] = decoded[i] ^ key[i % key.length]
      const plain = out.toString('utf8')
      if (plain.includes('[')) content = plain
    } catch {
      /* 保持原样 */
    }
  }
  return content
}

function mapSong(raw: Record<string, any>, source: 'search' | 'chart'): Song | null {
  const rid = text(raw.MUSICRID ?? raw.id ?? raw.rid)
  const songmid = rid.replace(/^MUSIC_/, '')
  if (!songmid) return null
  const name = text(raw.SONGNAME ?? raw.NAME ?? raw.name)
  if (!name) return null
  const singer = text(raw.ARTIST ?? raw.FARTIST ?? raw.artist)
  const minfo = text(raw.N_MINFO ?? raw.n_minfo ?? raw.MINFO)
  const qualities: Quality[] = parseKwMinfo(minfo)
  const interval = source === 'chart' ? toSeconds(raw.song_duration ?? raw.duration) : toSeconds(raw.DURATION)
  return {
    platform: 'kw',
    songmid,
    name,
    singer: singer.replace(/&/g, '、'),
    albumName: text(raw.ALBUM ?? raw.album),
    albumId: text(raw.ALBUMID ?? raw.albumId ?? raw.albumid),
    interval,
    img: source === 'chart' ? normalizeCover(text(raw.pic)) : null,
    qualities: qualities.length ? qualities : ['128k'],
  }
}

function normalizeCover(url: string): string | null {
  if (!url) return null
  if (url.startsWith('//')) return 'https:' + url
  if (url.startsWith('http')) return url
  return 'https://img1.kuwo.cn/' + url.replace(/^\//, '')
}

export const kwProvider: Provider = {
  id: 'kw' as Platform,

  async search(keyword: string, page: number, limit: number): Promise<SearchResult> {
    const p = clampPage(page)
    const size = clampLimit(limit)
    const url =
      'http://search.kuwo.cn/r.s?client=kt&all=' +
      encodeURIComponent(keyword) +
      '&pn=' +
      (p - 1) +
      '&rn=' +
      size +
      '&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1' +
      '&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1'
    const res = await request(url, { headers: HEADERS, timeoutMs: 12000 })
    const json = res.json
    if (!json) return { platform: 'kw', list: [], total: 0, page: p, limit: size, hasMore: false }
    const rawList: Record<string, any>[] = Array.isArray(json.abslist) ? json.abslist : []
    const list = rawList.map((item) => mapSong(item, 'search')).filter((s): s is Song => !!s)
    const total = Number(json.TOTAL ?? 0) || list.length
    return { platform: 'kw', list, total, page: p, limit: size, hasMore: p * size < total }
  },

  async lyric(song: Song): Promise<LyricResult> {
    const url = 'http://mlyric.kuwo.cn/mobi.s?f=web&type=lyric&lrcx=0&rid=' + encodeURIComponent(song.songmid) + '&encode=utf8'
    const res = await request(url, { headers: HEADERS, timeoutMs: 12000, binary: true })
    if (res.status !== 200) throw new Error('获取歌词失败')
    const rawText = decodeLyric(res.buffer)
    if (!rawText.trim()) throw new Error('暂无歌词')
    return { lyric: normalizeLrc(rawText) }
  },

  async pic(song: Song): Promise<string | null> {
    const url =
      'http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=' +
      encodeURIComponent(song.songmid)
    const res = await request(url, { headers: HEADERS, timeoutMs: 8000 })
    const body = res.text.trim()
    return /^https?:\/\//.test(body) ? body : null
  },

  async charts(): Promise<ChartInfo[]> {
    return BOARDS.map((b) => ({ id: b.id, name: b.name, platform: 'kw' as Platform }))
  },

  async chartSongs(chartId: string, page: number, limit: number): Promise<SearchResult> {
    const board = BOARDS.find((b) => b.id === chartId)
    if (!board) throw new Error('榜单不存在')
    const p = clampPage(page)
    const size = clampLimit(limit, 60, 100)
    const url =
      'http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=' +
      (p - 1) +
      '&rn=' +
      size +
      '&type=bang&data=content&id=' +
      board.bangid +
      '&show_copyright_off=0&pcmp4=1&isbang=1'
    const res = await request(url, { headers: HEADERS, timeoutMs: 12000 })
    const json = res.json
    const rawList: Record<string, any>[] = Array.isArray(json?.musiclist) ? json.musiclist : []
    const list = rawList.map((item) => mapSong(item, 'chart')).filter((s): s is Song => !!s)
    return { platform: 'kw', list, total: Number(json?.total ?? list.length) || list.length, page: p, limit: size, hasMore: false }
  },
}
