import crypto from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { findById, shortId, type User } from './auth.js'
import { getAppConfig, type DeviceApiConfig } from './app-config.js'
import { getDb } from './db.js'
import { HttpError } from './errors.js'
import { bearerToken, clientIp } from './http-util.js'
import { createLimiter } from './rate-limit.js'
import { writeAudit } from './audit.js'

export const DEVICE_SCOPES = ['search', 'playback', 'download', 'lyrics', 'library'] as const
export type DeviceScope = typeof DEVICE_SCOPES[number]
export type AccessMode = 'inherit' | 'allow' | 'deny'
interface KeyRow {
  id: string; user_id: string; name: string; prefix: string; scopes: string
  created_at: number; expires_at: number | null; last_used_at: number | null
}
export interface DeviceIdentity { user: User; key: ReturnType<typeof publicKey> }
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex')
const invalidLimiter = createLimiter(90, 60_000)
const buckets = new Map<string, { count: number; resetAt: number }>()

function publicKey(row: KeyRow) {
  return { id: row.id, name: row.name, prefix: row.prefix, scopes: JSON.parse(row.scopes) as DeviceScope[],
    createdAt: row.created_at, expiresAt: row.expires_at, lastUsedAt: row.last_used_at }
}

export function validateConfig(input: unknown): Partial<DeviceApiConfig> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '设备 API 设置格式不正确')
  const raw = input as Record<string, unknown>
  if (Object.keys(raw).some(key => !['enabled', 'roles', 'requestsPerMinute'].includes(key))
    || (raw.enabled !== undefined && typeof raw.enabled !== 'boolean')
    || (raw.roles !== undefined && (!Array.isArray(raw.roles) || raw.roles.some(role => typeof role !== 'string' || !['user', 'vip', 'admin'].includes(role))))
    || (raw.requestsPerMinute !== undefined && (typeof raw.requestsPerMinute !== 'number'
      || !Number.isSafeInteger(raw.requestsPerMinute) || raw.requestsPerMinute < 10 || raw.requestsPerMinute > 600))) {
    throw new HttpError(400, '设备 API 参数无效；频率范围为每分钟 10–600 次')
  }
  return raw as Partial<DeviceApiConfig>
}

export function access(user: User) {
  const settings = getAppConfig().deviceApi
  const row = getDb().prepare('SELECT mode FROM device_api_access WHERE user_id = ?').get(user.id)
  const mode = (row?.mode ?? 'inherit') as AccessMode
  const authorized = mode === 'allow' || (mode === 'inherit' && settings.roles.includes(user.role))
  return { enabled: settings.enabled, authorized, allowed: settings.enabled && authorized && user.status === 'active',
    mode, requestsPerMinute: settings.requestsPerMinute }
}

export function assertAccess(user: User): void {
  const policy = access(user)
  if (!policy.enabled) throw new HttpError(403, '设备 API 尚未开启', 'device_api_disabled')
  if (!policy.allowed) throw new HttpError(403, '当前用户未获设备 API 授权', 'device_api_forbidden')
}

export function setAccess(user: User, mode: unknown, actor: User) {
  if (typeof mode !== 'string' || !['inherit', 'allow', 'deny'].includes(mode)) throw new HttpError(400, '用户 API 权限无效')
  getDb().prepare(`INSERT INTO device_api_access(user_id, mode) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET mode = excluded.mode`).run(user.id, String(mode))
  writeAudit({ userId: actor.id, username: actor.username, action: 'admin.device.access', detail: user.username + ': ' + mode })
  return access(user)
}

export function listKeys(userId: string) {
  return (getDb().prepare('SELECT * FROM device_api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId) as unknown as KeyRow[]).map(publicKey)
}

export function createKey(user: User, input: unknown) {
  assertAccess(user)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '密钥参数无效')
  const { name, scopes, expiresInDays = 90 } = input as Record<string, unknown>
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60
    || !Array.isArray(scopes) || !scopes.length || scopes.some(scope => !DEVICE_SCOPES.includes(scope as DeviceScope))
    || (expiresInDays !== null && (typeof expiresInDays !== 'number' || !Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365))) {
    throw new HttpError(400, '请填写设备名称、至少一项权限和有效期（1–365 天或 null）')
  }
  const db = getDb(), now = Date.now()
  db.prepare('DELETE FROM device_api_keys WHERE user_id = ? AND expires_at <= ?').run(user.id, now)
  if (listKeys(user.id).length >= 10) throw new HttpError(400, '每个用户最多保留 10 个设备密钥')
  const token = 'myk_' + crypto.randomBytes(32).toString('base64url')
  const row: KeyRow = { id: shortId('dk_'), user_id: user.id, name: name.trim(), prefix: token.slice(0, 12),
    scopes: JSON.stringify([...new Set(scopes)]), created_at: now,
    expires_at: expiresInDays === null ? null : now + (expiresInDays as number) * 86400_000, last_used_at: null }
  db.prepare(`INSERT INTO device_api_keys(id,user_id,name,token_hash,prefix,scopes,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(row.id, user.id, row.name, hash(token), row.prefix, row.scopes, now, row.expires_at)
  writeAudit({ userId: user.id, username: user.username, action: 'device.key.create', detail: row.name })
  return { token, key: publicKey(row) }
}

export function revokeKey(userId: string, id: string, actor: User): void {
  const result = getDb().prepare('DELETE FROM device_api_keys WHERE id = ? AND user_id = ?').run(id, userId)
  if (!result.changes) throw new HttpError(404, '设备密钥不存在', 'not_found')
  writeAudit({ userId: actor.id, username: actor.username, action: 'device.key.revoke', detail: id })
}

export function updateKey(user: User, id: string, input: unknown) {
  const row = getDb().prepare('SELECT * FROM device_api_keys WHERE id = ? AND user_id = ?').get(id, user.id) as unknown as KeyRow | undefined
  if (!row) throw new HttpError(404, '设备密钥不存在', 'not_found')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '密钥参数无效')
  const patch = input as Record<string, unknown>
  if (!Object.keys(patch).length || Object.keys(patch).some(key => !['name', 'scopes'].includes(key))
    || (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.trim().length > 60))
    || (patch.scopes !== undefined && (!Array.isArray(patch.scopes) || !patch.scopes.length || patch.scopes.some(scope => !DEVICE_SCOPES.includes(scope as DeviceScope))))) {
    throw new HttpError(400, '设备密钥配置无效')
  }
  row.name = patch.name === undefined ? row.name : (patch.name as string).trim()
  row.scopes = patch.scopes === undefined ? row.scopes : JSON.stringify([...new Set(patch.scopes as DeviceScope[])])
  getDb().prepare('UPDATE device_api_keys SET name = ?, scopes = ? WHERE id = ? AND user_id = ?')
    .run(row.name, row.scopes, id, user.id)
  writeAudit({ userId: user.id, username: user.username, action: 'device.key.update', detail: row.name })
  return publicKey(row)
}

function identityFor(row: KeyRow | undefined): DeviceIdentity {
  if (!row || (row.expires_at !== null && row.expires_at <= Date.now())) throw new HttpError(401, '设备密钥无效或已过期', 'invalid_api_key')
  const user = findById(row.user_id)
  if (!user || user.status !== 'active') throw new HttpError(403, '用户已被停用', 'device_api_forbidden')
  assertAccess(user)
  if (row.last_used_at === null || Date.now() - row.last_used_at > 60_000) {
    getDb().prepare('UPDATE device_api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id)
  }
  return { user, key: publicKey(row) }
}

export function authenticate(req: IncomingMessage): DeviceIdentity {
  const token = bearerToken(req)
  const row = token && /^myk_[A-Za-z0-9_-]{43}$/.test(token)
    ? getDb().prepare('SELECT * FROM device_api_keys WHERE token_hash = ?').get(hash(token)) as unknown as KeyRow | undefined : undefined
  if (!row && !invalidLimiter.hit(clientIp(req))) throw new HttpError(429, '无效鉴权请求过多', 'rate_limited')
  return identityFor(row)
}

/** Internal bridge credentials go through the same live authorization as HTTP requests. */
export function authenticateToken(token: string): DeviceIdentity {
  const row = /^myk_[A-Za-z0-9_-]{43}$/.test(token)
    ? getDb().prepare('SELECT * FROM device_api_keys WHERE token_hash = ?').get(hash(token)) as unknown as KeyRow | undefined : undefined
  return identityFor(row)
}

export function refresh(identity: DeviceIdentity): DeviceIdentity {
  return identityFor(getDb().prepare('SELECT * FROM device_api_keys WHERE id = ?').get(identity.key.id) as unknown as KeyRow | undefined)
}

export function requireScope(identity: DeviceIdentity, scope: DeviceScope): void {
  if (!identity.key.scopes.includes(scope)) throw new HttpError(403, '设备密钥未授权此操作', 'insufficient_scope')
}

/** All keys of one account share the limit, independently of browser traffic. */
export function rateLimit(identity: DeviceIdentity): void {
  const now = Date.now(), key = identity.user.id
  if (buckets.size > 5000) for (const [id, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(id)
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) { bucket = { count: 0, resetAt: now + 60_000 }; buckets.set(key, bucket) }
  const limit = getAppConfig().deviceApi.requestsPerMinute
  if (++bucket.count > limit) throw new HttpError(429, '设备 API 调用频率超限，请稍后重试', 'rate_limited')
}
