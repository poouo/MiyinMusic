import { HttpError } from './errors.js'
import { getPlaylist } from './discover.js'
import type { PlaylistDetail, Song } from './types.js'

const hosts = new Set(['y.qq.com', 'i.y.qq.com', 'i2.y.qq.com', 'c.y.qq.com', 'music.qq.com', 'music.163.com', 'y.music.163.com', 'm.music.163.com', '163cn.tv'])
export function allowedPlaylistUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new HttpError(400, '歌单链接格式不正确') }
  if (!hosts.has(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) {
    throw new HttpError(400, '只支持 QQ 音乐与网易云的官方歌单链接')
  }
  url.protocol = 'https:'; url.port = ''
  return url
}
export function playlistIdFromUrl(url: URL): string | null {
  allowedPlaylistUrl(url.href)
  const params = new URLSearchParams([url.search.slice(1), url.hash.replace(/^#\/?[^?]*\?/, '').replace(/^#/, '')].join('&'))
  const qq = url.hostname.endsWith('qq.com')
  const route = url.pathname + url.hash
  const id = qq ? params.get('disstid') ?? params.get('dissid') ?? params.get('playlistid') ?? /\/(?:playlist|taoge)\/(\d+)/.exec(route)?.[1] ?? (/playlist|taoge/.test(route) ? params.get('id') : null)
    : /playlist/.test(route) ? params.get('id') ?? /\/playlist\/(\d+)/.exec(route)?.[1] : null
  return id && /^\d{1,20}$/.test(id) ? (qq ? 'tx-' : 'wy-') + id : null
}
export async function resolvePlaylistLink(text: string, fetcher: typeof fetch = fetch): Promise<string> {
  const match = text.replace(/&amp;/g, '&').match(/https?:\/\/[^\s<>"，。！【】「」『』（）()“”]+/i)
  if (!match) throw new HttpError(400, '请粘贴 QQ 音乐或网易云的歌单分享链接')
  let url = allowedPlaylistUrl(match[0])
  const signal = AbortSignal.timeout(12000)
  for (let hop = 0; hop < 6; hop++) {
    const id = playlistIdFromUrl(url)
    if (id) return id
    const response = await fetcher(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'Mozilla/5.0' } })
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) break
    url = allowedPlaylistUrl(new URL(location, url).href)
  }
  throw new HttpError(400, '没有找到公开歌单，请使用歌单页面的分享链接')
}
export async function fullPlaylist(id: string, read = getPlaylist): Promise<PlaylistDetail> {
  if (!/^(tx|wy)-[\w-]{1,100}$/.test(id)) throw new HttpError(400, '暂只支持 QQ 音乐与网易云公开歌单')
  const songs = new Map<string, Song>()
  let offset = 0
  for (let page = 0; page < 8; page++) {
    const detail = await read(id, { offset, limit: 300 })
    if (detail.total > 2000 || offset + detail.songs.length > 2000) throw new HttpError(400, '每张歌单最多保存 2000 首，请先拆分歌单')
    for (const song of detail.songs) songs.set(song.platform + '_' + song.songmid, song)
    offset += detail.songs.length
    if (!detail.hasMore) {
      if (!songs.size) throw new HttpError(400, '歌单为空、私有或暂时无法读取')
      if (offset < detail.total) throw new HttpError(502, '歌单读取不完整，请稍后重试')
      return { ...detail, songs: [...songs.values()], offset: 0, total: songs.size, hasMore: false }
    }
    if (!detail.songs.length) break
  }
  throw new HttpError(502, '歌单读取不完整，未保存任何歌曲')
}
