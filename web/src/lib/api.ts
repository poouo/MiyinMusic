import type {
  AdminOverview,
  AdminFavorites,
  AdminPlaylistSummary,
  Playlist,
  AdminUser,
  AdminUserList,
  AppConfig,
  AuditEntry,
  CacheConfig,
  CacheStats,
  ChartInfo,
  DownloadConfig,
  MembershipConfig,
  AccessInfo,
  DownloadResult,
  RegistrationConfig,
  LibraryData,
  LyricResult,
  PlaylistDetailResult,
  PlaylistInfo,
  SearchResult,
  SingerInfo,
  Song,
  SourceInfo,
  UrlResult,
  User,
  Quality,
  Platform,
  DeviceApiConfig,
  DeviceApiStatus,
  DeviceKey,
  XiaozhiStatus,
  DeviceScope,
  DeviceAccess,
} from './types'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

/** 请求总时限：服务端已经有上游超时，这里再兜一层，避免界面一直转圈 */
const REQUEST_TIMEOUT = 22000

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  let response: Response
  try {
    response = await fetch(path, { ...init, headers, credentials: 'same-origin', signal: controller.signal })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, '请求超时，请稍后重试')
    }
    throw new ApiError(0, '网络连接失败，请检查服务是否在运行')
  }
  clearTimeout(timer)
  const text = await response.text()
  let payload: any = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }
  if (!response.ok) {
    const message = payload?.error?.message ?? (text ? text.slice(0, 120) : '请求失败')
    throw new ApiError(response.status, message)
  }
  return payload as T
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? '?' + text : ''
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  config: () => request<AppConfig>('/api/config'),

  sources: () => request<{ sources: SourceInfo[] }>('/api/sources'),
  reorderSources: (ids: string[]) => request<{ sources: SourceInfo[] }>('/api/sources/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
  addSource: (body: { name?: string; url?: string; script?: string }) =>
    request<{ source: SourceInfo }>('/api/sources', { method: 'POST', body: JSON.stringify(body) }),
  updateSource: (id: string, body: { enabled: boolean }) =>
    request<{ source: SourceInfo }>('/api/sources/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  removeSource: (id: string) =>
    request<{ ok: boolean }>('/api/sources/' + encodeURIComponent(id), { method: 'DELETE' }),
  reloadSource: (id: string) =>
    request<{ source: SourceInfo }>('/api/sources/' + encodeURIComponent(id) + '/reload', { method: 'POST' }),

  search: (platform: Platform, q: string, page = 1, limit = 30) =>
    request<{ result: SearchResult }>('/api/search' + qs({ platform, q, page, limit })),

  charts: () => request<{ charts: ChartInfo[] }>('/api/charts'),
  chartSongs: (chartId: string, page = 1, limit = 60) =>
    request<{ result: SearchResult; chart?: { id: string; name: string; cover?: string } }>(
      '/api/charts/' + encodeURIComponent(chartId) + qs({ page, limit }),
    ),

  // ---- 发现页：推荐歌单 / 新歌 / 歌手 ----
  discoverPlaylists: (params: { page?: number; limit?: number; platform?: Platform | 'all' } = {}) =>
    request<{ playlists: PlaylistInfo[]; page: number; hasMore: boolean }>(
      '/api/discover/playlists' + qs({ page: params.page, limit: params.limit, platform: params.platform }),
    ),
  playlist: (id: string, params: { offset?: number; limit?: number } = {}) =>
    request<PlaylistDetailResult>('/api/playlist/' + encodeURIComponent(id) + qs({ offset: params.offset, limit: params.limit })),
  previewPlaylist: (body: { link?: string; id?: string }) => request<PlaylistDetailResult>('/api/playlists/preview', { method: 'POST', body: JSON.stringify(body) }),
  newSongs: (limit = 12) => request<{ songs: Song[] }>('/api/discover/new-songs' + qs({ limit })),
  singers: (limit = 12) => request<{ singers: SingerInfo[] }>('/api/discover/singers' + qs({ limit })),
  singer: (id: string, name: string, page = 1) =>
    request<{ singer: SingerInfo; songs: Song[]; total: number; hasMore: boolean; page: number; source: string }>(
      '/api/singer/' + encodeURIComponent(id) + qs({ name, page }),
    ),
  album: (id: string) => request<{ id: string; name: string; singer: string; cover?: string; songs: Song[] }>('/api/album/' + encodeURIComponent(id)),
  forYou: () => request<{ items: { song: Song; reason: string }[] }>('/api/discover/for-you'),
  followSinger: (singer: SingerInfo) => request<{ library: LibraryData }>('/api/library/singers', { method: 'POST', body: JSON.stringify({ singer }) }),
  unfollowSinger: (id: string) => request<{ library: LibraryData }>('/api/library/singers/' + encodeURIComponent(id), { method: 'DELETE' }),

  lyric: (song: Song) =>
    request<{ lyric: LyricResult }>('/api/lyric', { method: 'POST', body: JSON.stringify({ song }) }),

  pic: (platform: Platform, songmid: string) =>
    request<{ url: string }>('/api/pic' + qs({ platform, songmid })),

  musicUrl: (song: Song, qualities: Quality[], sourceId?: string, excludedSourceIds?: string[]) =>
    request<UrlResult>('/api/url', {
      method: 'POST',
      body: JSON.stringify({ song, qualities, sourceId, excludedSourceIds }),
    }),

  download: (song: Song) =>
    request<DownloadResult>('/api/download', { method: 'POST', body: JSON.stringify({ song }) }),
  access: () => request<AccessInfo>('/api/access'),
  deviceApi: {
    xiaozhi: () => request<XiaozhiStatus>('/api/device-api/xiaozhi'),
    saveXiaozhi: (body: { endpoint?: string; enabled: boolean; scopes?: DeviceScope[] }) =>
      request<XiaozhiStatus>('/api/device-api/xiaozhi', { method: 'PUT', body: JSON.stringify(body) }),
    removeXiaozhi: () => request<XiaozhiStatus>('/api/device-api/xiaozhi', { method: 'DELETE' }),
    status: () => request<DeviceApiStatus>('/api/device-api'),
    create: (body: { name: string; scopes: DeviceScope[]; expiresInDays: number | null }) =>
      request<{ key: DeviceKey; token: string }>('/api/device-api/keys', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { name?: string; scopes?: DeviceScope[] }) =>
      request<{ key: DeviceKey }>('/api/device-api/keys/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(body) }),
    revoke: (id: string) => request<{ ok: boolean }>('/api/device-api/keys/' + encodeURIComponent(id), { method: 'DELETE' }),
  },

  // ---- 管理后台（仅管理员；其他人一律 404） ----
  admin: {
    deviceAccess: (id: string) => request<DeviceApiStatus>('/api/admin/users/' + encodeURIComponent(id) + '/device-api'),
    saveDeviceAccess: (id: string, mode: DeviceAccess['mode']) => request<DeviceApiStatus>('/api/admin/users/' + encodeURIComponent(id) + '/device-api', { method: 'PUT', body: JSON.stringify({ mode }) }),
    revokeDeviceKey: (userId: string, id: string) => request<{ ok: boolean }>('/api/admin/users/' + encodeURIComponent(userId) + '/device-api/keys/' + encodeURIComponent(id), { method: 'DELETE' }),
    userAccess: (userId: string) => request<AccessInfo>('/api/admin/users/' + encodeURIComponent(userId) + '/access'),
    resetUserQuota: (userId: string) => request<AccessInfo>('/api/admin/users/' + encodeURIComponent(userId) + '/access', { method: 'DELETE' }),
    userFavorites: (userId: string, params: { q?: string; page?: number; limit?: number } = {}) =>
      request<AdminFavorites>('/api/admin/users/' + encodeURIComponent(userId) + '/favorites' + qs(params)),
    userPlaylists: (userId: string) => request<{ user: AdminUser; playlists: AdminPlaylistSummary[] }>('/api/admin/users/' + encodeURIComponent(userId) + '/playlists'),
    playlist: (userId: string, id: string) => request<{ playlist: Playlist }>('/api/admin/users/' + encodeURIComponent(userId) + '/playlists/' + encodeURIComponent(id)),
    createPlaylist: (userId: string, body: { name: string; description: string }) => request<{ playlist: Playlist }>('/api/admin/users/' + encodeURIComponent(userId) + '/playlists', { method: 'POST', body: JSON.stringify(body) }),
    updatePlaylist: (userId: string, id: string, body: { name: string; description: string }) => request<{ playlist: Playlist }>('/api/admin/users/' + encodeURIComponent(userId) + '/playlists/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(body) }),
    deletePlaylist: (userId: string, id: string) => request<{ ok: boolean }>('/api/admin/users/' + encodeURIComponent(userId) + '/playlists/' + encodeURIComponent(id), { method: 'DELETE' }),
    copyPlaylist: (userId: string, id: string, targetUserId: string, name: string) => request<{ playlist: Playlist }>('/api/admin/users/' + encodeURIComponent(userId) + '/playlists/' + encodeURIComponent(id) + '/copy', { method: 'POST', body: JSON.stringify({ targetUserId, name }) }),
    removePlaylistSong: (userId: string, id: string, key: string) => request<{ playlist: Playlist }>('/api/admin/users/' + encodeURIComponent(userId) + '/playlists/' + encodeURIComponent(id) + '/songs/' + encodeURIComponent(key), { method: 'DELETE' }),

    overview: () => request<AdminOverview>('/api/admin/overview'),
    system: () =>
      request<{
        node: string
        platform: string
        arch: string
        uptime: number
        memory: { rss: number; heapUsed: number; heapTotal: number }
        database: { file: string; bytes: number; walBytes: number; tables: { name: string; rows: number }[] }
        generatedAt: number
      }>('/api/admin/system'),
    users: (params: { q?: string; role?: string; status?: string; page?: number; limit?: number }) =>
      request<AdminUserList>('/api/admin/users' + qs(params)),
    user: (id: string) => request<{ user: AdminUser }>('/api/admin/users/' + encodeURIComponent(id)),
    createUser: (body: { username: string; password: string; nickname?: string; role?: 'admin' | 'vip' | 'user' }) =>
      request<{ user: AdminUser }>('/api/admin/users', { method: 'POST', body: JSON.stringify(body) }),
    updateUser: (id: string, body: { nickname?: string; role?: 'admin' | 'vip' | 'user'; status?: 'active' | 'disabled' }) =>
      request<{ user: AdminUser }>('/api/admin/users/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    resetPassword: (id: string, password: string) =>
      request<{ ok: boolean }>('/api/admin/users/' + encodeURIComponent(id) + '/password', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    revokeSessions: (id: string) =>
      request<{ ok: boolean }>('/api/admin/users/' + encodeURIComponent(id) + '/logout', { method: 'POST' }),
    deleteUser: (id: string) =>
      request<{ ok: boolean }>('/api/admin/users/' + encodeURIComponent(id), { method: 'DELETE' }),
    unlockUser: (id: string) =>
      request<{ ok: boolean }>('/api/admin/users/' + encodeURIComponent(id) + '/unlock', { method: 'POST' }),
    locked: () => request<{ items: { key: string; failures: number; lockedUntil: number; locked: boolean }[] }>('/api/admin/locked'),
    unlockKey: (key: string) =>
      request<{ ok: boolean; removed: number }>('/api/admin/unlock', { method: 'POST', body: JSON.stringify({ key }) }),
    unlockAll: () =>
      request<{ ok: boolean; removed: number }>('/api/admin/unlock', { method: 'POST', body: JSON.stringify({ all: true }) }),
    audit: (params: { page?: number; limit?: number }) => request<{ audit: { total: number; page: number; limit: number; entries: AuditEntry[] } }>('/api/admin/audit' + qs(params)),
    config: () =>
      request<{ config: { registration: { enabled: boolean }; download: DownloadConfig; cache: CacheConfig; membership: MembershipConfig; deviceApi: DeviceApiConfig } }>(
        '/api/admin/config',
      ),
    saveConfig: (body: {
      registration?: { enabled: boolean }
      download?: Partial<DownloadConfig>
      cache?: Partial<CacheConfig>
      membership?: MembershipConfig
      deviceApi?: DeviceApiConfig
    }) =>
      request<{ config: { registration: { enabled: boolean }; download: DownloadConfig; cache: CacheConfig; membership: MembershipConfig; deviceApi: DeviceApiConfig } }>(
        '/api/admin/config',
        {
          method: 'PUT',
          body: JSON.stringify(body),
        },
      ),
    cache: () => request<{ cache: CacheStats }>('/api/admin/cache'),
    clearCache: () =>
      request<{ ok: boolean; removed: { removed: number; bytes: number } }>('/api/admin/cache', { method: 'DELETE' }),
    warmCache: () => request<{ ok: boolean; queued: number }>('/api/admin/cache/warm', { method: 'POST' }),
  },

  // ---- 账号 ----
  me: () => request<{ user: User | null; library: { favorites: number; playlists: number; history: number } | null }>('/api/auth/me'),
  login: (body: { username: string; password: string }) =>
    request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  register: (body: { username: string; password: string; nickname?: string }) =>
    request<{ user: User }>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  updateProfile: (body: { nickname?: string; avatarColor?: string }) =>
    request<{ user: User }>('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(body) }),
  changePassword: (body: { oldPassword: string; newPassword: string }) =>
    request<{ ok: boolean }>('/api/auth/password', { method: 'POST', body: JSON.stringify(body) }),

  // ---- 音乐库 ----
  library: () => request<{ library: LibraryData }>('/api/library'),
  addFavorite: (song: Song) =>
    request<{ library: LibraryData }>('/api/library/favorites', {
      method: 'POST',
      body: JSON.stringify({ song }),
    }),
  removeFavorite: (key: string) =>
    request<{ library: LibraryData }>('/api/library/favorites/' + encodeURIComponent(key), { method: 'DELETE' }),
  addHistory: (song: Song) =>
    request<{ library: LibraryData }>('/api/library/history', { method: 'POST', body: JSON.stringify({ song }) }),
  clearHistory: () => request<{ library: LibraryData }>('/api/library/history', { method: 'DELETE' }),
  saveSettings: (settings: Record<string, unknown>) =>
    request<{ library: LibraryData }>('/api/library/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  importLibrary: (data: {
    favorites?: Song[]
    playlists?: { name: string; description?: string; songs: Song[] }[]
    history?: Song[]
    settings?: Record<string, unknown>
  }) => request<{ library: LibraryData }>('/api/library/import', { method: 'POST', body: JSON.stringify(data) }),
  createPlaylist: (name: string, description = '') =>
    request<{ library: LibraryData }>('/api/library/playlists', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  updatePlaylist: (id: string, body: { name?: string; description?: string }) =>
    request<{ library: LibraryData }>('/api/library/playlists/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deletePlaylist: (id: string) =>
    request<{ library: LibraryData }>('/api/library/playlists/' + encodeURIComponent(id), { method: 'DELETE' }),
  addPlaylistSong: (id: string, song: Song) =>
    request<{ library: LibraryData }>('/api/library/playlists/' + encodeURIComponent(id) + '/songs', {
      method: 'POST',
      body: JSON.stringify({ song }),
    }),
  removePlaylistSong: (id: string, key: string) =>
    request<{ library: LibraryData }>(
      '/api/library/playlists/' + encodeURIComponent(id) + '/songs/' + encodeURIComponent(key),
      { method: 'DELETE' },
    ),
}

/** 封面图走服务端代理，避免跨域与防盗链 */
export function imageSrc(url?: string | null): string | undefined {
  if (!url) return undefined
  if (url.startsWith('/api/') || url.startsWith('data:')) return url
  return '/api/image?u=' + btoa(unescape(encodeURIComponent(url))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
