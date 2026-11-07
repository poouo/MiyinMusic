import { getDb, p, sql } from './db.js'
import { HttpError } from './errors.js'

/** 出现多少次失败后才开始锁定 */
const FREE_ATTEMPTS = 4
/** 最长锁定时间（毫秒） */
const MAX_LOCK_MS = 30 * 60 * 1000

interface GuardRow {
  key: string
  failures: number
  locked_until: number
  updated_at: number
}

function keyOf(kind: 'ip' | 'user', value: string): string {
  return kind + ':' + value.trim().toLowerCase()
}

function readRow(key: string): GuardRow | undefined {
  return sql('SELECT key, failures, locked_until, updated_at FROM login_guard WHERE key = ?').get(key) as
    | GuardRow
    | undefined
}

/** 计算下一次锁定时长：30s、1min、2min…封顶 30 分钟 */
function lockDuration(failures: number): number {
  const step = Math.max(0, failures - FREE_ATTEMPTS - 1)
  return Math.min(MAX_LOCK_MS, 30_000 * Math.pow(2, step))
}

/**
 * 登录/改密前的准入检查。命中锁定直接抛 429，并带上剩余秒数。
 */
export function assertNotLocked(ip: string, username: string): void {
  const now = Date.now()
  const keys = [keyOf('ip', ip), keyOf('user', username)]
  let remain = 0
  for (const key of keys) {
    const row = readRow(key)
    if (row && Number(row.locked_until) > now) {
      remain = Math.max(remain, Number(row.locked_until) - now)
    }
  }
  if (remain > 0) {
    const seconds = Math.ceil(remain / 1000)
    const error = new HttpError(429, '尝试过于频繁，请在 ' + seconds + ' 秒后重试', 'too_many_attempts')
    ;(error as HttpError & { retryAfter?: number }).retryAfter = seconds
    throw error
  }
}

export function recordLoginFailure(ip: string, username: string): { lockedSeconds: number; failures: number } {
  const now = Date.now()
  let lockedSeconds = 0
  let failures = 0
  for (const key of [keyOf('ip', ip), keyOf('user', username)]) {
    const row = readRow(key)
    const next = Number(row?.failures ?? 0) + 1
    const lockedUntil = next > FREE_ATTEMPTS ? now + lockDuration(next) : 0
    sql(
      `INSERT INTO login_guard (key, failures, locked_until, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until, updated_at = excluded.updated_at`,
    ).run(key, next, lockedUntil, now)
    if (lockedUntil > now) lockedSeconds = Math.max(lockedSeconds, Math.ceil((lockedUntil - now) / 1000))
    if (key.startsWith('user:')) failures = next
  }
  return { lockedSeconds, failures }
}

export function clearLoginFailures(ip: string, username: string): void {
  getDb().prepare('DELETE FROM login_guard WHERE key = ? OR key = ?').run(keyOf('ip', ip), keyOf('user', username))
}

export function listLocked(): { key: string; failures: number; lockedUntil: number; locked: boolean }[] {
  const rows = getDb()
    .prepare('SELECT key, failures, locked_until FROM login_guard ORDER BY updated_at DESC LIMIT 200')
    .all() as Record<string, unknown>[]
  const now = Date.now()
  return rows.map((row) => ({
    key: String(row.key),
    failures: Number(row.failures),
    lockedUntil: Number(row.locked_until),
    locked: Number(row.locked_until) > now,
  }))
}

export function unlockAccount(key: string): boolean {
  const result = getDb().prepare('DELETE FROM login_guard WHERE key = ?').run(key)
  return Number(result.changes) > 0
}

export function unlockAll(ip?: string): number {
  if (ip) {
    const result = getDb().prepare('DELETE FROM login_guard WHERE key = ?').run(keyOf('ip', ip))
    return Number(result.changes)
  }
  const result = getDb().prepare('DELETE FROM login_guard').run()
  return Number(result.changes)
}

/** 顺带清理过期的失败计数（启动时调用） */
export function pruneGuard(): void {
  try {
    getDb()
      .prepare('DELETE FROM login_guard WHERE locked_until < ? AND updated_at < ?')
      .run(Date.now() - 24 * 3600 * 1000, Date.now() - 24 * 3600 * 1000)
  } catch {
    /* ignore */
  }
}

export { p }
