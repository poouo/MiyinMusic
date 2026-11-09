/** 平台标识，与洛雪音乐一致 */
export type Platform = 'kw' | 'kg' | 'tx' | 'wy' | 'mg'

/** 音质标识，与洛雪音乐一致 */
export type Quality = '128k' | '320k' | 'flac' | 'flac24bit'

export const PLATFORM_NAMES: Record<Platform, string> = {
  kw: '酷我音乐',
  kg: '酷狗音乐',
  tx: 'QQ音乐',
  wy: '网易云音乐',
  mg: '咪咕音乐',
}

export const PLATFORMS: Platform[] = ['kw', 'kg', 'tx', 'wy', 'mg']

export const QUALITIES: Quality[] = ['128k', '320k', 'flac', 'flac24bit']

/** 一首歌在平台上的最小描述，同时也是传给音源脚本的 musicInfo */
export interface Song {
  platform: Platform
  songmid: string
  name: string
  singer: string
  artists?: { id: string; name: string }[]
  albumName: string
  interval: number
  img?: string | null
  qualities: Quality[]
  /** 酷狗专用 */
  hash?: string
  /** 专辑 ID（酷我 / 酷狗 / QQ / 网易 / 咪咕） */
  albumId?: string
  /** QQ 音乐专辑 mid */
  albumMid?: string
  /** QQ 音乐 media_mid，取播放地址需要 */
  strMediaMid?: string
  /** 咪咕版权 ID */
  copyrightId?: string
  /** 咪咕歌词地址（播放时不参与，仅用于取歌词） */
  lrcUrl?: string
  /** 网易云 ID（数字） */
  songId?: string
}

export interface SearchResult {
  platform: Platform
  list: Song[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

/** 平台公开歌单（歌单广场 / 推荐歌单） */
export interface PlaylistInfo {
  /** 带平台前缀的 ID，例如 wy-171037362 / tx-8044204090 */
  id: string
  platform: Platform
  name: string
  cover?: string | null
  description?: string
  creator?: string
  tags?: string[]
  playCount?: number
  trackCount?: number
}

/** 公开歌单详情（分页后的结果） */
export interface PlaylistDetail {
  playlist: PlaylistInfo
  songs: Song[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

/** 歌手信息 */
export interface SingerInfo {
  /** QQ 音乐歌手中 mid */
  id: string
  platform: Platform
  name: string
  pic?: string | null
  followers?: number
  area?: string
}

export interface LyricResult {
  /** 原文歌词，LRC 文本 */
  lyric: string
  /** 翻译歌词，LRC 文本 */
  tlyric?: string
  /** 逐字歌词（扩展格式 <mm:ss.xxx,length>word），没有则为空 */
  lxlyric?: string
}

export interface MusicUrlResult {
  url: string
  quality: Quality
  sourceId: string
  sourceName: string
  platform: Platform
}

export function songKey(song: Pick<Song, 'platform' | 'songmid'>): string {
  return song.platform + '_' + song.songmid
}
