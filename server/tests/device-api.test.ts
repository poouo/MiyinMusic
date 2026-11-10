import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { after, afterEach, before, beforeEach, mock, test } from 'node:test'
import type { User } from '../src/auth.js'
import type { Quality, Song } from '../src/types.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { WebSocketServer, type WebSocket } from 'ws'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'miyin-device-test-'))
process.env.MIYIN_DATA_DIR = temp
const { getDb, closeDb } = await import('../src/db.js')
const auth = await import('../src/auth.js')
const { handleApi } = await import('../src/routes.js')
const { HttpError } = await import('../src/errors.js')
const { sendError } = await import('../src/http-util.js')
const { updateAppConfig, getAppConfig, unrestrictedPolicy } = await import('../src/app-config.js')
const { sourceManager } = await import('../src/lx/manager.js')
const { getProvider } = await import('../src/providers/index.js')
const library = await import('../src/library.js')
const membership = await import('../src/membership.js')
const { sessionCache } = await import('../src/session-cache.js')
const { XiaozhiMcpBridge } = await import('../src/xiaozhi-bridge.js')
const xiaozhi = await import('../src/xiaozhi.js')
let server: http.Server, base: string, admin: User, user: User, other: User
let adminToken: string, userToken: string, otherToken: string
let supported: Quality[], resolved: Quality[][], sourceCalls: Song[], onResolve: () => Promise<void>
const song: Song = { platform: 'wy', songmid: 'device-song', name: '测试歌曲', singer: '测试歌手', albumName: '测试专辑',
  interval: 200, qualities: ['128k', '320k', 'flac', 'flac24bit'], hash: 'platform-specific-field' }
const nativeFetch = globalThis.fetch
const request = (endpoint: string, method = 'GET', body?: unknown, token = '', headers: Record<string, string> = {}) => fetch(base + endpoint, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
})
async function key(scopes = ['search', 'playback', 'download', 'lyrics', 'library'], token = userToken) {
  const response = await request('/api/device-api/keys', 'POST', { name: '客厅设备', scopes, expiresInDays: 90 }, token)
  assert.equal(response.status, 201, await response.clone().text())
  return await response.json() as { token: string; key: { id: string; name: string; scopes: string[] } }
}
async function json(response: Response) { return response.json() as Promise<any> }

before(async () => {
  admin = await auth.register({ username: 'deviceadmin', password: 'password123' })
  user = await auth.register({ username: 'deviceowner', password: 'password123' })
  other = await auth.register({ username: 'deviceother', password: 'password123' })
  adminToken = auth.createSession(admin.id); userToken = auth.createSession(user.id); otherToken = auth.createSession(other.id)
  server = http.createServer((req, res) => {
    void (async () => {
      try { if (!await handleApi(req, res, new URL(req.url!, base))) sendError(res, 404, 'not found') }
      catch (error) {
        if (!res.headersSent) sendError(res, error instanceof HttpError ? error.status : 500, (error as Error).message,
          error instanceof HttpError ? error.code : 'error')
        else res.destroy()
      }
    })()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port
})
beforeEach(() => {
  const db = getDb()
  db.exec('DELETE FROM device_api_keys; DELETE FROM device_api_access; DELETE FROM download_usage; DELETE FROM audio_cache; DELETE FROM lyric_cache; DELETE FROM playlists; DELETE FROM favorites')
  db.prepare("UPDATE users SET status = 'active', role = 'user' WHERE id IN (?, ?)").run(user.id, other.id)
  sessionCache.clear()
  updateAppConfig({ deviceApi: { enabled: true, roles: ['admin', 'user'], requestsPerMinute: 600 },
    cache: { enabled: true, warmCollections: false }, membership: { enabled: true, audiences: { user: unrestrictedPolicy(), vip: unrestrictedPolicy() } } })
  supported = [...song.qualities]; resolved = []; sourceCalls = []; onResolve = async () => {}
  mock.method(sourceManager, 'getMusicUrl', async (track: Song, qualities: Quality[], _source: unknown, strict: boolean) => {
    assert.equal(strict, true)
    sourceCalls.push(track); resolved.push([...qualities])
    await onResolve()
    const quality = qualities.find(q => supported.includes(q))
    if (!quality) throw new Error('fixture: requested quality unavailable')
    return { url: 'https://93.184.216.34/audio/' + quality, quality, sourceId: 'fixture', sourceName: 'fixture', platform: track.platform, duration: 200 }
  })
  mock.method(getProvider('wy'), 'search', async (_q: string, page: number, limit: number) => ({ platform: 'wy', list: [song], total: 1, page, limit, hasMore: false }))
  mock.method(getProvider('wy'), 'lyric', async () => ({ lyric: '[00:01.00]测试歌词' }))
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const target = new URL(input instanceof Request ? input.url : String(input))
    assert.equal(target.hostname, '127.0.0.1', 'device routes must not fetch or proxy full audio or contact real providers')
    return nativeFetch(input, init)
  })
})
afterEach(() => { xiaozhi.stopXiaozhiConnections(); mock.restoreAll() })
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  closeDb()
  const resolved = fs.realpathSync(temp)
  assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase())
  assert.ok(path.basename(resolved).startsWith('miyin-device-test-'))
  fs.rmSync(resolved, { recursive: true })
})

test('API defaults off on upgrade and partial site updates preserve device settings', async () => {
  const { deviceApi: _deviceApi, ...legacy } = getAppConfig()
  getDb().prepare("UPDATE meta SET value = ? WHERE key = 'app_config'").run(JSON.stringify(legacy))
  assert.equal(getAppConfig().deviceApi.enabled, false)
  assert.equal((await request('/api/device-api/keys', 'POST', { name: 'test', scopes: ['search'] }, userToken)).status, 403)
  updateAppConfig({ deviceApi: { enabled: true, roles: ['user'], requestsPerMinute: 123 } })
  await request('/api/admin/config', 'PUT', { registration: { enabled: true } }, adminToken)
  assert.deepEqual(getAppConfig().deviceApi, { enabled: true, roles: ['user'], requestsPerMinute: 123 })
})

test('global and per-user authorization are admin-only and strictly validated', async () => {
  const endpoint = '/api/admin/users/' + user.id + '/device-api'
  for (const token of ['', userToken]) {
    assert.equal((await request(endpoint, 'PUT', { mode: 'allow' }, token)).status, 404)
    assert.equal((await request('/api/admin/config', 'PUT', { deviceApi: { enabled: true } }, token)).status, 404)
  }
  const saved = getAppConfig().deviceApi
  for (const deviceApi of [null, [], { enabled: 'true' }, { roles: ['guest'] }, { roles: [['admin']] }, { requestsPerMinute: 0 }, { requestsPerMinute: 600.5 }, { unknown: true }]) {
    assert.equal((await request('/api/admin/config', 'PUT', { deviceApi }, adminToken)).status, 400)
    assert.deepEqual(getAppConfig().deviceApi, saved)
  }
  for (const mode of ['', null, ['allow'], 'admin']) assert.equal((await request(endpoint, 'PUT', { mode }, adminToken)).status, 400)
  updateAppConfig({ deviceApi: { roles: [] } })
  assert.equal((await request('/api/device-api/keys', 'POST', { name: 'x', scopes: ['search'] }, userToken)).status, 403)
  assert.equal((await request(endpoint, 'PUT', { mode: 'allow' }, adminToken)).status, 200)
  const created = await key(['search'])
  assert.equal((await request('/api/v1/me', 'GET', undefined, created.token)).status, 200)
  await request(endpoint, 'PUT', { mode: 'deny' }, adminToken)
  assert.equal((await request('/api/v1/me', 'GET', undefined, created.token)).status, 403)
})

test('keys are hashed, secrets appear once, lists are owner-scoped and editing does not rotate tokens', async () => {
  const created = await key()
  assert.match(created.token, /^myk_[A-Za-z0-9_-]{43}$/)
  const stored = getDb().prepare('SELECT * FROM device_api_keys WHERE id = ?').get(created.key.id)!
  assert.equal(String(stored.token_hash).length, 64)
  assert.ok(!JSON.stringify(stored).includes(created.token))
  const listing = await json(await request('/api/device-api', 'GET', undefined, userToken))
  assert.equal(listing.keys.length, 1)
  assert.ok(!JSON.stringify(listing).includes(created.token)); assert.equal(listing.keys[0].token_hash, undefined)
  assert.deepEqual((await json(await request('/api/device-api', 'GET', undefined, otherToken))).keys, [])
  const endpoint = '/api/device-api/keys/' + created.key.id
  for (const method of ['PATCH', 'DELETE']) assert.equal((await request(endpoint, method, { name: 'other' }, otherToken)).status, 404)
  assert.equal((await request(endpoint, 'PATCH', { name: '卧室音箱', scopes: ['search'] }, userToken)).status, 200)
  const me = await json(await request('/api/v1/me', 'GET', undefined, created.token))
  assert.equal(me.key.name, '卧室音箱'); assert.deepEqual(me.key.scopes, ['search'])
  assert.equal(me.user.passwordHash, undefined)
  assert.equal((await request('/api/v1/playback', 'POST', { song }, created.token)).status, 403)
})

test('session cookies cannot authenticate devices; device keys cannot manage sessions, users or keys', async () => {
  const created = await key()
  for (const token of ['', userToken]) assert.equal((await request('/api/v1/me', 'GET', undefined, token)).status, 401)
  assert.equal((await request('/api/v1/me', 'GET', undefined, '', { Cookie: 'miyin_token=' + userToken })).status, 401)
  const invalid = await request('/api/v1/me?api_key=' + created.token)
  assert.equal(invalid.status, 401); assert.match(invalid.headers.get('www-authenticate')!, /Bearer/)
  assert.equal((await request('/api/device-api/keys', 'POST', { name: 'escape', scopes: ['search'] }, created.token)).status, 401)
  assert.equal((await request('/api/admin/config', 'GET', undefined, created.token)).status, 404)
  assert.equal((await json(await request('/api/auth/me', 'GET', undefined, created.token))).user, null)
  // Browser CSRF remains enforced; hardware authentication does not depend on Origin.
  assert.equal((await request('/api/device-api/keys', 'POST', { name: 'bad', scopes: ['search'] }, userToken, { Origin: 'https://other.example' })).status, 403)
  assert.equal((await request('/api/v1/playback', 'POST', { song }, created.token, { Origin: 'https://device.example' })).status, 200)
})

test('expiry, deletion, account suspension and global switch block subsequent API calls', async () => {
  const created = await key()
  updateAppConfig({ deviceApi: { enabled: false } })
  assert.equal((await request('/api/v1/me', 'GET', undefined, created.token)).status, 403)
  updateAppConfig({ deviceApi: { enabled: true } })
  getDb().prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(user.id)
  assert.equal((await request('/api/v1/me', 'GET', undefined, created.token)).status, 403)
  getDb().prepare("UPDATE users SET status = 'active' WHERE id = ?").run(user.id)
  getDb().prepare('UPDATE device_api_keys SET expires_at = ? WHERE id = ?').run(Date.now() - 1, created.key.id)
  assert.equal((await request('/api/v1/me', 'GET', undefined, created.token)).status, 401)
  assert.equal((await request('/api/device-api/keys/' + created.key.id, 'DELETE', undefined, userToken)).status, 200)
  assert.equal((await request('/api/v1/me', 'GET', undefined, created.token)).status, 401)
  const next = await key()
  assert.equal((await request('/api/admin/users/' + user.id + '/device-api/keys/' + next.key.id, 'DELETE', undefined, adminToken)).status, 200)
  assert.equal((await request('/api/v1/me', 'GET', undefined, next.token)).status, 401)
})

test('device credentials validate scopes and expiry, and limit each owner to ten keys', async () => {
  for (const body of [null, [], { name: '', scopes: ['search'] }, { name: 'x', scopes: [] }, { name: 'x', scopes: ['admin'] },
    { name: 'x', scopes: ['search'], expiresInDays: 0 }, { name: 'x', scopes: ['search'], expiresInDays: '90' }]) {
    assert.equal((await request('/api/device-api/keys', 'POST', body, userToken)).status, 400)
  }
  for (let i = 0; i < 10; i++) await key(['search'])
  assert.equal((await request('/api/device-api/keys', 'POST', { name: '11', scopes: ['search'] }, userToken)).status, 400)
  assert.equal((await request('/api/device-api/keys', 'POST', { name: 'other', scopes: ['search'], expiresInDays: null }, otherToken)).status, 201)
})

test('search, lyrics and libraries use explicit scopes and never disclose another owner', async () => {
  const created = await key(['search', 'lyrics', 'library'])
  const result = await json(await request('/api/v1/search?q=测试&platform=wy&page=1&limit=10', 'GET', undefined, created.token))
  assert.equal(result.result.list[0].hash, song.hash)
  for (const query of ['q=', 'q=test&platform=all', 'q=test&limit=51', 'q=test&page=NaN']) {
    assert.equal((await request('/api/v1/search?' + query, 'GET', undefined, created.token)).status, 400)
  }
  const own = library.createPlaylist(user.id, { name: '我的设备歌单' }).playlists[0]
  library.addPlaylistSong(user.id, own.id, song); library.addFavorite(user.id, song)
  const theirs = library.createPlaylist(other.id, { name: '别人的歌单' }).playlists[0]
  const listing = await json(await request('/api/v1/playlists', 'GET', undefined, created.token))
  assert.deepEqual(listing.playlists.map((item: any) => item.id), [own.id])
  assert.equal(listing.playlists[0].songCount, 1); assert.equal(listing.playlists[0].songs, undefined)
  assert.equal((await request('/api/v1/playlists/' + theirs.id, 'GET', undefined, created.token)).status, 404)
  assert.equal((await json(await request('/api/v1/favorites?limit=1', 'GET', undefined, created.token))).songs[0].songmid, song.songmid)
  assert.match((await json(await request('/api/v1/lyrics', 'POST', { song }, created.token))).lyric.lyric, /测试歌词/)
  const limited = await key(['search'])
  for (const endpoint of ['/api/v1/playlists', '/api/v1/favorites']) assert.equal((await request(endpoint, 'GET', undefined, limited.token)).status, 403)
  assert.equal((await request('/api/v1/lyrics', 'POST', { song }, limited.token)).status, 403)
})

test('playback returns upstream direct URLs and never selects local cache or relays audio', async () => {
  getDb().prepare(`INSERT INTO audio_cache(cache_key,song_key,platform,songmid,quality,file_name,bytes,created_at,last_access_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('device-cache', 'wy_' + song.songmid, 'wy', song.songmid, '320k', 'fixture.mp3', 100, Date.now(), Date.now())
  const created = await key(['playback'])
  const response = await request('/api/v1/playback', 'POST', { song, quality: '320k' }, created.token)
  assert.equal(response.status, 200)
  const data = await json(response)
  assert.equal(data.url, 'https://93.184.216.34/audio/320k'); assert.equal(data.delivery, 'direct')
  assert.equal(data.expiresAt, null); assert.equal(data.downgraded, false)
  assert.equal(sourceCalls[0].hash, song.hash)
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM audio_cache').get()!.c, 1)
  const capabilities = await json(await request('/api/v1/capabilities', 'GET', undefined, created.token))
  assert.equal(capabilities.mediaUrlMode, 'direct')
})

test('fallback is opt-in, descends only, and honors current account quality permissions', async () => {
  const created = await key(['playback'])
  supported = ['128k', '320k']
  for (const extra of [{ fallback: false }, {}]) {
    const response = await request('/api/v1/playback', 'POST', { song, quality: 'flac24bit', ...extra }, created.token)
    assert.equal(response.status, 502); assert.equal((await json(response)).error.code, 'quality_unavailable')
    assert.deepEqual(resolved.at(-1), ['flac24bit'])
  }
  const data = await json(await request('/api/v1/playback', 'POST', { song, quality: 'flac24bit', fallback: true }, created.token))
  assert.deepEqual(resolved.at(-1), ['flac24bit', 'flac', '320k', '128k'])
  assert.equal(data.quality, '320k'); assert.equal(data.requestedQuality, 'flac24bit'); assert.equal(data.downgraded, true)
  updateAppConfig({ membership: { audiences: { user: { playbackQualities: ['128k'] } } } })
  assert.equal((await request('/api/v1/playback', 'POST', { song, quality: 'flac', fallback: false }, created.token)).status, 403)
  assert.equal((await request('/api/v1/playback', 'POST', { song, quality: 'flac', fallback: true }, created.token)).status, 200)
  assert.deepEqual(resolved.at(-1), ['128k'])
  supported = ['flac']
  assert.equal((await request('/api/v1/playback', 'POST', { song, quality: '128k', fallback: true }, created.token)).status, 502)
  assert.deepEqual(resolved.at(-1), ['128k'])
  assert.equal((await request('/api/v1/playback', 'POST', { song, fallback: 'true' }, created.token)).status, 400)
})

test('permissions are rechecked after asynchronous resolution before any direct link is disclosed', async () => {
  const created = await key(['playback'])
  onResolve = async () => { updateAppConfig({ deviceApi: { enabled: false } }) }
  assert.equal((await request('/api/v1/playback', 'POST', { song }, created.token)).status, 403)
  updateAppConfig({ deviceApi: { enabled: true } })
  onResolve = async () => { getDb().prepare('DELETE FROM device_api_keys WHERE id = ?').run(created.key.id) }
  assert.equal((await request('/api/v1/playback', 'POST', { song }, created.token)).status, 401)
})

test('direct download counts successful link issuance atomically and never bypasses byte quotas', async () => {
  const created = await key(['download'])
  updateAppConfig({ membership: { audiences: { user: { dailyDownloads: 1 } } } })
  const responses = await Promise.all([1, 2].map(() => request('/api/v1/download', 'POST', { song, quality: '128k' }, created.token)))
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 429])
  const success = await json(responses.find(response => response.status === 200)!)
  assert.equal(success.delivery, 'direct'); assert.equal(success.url, 'https://93.184.216.34/audio/128k')
  assert.match(success.filename, /\.mp3$/)
  assert.equal(membership.usage('u:' + user.id).day.downloads, 1)
  assert.equal(membership.usage('u:' + user.id).day.bytes, 0)
  membership.resetUsage('u:' + user.id)
  updateAppConfig({ membership: { audiences: { user: { dailyBytes: 1000 } } } })
  const blocked = await request('/api/v1/download', 'POST', { song }, created.token)
  assert.equal(blocked.status, 403); assert.equal((await json(blocked)).error.code, 'direct_download_byte_quota')
  assert.equal(membership.usage('u:' + user.id).day.downloads, 0)
})

test('failed or unauthorized downloads do not consume quota and strict quality applies to download too', async () => {
  const created = await key(['download'])
  supported = ['128k']
  assert.equal((await request('/api/v1/download', 'POST', { song, quality: 'flac' }, created.token)).status, 502)
  assert.equal(membership.usage('u:' + user.id).day.downloads, 0)
  const response = await request('/api/v1/download', 'POST', { song, quality: 'flac', fallback: true }, created.token)
  assert.equal(response.status, 200); assert.equal((await json(response)).quality, '128k')
  updateAppConfig({ membership: { audiences: { user: { downloadEnabled: false } } } })
  assert.equal((await request('/api/v1/download', 'POST', { song }, created.token)).status, 403)
  assert.equal(membership.usage('u:' + user.id).day.downloads, 1)
})

test('API burst limits aggregate one user keys and do not throttle other users', async () => {
  const limited = await auth.register({ username: 'devicelimited', password: 'password123' })
  const token = auth.createSession(limited.id)
  const one = await key(['search'], token), two = await key(['search'], token), unaffected = await key(['search'], otherToken)
  updateAppConfig({ deviceApi: { requestsPerMinute: 10 } })
  for (let i = 0; i < 10; i++) assert.equal((await request('/api/v1/me', 'GET', undefined, i % 2 ? one.token : two.token)).status, 200)
  const blocked = await request('/api/v1/me', 'GET', undefined, one.token)
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '60')
  assert.equal((await request('/api/v1/me', 'GET', undefined, unaffected.token)).status, 200)
})

test('published OpenAPI matches direct-only media and opt-in fallback semantics', async () => {
  updateAppConfig({ deviceApi: { enabled: false } })
  const document = await json(await request('/api/v1/openapi.json'))
  assert.equal(document.openapi, '3.0.3')
  assert.equal(document.paths['/stream'], undefined); assert.equal(document.paths['/download/file'], undefined)
  assert.equal(document.paths['/playback'].post.requestBody.content['application/json'].schema.properties.fallback.default, false)
  const walk = (value: any) => {
    if (!value || typeof value !== 'object') return
    if (value.$ref) assert.ok(document.components.schemas[value.$ref.split('/').at(-1)], value.$ref)
    Object.values(value).forEach(walk)
  }
  walk(document)
})

async function mcpClient(token: string) {
  const client = new Client({ name: 'device-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(base + '/api/v1/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + token } } })
  await client.connect(transport)
  return client
}

test('standard MCP initializes, lists scoped tools and resolves a direct music link via the official SDK client', async () => {
  const created = await key(['search', 'playback'])
  assert.equal((await request('/api/v1/mcp', 'POST', [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }], created.token,
    { Accept: 'application/json, text/event-stream' })).status, 400)
  const client = await mcpClient(created.token)
  try {
    const tools = await client.listTools()
    assert.ok(tools.tools.some(tool => tool.name === 'miyin_find_playback_url'))
    assert.ok(!tools.tools.some(tool => tool.name === 'miyin_get_download_url'))
    const result = await client.callTool({ name: 'miyin_find_playback_url', arguments: { query: '测试', platform: 'wy', quality: '128k', fallback: true } })
    assert.equal(result.isError, undefined)
    const data = JSON.parse((result.content as { text: string }[])[0].text)
    assert.equal(data.url, 'https://93.184.216.34/audio/128k'); assert.equal(data.delivery, 'direct')
    assert.equal(data.playbackStarted, false)
    supported = ['128k']
    const unavailable = await client.callTool({ name: 'miyin_get_playback_url', arguments: { song_json: JSON.stringify(song), quality: 'flac', fallback: false } })
    assert.equal(unavailable.isError, true)
    assert.equal(JSON.parse((unavailable.content as { text: string }[])[0].text).error.code, 'quality_unavailable')
    const lower = await client.callTool({ name: 'miyin_get_playback_url', arguments: { song_json: JSON.stringify(song), quality: 'flac', fallback: true } })
    assert.equal(JSON.parse((lower.content as { text: string }[])[0].text).quality, '128k')
  } finally { await client.close() }
})

test('MCP identities stay isolated across clients and revoked credentials stop subsequent tool calls', async () => {
  const first = await key(['library']), second = await key(['library'], otherToken)
  library.createPlaylist(user.id, { name: '账号甲的歌单' }); library.createPlaylist(other.id, { name: '账号乙的歌单' })
  const a = await mcpClient(first.token), b = await mcpClient(second.token)
  try {
    const [ra, rb] = await Promise.all([a.callTool({ name: 'miyin_list_playlists', arguments: {} }), b.callTool({ name: 'miyin_list_playlists', arguments: {} })])
    assert.equal(JSON.parse((ra.content as { text: string }[])[0].text).playlists[0].name, '账号甲的歌单')
    assert.equal(JSON.parse((rb.content as { text: string }[])[0].text).playlists[0].name, '账号乙的歌单')
    await request('/api/device-api/keys/' + first.key.id, 'DELETE', undefined, userToken)
    await assert.rejects(a.listTools())
    assert.ok((await b.listTools()).tools.length)
  } finally { await Promise.all([a.close(), b.close()]) }
})

test('voice download tool searches and signs one link, enforces quota and is absent without both scopes', async () => {
  const created = await key(['search', 'download']), playbackOnly = await key(['search', 'playback'])
  updateAppConfig({ membership: { audiences: { user: { dailyDownloads: 1 } } } })
  const client = await mcpClient(created.token), listener = await mcpClient(playbackOnly.token)
  try {
    const list = await client.listTools()
    const download = list.tools.find(tool => tool.name === 'miyin_find_download_url')!
    assert.ok(download)
    assert.equal(download.annotations?.readOnlyHint, false); assert.equal(download.annotations?.idempotentHint, false)
    assert.ok(!(await listener.listTools()).tools.some(tool => tool.name === 'miyin_find_download_url'))
    const result = await client.callTool({ name: download.name, arguments: { query: '测试歌手 测试歌曲', quality: '128k' } })
    assert.equal(result.isError, undefined)
    const data = JSON.parse((result.content as { text: string }[])[0].text)
    assert.equal(data.url, 'https://93.184.216.34/audio/128k'); assert.ok(data.filename.endsWith('.mp3'))
    assert.equal(data.downloadStarted, false)
    assert.equal(membership.usage('u:' + user.id).day.downloads, 1)
    const blocked = await client.callTool({ name: download.name, arguments: { query: '测试歌曲', quality: '128k' } })
    assert.equal(blocked.isError, true)
    assert.equal(membership.usage('u:' + user.id).day.downloads, 1)
  } finally { await Promise.all([client.close(), listener.close()]) }
})

test('Xiaozhi WebSocket bridge forwards initialize, tools and direct-link results, reconnects and never logs tokens', async () => {
  const created = await key(['search', 'playback'])
  const endpoint = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>(resolve => endpoint.once('listening', resolve))
  const messages: string[] = []
  const connection = new Promise<WebSocket>(resolve => endpoint.once('connection', resolve))
  const bridge = new XiaozhiMcpBridge({ endpoint: 'ws://127.0.0.1:' + (endpoint.address() as import('node:net').AddressInfo).port + '/mcp/?token=private-xiaozhi-token',
    mcpUrl: base + '/api/v1/mcp', apiKey: created.token, log: value => messages.push(value), initialBackoffMs: 20 })
  const rpc = (socket: WebSocket, id: number, method: string, params?: unknown) => new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', handle); reject(new Error('bridge RPC timed out')) }, 5000)
    const handle = (data: import('ws').RawData) => {
      const response = JSON.parse(data.toString())
      if (response.id !== id) return
      clearTimeout(timer); socket.off('message', handle); resolve(response)
    }
    socket.on('message', handle); socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }))
  })
  bridge.start()
  try {
    const socket = await connection
    const initialized = await rpc(socket, 1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'xiaozhi-fixture', version: '1' } })
    assert.equal(initialized.result.protocolVersion, '2024-11-05')
    socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    assert.ok((await rpc(socket, 2, 'tools/list')).result.tools.some((tool: any) => tool.name === 'miyin_find_playback_url'))
    const result = await rpc(socket, 3, 'tools/call', { name: 'miyin_find_playback_url', arguments: { query: '测试歌曲', quality: '128k', fallback: true } })
    assert.equal(JSON.parse(result.result.content[0].text).delivery, 'direct')
    const reconnected = new Promise<WebSocket>(resolve => endpoint.once('connection', resolve))
    socket.terminate()
    const next = await reconnected
    assert.ok((await rpc(next, 4, 'tools/list')).result.tools.length)
    assert.ok(messages.some(message => message.includes('重连')))
    assert.ok(!messages.join('\n').includes(created.token)); assert.ok(!messages.join('\n').includes('private-xiaozhi-token'))
  } finally {
    bridge.stop()
    for (const socket of endpoint.clients) socket.terminate()
    await new Promise<void>(resolve => endpoint.close(() => resolve()))
  }
})

test('browser Xiaozhi setup validates official endpoints, session ownership and permissions', async () => {
  const path = '/api/device-api/xiaozhi'
  const endpoint = 'wss://api.xiaozhi.me/mcp/?token=browser-owned-token'
  assert.equal((await request(path)).status, 401)
  const created = await key()
  assert.equal((await request(path, 'GET', undefined, created.token)).status, 401)
  for (const invalid of ['http://api.xiaozhi.me/mcp/?token=a', 'ws://127.0.0.1/mcp/?token=a',
    'wss://api.xiaozhi.me.attacker.test/mcp/?token=a', 'wss://evilxiaozhi.me/mcp/?token=a',
    'wss://api.xiaozhi.me:444/mcp/?token=a', 'wss://user:pass@api.xiaozhi.me/mcp/?token=a',
    'wss://api.xiaozhi.me/mcp/', 'wss://api.xiaozhi.me/other?token=a']) {
    assert.equal((await request(path, 'PUT', { endpoint: invalid, enabled: true }, userToken)).status, 400)
  }
  assert.equal((await request(path, 'PUT', { endpoint, enabled: true, scopes: ['admin'] }, userToken)).status, 400)
  assert.equal((await request(path, 'PUT', { endpoint, enabled: true, scopes: [] }, userToken)).status, 400)
  updateAppConfig({ deviceApi: { enabled: false } })
  assert.equal((await request(path, 'PUT', { endpoint, enabled: true }, userToken)).status, 403)
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM xiaozhi_mcp_connections').get()!.n, 0)
})

test('browser Xiaozhi configuration encrypts credentials, isolates accounts and restores without duplicating keys', async () => {
  const path = '/api/device-api/xiaozhi', endpoint = 'wss://api.xiaozhi.me/mcp/?token=persisted-private-token'
  const starts: string[] = []
  mock.method(XiaozhiMcpBridge.prototype, 'start', function (this: XiaozhiMcpBridge) {
    const options = (this as unknown as { options: import('../src/xiaozhi-bridge.js').XiaozhiBridgeOptions }).options
    starts.push(options.endpoint); options.onState?.('connected', Date.now())
  })
  xiaozhi.startXiaozhiConnections(base + '/api/v1/mcp')
  const saved = await json(await request(path, 'PUT', { endpoint, enabled: true }, userToken))
  assert.equal(saved.state, 'connected'); assert.deepEqual(saved.scopes, ['search', 'playback'])
  assert.ok(saved.connectedAt)
  assert.ok(!JSON.stringify(saved).includes('persisted-private-token'))
  assert.ok(!JSON.stringify(saved).includes('myk_'))
  const row = getDb().prepare('SELECT * FROM xiaozhi_mcp_connections WHERE user_id = ?').get(user.id)!
  assert.ok(!JSON.stringify(row).includes('persisted-private-token')); assert.ok(!String(row.secret).includes('myk_'))
  assert.equal((await json(await request(path, 'GET', undefined, otherToken))).configured, false)
  assert.equal((await request(path, 'PUT', { endpoint: endpoint + '&another=value', enabled: true }, otherToken)).status, 409)
  xiaozhi.stopXiaozhiConnections()
  xiaozhi.startXiaozhiConnections(base + '/api/v1/mcp')
  assert.equal(starts.length, 2); assert.equal(starts[1], endpoint)
  assert.equal((await json(await request('/api/device-api', 'GET', undefined, userToken))).keys.length, 1)
  await request(path, 'PUT', { enabled: true, scopes: ['library'] }, userToken)
  assert.deepEqual((await json(await request(path, 'GET', undefined, userToken))).scopes, ['library'])
  updateAppConfig({ deviceApi: { enabled: false } })
  assert.equal((await json(await request(path, 'GET', undefined, userToken))).state, 'blocked')
  assert.equal((await request(path, 'PUT', { enabled: false }, userToken)).status, 200)
  xiaozhi.stopXiaozhiConnections(); xiaozhi.startXiaozhiConnections(base + '/api/v1/mcp')
  assert.equal((await json(await request(path, 'GET', undefined, userToken))).state, 'disabled')
  assert.equal((await request(path, 'DELETE', undefined, otherToken)).status, 200)
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM xiaozhi_mcp_connections').get()!.n, 1)
  assert.equal((await request(path, 'DELETE', undefined, userToken)).status, 200)
  assert.equal((await json(await request('/api/device-api', 'GET', undefined, userToken))).keys.length, 0)
})

test('settings-managed Xiaozhi bridge serves scoped music tools and closes after key revocation', async () => {
  const endpoint = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>(resolve => endpoint.once('listening', resolve))
  const localEndpoint = 'ws://127.0.0.1:' + (endpoint.address() as import('node:net').AddressInfo).port
  const originalStart = XiaozhiMcpBridge.prototype.start
  // Redirect the already-validated official connection to a local protocol fixture only in this test.
  mock.method(XiaozhiMcpBridge.prototype, 'start', function (this: XiaozhiMcpBridge) {
    const options = (this as unknown as { options: import('../src/xiaozhi-bridge.js').XiaozhiBridgeOptions }).options
    options.endpoint = localEndpoint; originalStart.call(this)
  })
  xiaozhi.startXiaozhiConnections(base + '/api/v1/mcp')
  try {
    const connected = new Promise<WebSocket>(resolve => endpoint.once('connection', resolve))
    const saved = await json(await request('/api/device-api/xiaozhi', 'PUT', {
      enabled: true, endpoint: 'wss://api.xiaozhi.me/mcp/?token=integration-token', scopes: ['search', 'playback'],
    }, userToken))
    const socket = await connected
    const rpc = async (id: number, method: string, params?: unknown) => {
      const result = new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('managed MCP timed out')), 5000)
        socket.once('message', data => { clearTimeout(timer); resolve(JSON.parse(data.toString())) })
      })
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params })); return result
    }
    assert.equal((await rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'xiaozhi', version: '1' } })).result.protocolVersion, '2024-11-05')
    socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    const list = await rpc(2, 'tools/list')
    assert.ok(list.result.tools.some((tool: any) => tool.name === 'miyin_find_playback_url'))
    assert.ok(!list.result.tools.some((tool: any) => tool.name === 'miyin_get_download_url'))
    const result = await rpc(3, 'tools/call', { name: 'miyin_find_playback_url', arguments: { query: '测试歌曲', quality: '128k' } })
    assert.equal(JSON.parse(result.result.content[0].text).url, 'https://93.184.216.34/audio/128k')
    const closed = new Promise<void>(resolve => socket.once('close', () => resolve()))
    await request('/api/device-api/keys/' + saved.keyId, 'DELETE', undefined, userToken)
    assert.equal((await json(await request('/api/device-api/xiaozhi', 'GET', undefined, userToken))).configured, false)
    await closed
  } finally {
    xiaozhi.stopXiaozhiConnections()
    for (const socket of endpoint.clients) socket.terminate()
    await new Promise<void>(resolve => endpoint.close(() => resolve()))
  }
})
