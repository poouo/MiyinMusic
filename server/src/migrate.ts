import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { getDb, readMeta, transaction, writeMeta } from './db.js'
import { logger } from './log.js'

const log = logger('migrate')

interface LegacyUser {
  id?: string
  username?: string
  nickname?: string
  passwordHash?: string
  salt?: string
  avatarColor?: string
  role?: string
  createdAt?: number
  updatedAt?: number
}

interface LegacyLibrary {
  favorites?: { song?: unknown; addedAt?: number }[]
  playlists?: { name?: string; description?: string; songs?: unknown[]; createdAt?: number }[]
  history?: { song?: unknown; playedAt?: number }[]
  settings?: Record<string, unknown>
}

function readJson<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null
    const raw = fs.readFileSync(file, 'utf8')
    if (!raw.trim()) return null
    return JSON.parse(raw) as T
  } catch (err) {
    log.warn('读取旧数据失败：' + file + ' · ' + (err as Error).message)
    return null
  }
}

/**
 * 一次性迁移：把旧版 JSON 存储（users.json / sessions.json / state.json / users/<id>/library.json）
 * 导入 SQLite，成功后把旧文件移到 data/legacy-backup/ 下。
 */
export function migrateLegacyData(): void {
  const db = getDb()
  if (readMeta(db, 'legacy_migrated') === '1') return

  const hasLegacy =
    fs.existsSync(config.usersFile) ||
    fs.existsSync(config.sessionsFile) ||
    fs.existsSync(config.stateFile) ||
    fs.existsSync(config.legacyUsersDir)
  if (!hasLegacy) {
    writeMeta(db, 'legacy_migrated', '1')
    return
  }

  const users = readJson<LegacyUser[]>(config.usersFile) ?? []
  const sessions = readJson<Record<string, { userId?: string; createdAt?: number; expiresAt?: number; ip?: string; userAgent?: string }>>(
    config.sessionsFile,
  ) ?? {}
  const state = readJson<{ sources?: { id?: string; kind?: string; name?: string; url?: string; script?: string; enabled?: boolean; order?: number }[] }>(
    config.stateFile,
  ) ?? {}

  let userCount = 0
  let libraryCount = 0
  let playlistCount = 0
  let songCount = 0

  transaction(() => {
    const insertUser = db.prepare(
      `INSERT OR IGNORE INTO users (id, username, nickname, password_hash, salt, role, status, avatar_color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    const userIdMap = new Map<string, string>()
    for (const user of users) {
      if (!user?.username || !user?.passwordHash || !user?.salt) continue
      const id = user.id || 'u_' + Math.random().toString(36).slice(2, 12)
      userIdMap.set(user.id || id, id)
      const now = Date.now()
      insertUser.run(
        id,
        user.username,
        user.nickname || user.username,
        user.passwordHash,
        user.salt,
        user.role === 'admin' ? 'admin' : 'user',
        user.avatarColor || '#6c8cff',
        Number(user.createdAt) || now,
        Number(user.updatedAt) || now,
      )
      userCount++
    }

    const insertSession = db.prepare(
      'INSERT OR IGNORE INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    )
    for (const [tokenHash, session] of Object.entries(sessions)) {
      const mapped = userIdMap.get(String(session?.userId ?? ''))
      if (!mapped) continue
      insertSession.run(
        tokenHash,
        mapped,
        Number(session.createdAt) || Date.now(),
        Number(session.expiresAt) || Date.now() + 24 * 3600 * 1000,
        session.ip ?? null,
        session.userAgent?.slice(0, 200) ?? null,
      )
    }

    // 音源配置只在源表为空时导入，避免覆盖默认值
    if (Array.isArray(state.sources) && state.sources.length) {
      const existing = db.prepare('SELECT COUNT(*) AS c FROM sources').get() as { c: number }
      if (Number(existing.c) === 0) {
        const insertSource = db.prepare(
          'INSERT OR REPLACE INTO sources (id, kind, name, url, script, enabled, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        state.sources.forEach((source, index) => {
          if (!source?.id) return
          insertSource.run(
            source.id,
            source.kind === 'custom' ? 'custom' : 'builtin',
            source.name || source.id,
            source.url ?? null,
            source.script ?? null,
            source.enabled === false ? 0 : 1,
            Number(source.order ?? index),
            Date.now(),
          )
        })
      }
    }

    // 每个用户的音乐库
    if (fs.existsSync(config.legacyUsersDir)) {
      for (const entry of fs.readdirSync(config.legacyUsersDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const userId = userIdMap.get(entry.name) ?? entry.name
        const userExists = db.prepare('SELECT 1 AS x FROM users WHERE id = ?').get(userId)
        if (!userExists) continue
        const library = readJson<LegacyLibrary>(path.join(config.legacyUsersDir, entry.name, 'library.json'))
        if (!library) continue
        libraryCount++

        const insertFavorite = db.prepare(
          'INSERT OR IGNORE INTO favorites (user_id, song_key, song_json, added_at) VALUES (?, ?, ?, ?)',
        )
        for (const item of library.favorites ?? []) {
          const song = item?.song as { platform?: string; songmid?: string } | undefined
          if (!song?.platform || !song?.songmid) continue
          insertFavorite.run(userId, song.platform + '_' + song.songmid, JSON.stringify(song), Number(item.addedAt) || Date.now())
        }

        const insertPlaylist = db.prepare(
          'INSERT OR REPLACE INTO playlists (id, user_id, name, description, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        const insertSong = db.prepare(
          'INSERT OR IGNORE INTO playlist_songs (playlist_id, position, song_key, song_json, added_at) VALUES (?, ?, ?, ?, ?)',
        )
        for (const playlist of library.playlists ?? []) {
          if (!playlist?.name) continue
          const id = 'pl_' + Math.random().toString(36).slice(2, 12)
          const now = Number(playlist.createdAt) || Date.now()
          insertPlaylist.run(id, userId, playlist.name.slice(0, 40), String(playlist.description ?? '').slice(0, 200), 0, now, now)
          let position = 0
          for (const rawSong of playlist.songs ?? []) {
            const song = rawSong as { platform?: string; songmid?: string }
            if (!song?.platform || !song?.songmid) continue
            insertSong.run(id, position++, song.platform + '_' + song.songmid, JSON.stringify(song), now)
            songCount++
          }
          playlistCount++
        }

        const insertHistory = db.prepare(
          'INSERT OR IGNORE INTO history (user_id, song_key, song_json, played_at) VALUES (?, ?, ?, ?)',
        )
        for (const item of library.history ?? []) {
          const song = item?.song as { platform?: string; songmid?: string } | undefined
          if (!song?.platform || !song?.songmid) continue
          insertHistory.run(userId, song.platform + '_' + song.songmid, JSON.stringify(song), Number(item.playedAt) || Date.now())
        }

        const upsertSetting = db.prepare(
          'INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
        )
        for (const [key, value] of Object.entries(library.settings ?? {})) {
          if (key.length > 60) continue
          upsertSetting.run(userId, key, JSON.stringify(value ?? null))
        }
      }
    }
  })

  // 备份旧文件
  try {
    const backupDir = path.join(config.legacyBackupDir, new Date().toISOString().replace(/[:.]/g, '-'))
    fs.mkdirSync(backupDir, { recursive: true })
    for (const file of [config.usersFile, config.sessionsFile, config.stateFile]) {
      if (fs.existsSync(file)) {
        fs.renameSync(file, path.join(backupDir, path.basename(file)))
      }
    }
    if (fs.existsSync(config.legacyUsersDir)) {
      fs.renameSync(config.legacyUsersDir, path.join(backupDir, 'users'))
    }
    log.info('旧数据已备份到 ' + backupDir)
  } catch (err) {
    log.warn('备份旧数据失败：' + (err as Error).message)
  }

  writeMeta(db, 'legacy_migrated', '1')
  log.info(
    '旧数据迁移完成：用户 ' + userCount + ' · 音乐库 ' + libraryCount + ' · 歌单 ' + playlistCount + ' · 歌曲 ' + songCount,
  )
}
