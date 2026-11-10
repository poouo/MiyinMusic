import { getDb, p, sql, transaction } from './db.js'
import { HttpError } from './errors.js'
import { shortId, findById } from './auth.js'
import type { Platform, Quality, Song, SingerInfo } from './types.js'
import { PLATFORMS, QUALITIES } from './types.js'

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

export interface HistoryEntry {
  song: Song
  playedAt: number
}

export interface UserLibrary {
  favorites: FavoriteEntry[]
  playlists: Playlist[]
  history: HistoryEntry[]
  settings: Record<string, unknown>
  updatedAt: number
}

const LIMITS = {
  favorites: 3000,
  playlists: 200,
  playlistSongs: 2000,
  history: 200,
}

export function songKey(song: Pick<Song, 'platform' | 'songmid'>): string {
  return String(song.platform) + '_' + String(song.songmid)
}

export function sanitizeSingers(value: unknown): SingerInfo[] {
  const result = new Map<string, SingerInfo>()
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || typeof raw !== 'object' || !['tx', 'wy'].includes(raw.platform) || typeof raw.name !== 'string' || !raw.name.trim() || typeof raw.id !== 'string' || !/^(?:(?:tx|wy)-)?[\w]{1,64}$/.test(raw.id)) continue
    const id = raw.platform + '-' + raw.id.replace(/^(tx|wy)-/, '')
    if (!result.has(id)) result.set(id, { id, platform: raw.platform, name: raw.name.trim().slice(0, 80), pic: typeof raw.pic === 'string' ? raw.pic.slice(0, 500) : null })
    if (result.size >= 100) break
  }
  return [...result.values()]
}

/** 只保留白名单字段，避免客户端塞入无关数据 */
export function sanitizeSong(input: unknown): Song {
  const raw = (input ?? {}) as Record<string, unknown>
  const platform = String(raw.platform ?? '') as Platform
  if (!PLATFORMS.includes(platform)) throw new HttpError(400, '非法的歌曲平台')
  const songmid = String(raw.songmid ?? '').trim()
  if (!songmid || songmid.length > 128) throw new HttpError(400, '非法的歌曲 ID')
  const qualities = Array.isArray(raw.qualities)
    ? (raw.qualities.filter((q) => QUALITIES.includes(q as Quality)) as Quality[])
    : []
  const song: Song = {
    platform,
    songmid,
    name: String(raw.name ?? '').slice(0, 200),
    singer: String(raw.singer ?? '').slice(0, 200),
    albumName: String(raw.albumName ?? '').slice(0, 200),
    interval: Math.max(0, Math.min(24 * 3600, Math.round(Number(raw.interval) || 0))),
    img: typeof raw.img === 'string' ? raw.img.slice(0, 500) : null,
    qualities,
  }
  const optional: (keyof Song)[] = ['hash', 'albumId', 'albumMid', 'strMediaMid', 'copyrightId', 'lrcUrl', 'songId']
  if (Array.isArray(raw.artists)) song.artists = raw.artists.slice(0, 10).filter(item => item && typeof item === 'object' && /^[\w-]{1,64}$/.test(String(item.id)) && typeof item.name === 'string').map(item => ({ id: String(item.id), name: item.name.slice(0, 80) }))
  for (const key of optional) {
    const value = raw[key]
    if (typeof value === 'string' && value && value.length <= 200) {
      ;(song as unknown as Record<string, unknown>)[key] = value
    }
  }
  return song
}

function parseSong(json: unknown): Song | null {
  if (typeof json !== 'string' || !json) return null
  try {
    const song = JSON.parse(json) as Song
    if (!song || !song.platform || !song.songmid) return null
    return song
  } catch {
    return null
  }
}

/** Read favorites independently so admin inspection does not load playlists or history. */
export function getFavorites(userId: string): FavoriteEntry[] {
  const db = getDb()
  const favoriteRows = db
    .prepare('SELECT song_json, added_at FROM favorites WHERE user_id = ? ORDER BY added_at DESC, song_key ASC')
    .all(userId) as { song_json: string; added_at: number }[]
  const favorites: FavoriteEntry[] = []
  for (const row of favoriteRows) {
    const song = parseSong(row.song_json)
    if (song) favorites.push({ song, addedAt: Number(row.added_at) })
  }
  return favorites
}

export function getLibrary(userId: string): UserLibrary {
  const db = getDb()
  const favorites = getFavorites(userId)
  const playlistRows = db
    .prepare('SELECT id, name, description, created_at, updated_at FROM playlists WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as { id: string; name: string; description: string; created_at: number; updated_at: number }[]
  const songsStmt = db.prepare('SELECT song_json FROM playlist_songs WHERE playlist_id = ? ORDER BY position ASC')
  const playlists: Playlist[] = playlistRows.map((row) => {
    const rows = songsStmt.all(row.id) as { song_json: string }[]
    const songs: Song[] = []
    for (const item of rows) {
      const song = parseSong(item.song_json)
      if (song) songs.push(song)
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      songs,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  })

  const historyRows = db
    .prepare('SELECT song_json, played_at FROM history WHERE user_id = ? ORDER BY played_at DESC LIMIT ?')
    .all(userId, LIMITS.history) as { song_json: string; played_at: number }[]
  const history: HistoryEntry[] = []
  for (const row of historyRows) {
    const song = parseSong(row.song_json)
    if (song) history.push({ song, playedAt: Number(row.played_at) })
  }

  const settingsRows = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(userId) as {
    key: string
    value: string
  }[]
  const settings: Record<string, unknown> = {}
  for (const row of settingsRows) {
    try {
      settings[row.key] = JSON.parse(row.value)
    } catch {
      /* 忽略损坏的设置项 */
    }
  }

  const stamps = [0, ...favorites.map((f) => f.addedAt), ...playlists.map((pl) => pl.updatedAt), ...history.map((h) => h.playedAt)]
  return { favorites, playlists, history, settings, updatedAt: Math.max(...stamps) }
}

export function librarySummary(userId: string) {
  const db = getDb()
  const count = (table: string) => Number((db.prepare('SELECT COUNT(*) AS c FROM ' + table + ' WHERE user_id = ?').get(userId) as { c: number }).c)
  return {
    favorites: count('favorites'),
    playlists: count('playlists'),
    history: count('history'),
  }
}

/** Summary reads do not deserialize every song or load unrelated history/settings. */
export function playlistSummaries(userId: string) {
  return getDb().prepare(`SELECT p.id, p.name, p.description, p.created_at AS createdAt, p.updated_at AS updatedAt,
    (SELECT COUNT(*) FROM playlist_songs s WHERE s.playlist_id = p.id) AS songCount
    FROM playlists p WHERE p.user_id = ? ORDER BY p.created_at DESC`).all(userId)
}

export function addFavorite(userId: string, input: unknown): UserLibrary {
  const song = sanitizeSong(input)
  const key = songKey(song)
  const existing = sql('SELECT 1 AS x FROM favorites WHERE user_id = ? AND song_key = ?').get(userId, key)
  if (existing) return getLibrary(userId)
  const total = Number((sql('SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?').get(userId) as { c: number }).c)
  if (total >= LIMITS.favorites) throw new HttpError(400, '收藏数量已达上限')
  getDb()
    .prepare('INSERT INTO favorites (user_id, song_key, song_json, added_at) VALUES (?, ?, ?, ?)')
    .run(userId, key, JSON.stringify(song), Date.now())
  return getLibrary(userId)
}

export function removeFavorite(userId: string, key: string): UserLibrary {
  getDb().prepare('DELETE FROM favorites WHERE user_id = ? AND song_key = ?').run(userId, key)
  return getLibrary(userId)
}

export function clearFavorites(userId: string): UserLibrary {
  getDb().prepare('DELETE FROM favorites WHERE user_id = ?').run(userId)
  return getLibrary(userId)
}

export function addHistory(userId: string, input: unknown): UserLibrary {
  const song = sanitizeSong(input)
  const key = songKey(song)
  getDb()
    .prepare(
      `INSERT INTO history (user_id, song_key, song_json, played_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, song_key) DO UPDATE SET played_at = excluded.played_at, song_json = excluded.song_json`,
    )
    .run(userId, key, JSON.stringify(song), Date.now())
  getDb()
    .prepare(
      'DELETE FROM history WHERE user_id = ? AND song_key NOT IN (SELECT song_key FROM history WHERE user_id = ? ORDER BY played_at DESC LIMIT ?)',
    )
    .run(userId, userId, LIMITS.history)
  return getLibrary(userId)
}

export function clearHistory(userId: string): UserLibrary {
  getDb().prepare('DELETE FROM history WHERE user_id = ?').run(userId)
  return getLibrary(userId)
}

function findPlaylist(userId: string, id: string) {
  const row = sql('SELECT id, name, description FROM playlists WHERE id = ? AND user_id = ?').get(id, userId) as
    | { id: string; name: string; description: string }
    | undefined
  if (!row) throw new HttpError(404, '歌单不存在')
  return row
}

export function createPlaylist(userId: string, input: { name?: string; description?: string }): UserLibrary {
  const name = String(input.name ?? '').trim().slice(0, 40)
  if (!name) throw new HttpError(400, '歌单名称不能为空')
  const total = Number((sql('SELECT COUNT(*) AS c FROM playlists WHERE user_id = ?').get(userId) as { c: number }).c)
  if (total >= LIMITS.playlists) throw new HttpError(400, '歌单数量已达上限')
  const now = Date.now()
  getDb()
    .prepare('INSERT INTO playlists (id, user_id, name, description, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(shortId('pl_'), userId, name, String(input.description ?? '').slice(0, 200), 0, now, now)
  return getLibrary(userId)
}

export function updatePlaylist(userId: string, id: string, input: { name?: string; description?: string }): UserLibrary {
  const playlist = findPlaylist(userId, id)
  let name = playlist.name
  let description = playlist.description ?? ''
  if (typeof input.name === 'string') {
    const next = input.name.trim().slice(0, 40)
    if (!next) throw new HttpError(400, '歌单名称不能为空')
    name = next
  }
  if (typeof input.description === 'string') description = input.description.slice(0, 200)
  getDb().prepare('UPDATE playlists SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(name, description, Date.now(), id)
  return getLibrary(userId)
}

export function deletePlaylist(userId: string, id: string): UserLibrary {
  findPlaylist(userId, id)
  transaction((db) => {
    db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ?').run(id)
    db.prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?').run(id, userId)
  })
  return getLibrary(userId)
}

export function addPlaylistSong(userId: string, id: string, input: unknown): UserLibrary {
  const song = sanitizeSong(input)
  const key = songKey(song)
  findPlaylist(userId, id)
  const duplicate = sql('SELECT 1 AS x FROM playlist_songs WHERE playlist_id = ? AND song_key = ?').get(id, key)
  if (duplicate) throw new HttpError(409, '歌单中已有这首歌')
  const total = Number((sql('SELECT COUNT(*) AS c FROM playlist_songs WHERE playlist_id = ?').get(id) as { c: number }).c)
  if (total >= LIMITS.playlistSongs) throw new HttpError(400, '歌单歌曲数量已达上限')
  const now = Date.now()
  transaction((db) => {
    const row = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM playlist_songs WHERE playlist_id = ?').get(id) as {
      m: number
    }
    db.prepare('INSERT INTO playlist_songs (playlist_id, position, song_key, song_json, added_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      Number(row.m) + 1,
      key,
      JSON.stringify(song),
      now,
    )
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, id)
  })
  return getLibrary(userId)
}

export function removePlaylistSong(userId: string, id: string, key: string): UserLibrary {
  findPlaylist(userId, id)
  transaction((db) => {
    db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ? AND song_key = ?').run(id, key)
    const rows = db.prepare('SELECT song_key, song_json, added_at FROM playlist_songs WHERE playlist_id = ? ORDER BY position ASC').all(id) as {
      song_key: string
      song_json: string
      added_at: number
    }[]
    db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ?').run(id)
    const insert = db.prepare('INSERT INTO playlist_songs (playlist_id, position, song_key, song_json, added_at) VALUES (?, ?, ?, ?, ?)')
    rows.forEach((row, index) => insert.run(id, index, row.song_key, row.song_json, row.added_at))
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), id)
  })
  return getLibrary(userId)
}

export function reorderPlaylist(userId: string, id: string, keys: string[]): UserLibrary {
  findPlaylist(userId, id)
  transaction((db) => {
    const rows = db.prepare('SELECT song_key, song_json, added_at FROM playlist_songs WHERE playlist_id = ?').all(id) as {
      song_key: string
      song_json: string
      added_at: number
    }[]
    const map = new Map(rows.map((row) => [row.song_key, row]))
    const ordered: typeof rows = []
    for (const key of keys) {
      const row = map.get(key)
      if (row) {
        ordered.push(row)
        map.delete(key)
      }
    }
    for (const row of map.values()) ordered.push(row)
    db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ?').run(id)
    const insert = db.prepare('INSERT INTO playlist_songs (playlist_id, position, song_key, song_json, added_at) VALUES (?, ?, ?, ?, ?)')
    ordered.forEach((row, index) => insert.run(id, index, row.song_key, row.song_json, row.added_at))
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), id)
  })
  return getLibrary(userId)
}

export function updateSettings(userId: string, patch: Record<string, unknown>): UserLibrary {
  const db = getDb()
  const upsert = db.prepare(
    'INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
  )
  transaction(() => {
    for (const [key, value] of Object.entries(patch ?? {})) {
      if (typeof key !== 'string' || key.length > 60) continue
      upsert.run(userId, key, JSON.stringify(key === 'favoriteSingers' ? sanitizeSingers(value) : value ?? null))
    }
  })
  return getLibrary(userId)
}

/** 把本地的书签导入到账号（仅补全，不覆盖已有） */
export function importLibrary(
  userId: string,
  input: { favorites?: unknown[]; playlists?: unknown[]; history?: unknown[]; settings?: Record<string, unknown> },
): UserLibrary {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '导入数据格式不正确')
  for (const key of ['favorites', 'playlists', 'history'] as const) {
    if (input[key] !== undefined && !Array.isArray(input[key])) throw new HttpError(400, key + ' 必须为数组')
  }
  const cleanSongs = (items: unknown[]): Song[] => {
    const unique = new Map<string, Song>()
    for (const item of items) {
      try {
        const song = sanitizeSong(item)
        if (!unique.has(songKey(song))) unique.set(songKey(song), song)
      } catch { /* Ignore invalid individual songs from older exports. */ }
    }
    return [...unique.values()]
  }
  const current = getLibrary(userId)
  const favorites = cleanSongs(input.favorites ?? [])
  const favoriteKeys = new Set([...current.favorites.map((entry) => songKey(entry.song)), ...favorites.map(songKey)])
  if (favoriteKeys.size > LIMITS.favorites) throw new HttpError(400, '导入后收藏数量超过上限（3000 首）')

  const signature = (playlist: { name: string; description: string; songs: Song[] }) =>
    JSON.stringify([playlist.name, playlist.description, playlist.songs.map(songKey)])
  const signatures = new Set(current.playlists.map(signature))
  const playlists: { name: string; description: string; songs: Song[] }[] = []
  for (const item of input.playlists ?? []) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const name = String(raw.name ?? '').trim().slice(0, 40)
    if (!name) continue
    if (raw.songs !== undefined && !Array.isArray(raw.songs)) throw new HttpError(400, '歌单歌曲必须为数组')
    const songs = cleanSongs((raw.songs as unknown[]) ?? [])
    if (songs.length > LIMITS.playlistSongs) throw new HttpError(400, '单个歌单最多导入 2000 首歌曲')
    const playlist = { name, description: String(raw.description ?? '').slice(0, 200), songs }
    const key = signature(playlist)
    if (signatures.has(key)) continue // Retrying an import must not create another identical playlist.
    signatures.add(key)
    playlists.push(playlist)
  }
  if (current.playlists.length + playlists.length > LIMITS.playlists) throw new HttpError(400, '导入后歌单数量超过上限（200 个）')
  if (input.settings && (typeof input.settings !== 'object' || Array.isArray(input.settings))) {
    throw new HttpError(400, '设置数据格式不正确')
  }
  const settings = Object.entries(input.settings ?? {})
  if (settings.length > 100 || settings.some(([key, value]) => key.length > 60 || JSON.stringify(value ?? null).length > 16384)) {
    throw new HttpError(400, '导入的设置数据过大')
  }
  transaction((db) => {
    const now = Date.now()
    const insertFavorite = db.prepare('INSERT OR IGNORE INTO favorites (user_id, song_key, song_json, added_at) VALUES (?, ?, ?, ?)')
    for (const song of favorites) insertFavorite.run(userId, songKey(song), JSON.stringify(song), now)
    const insertPlaylist = db.prepare(
      'INSERT INTO playlists (id, user_id, name, description, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    const insertSong = db.prepare('INSERT INTO playlist_songs (playlist_id, position, song_key, song_json, added_at) VALUES (?, ?, ?, ?, ?)')
    for (const playlist of playlists) {
      const id = shortId('pl_')
      insertPlaylist.run(id, userId, playlist.name, playlist.description, 0, now, now)
      playlist.songs.forEach((song, index) => insertSong.run(id, index, songKey(song), JSON.stringify(song), now))
    }
    const insertHistory = db.prepare('INSERT OR IGNORE INTO history (user_id, song_key, song_json, played_at) VALUES (?, ?, ?, ?)')
    const history = cleanSongs(input.history ?? []).slice(0, LIMITS.history)
    history.forEach((song, index) => insertHistory.run(userId, songKey(song), JSON.stringify(song), now - index))
    db.prepare('DELETE FROM history WHERE user_id = ? AND song_key NOT IN (SELECT song_key FROM history WHERE user_id = ? ORDER BY played_at DESC LIMIT ?)')
      .run(userId, userId, LIMITS.history)
    const upsert = db.prepare('INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value')
    for (const [key, value] of settings) upsert.run(userId, key, JSON.stringify(key === 'favoriteSingers' ? sanitizeSingers(value) : value ?? null))
  })
  return getLibrary(userId)
}

/** 旧版 JSON 迁移过程中使用：直接写入原始歌单对象 */
export function importRawPlaylist(userId: string, playlist: { name: string; description?: string; songs?: unknown[]; createdAt?: number }) {
  const id = shortId('pl_')
  const now = Number(playlist.createdAt) || Date.now()
  transaction((db) => {
    db.prepare('INSERT INTO playlists (id, user_id, name, description, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      userId,
      String(playlist.name ?? '').slice(0, 40),
      String(playlist.description ?? '').slice(0, 200),
      0,
      now,
      now,
    )
    const insertSong = db.prepare(
      'INSERT OR IGNORE INTO playlist_songs (playlist_id, position, song_key, song_json, added_at) VALUES (?, ?, ?, ?, ?)',
    )
    let position = 0
    for (const rawSong of playlist.songs ?? []) {
      try {
        const song = sanitizeSong(rawSong)
        insertSong.run(id, position++, songKey(song), JSON.stringify(song), now)
      } catch {
        /* ignore */
      }
    }
  })
}

export function flushLibraries(): void {
  /* SQLite 立即落盘，无需额外刷写 */
}

/** Read a single owned playlist without loading the user's favorites or history. */
export function getPlaylist(userId: string, id: string): Playlist {
  findPlaylist(userId, id)
  const row = getDb().prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown>
  const rows = getDb().prepare('SELECT song_json FROM playlist_songs WHERE playlist_id = ? ORDER BY position').all(id) as { song_json: string }[]
  return { id, name: String(row.name), description: String(row.description ?? ''),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    songs: rows.map(row => parseSong(row.song_json)).filter((song): song is Song => song !== null) }
}

/** Copy is atomic, independent of the source, and always creates a new playlist. */
export function copyPlaylist(sourceUserId: string, id: string, targetUserId: string, requestedName?: string): Playlist {
  const newId = shortId('pl_')
  transaction(db => {
    const source = findPlaylist(sourceUserId, id)
    if (!findById(targetUserId)) throw new HttpError(404, '目标用户不存在')
    const count = Number((db.prepare('SELECT COUNT(*) AS c FROM playlists WHERE user_id = ?').get(targetUserId) as { c: number }).c)
    if (count >= LIMITS.playlists) throw new HttpError(400, '目标用户的歌单数量已达上限')
    const songs = db.prepare('SELECT song_key, song_json FROM playlist_songs WHERE playlist_id = ? ORDER BY position').all(id) as { song_key: string; song_json: string }[]
    if (songs.length > LIMITS.playlistSongs) throw new HttpError(400, '歌单歌曲数量已达上限')
    const name = String(requestedName ?? source.name).trim().slice(0, 40)
    if (!name) throw new HttpError(400, '歌单名称不能为空')
    const now = Date.now()
    db.prepare('INSERT INTO playlists (id, user_id, name, description, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId, targetUserId, name, source.description ?? '', count, now, now)
    const insert = db.prepare('INSERT INTO playlist_songs (playlist_id, position, song_key, song_json, added_at) VALUES (?, ?, ?, ?, ?)')
    songs.forEach((song, index) => insert.run(newId, index, song.song_key, song.song_json, now))
  })
  return getPlaylist(targetUserId, newId)
}
