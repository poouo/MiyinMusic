import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { getDb, p, sql } from './db.js'
import { HttpError } from './errors.js'
import { writeAudit } from './audit.js'
import { assertNotLocked, clearLoginFailures, recordLoginFailure } from './login-guard.js'

const scryptAsync = promisify(crypto.scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>

export type UserRole = 'admin' | 'vip' | 'user'
export type UserStatus = 'active' | 'disabled'

export interface User {
  id: string
  username: string
  nickname: string
  passwordHash: string
  salt: string
  role: UserRole
  status: UserStatus
  avatarColor: string
  createdAt: number
  updatedAt: number
  lastLoginAt: number | null
  lastLoginIp: string | null
}

export interface PublicUser {
  id: string
  username: string
  nickname: string
  avatarColor: string
  role: UserRole
  status: UserStatus
  createdAt: number
  lastLoginAt: number | null
}

interface UserRow {
  id: string
  username: string
  nickname: string
  password_hash: string
  salt: string
  role: string
  status: string
  avatar_color: string
  created_at: number
  updated_at: number
  last_login_at: number | null
  last_login_ip: string | null
}

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000
const AVATAR_COLORS = ['#6c8cff', '#ff5d8f', '#2dd4bf', '#f5a524', '#a78bfa', '#38bdf8', '#fb7185', '#4ade80']

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    passwordHash: row.password_hash,
    salt: row.salt,
    role: row.role === 'admin' ? 'admin' : row.role === 'vip' ? 'vip' : 'user',
    status: row.status === 'disabled' ? 'disabled' : 'active',
    avatarColor: row.avatar_color,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastLoginAt: row.last_login_at == null ? null : Number(row.last_login_at),
    lastLoginIp: row.last_login_ip ?? null,
  }
}

export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    avatarColor: user.avatarColor,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  }
}

export function shortId(prefix = ''): string {
  return prefix + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')
}

export function countUsers(): number {
  return Number((sql('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c)
}

export function countAdmins(): number {
  return Number((sql("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number }).c)
}

export function findByUsername(username: string): User | undefined {
  const row = sql('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username.trim()) as UserRow | undefined
  return row ? toUser(row) : undefined
}

export function findById(id: string): User | undefined {
  const row = sql('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  return row ? toUser(row) : undefined
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await scryptAsync(password, salt, 64)
  return key.toString('hex')
}

async function verifyPassword(password: string, salt: string, expected: string): Promise<boolean> {
  const actual = await scryptAsync(password, salt, 64)
  const target = Buffer.from(expected, 'hex')
  if (actual.length !== target.length) return false
  return crypto.timingSafeEqual(actual, target)
}

function validateCredentials(username: string, password: string): string | null {
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) return '用户名需为 3-24 位字母、数字、下划线或减号'
  if (typeof password !== 'string' || password.length < 6) return '密码至少 6 位'
  if (password.length > 128) return '密码过长'
  return null
}

export interface RegisterInput {
  username: string
  password: string
  nickname?: string
  ip?: string
}

export async function register(input: RegisterInput): Promise<User> {
  const username = String(input.username ?? '').trim()
  const password = String(input.password ?? '')
  const error = validateCredentials(username, password)
  if (error) throw new HttpError(400, error)
  if (findByUsername(username)) throw new HttpError(409, '用户名已被占用')

  const salt = crypto.randomBytes(16).toString('hex')
  const passwordHash = await hashPassword(password, salt)
  const now = Date.now()
  const isFirst = countUsers() === 0
  const user: User = {
    id: shortId('u_'),
    username,
    nickname: String(input.nickname ?? '').trim().slice(0, 24) || username,
    passwordHash,
    salt,
    role: isFirst ? 'admin' : 'user',
    status: 'active',
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    lastLoginIp: null,
  }
  getDb()
    .prepare(
      `INSERT INTO users (id, username, nickname, password_hash, salt, role, status, avatar_color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.id,
      user.username,
      user.nickname,
      user.passwordHash,
      user.salt,
      user.role,
      user.status,
      user.avatarColor,
      user.createdAt,
      user.updatedAt,
    )
  writeAudit({ userId: user.id, username: user.username, action: 'user.register', detail: isFirst ? '首个用户，自动成为管理员' : '', ip: input.ip })
  return user
}

export async function login(input: { username: string; password: string; ip?: string }): Promise<User> {
  const ip = input.ip ?? 'unknown'
  const username = String(input.username ?? '').trim().slice(0, 40)
  // 防爆破：先看是否处于锁定期
  assertNotLocked(ip, username)
  const user = findByUsername(username)
  if (!user) {
    const guard = recordLoginFailure(ip, username)
    writeAudit({
      username,
      action: 'user.login.fail',
      detail: '用户名不存在' + (guard.lockedSeconds ? '，已临时锁定 ' + guard.lockedSeconds + ' 秒' : ''),
      ip,
    })
    throw new HttpError(401, '用户名或密码错误')
  }
  if (!(await verifyPassword(String(input.password ?? ''), user.salt, user.passwordHash))) {
    const guard = recordLoginFailure(ip, username)
    writeAudit({
      userId: user.id,
      username: user.username,
      action: 'user.login.fail',
      detail: '密码错误（累计 ' + guard.failures + ' 次）' + (guard.lockedSeconds ? '，已锁定 ' + guard.lockedSeconds + ' 秒' : ''),
      ip,
    })
    throw new HttpError(
      401,
      guard.lockedSeconds
        ? '密码错误次数过多，已锁定 ' + guard.lockedSeconds + ' 秒'
        : '用户名或密码错误',
    )
  }
  if (user.status === 'disabled') {
    writeAudit({ userId: user.id, username: user.username, action: 'user.login.fail', detail: '账号已禁用', ip: input.ip })
    throw new HttpError(403, '账号已被停用，请联系管理员')
  }
  clearLoginFailures(ip, username)
  const now = Date.now()
  getDb()
    .prepare('UPDATE users SET last_login_at = ?, last_login_ip = ?, updated_at = ? WHERE id = ?')
    .run(now, p(input.ip), now, user.id)
  user.lastLoginAt = now
  user.lastLoginIp = input.ip ?? null
  writeAudit({ userId: user.id, username: user.username, action: 'user.login', ip: input.ip })
  return user
}

export async function changePassword(user: User, oldPassword: string, newPassword: string): Promise<void> {
  if (!(await verifyPassword(String(oldPassword ?? ''), user.salt, user.passwordHash))) {
    throw new HttpError(400, '原密码不正确')
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) throw new HttpError(400, '新密码至少 6 位')
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = await hashPassword(newPassword, salt)
  getDb()
    .prepare('UPDATE users SET salt = ?, password_hash = ?, updated_at = ? WHERE id = ?')
    .run(salt, hash, Date.now(), user.id)
  writeAudit({ userId: user.id, username: user.username, action: 'user.password' })
}

export function updateProfile(user: User, patch: { nickname?: string; avatarColor?: string }): User {
  let nickname = user.nickname
  let avatarColor = user.avatarColor
  if (typeof patch.nickname === 'string') {
    const next = patch.nickname.trim().slice(0, 24)
    if (next) nickname = next
  }
  if (typeof patch.avatarColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(patch.avatarColor)) {
    avatarColor = patch.avatarColor
  }
  getDb()
    .prepare('UPDATE users SET nickname = ?, avatar_color = ?, updated_at = ? WHERE id = ?')
    .run(nickname, avatarColor, Date.now(), user.id)
  user.nickname = nickname
  user.avatarColor = avatarColor
  return user
}

function sessionKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function createSession(userId: string, meta: { ip?: string; userAgent?: string } = {}): string {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now)
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(sessionKey(token), userId, now, now + SESSION_TTL, p(meta.ip), p(meta.userAgent?.slice(0, 200)))
  return token
}

export function getSessionUser(token: string | null): User | null {
  if (!token) return null
  const row = getDb()
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sessionKey(token), Date.now()) as UserRow | undefined
  if (!row) return null
  const user = toUser(row)
  return user.status === 'disabled' ? null : user
}

export function destroySession(token: string | null): void {
  if (!token) return
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sessionKey(token))
}

export function destroyAllSessions(userId: string): void {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export function countSessions(): number {
  return Number((sql('SELECT COUNT(*) AS c FROM sessions WHERE expires_at > ?').get(Date.now()) as { c: number }).c)
}

/** 简易登录限流：同一 IP 5 分钟内最多失败 10 次 */
const attempts = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(ip: string): void {
  const now = Date.now()
  const record = attempts.get(ip)
  if (!record || record.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 5 * 60_000 })
    return
  }
  record.count++
  if (record.count > 10) throw new HttpError(429, '尝试过于频繁，请 5 分钟后再试')
}

export function resetRateLimit(ip: string): void {
  attempts.delete(ip)
}

export async function resetPasswordByAdmin(userId: string, password: string, actor?: { id: string; username: string }): Promise<void> {
  if (typeof password !== 'string' || password.length < 6) throw new HttpError(400, '密码至少 6 位')
  const user = findById(userId)
  if (!user) throw new HttpError(404, '用户不存在')
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = await hashPassword(password, salt)
  getDb()
    .prepare('UPDATE users SET salt = ?, password_hash = ?, updated_at = ? WHERE id = ?')
    .run(salt, hash, Date.now(), userId)
  destroyAllSessions(userId)
  writeAudit({
    userId: actor?.id ?? null,
    username: actor?.username ?? null,
    action: 'admin.user.password',
    detail: '重置了 ' + user.username + ' 的密码',
  })
}

const ROLE_NAMES: Record<UserRole, string> = { admin: '管理员', vip: '会员', user: '普通用户' }

export function setUserRole(userId: string, role: UserRole, actor?: { id: string; username: string }): void {
  const user = findById(userId)
  if (!user) throw new HttpError(404, '用户不存在')
  if (user.role === role) return
  if (user.role === 'admin' && role !== 'admin' && countAdmins() <= 1) {
    throw new HttpError(400, '至少需要保留一位管理员')
  }
  getDb().prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, Date.now(), userId)
  destroyAllSessions(userId)
  writeAudit({
    userId: actor?.id ?? null,
    username: actor?.username ?? null,
    action: 'admin.user.role',
    detail: user.username + '：' + ROLE_NAMES[user.role] + ' → ' + ROLE_NAMES[role],
  })
}

/** 管理员直接创建账号 */
export async function createUserByAdmin(
  input: { username: string; password: string; nickname?: string; role?: UserRole },
  actor?: { id: string; username: string },
): Promise<User> {
  const username = String(input.username ?? '').trim()
  const password = String(input.password ?? '')
  const error = validateCredentials(username, password)
  if (error) throw new HttpError(400, error)
  if (findByUsername(username)) throw new HttpError(409, '用户名已被占用')
  const salt = crypto.randomBytes(16).toString('hex')
  const passwordHash = await hashPassword(password, salt)
  const role: UserRole = input.role === 'admin' || input.role === 'vip' ? input.role : 'user'
  const now = Date.now()
  const user: User = {
    id: shortId('u_'),
    username,
    nickname: String(input.nickname ?? '').trim().slice(0, 24) || username,
    passwordHash,
    salt,
    role,
    status: 'active',
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    lastLoginIp: null,
  }
  getDb()
    .prepare(
      `INSERT INTO users (id, username, nickname, password_hash, salt, role, status, avatar_color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(user.id, user.username, user.nickname, user.passwordHash, user.salt, user.role, user.status, user.avatarColor, user.createdAt, user.updatedAt)
  writeAudit({
    userId: actor?.id ?? null,
    username: actor?.username ?? null,
    action: 'admin.user.create',
    detail: '创建了 ' + user.username + '（' + ROLE_NAMES[role] + '）',
  })
  return user
}

export function setUserStatus(userId: string, status: UserStatus, actor?: { id: string; username: string }): void {
  const user = findById(userId)
  if (!user) throw new HttpError(404, '用户不存在')
  if (user.status === status) return
  getDb().prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), userId)
  if (status === 'disabled') destroyAllSessions(userId)
  writeAudit({
    userId: actor?.id ?? null,
    username: actor?.username ?? null,
    action: 'admin.user.status',
    detail: user.username + ' → ' + (status === 'disabled' ? '停用' : '启用'),
  })
}

export function setNickname(userId: string, nickname: string, actor?: { id: string; username: string }): void {
  const next = nickname.trim().slice(0, 24)
  if (!next) throw new HttpError(400, '昵称不能为空')
  const user = findById(userId)
  if (!user) throw new HttpError(404, '用户不存在')
  getDb().prepare('UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?').run(next, Date.now(), userId)
  writeAudit({
    userId: actor?.id ?? null,
    username: actor?.username ?? null,
    action: 'admin.user.rename',
    detail: user.nickname + ' → ' + next,
  })
}

export function deleteUserById(userId: string, actor?: { id: string; username: string }): void {
  const user = findById(userId)
  if (!user) throw new HttpError(404, '用户不存在')
  if (user.role === 'admin' && countAdmins() <= 1) throw new HttpError(400, '至少需要保留一位管理员')
  getDb().prepare('DELETE FROM users WHERE id = ?').run(userId)
  writeAudit({
    userId: actor?.id ?? null,
    username: actor?.username ?? null,
    action: 'admin.user.delete',
    detail: '删除了 ' + user.username,
  })
}