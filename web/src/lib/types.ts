export type Platform = 'kw' | 'kg' | 'tx' | 'wy' | 'mg'
export type Quality = '128k' | '320k' | 'flac' | 'flac24bit'
export type RepeatMode = 'off' | 'all' | 'one'

export const PLATFORM_NAMES: Record<Platform, string> = {
  kw: '酷我',
  kg: '酷狗',
  tx: 'QQ',
  wy: '网易云',
  mg: '咪咕',
}

export const PLATFORM_FULL_NAMES: Record<Platform, string> = {
  kw: '酷我音乐',
  kg: '酷狗音乐',
  tx: 'QQ 音乐',
  wy: '网易云音乐',
  mg: '咪咕音乐',
}

export const PLATFORMS: Platform[] = ['kw', 'kg', 'tx', 'wy', 'mg']

export const ROLE_NAMES: Record<UserRole, string> = {
  admin: '管理员',
  vip: '会员',
  user: '普通用户',
}

export const AUDIENCE_NAMES: Record<Audience, string> = {
  guest: '游客',
  user: '普通用户',
  vip: '会员',
  admin: '管理员',
}

export const QUALITY_NAMES: Record<Quality, string> = {
  '128k': '标准',
  '320k': '高品质',
  flac: '无损',
  flac24bit: 'Hi-Res',
}

export interface Song {
  artists?: { id: string; name: string }[]
  platform: Platform
  songmid: string
  name: string
  singer: string
  albumName: string
  interval: number
  img?: string | null
  qualities: Quality[]
  hash?: string
  albumId?: string
  albumMid?: string
  strMediaMid?: string
  copyrightId?: string
  songId?: string
  lrcUrl?: string
}

export interface SearchResult {
  platform: Platform
  list: Song[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

export interface Playlist {
  id: string
  name: string
  description: string
  songs: Song[]
  createdAt: number
  updatedAt: number
}

export interface FavoriteEntry {
  song: Song
  addedAt: number
}

export interface AdminFavorites {
  user: AdminUser
  favorites: FavoriteEntry[]
  total: number
  totalFavorites: number
  page: number
  limit: number
  hasMore: boolean
}

export interface HistoryEntry {
  song: Song
  playedAt: number
}

export interface LibraryData {
  favoriteSingers?: SingerInfo[]
  favorites: FavoriteEntry[]
  playlists: Playlist[]
  history: HistoryEntry[]
  settings: Record<string, unknown>
  updatedAt?: number
}

export interface User {
  id: string
  username: string
  nickname: string
  avatarColor: string
  role: UserRole
  status: 'active' | 'disabled'
  createdAt: number
  lastLoginAt?: number | null
}

export interface SourceInfo {
  id: string
  kind: 'builtin' | 'custom'
  name: string
  url?: string
  enabled: boolean
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  meta: { name?: string; version?: string; author?: string; description?: string; homepage?: string }
  platforms: { platform: Platform; platformName: string; actions: string[]; qualitys: Quality[] }[]
  updatedAt?: number
  stats: { ok: number; fail: number; lastError?: string; lastOkAt?: number }
}

export interface LyricResult {
  lyric: string
  tlyric?: string
  lxlyric?: string
}

export interface ChartInfo {
  id: string
  name: string
  platform: Platform
  cover?: string
}

/** 平台公开歌单（歌单广场 / 推荐歌单） */
export interface PlaylistInfo {
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

export interface PlaylistDetailResult {
  playlist: PlaylistInfo
  songs: Song[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

/** 热门歌手 */
export interface SingerInfo {
  id: string
  platform: Platform
  name: string
  pic?: string | null
  followers?: number
  area?: string
}

export type Audience = 'guest' | 'user' | 'vip' | 'admin'
export type UserRole = 'admin' | 'vip' | 'user'

export interface DownloadConfig {
  enabled: boolean
  roles: Audience[]
  qualities: Quality[]
}

export interface AudiencePolicy {
  playbackEnabled: boolean
  playbackQualities: Quality[]
  downloadEnabled: boolean
  downloadQualities: Quality[]
  dailyDownloads: number | null
  monthlyDownloads: number | null
  dailyBytes: number | null
  monthlyBytes: number | null
}

export interface MembershipConfig {
  enabled: boolean
  audiences: Record<'guest' | 'user' | 'vip', AudiencePolicy>
}

export interface AccessInfo extends AudiencePolicy {
  audience: Audience
  usage: {
    day: { downloads: number; bytes: number }
    month: { downloads: number; bytes: number }
    dayKey: string
    monthKey: string
    timezone: string
  }
}

export interface CacheConfig {
  enabled: boolean
  /** 服务端缓存总大小（字节） */
  maxBytes: number
  /** 收藏 / 歌单自动缓存 */
  warmCollections: boolean
  /** 兼容字段，固定为全部音质 */
  qualities: Quality[]
}

export interface CacheStats {
  enabled: boolean
  count: number
  bytes: number
  maxBytes: number
  dir: string
  warming: number
  lyricCount: number
  lyricBytes: number
}

export interface AppConfig {
  platforms: { id: Platform; name: string; available: boolean }[]
  qualities: Quality[]
  allowRegister: boolean
  download: DownloadConfig
  membership?: MembershipConfig
  access?: AccessInfo
}

export type DeviceScope = 'search' | 'playback' | 'download' | 'lyrics' | 'library'
export interface DeviceApiConfig {
  enabled: boolean
  roles: UserRole[]
  requestsPerMinute: number
}
export interface DeviceAccess {
  enabled: boolean
  authorized: boolean
  allowed: boolean
  mode: 'inherit' | 'allow' | 'deny'
  requestsPerMinute: number
}
export interface DeviceKey {
  id: string
  name: string
  prefix: string
  scopes: DeviceScope[]
  createdAt: number
  expiresAt: number | null
  lastUsedAt: number | null
}
export interface DeviceApiStatus { access: DeviceAccess; keys: DeviceKey[] }

export interface RegistrationConfig {
  enabled: boolean
}

export interface DownloadResult {
  url: string
  quality: Quality
  filename: string
  sourceName: string
  platform: Platform
}

export interface AdminUser {
  id: string
  username: string
  nickname: string
  role: UserRole
  status: 'active' | 'disabled'
  avatarColor: string
  createdAt: number
  lastLoginAt: number | null
  lastLoginIp?: string | null
  playlists: number
  favorites: number
  history: number
  sessions: number
}

export interface AdminUserList {
  users: AdminUser[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

export interface AuditEntry {
  id: number
  userId: string | null
  username: string | null
  action: string
  detail: string | null
  ip: string | null
  createdAt: number
}

export interface AdminOverview {
  stats: {
    users: number
    admins: number
    disabledUsers: number
    sessions: number
    playlists: number
    favorites: number
    history: number
    newUsersToday: number
    playsToday: number
    favoritesToday: number
    loginsToday: number
  }
  series: { date: string; label: string; count: number }[]
  platforms: { platform: string; count: number }[]
  topSingers: { singer: string; count: number }[]
  recentUsers: { id: string; username: string; nickname: string; role: UserRole; status: string; createdAt: number }[]
  database: { file: string; bytes: number; walBytes: number; tables: { name: string; rows: number }[] }
  sources: { total: number; ready: number }
  audit: AuditEntry[]
  generatedAt: number
}

export interface UrlResult {
  playUrl: string
  quality: Quality
  platform: Platform
  sourceId: string
  sourceName: string
}

export function songKey(song: Pick<Song, 'platform' | 'songmid'>): string {
  return song.platform + '_' + song.songmid
}

export function sameSong(a: Song | null, b: Song | null): boolean {
  return !!a && !!b && a.platform === b.platform && a.songmid === b.songmid
}
export interface AdminPlaylistSummary {
  id: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
  songCount: number
}
