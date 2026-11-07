import { getDb, p, sql } from './db.js'

export interface AuditInput {
  userId?: string | null
  username?: string | null
  action: string
  detail?: string
  ip?: string | null
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

/** 记录一条审计日志（失败不影响主流程） */
export function writeAudit(input: AuditInput): void {
  try {
    sql(
      'INSERT INTO audit_log (user_id, username, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(p(input.userId), p(input.username), input.action, p(input.detail), p(input.ip), Date.now())
  } catch {
    /* 审计失败不应中断业务 */
  }
}

export function listAudit(options: { page?: number; limit?: number; action?: string } = {}) {
  const page = Math.max(1, Math.floor(options.page ?? 1))
  const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? 30)))
  const offset = (page - 1) * limit
  const db = getDb()
  const where = options.action ? 'WHERE action = ?' : ''
  const args = options.action ? [options.action] : []
  const total = Number(
    (db.prepare('SELECT COUNT(*) AS c FROM audit_log ' + where).get(...args) as { c: number }).c,
  )
  const rows = db
    .prepare(
      'SELECT id, user_id, username, action, detail, ip, created_at FROM audit_log ' +
        where +
        ' ORDER BY id DESC LIMIT ? OFFSET ?',
    )
    .all(...args, limit, offset) as Record<string, unknown>[]
  return {
    total,
    page,
    limit,
    entries: rows.map((row) => ({
      id: Number(row.id),
      userId: (row.user_id as string) ?? null,
      username: (row.username as string) ?? null,
      action: String(row.action),
      detail: (row.detail as string) ?? null,
      ip: (row.ip as string) ?? null,
      createdAt: Number(row.created_at),
    })) as AuditEntry[],
  }
}

export function pruneAudit(maxRows = 5000): void {
  try {
    getDb()
      .prepare('DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT ?)')
      .run(maxRows)
  } catch {
    /* ignore */
  }
}
