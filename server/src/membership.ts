import crypto from 'node:crypto'
import net from 'node:net'
import type { IncomingMessage } from 'node:http'
import { getDb, sql } from './db.js'
import { HttpError } from './errors.js'
import { clientIp } from './http-util.js'
import { accessPolicy, MANAGED_AUDIENCES, type AudiencePolicy, type MembershipPatch } from './app-config.js'
import { QUALITIES, type Quality } from './types.js'

const LIMIT_FIELDS = ['dailyDownloads', 'monthlyDownloads', 'dailyBytes', 'monthlyBytes'] as const
const POLICY_FIELDS = ['playbackEnabled', 'playbackQualities', 'downloadEnabled', 'downloadQualities', ...LIMIT_FIELDS]

export function validateMembershipPatch(input: unknown): MembershipPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '会员设置格式不正确')
  const raw = input as Record<string, unknown>
  if (Object.keys(raw).some(key => !['enabled', 'audiences'].includes(key))) throw new HttpError(400, '未知的会员设置')
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') throw new HttpError(400, '会员开关格式不正确')
  const result: MembershipPatch = {}
  if (raw.enabled !== undefined) result.enabled = raw.enabled as boolean
  if (raw.audiences !== undefined) {
    if (!raw.audiences || typeof raw.audiences !== 'object' || Array.isArray(raw.audiences)) throw new HttpError(400, '角色权限格式不正确')
    const audiences = raw.audiences as Record<string, unknown>
    if (Object.keys(audiences).some(key => !MANAGED_AUDIENCES.includes(key as never))) throw new HttpError(400, '不能配置该角色')
    result.audiences = {}
    for (const audience of MANAGED_AUDIENCES) {
      if (!Object.hasOwn(audiences, audience)) continue
      const value = audiences[audience]
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '角色权限格式不正确')
      const policy = value as Record<string, unknown>
      if (Object.keys(policy).some(key => !POLICY_FIELDS.includes(key))) throw new HttpError(400, '未知的角色权限')
      for (const key of ['playbackEnabled', 'downloadEnabled']) {
        if (policy[key] !== undefined && typeof policy[key] !== 'boolean') throw new HttpError(400, '权限开关格式不正确')
      }
      for (const key of ['playbackQualities', 'downloadQualities']) {
        if (policy[key] !== undefined && (!Array.isArray(policy[key]) || (policy[key] as unknown[]).some(q => !QUALITIES.includes(q as Quality)))) {
          throw new HttpError(400, '音质设置不正确')
        }
      }
      for (const key of LIMIT_FIELDS) {
        const value = policy[key]
        const max = key.endsWith('Bytes') ? 100 * 1024 ** 4 : 1_000_000
        if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)) {
          throw new HttpError(400, '额度必须是非负整数，留空为不限')
        }
      }
      result.audiences[audience] = policy as Partial<AudiencePolicy>
    }
  }
  return result
}

/** IPv6 clients share a /64 quota, preventing rotation within one subnet. */
export function guestNetwork(req: IncomingMessage): string {
  const ip = clientIp(req)
  if (!net.isIPv6(ip)) return ip
  const hostname = new URL('http://[' + ip + ']/').hostname.slice(1, -1)
  const [left, right = ''] = hostname.split('::')
  const first = left ? left.split(':') : []
  const last = right ? right.split(':') : []
  const groups = hostname.includes('::') ? [...first, ...Array(8 - first.length - last.length).fill('0'), ...last] : first
  return groups.slice(0, 4).map(group => group.padStart(4, '0')).join(':') + '::/64'
}

export function quotaSubject(req: IncomingMessage, viewer: { id: string } | null): string {
  if (viewer) return 'u:' + viewer.id
  return 'g:' + crypto.createHash('sha256').update(guestNetwork(req)).digest('hex')
}

export function periods(now = Date.now()): { day: string; month: string } {
  const day = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return { day, month: day.slice(0, 7) }
}

export function usage(subject: string, now = Date.now()) {
  const { day, month } = periods(now)
  const read = (period: string) => {
    const row = sql('SELECT downloads, bytes FROM download_usage WHERE subject = ? AND period = ?').get(subject, period)
    return { downloads: Number(row?.downloads ?? 0), bytes: Number(row?.bytes ?? 0) }
  }
  return { day: read(day), month: read(month), dayKey: day, monthKey: month, timezone: 'Asia/Shanghai' }
}

export function assertPlayback(role: string | null | undefined, quality?: Quality): AudiencePolicy {
  const policy = accessPolicy(role)
  if (!policy.playbackEnabled || !policy.playbackQualities.length || (quality && !policy.playbackQualities.includes(quality))) {
    throw new HttpError(403, '当前身份不支持该收听音质', 'playback_forbidden')
  }
  return policy
}

export function assertDownload(role: string | null | undefined, quality?: Quality): AudiencePolicy {
  const policy = accessPolicy(role)
  if (!policy.downloadEnabled || !policy.downloadQualities.length || (quality && !policy.downloadQualities.includes(quality))) {
    throw new HttpError(role ? 403 : 401, role ? '当前账号没有该下载权限' : '当前游客下载权限受限，请登录', 'download_forbidden')
  }
  return policy
}

function checkAllowance(subject: string, policy: AudiencePolicy, count: number, bytes: number, keys = periods()) {
  for (const [period, countLimit, byteLimit, label] of [
    [keys.day, policy.dailyDownloads, policy.dailyBytes, '今日'],
    [keys.month, policy.monthlyDownloads, policy.monthlyBytes, '本月'],
  ] as const) {
    const row = sql('SELECT downloads, bytes FROM download_usage WHERE subject = ? AND period = ?').get(subject, period)
    if ((count > 0 && countLimit !== null && Number(row?.downloads ?? 0) + count > countLimit)
      || (bytes > 0 && byteLimit !== null && Number(row?.bytes ?? 0) + bytes > byteLimit)
      || (count > 0 && byteLimit === 0)) {
      throw new HttpError(429, label + '下载额度已用完', 'download_quota_exceeded')
    }
  }
}

export function checkDownloadAllowance(subject: string, policy: AudiencePolicy): void {
  checkAllowance(subject, policy, 1, 0)
  const current = usage(subject)
  if ((policy.dailyBytes !== null && current.day.bytes >= policy.dailyBytes)
    || (policy.monthlyBytes !== null && current.month.bytes >= policy.monthlyBytes)) {
    throw new HttpError(429, '下载流量额度已用完', 'download_quota_exceeded')
  }
}

interface DownloadTicket {
  id: string
  subject: string
  target: string
  quality: Quality
  filename: string
  expires_at: number
  started_at: number | null
}

export function issueDownload(subject: string, target: string, quality: Quality, filename: string): string {
  const now = Date.now()
  sql('DELETE FROM download_tickets WHERE expires_at < ?').run(now)
  // Usage older than 3 months cannot affect any current limit.
  sql('DELETE FROM download_usage WHERE updated_at < ?').run(now - 100 * 24 * 60 * 60 * 1000)
  const id = crypto.randomBytes(32).toString('base64url')
  sql(`INSERT INTO download_tickets (id, subject, target, quality, filename, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, subject, target, quality, filename, now + 5 * 60 * 1000)
  return '/api/download/file?t=' + id
}

export function readDownload(id: string, subject: string): DownloadTicket {
  const row = sql('SELECT * FROM download_tickets WHERE id = ? AND subject = ?').get(id, subject) as unknown as DownloadTicket | undefined
  if (!row || row.expires_at <= Date.now()) throw new HttpError(403, '下载链接已失效', 'invalid_ticket')
  if (row.started_at !== null) throw new HttpError(409, '下载链接已使用，请重新发起下载', 'ticket_used')
  return row
}

function transaction<T>(run: () => T): T {
  const db = getDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = run()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function addUsage(subject: string, count: number, bytes: number, keys: ReturnType<typeof periods>) {
  for (const period of [keys.day, keys.month]) {
    sql(`INSERT INTO download_usage (subject, period, downloads, bytes, updated_at) VALUES (?, ?, ?, MAX(0, ?), ?)
      ON CONFLICT(subject, period) DO UPDATE SET downloads = downloads + excluded.downloads,
      bytes = MAX(0, bytes + ?), updated_at = excluded.updated_at`)
      .run(subject, period, count, bytes, Date.now(), bytes)
  }
}

/** Claim and quota reservation are one SQLite transaction, including concurrent clients. */
export function beginDownload(id: string, subject: string, role: string | null | undefined, expectedBytes: number | null) {
  const keys = periods()
  const reserved = Math.max(0, expectedBytes ?? 0)
  let charged = reserved
  transaction(() => {
    const ticket = readDownload(id, subject)
    const policy = assertDownload(role, ticket.quality)
    checkAllowance(subject, policy, 1, reserved, keys)
    sql('UPDATE download_tickets SET started_at = ? WHERE id = ?').run(Date.now(), id)
    addUsage(subject, 1, reserved, keys)
  })
  let sent = 0
  return {
    beforeChunk(bytes: number) {
      const extra = Math.max(0, sent + bytes - charged)
      if (extra) transaction(() => {
        const policy = assertDownload(role)
        checkAllowance(subject, policy, 0, extra, keys)
        addUsage(subject, 0, extra, keys)
      })
      charged += extra
      sent += bytes
    },
    finish() {
      if (charged > sent) transaction(() => addUsage(subject, 0, sent - charged, keys))
      charged = sent
    },
  }
}

export function resetUsage(subject: string): void {
  sql('DELETE FROM download_usage WHERE subject = ?').run(subject)
}
