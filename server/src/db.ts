import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { config } from './config.js'
import { logger } from './log.js'

const log = logger('db')

let database: DatabaseSync | null = null

const SCHEMA_VERSION = 2

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS device_api_access (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS device_api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    scopes TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    last_used_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_device_keys_user ON device_api_keys(user_id)`,
  `CREATE TABLE IF NOT EXISTS audio_validation (
    cache_key TEXT PRIMARY KEY,
    bytes INTEGER NOT NULL,
    mtime REAL NOT NULL,
    duration REAL NOT NULL,
    mime TEXT,
    source_id TEXT,
    source_name TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nickname TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    avatar_color TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER,
    last_login_ip TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id)`,
  `CREATE TABLE IF NOT EXISTS playlist_songs (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    song_key TEXT NOT NULL,
    song_json TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, position)
  )`,
  `CREATE TABLE IF NOT EXISTS favorites (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_key TEXT NOT NULL,
    song_json TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, song_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, added_at DESC)`,
  `CREATE TABLE IF NOT EXISTS history (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_key TEXT NOT NULL,
    song_json TEXT NOT NULL,
    played_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, song_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, played_at DESC)`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT,
    script TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    username TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS login_guard (
    key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audio_cache (
    cache_key TEXT PRIMARY KEY,
    song_key TEXT NOT NULL,
    platform TEXT NOT NULL,
    songmid TEXT NOT NULL,
    quality TEXT NOT NULL,
    file_name TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_access_at INTEGER NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audio_cache_song ON audio_cache(song_key)`,
  `CREATE INDEX IF NOT EXISTS idx_audio_cache_access ON audio_cache(last_access_at)`,
  `CREATE TABLE IF NOT EXISTS lyric_cache (
    song_key TEXT PRIMARY KEY,
    lyric_json TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL,
    last_access_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_lyric_cache_access ON lyric_cache(last_access_at)`,
  `CREATE TABLE IF NOT EXISTS download_usage (
    subject TEXT NOT NULL,
    period TEXT NOT NULL,
    downloads INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (subject, period)
  )`,
  `CREATE TABLE IF NOT EXISTS download_tickets (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    target TEXT NOT NULL,
    quality TEXT NOT NULL,
    filename TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    started_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_download_usage_updated ON download_usage(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_download_tickets_expire ON download_tickets(expires_at)`,
]

/** 打开（并在需要时初始化）数据库 */
export function getDb(): DatabaseSync {
  if (database) return database
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true })
  const db = new DatabaseSync(config.dbFile)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA temp_store = MEMORY')
  for (const statement of SCHEMA) db.exec(statement)
  const current = readMeta(db, 'schema_version')
  if (current !== String(SCHEMA_VERSION)) {
    writeMeta(db, 'schema_version', String(SCHEMA_VERSION))
  }
  database = db
  log.info('数据库就绪：' + config.dbFile)
  return db
}

export function closeDb(): void {
  if (!database) return
  try {
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    database.close()
  } catch (err) {
    log.warn('关闭数据库失败：', (err as Error).message)
  }
  database = null
}

/** 事务包装：出错自动回滚 */
export function transaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb()
  db.exec('BEGIN')
  try {
    const result = fn(db)
    db.exec('COMMIT')
    return result
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  }
}

export function readMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value?: string } | undefined
  return row?.value ?? null
}

export function writeMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  )
}

/** node:sqlite 不接受 undefined，统一转成 null */
export function p(value: unknown): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' || typeof value === 'string') return value
  return String(value)
}

export interface StatementCache {
  (sql: string): StatementSync
}

const statementCache = new Map<string, StatementSync>()

/** 复用 prepared statement，避免每次请求都重新编译 SQL */
export const sql: StatementCache = (text: string) => {
  const cached = statementCache.get(text)
  if (cached) return cached
  const statement = getDb().prepare(text)
  statementCache.set(text, statement)
  return statement
}

export interface DatabaseStats {
  file: string
  bytes: number
  walBytes: number
  tables: { name: string; rows: number }[]
}

export function databaseStats(): DatabaseStats {
  const db = getDb()
  let bytes = 0
  let walBytes = 0
  try {
    bytes = fs.statSync(config.dbFile).size
  } catch {
    bytes = 0
  }
  try {
    walBytes = fs.statSync(config.dbFile + '-wal').size
  } catch {
    walBytes = 0
  }
  const tables = ['users', 'sessions', 'playlists', 'playlist_songs', 'favorites', 'history', 'sources', 'audit_log', 'audio_cache', 'lyric_cache', 'download_usage', 'download_tickets']
  return {
    file: config.dbFile,
    bytes,
    walBytes,
    tables: tables.map((name) => {
      const row = db.prepare('SELECT COUNT(*) AS c FROM ' + name).get() as { c: number }
      return { name, rows: Number(row.c) }
    }),
  }
}
