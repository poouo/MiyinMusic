import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { User } from './auth.js'
import { config } from './config.js'
import { getDb, transaction } from './db.js'
import * as devices from './device-auth.js'
import { HttpError } from './errors.js'
import { XiaozhiMcpBridge } from './xiaozhi-bridge.js'

interface ConnectionRow { user_id: string; key_id: string; endpoint_hash: string; secret: string; enabled: number }
interface Secret { endpoint: string; apiKey: string }
type State = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'blocked' | 'error'
interface Runtime { bridge?: XiaozhiMcpBridge; secret: string; state: State; connectedAt?: number; message?: string }
const runtimes = new Map<string, Runtime>()
let mcpUrl: string | undefined
let timer: ReturnType<typeof setInterval> | undefined

/** A browser user may connect only to the official service, never arbitrary LAN hosts. */
export function validateXiaozhiEndpoint(input: unknown): string {
  try {
    if (typeof input !== 'string' || input.length > 4096) throw new Error()
    const url = new URL(input.trim())
    if (url.protocol !== 'wss:' || (url.hostname !== 'xiaozhi.me' && !url.hostname.endsWith('.xiaozhi.me'))
      || (url.port && url.port !== '443') || !/^\/mcp\/?$/.test(url.pathname)
      || url.username || url.password || url.hash || !url.searchParams.get('token')) throw new Error()
    return url.href
  } catch { throw new HttpError(400, '请粘贴小智控制台提供的完整 wss:// MCP 接入点', 'invalid_xiaozhi_endpoint') }
}

function encryptionKey(): Buffer {
  const file = path.join(config.dataDir, 'xiaozhi-mcp.key')
  fs.mkdirSync(config.dataDir, { recursive: true })
  try { fs.writeFileSync(file, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const key = fs.readFileSync(file)
  if (key.length !== 32) throw new Error('Invalid Xiaozhi encryption key')
  return key
}

function seal(userId: string, value: Secret): string {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(Buffer.from(userId))
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

function unseal(row: ConnectionRow): Secret {
  const data = Buffer.from(row.secret, 'base64url')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12))
  decipher.setAAD(Buffer.from(row.user_id)); decipher.setAuthTag(data.subarray(12, 28))
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')) as Secret
}

function connection(userId: string): ConnectionRow | undefined {
  return getDb().prepare('SELECT * FROM xiaozhi_mcp_connections WHERE user_id = ?').get(userId) as unknown as ConnectionRow | undefined
}

function stop(userId: string) {
  const runtime = runtimes.get(userId)
  runtimes.delete(userId)
  runtime?.bridge?.stop()
}

export function stopXiaozhiForKey(userId: string, keyId: string): void {
  const row = connection(userId)
  if (row?.key_id === keyId) stop(userId)
}

function reconcile(row: ConnectionRow) {
  let runtime = runtimes.get(row.user_id)
  if (!row.enabled) { stop(row.user_id); return }
  let secret: Secret
  try { secret = unseal(row) }
  catch {
    stop(row.user_id)
    runtimes.set(row.user_id, { secret: row.secret, state: 'error', message: '接入配置无法解密，请移除后重新连接' })
    return
  }
  try {
    const identity = devices.authenticateToken(secret.apiKey)
    if (identity.user.id !== row.user_id || identity.key.id !== row.key_id) throw new Error()
  } catch {
    stop(row.user_id)
    runtimes.set(row.user_id, { secret: row.secret, state: 'blocked', message: '设备 API 未开放、权限已撤销或密钥已失效' })
    return
  }
  if (!mcpUrl || (runtime?.bridge && runtime.secret === row.secret)) return
  stop(row.user_id)
  runtime = { secret: row.secret, state: 'connecting' }
  const current = runtime
  current.bridge = new XiaozhiMcpBridge({ endpoint: validateXiaozhiEndpoint(secret.endpoint), mcpUrl, apiKey: secret.apiKey,
    onState: (state, connectedAt) => {
      if (runtimes.get(row.user_id) !== current) return
      current.state = state; current.connectedAt = connectedAt
    } })
  runtimes.set(row.user_id, current)
  current.bridge.start()
}

export function startXiaozhiConnections(localMcpUrl: string): void {
  stopXiaozhiConnections()
  mcpUrl = localMcpUrl
  const sync = () => {
    const rows = getDb().prepare('SELECT * FROM xiaozhi_mcp_connections').all() as unknown as ConnectionRow[]
    const users = new Set(rows.map(row => row.user_id))
    for (const id of runtimes.keys()) if (!users.has(id)) stop(id)
    for (const row of rows) reconcile(row)
  }
  sync()
  timer = setInterval(sync, 15_000)
  timer.unref()
}

export function stopXiaozhiConnections(): void {
  clearInterval(timer); timer = undefined; mcpUrl = undefined
  for (const id of runtimes.keys()) stop(id)
}

export function xiaozhiStatus(user: User) {
  const row = connection(user.id)
  if (!row) { stop(user.id); return { configured: false, enabled: false, state: 'disabled' as State } }
  reconcile(row)
  const runtime = runtimes.get(user.id)
  const key = devices.listKeys(user.id).find(key => key.id === row.key_id)
  return { configured: true, enabled: !!row.enabled, state: runtime?.state ?? (row.enabled ? 'connecting' : 'disabled'),
    connectedAt: runtime?.connectedAt, message: runtime?.message, keyId: row.key_id, scopes: key?.scopes ?? [] }
}

export function saveXiaozhi(user: User, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '接入配置无效')
  const body = input as Record<string, unknown>
  if (Object.keys(body).some(key => !['endpoint', 'enabled', 'scopes'].includes(key)) || typeof body.enabled !== 'boolean') throw new HttpError(400, '接入配置无效')
  const old = connection(user.id)
  // Disconnection remains available even after an administrator withdraws API access.
  if (!body.enabled) {
    if (old) getDb().prepare('UPDATE xiaozhi_mcp_connections SET enabled = 0 WHERE user_id = ?').run(user.id)
    stop(user.id)
    return xiaozhiStatus(user)
  }
  devices.assertAccess(user)
  const endpoint = body.endpoint === undefined && old ? unsealSafely(old).endpoint : validateXiaozhiEndpoint(body.endpoint)
  const hash = crypto.createHash('sha256').update(new URL(endpoint).searchParams.get('token')!).digest('hex')
  const duplicate = getDb().prepare('SELECT user_id FROM xiaozhi_mcp_connections WHERE endpoint_hash = ? AND user_id != ?').get(hash, user.id)
  if (duplicate) throw new HttpError(409, '该接入点已配置，请使用当前智能体独立的接入点')
  transaction(() => {
    let secret: Secret, keyId: string
    if (old) {
      secret = unsealSafely(old); secret.endpoint = endpoint; keyId = old.key_id
      const identity = devices.authenticateToken(secret.apiKey)
      if (identity.user.id !== user.id || identity.key.id !== keyId) throw new HttpError(403, '设备密钥已失效，请移除后重新连接')
      if (body.scopes !== undefined) devices.updateKey(user, keyId, { scopes: body.scopes })
    } else {
      const created = devices.createKey(user, { name: '小智 MCP', scopes: body.scopes ?? ['search', 'playback'], expiresInDays: null })
      secret = { endpoint, apiKey: created.token }; keyId = created.key.id
    }
    getDb().prepare(`INSERT INTO xiaozhi_mcp_connections(user_id, key_id, endpoint_hash, secret, enabled) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET endpoint_hash = excluded.endpoint_hash, secret = excluded.secret, enabled = 1`)
      .run(user.id, keyId, hash, seal(user.id, secret))
  })
  stop(user.id)
  return xiaozhiStatus(user)
}

function unsealSafely(row: ConnectionRow): Secret {
  try { return unseal(row) }
  catch { throw new HttpError(400, '接入配置无法解密，请移除后重新连接') }
}

export function removeXiaozhi(user: User) {
  const row = connection(user.id)
  stop(user.id)
  if (row) devices.revokeKey(user.id, row.key_id, user)
  return xiaozhiStatus(user)
}
