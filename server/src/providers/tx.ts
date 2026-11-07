import crypto from 'node:crypto'
import { request } from '../http-client.js'
import { decodeHtmlEntities } from '../http-client.js'
import type { LyricResult, PlaylistInfo, Quality, SearchResult, SingerInfo, Song } from '../types.js'
import type { ChartInfo, Provider } from './types.js'
import { clampLimit, clampPage, normalizeLrc, sortQualities, text, toSeconds } from './util.js'

const PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19]
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5]
const SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179]
const SEARCH_URL = 'https://u.y.qq.com/cgi-bin/musics.fcg'

function zzcSign(input: string): string {
  const hash = crypto.createHash('sha1').update(input).digest('hex')
  const part1 = PART_1_INDEXES.map((i) => hash[i]).join('')
  const part2 = PART_2_INDEXES.map((i) => hash[i]).join('')
  const bytes = SCRAMBLE_VALUES.map((v, i) => v ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16))
  const part3 = Buffer.from(bytes).toString('base64').replace(/[\/+=]/g, '')
  return ('zzc' + part1 + part3 + part2).toLowerCase()
}

function randomGuid(): string {
  let out = ''
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16)
  return out.toUpperCase()
}

function searchId(): string {
  return randomGuid() + String(Math.floor(Math.random() * 100000)).padStart(5, '0')
}

function cover(albumMid: string, singerMid: string): string | null {
  if (albumMid) return 'https://y.gtimg.cn/music/photo_new/T002R500x500M000' + albumMid + '.jpg'
  if (singerMid) return 'https://y.gtimg.cn/music/photo_new/T001R500x500M000' + singerMid + '.jpg'
  return null
}

function mapSong(item: Record<string, any>): Song | null {
  const file = item.file ?? {}
  const mediaMid = text(file.media_mid)
  const mid = text(item.mid)
  if (!mid || !mediaMid) return null
  const name = text(item.title ?? item.name)
  if (!name) return null
  const singers: any[] = Array.isArray(item.singer) ? item.singer : []
  const singer = singers.map((s) => text(s.name)).filter(Boolean).join('、')
  const albumMid = text(item.album?.mid)
  const qualities: Quality[] = []
  if (Number(file.size_128mp3) > 0) qualities.push('128k')
  if (Number(file.size_320mp3) > 0) qualities.push('320k')
  if (Number(file.size_flac) > 0) qualities.push('flac')
  if (Number(file.size_hires) > 0) qualities.push('flac24bit')
  return {
    platform: 'tx',
    songmid: mid,
    name,
    singer,
    albumName: text(item.album?.name),
    albumId: albumMid,
    albumMid,
    strMediaMid: mediaMid,
    interval: toSeconds(item.interval),
    img: cover(albumMid, text(singers[0]?.mid)),
    qualities: qualities.length ? qualities : ['128k'],
  }
}

/** 老版歌单 / 新歌接口里的曲目结构 */
function mapLegacySong(raw: Record<string, any>): Song | null {
  const mid = text(raw?.songmid)
  const name = text(raw?.songname) || text(raw?.songorig)
  if (!mid || !name) return null
  const singers: any[] = Array.isArray(raw.singer) ? raw.singer : []
  const albumMid = text(raw.albummid)
  const qualities: Quality[] = []
  if (Number(raw.size128) > 0) qualities.push('128k')
  if (Number(raw.size320) > 0) qualities.push('320k')
  if (Number(raw.sizeflac) > 0) qualities.push('flac')
  if (Number(raw.sizehires) > 0) qualities.push('flac24bit')
  return {
    platform: 'tx',
    songmid: mid,
    name,
    singer: singers.map((s) => text(s.name)).filter(Boolean).join('、'),
    albumName: text(raw.albumname),
    albumId: albumMid,
    albumMid,
    strMediaMid: text(raw.strMediaMid) || undefined,
    interval: toSeconds(raw.interval),
    img: cover(albumMid, text(singers[0]?.mid)),
    qualities: sortQualities(qualities.length ? qualities : ['128k']),
  }
}

/** 音乐接口统一走 musicu.fcg */
async function musicu(payload: Record<string, unknown>, timeoutMs = 12000): Promise<any> {
  const res = await request('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://y.qq.com/' },
    body: JSON.stringify({ comm: { ct: 24, cv: 0 }, ...payload }),
    timeoutMs,
  })
  return res.json
}

export const txProvider: Provider = {
  id: 'tx',

  async search(keyword: string, page: number, limit: number): Promise<SearchResult> {
    const p = clampPage(page)
    const size = clampLimit(limit, 30, 50)
    const payload = {
      comm: {
        _channelid: '0',
        _os_version: '6.2.9200-2',
        ct: '19',
        cv: '2151',
        guid: randomGuid(),
        patch: '118',
        psrf_access_token_expiresAt: 0,
        psrf_qqaccess_token: '',
        psrf_qqopenid: '',
        psrf_qqunionid: '',
        tmeAppID: 'qqmusic',
        tmeLoginType: 0,
        uin: '0',
        wid: randomGuid(),
      },
      'music.search.SearchCgiService': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          grp: 1,
          num_per_page: size,
          page_num: p,
          query: keyword,
          remoteplace: 'txt.newclient.top',
          search_type: 0,
          searchid: searchId(),
        },
      },
    }
    const body = JSON.stringify(payload)
    const sign = zzcSign(body)
    const res = await request(SEARCH_URL + '?sign=' + sign, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'QQMusic 14090508(android 12)' },
      body,
      timeoutMs: 12000,
    })
    const json = res.json
    const req = json?.['music.search.SearchCgiService'] ?? json?.req
    if (!json || json.code !== 0 || !req || req.code !== 0) throw new Error('QQ 音乐搜索失败')
    const data = req.data?.body ?? req.data ?? {}
    const rawList: Record<string, any>[] = Array.isArray(data.song?.list) ? data.song.list : []
    const list = rawList.map(mapSong).filter((s): s is Song => !!s)
    const total = Number(data.song?.totalnum ?? data.meta?.sum ?? list.length) || list.length
    return { platform: 'tx', list, total, page: p, limit: size, hasMore: p * size < total }
  },

  async lyric(song: Song): Promise<LyricResult> {
    const url =
      'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=' +
      encodeURIComponent(song.songmid) +
      '&format=json&nobase64=1&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0'
    const res = await request(url, {
      headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' },
      timeoutMs: 12000,
    })
    const json = res.json
    if (!json || Number(json.retcode) !== 0) throw new Error('暂无歌词')
    const lyric = text(json.lyric)
    const tlyric = text(json.trans)
    if (!lyric) throw new Error('暂无歌词')
    return { lyric: normalizeLrc(lyric), tlyric: normalizeLrc(tlyric) }
  },
  async charts(): Promise<ChartInfo[]> {
    const res = await request('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://y.qq.com/' },
      body: JSON.stringify({ req_0: { module: 'musicToplist.ToplistInfoServer', method: 'GetAll', param: {} } }),
      timeoutMs: 12000,
    })
    const groups: Record<string, any>[] = Array.isArray(res.json?.req_0?.data?.group) ? res.json.req_0.data.group : []
    const list: ChartInfo[] = []
    for (const group of groups) {
      const items: Record<string, any>[] = Array.isArray(group.toplist) ? group.toplist : []
      for (const item of items) {
        const topId = Number(item.topId)
        const name = text(item.title)
        if (!topId || !name) continue
        list.push({ id: 'tx-' + topId, name, platform: 'tx', cover: text(item.frontPicUrl) || undefined })
        if (list.length >= 16) return list
      }
    }
    return list
  },

  async chartSongs(chartId: string, page: number, limit: number): Promise<SearchResult> {
    const topId = Number(chartId.replace(/^tx-/, ''))
    const p = clampPage(page)
    const size = clampLimit(limit, 60, 100)
    const res = await request('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://y.qq.com/' },
      body: JSON.stringify({
        req_0: {
          module: 'musicToplist.ToplistInfoServer',
          method: 'GetDetail',
          param: { topId, offset: (p - 1) * size, num: size },
        },
      }),
      timeoutMs: 12000,
    })
    const raw: Record<string, any>[] = Array.isArray(res.json?.req_0?.data?.songInfoList)
      ? res.json.req_0.data.songInfoList
      : []
    const list = raw.map((item) => mapSong(item)).filter((song): song is Song => !!song)
    const total = Number(res.json?.req_0?.data?.totalNum ?? list.length) || list.length
    return { platform: 'tx', list, total, page: p, limit: size, hasMore: p * size < total }
  },

  async playlists(page: number, limit: number): Promise<PlaylistInfo[]> {
    const p = clampPage(page)
    const size = clampLimit(limit, 18, 60)
    const json = await musicu({
      req_1: {
        module: 'music.playlist.PlaylistSquare',
        method: 'GetRecommendFeed',
        param: { from: (p - 1) * size, size, withsong: 0, withtags: 1, withsort: 0 },
      },
    })
    const raw: Record<string, any>[] = Array.isArray(json?.req_1?.data?.List) ? json.req_1.data.List : []
    const list: PlaylistInfo[] = []
    for (const item of raw) {
      const basic = item?.Playlist?.basic ?? {}
      const tid = text(basic.tid ?? basic.content_id)
      const name = text(basic.title)
      if (!tid || !name) continue
      const coverInfo = basic.cover ?? {}
      list.push({
        id: 'tx-' + tid,
        platform: 'tx',
        name,
        cover: text(coverInfo.medium_url || coverInfo.small_url || coverInfo.big_url) || undefined,
        description: text(basic.desc).replace(/\s+/g, ' ').slice(0, 200),
        creator: text(basic.creator?.nick),
        tags: Array.isArray(basic.v_tag)
          ? basic.v_tag.map((tag: any) => text(tag?.name)).filter(Boolean).slice(0, 3)
          : [],
        playCount: Number(basic.play_cnt) || 0,
        trackCount: Number(basic.song_cnt) || 0,
      })
    }
    return list
  },

  async playlistSongs(playlistId: string) {
    const id = playlistId.replace(/^tx-/, '')
    const url =
      'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=' +
      encodeURIComponent(id) +
      '&format=json&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0'
    const res = await request(url, { headers: { Referer: 'https://y.qq.com/' }, timeoutMs: 15000 })
    const cd = res.json?.cdlist?.[0]
    if (!cd) throw new Error('歌单不存在或已下架')
    const raw: Record<string, any>[] = Array.isArray(cd.songlist) ? cd.songlist : []
    const songs = raw.map(mapLegacySong).filter((song): song is Song => !!song)
    const description = decodeHtmlEntities(text(cd.desc))
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240)
    return {
      playlist: {
        id: 'tx-' + id,
        platform: 'tx' as const,
        name: text(cd.dissname),
        cover: text(cd.logo) || undefined,
        description,
        creator: text(cd.nick) || text(cd.nickname),
        tags: Array.isArray(cd.tags) ? cd.tags.map((tag: any) => text(tag?.name ?? tag)).filter(Boolean).slice(0, 3) : [],
        playCount: Number(cd.visitnum) || 0,
        trackCount: Number(cd.total_song_num ?? cd.songnum) || songs.length,
      },
      songs,
    }
  },

  async newSongs(limit: number): Promise<Song[]> {
    const size = clampLimit(limit, 12, 30)
    const url =
      'https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?topid=27&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&tpl=3&page=detail&type=top&song_begin=0&song_num=' +
      size
    const res = await request(url, { headers: { Referer: 'https://y.qq.com/' }, timeoutMs: 12000 })
    const raw: Record<string, any>[] = Array.isArray(res.json?.songlist) ? res.json.songlist : []
    return raw.map((item) => mapLegacySong(item?.data ?? item)).filter((song): song is Song => !!song)
  },

  async singers(limit: number): Promise<SingerInfo[]> {
    const size = clampLimit(limit, 12, 30)
    const json = await musicu({
      singerList: {
        module: 'music.musichallSinger.SingerList',
        method: 'GetSingerList',
        param: { area: -100, sex: -100, genre: -100, index: 1, sin: 0, cur_page: 1 },
      },
    })
    const hot: Record<string, any>[] = Array.isArray(json?.singerList?.data?.hotlist)
      ? json.singerList.data.hotlist
      : []
    const areaNames: Record<number, string> = { 1: '华语', 2: '欧美', 3: '日本', 4: '韩国', 5: '其他' }
    const list: SingerInfo[] = []
    for (const item of hot) {
      const mid = text(item.singer_mid)
      const name = text(item.singer_name)
      if (!mid || !name) continue
      list.push({
        id: mid,
        platform: 'tx',
        name,
        pic: text(item.singer_pic) || 'https://y.gtimg.cn/music/photo_new/T001R500x500M000' + mid + '.jpg',
        followers: Number(item.concernNum) || 0,
        area: areaNames[Number(item.area_id)] || undefined,
      })
      if (list.length >= size) break
    }
    return list
  },
}
