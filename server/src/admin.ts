import { databaseStats, getDb } from './db.js'
import { countAdmins, countSessions, countUsers, findById, type UserRole, type UserStatus } from './auth.js'
import { HttpError } from './errors.js'

export interface AdminUserRow {
  id: string
  username: string
  nickname: string
  role: UserRole
  status: UserStatus
  avatarColor: string
  createdAt: number
  lastLoginAt: number | null
  lastLoginIp: string | null
  playlists: number
  favorites: number
  history: number
  sessions: number
}

export interface ListUsersOptions {
  q?: string
  role?: string
  status?: string
  page?: number
  limit?: number
}

export function listUsers(options: ListUsersOptions = {}) {
  const db = getDb()
  const page = Math.max(1, Math.floor(options.page ?? 1))
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 20)))
  const offset = (page - 1) * limit
  const clauses: string[] = []
  const args: (string | number)[] = []
  if (options.q) {
    clauses.push('(u.username LIKE ? OR u.nickname LIKE ?)')
    const like = '%' + options.q.trim() + '%'
    args.push(like, like)
  }
  if (options.role === 'admin' || options.role === 'vip' || options.role === 'user') {
    clauses.push('u.role = ?')
    args.push(options.role)
  }
  if (options.status === 'active' || options.status === 'disabled') {
    clauses.push('u.status = ?')
    args.push(options.status)
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
  const total = Number(
    (db.prepare('SELECT COUNT(*) AS c FROM users u ' + where).get(...args) as { c: number }).c,
  )
  const rows = db
    .prepare(
      `SELECT u.*,
        (SELECT COUNT(*) FROM playlists p WHERE p.user_id = u.id) AS playlists,
        (SELECT COUNT(*) FROM favorites f WHERE f.user_id = u.id) AS favorites,
        (SELECT COUNT(*) FROM history h WHERE h.user_id = u.id) AS history,
        (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS sessions
       FROM users u ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(Date.now(), ...args, limit, offset) as Record<string, unknown>[]

  const users: AdminUserRow[] = rows.map((row) => ({
    id: String(row.id),
    username: String(row.username),
    nickname: String(row.nickname),
    role: row.role === 'admin' ? 'admin' : row.role === 'vip' ? 'vip' : 'user',
    status: row.status === 'disabled' ? 'disabled' : 'active',
    avatarColor: String(row.avatar_color ?? '#6c8cff'),
    createdAt: Number(row.created_at),
    lastLoginAt: row.last_login_at == null ? null : Number(row.last_login_at),
    lastLoginIp: (row.last_login_ip as string) ?? null,
    playlists: Number(row.playlists ?? 0),
    favorites: Number(row.favorites ?? 0),
    history: Number(row.history ?? 0),
    sessions: Number(row.sessions ?? 0),
  }))

  return { users, total, page, limit, hasMore: page * limit < total }
}

export function getUserDetail(id: string) {
  const user = findById(id)
  if (!user) throw new HttpError(404, '用户不存在')
  const db = getDb()
  const count = (table: string) =>
    Number((db.prepare('SELECT COUNT(*) AS c FROM ' + table + ' WHERE user_id = ?').get(id) as { c: number }).c)
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    status: user.status,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    lastLoginIp: user.lastLoginIp,
    playlists: count('playlists'),
    favorites: count('favorites'),
    history: count('history'),
    sessions: Number(
      (db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND expires_at > ?').get(id, Date.now()) as {
        c: number
      }).c,
    ),
  }
}

function countWhere(sqlText: string, ...args: (string | number)[]): number {
  return Number((getDb().prepare(sqlText).get(...args) as { c: number }).c)
}

function safeQuery<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export function overview() {
  const db = getDb()
  const now = Date.now()
  const todayStart = new Date(now).setHours(0, 0, 0, 0)
  const weekStart = todayStart - 6 * 86400000

  const stats = {
    users: countUsers(),
    admins: countAdmins(),
    disabledUsers: countWhere("SELECT COUNT(*) AS c FROM users WHERE status = 'disabled'"),
    sessions: countSessions(),
    playlists: countWhere('SELECT COUNT(*) AS c FROM playlists'),
    favorites: countWhere('SELECT COUNT(*) AS c FROM favorites'),
    history: countWhere('SELECT COUNT(*) AS c FROM history'),
    newUsersToday: countWhere('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', todayStart),
    playsToday: countWhere('SELECT COUNT(*) AS c FROM history WHERE played_at >= ?', todayStart),
    favoritesToday: countWhere('SELECT COUNT(*) AS c FROM favorites WHERE added_at >= ?', todayStart),
    loginsToday: countWhere("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'user.login' AND created_at >= ?", todayStart),
  }

  const series: { date: string; label: string; count: number }[] = []
  const grouped = db
    .prepare(
      `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS d, COUNT(*) AS c
       FROM users WHERE created_at >= ? GROUP BY d`,
    )
    .all(weekStart) as { d: string; c: number }[]
  const groupMap = new Map(grouped.map((row) => [row.d, Number(row.c)]))
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart + i * 86400000)
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    series.push({
      date: key,
      label: String(day.getMonth() + 1) + '/' + String(day.getDate()),
      count: groupMap.get(key) ?? 0,
    })
  }

  const platforms = safeQuery(
    () =>
      db
        .prepare(
          `SELECT json_extract(song_json, '$.platform') AS p, COUNT(*) AS c FROM history
           GROUP BY p ORDER BY c DESC LIMIT 6`,
        )
        .all() as { p: string | null; c: number }[],
    [],
  ).map((row) => ({ platform: row.p ?? 'unknown', count: Number(row.c) }))

  const topSingers = safeQuery(
    () =>
      db
        .prepare(
          `SELECT json_extract(song_json, '$.singer') AS s, COUNT(*) AS c FROM favorites
           GROUP BY s ORDER BY c DESC LIMIT 5`,
        )
        .all() as { s: string | null; c: number }[],
    [],
  )
    .filter((row) => row.s)
    .map((row) => ({ singer: row.s as string, count: Number(row.c) }))

  const recentUsers = (
    db
      .prepare('SELECT id, username, nickname, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 5')
      .all() as Record<string, unknown>[]
  ).map((row) => ({
    id: String(row.id),
    username: String(row.username),
    nickname: String(row.nickname),
    role: row.role === 'admin' ? 'admin' : row.role === 'vip' ? 'vip' : 'user',
    status: row.status === 'disabled' ? 'disabled' : 'active',
    createdAt: Number(row.created_at),
  }))

  const dbStats = databaseStats()

  return { stats, series, platforms, topSingers, recentUsers, database: dbStats, generatedAt: now }
}