import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { after, afterEach, before, beforeEach, mock, test } from 'node:test'
import type { AudiencePolicy, ManagedAudience } from '../src/app-config.js'
import type { Song, Quality } from '../src/types.js'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'miyin-membership-test-'))
process.env.MIYIN_DATA_DIR = temp
const { getDb, closeDb } = await import('../src/db.js')
const auth = await import('../src/auth.js')
const { sessionCache } = await import('../src/session-cache.js')
const { handleApi } = await import('../src/routes.js')
const { HttpError } = await import('../src/errors.js')
const { sendError, clientIp } = await import('../src/http-util.js')
const { getAppConfig, updateAppConfig, unrestrictedPolicy, accessPolicy } = await import('../src/app-config.js')
const { sourceManager } = await import('../src/lx/manager.js')
const { getRateLimiter } = await import('../src/rate-limit.js')
const { QUALITIES } = await import('../src/types.js')
const audio = await import('../src/audio-cache.js')
const membership = await import('../src/membership.js')
const { playbackUrl } = await import('../src/media-token.js')
const originalFetch = globalThis.fetch
const track: Song = { platform: 'wy', songmid: 'test-song', name: '歌曲', singer: '歌手', interval: 200, albumName: '', qualities: [...QUALITIES] }
let server: http.Server, base: string, admin: auth.User, user: auth.User, vip: auth.User, other: auth.User
let adminToken: string, userToken: string, vipToken: string, otherToken: string
let fetchMedia: () => Promise<Response>
let resolveMedia: (qualities: Quality[]) => Promise<Quality>
let resolvedQualities: Quality[][]
const fakeReq = (ip: string, forwarded?: string) => ({ socket: { remoteAddress: ip }, headers: forwarded ? { 'x-forwarded-for': forwarded } : {} }) as http.IncomingMessage

const request = (endpoint: string, method = 'GET', body?: unknown, token = '', headers: Record<string, string> = {}) => fetch(base + endpoint, {
  method, headers: { ...headers, ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})
async function configure(audience: ManagedAudience, patch: Partial<AudiencePolicy>) {
  const response = await request('/api/admin/config', 'PUT', { membership: { audiences: { [audience]: patch } } }, adminToken)
  assert.equal(response.status, 200, await response.text())
}
async function downloadLink(token = '', headers: Record<string, string> = {}) {
  const response = await request('/api/download', 'POST', { song: track }, token, headers)
  assert.equal(response.status, 200, await response.clone().text())
  return (await response.json() as { url: string; quality: Quality })
}
async function consume(url: string, token = '', headers: Record<string, string> = {}) {
  const response = await request(url, 'GET', undefined, token, headers)
  const body = await response.text()
  return { status: response.status, body }
}
function setUsage(subject: string, dayCount: number, monthCount: number, dayBytes = 0, monthBytes = 0) {
  const { day, month } = membership.periods()
  const insert = getDb().prepare('INSERT OR REPLACE INTO download_usage VALUES (?, ?, ?, ?, ?)')
  insert.run(subject, day, dayCount, dayBytes, Date.now())
  insert.run(subject, month, monthCount, monthBytes, Date.now())
}

before(async () => {
  admin = await auth.register({ username: 'memberadmin', password: 'password123' })
  user = await auth.register({ username: 'memberuser', password: 'password123' })
  vip = await auth.register({ username: 'membervip', password: 'password123' })
  other = await auth.register({ username: 'memberother', password: 'password123' })
  auth.setUserRole(vip.id, 'vip', admin)
  adminToken = auth.createSession(admin.id); userToken = auth.createSession(user.id)
  vipToken = auth.createSession(vip.id); otherToken = auth.createSession(other.id)
  audio.init()
  server = http.createServer((req, res) => {
    void (async () => {
      try {
        if (!await handleApi(req, res, new URL(req.url!, base))) sendError(res, 404, 'not found')
      } catch (error) {
        if (!res.headersSent) sendError(res, error instanceof HttpError ? error.status : 500, (error as Error).message)
        else res.destroy()
      }
    })()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port
})
beforeEach(() => {
  delete process.env.MIYIN_TRUSTED_PROXIES
  sessionCache.clear()
  getDb().exec('DELETE FROM download_usage; DELETE FROM download_tickets')
  updateAppConfig({ cache: { enabled: true, warmCollections: false }, membership: { enabled: true,
    audiences: { guest: { ...unrestrictedPolicy(), downloadEnabled: false }, user: unrestrictedPolicy(), vip: unrestrictedPolicy() } } })
  audio.clear()
  resolvedQualities = []
  fetchMedia = async () => new Response('1234567890', { headers: { 'content-type': 'audio/mpeg', 'content-length': '10' } })
  resolveMedia = async qualities => qualities[0]
  mock.method(sourceManager, 'getMusicUrl', async (song: Song, qualities: Quality[], _id: unknown, strict: boolean) => {
    assert.equal(strict, true)
    resolvedQualities.push([...qualities])
    const quality = await resolveMedia(qualities)
    return { url: 'https://93.184.216.34/audio/' + quality, quality, sourceName: 'fixture', sourceId: 'fixture', platform: song.platform }
  })
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname === '127.0.0.1') return originalFetch(input, init)
    assert.equal(url.hostname, '93.184.216.34', 'tests must not contact real providers')
    return fetchMedia()
  })
  // Quota tests intentionally isolate durable quotas from the independent burst limiter.
  mock.method(getRateLimiter('download'), 'hit', () => true)
})
afterEach(() => mock.restoreAll())
after(async () => {
  delete process.env.MIYIN_TRUSTED_PROXIES
  await new Promise<void>(resolve => server.close(() => resolve()))
  closeDb()
  const resolved = fs.realpathSync(temp)
  assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase())
  assert.ok(path.basename(resolved).startsWith('miyin-membership-test-'))
  fs.rmSync(resolved, { recursive: true })
})

test('membership settings are admin-only, strictly validated, persist and partial updates keep other roles', async () => {
  for (const token of ['', userToken, vipToken]) {
    assert.equal((await request('/api/admin/config', 'PUT', { membership: { enabled: false } }, token)).status, 404)
  }
  await configure('user', { dailyDownloads: 3, monthlyDownloads: 20, dailyBytes: 100, monthlyBytes: 1000, playbackQualities: ['128k'] })
  await configure('vip', { dailyDownloads: null, downloadEnabled: false })
  const saved = getAppConfig().membership
  assert.equal(saved.audiences.user.dailyDownloads, 3)
  assert.equal(saved.audiences.vip.downloadEnabled, false)
  assert.equal(saved.audiences.guest.downloadEnabled, false)
  const bad = [null, [], { enabled: 'false' }, { audiences: [] }, { audiences: { admin: {} } },
    { audiences: { guest: null } }, { audiences: { user: { dailyDownloads: -1 } } },
    { audiences: { user: { dailyDownloads: 0.5 } } }, { audiences: { user: { monthlyBytes: '100' } } },
    { audiences: { user: { downloadEnabled: 'true' } } }, { audiences: { user: { playbackQualities: ['invalid'] } } },
    { audiences: { user: { dailyBytes: Number.MAX_SAFE_INTEGER } } }, { audiences: { user: { role: 'vip' } } }]
  for (const membership of bad) {
    assert.equal((await request('/api/admin/config', 'PUT', { membership }, adminToken)).status, 400, JSON.stringify(membership))
    assert.deepEqual(getAppConfig().membership, saved)
  }
  assert.equal((await request('/api/admin/config', 'PUT', { registration: { enabled: true } }, adminToken)).status, 200)
  assert.deepEqual(getAppConfig().membership, saved)
})

test('old download settings migrate without losing permissions and empty qualities deny access', async () => {
  const legacy = getAppConfig()
  const { membership: _membership, ...old } = legacy
  getDb().prepare("UPDATE meta SET value = ? WHERE key = 'app_config'").run(JSON.stringify({ ...old,
    download: { enabled: true, roles: ['vip'], qualities: ['flac'] } }))
  assert.equal(accessPolicy('user').downloadEnabled, false)
  assert.deepEqual(accessPolicy('vip').downloadQualities, ['flac'])
  await configure('vip', { downloadQualities: [], playbackQualities: [] })
  assert.equal((await request('/api/download', 'POST', { song: track }, vipToken)).status, 403)
  assert.equal((await request('/api/url', 'POST', { song: track, qualities: ['flac'] }, vipToken)).status, 403)
})

test('cached and upstream playback enforce allowed qualities even with forged client roles and direct URL requests', async () => {
  await configure('user', { playbackQualities: ['128k'] })
  const denied = await request('/api/url', 'POST', { song: track, qualities: ['flac24bit'], role: 'admin', direct: true }, userToken)
  assert.equal(denied.status, 403)
  assert.equal(resolvedQualities.length, 0)
  const response = await request('/api/url', 'POST', { song: track, qualities: ['flac', '128k'], direct: true }, userToken)
  assert.equal(response.status, 200)
  const result = await response.json() as { playUrl: string; directUrl?: string; quality: string }
  assert.deepEqual(resolvedQualities, [['128k']])
  assert.equal(result.directUrl, undefined)
  assert.equal(result.quality, '128k')
  assert.ok(!result.playUrl.includes('93.184.216.34'))
  assert.equal((await consume(result.playUrl, userToken)).status, 200)
  await audio.ensure(track)
  const cached = await (await request('/api/url', 'POST', { song: track, qualities: ['flac', '128k'] }, userToken)).json() as any
  assert.equal(cached.cached, true)
  assert.equal(cached.quality, '128k')
  assert.equal((await consume(cached.playUrl, userToken)).status, 200)
  resolveMedia = async () => 'flac'
  audio.clear()
  assert.equal((await request('/api/url', 'POST', { song: track, qualities: ['128k'] }, userToken)).status, 403)
})

test('playback grants bind identity and quality and are rechecked after role or policy changes', async () => {
  const response = await request('/api/url', 'POST', { song: track, qualities: ['flac'] }, vipToken)
  const { playUrl } = await response.json() as { playUrl: string }
  assert.equal((await consume(playUrl, userToken)).status, 403)
  const parsed = new URL(playUrl, base)
  parsed.searchParams.set('t', parsed.searchParams.get('t')!.slice(0, 18) + 'corrupted')
  assert.equal((await consume(parsed.pathname + parsed.search, vipToken)).status, 403)
  assert.equal((await consume('/api/stream?u=' + Buffer.from('https://93.184.216.34/audio').toString('base64url') + '&e=9999999999999&s=fake', vipToken)).status, 403)
  await configure('vip', { playbackQualities: ['128k'] })
  assert.equal((await consume(playUrl, vipToken)).status, 403)
  await configure('vip', { playbackEnabled: false })
  assert.equal((await request('/api/url', 'POST', { song: track }, vipToken)).status, 403)
  await configure('user', { playbackQualities: ['128k'] })
  assert.equal((await request('/api/admin/users/' + vip.id, 'PATCH', { role: 'user' }, adminToken)).status, 200)
  assert.equal((await consume(playUrl, vipToken)).status, 403)
  await request('/api/admin/users/' + vip.id, 'PATCH', { role: 'vip' }, adminToken)
  vipToken = auth.createSession(vip.id)
})

test('guest grants cannot be moved between networks, but do not rely on forgeable user-agent identity', async () => {
  const a = membership.quotaSubject(fakeReq('203.0.113.1'), null)
  const b = membership.quotaSubject(fakeReq('203.0.113.2'), null)
  const link = playbackUrl('https://93.184.216.34/test', '128k', a)
  const { readPlayback } = await import('../src/media-token.js')
  assert.equal(readPlayback(new URL(link, base).searchParams.get('t')!, a).quality, '128k')
  assert.throws(() => readPlayback(new URL(link, base).searchParams.get('t')!, b), /播放链接/)
})

test('separate daily and monthly download counts apply at file transfer and reset at Beijing boundaries', async () => {
  await configure('user', { dailyDownloads: 1, monthlyDownloads: 2 })
  const subject = 'u:' + user.id
  const first = await downloadLink(userToken)
  assert.equal(membership.usage(subject).day.downloads, 0, 'preparing a URL is not billed')
  assert.equal((await consume(first.url, userToken)).status, 200)
  assert.equal(membership.usage(subject).day.downloads, 1)
  assert.equal((await request('/api/download', 'POST', { song: track }, userToken)).status, 429)
  const { day, month } = membership.periods()
  getDb().prepare('DELETE FROM download_usage WHERE subject = ? AND period = ?').run(subject, day)
  assert.equal((await consume((await downloadLink(userToken)).url, userToken)).status, 200)
  assert.equal(membership.usage(subject).month.downloads, 2)
  getDb().prepare('DELETE FROM download_usage WHERE subject = ? AND period = ?').run(subject, day)
  assert.equal((await request('/api/download', 'POST', { song: track }, userToken)).status, 429)
  getDb().prepare('DELETE FROM download_usage WHERE subject = ? AND period = ?').run(subject, month)
  assert.equal((await consume((await downloadLink(userToken)).url, userToken)).status, 200)
  assert.deepEqual(membership.periods(Date.parse('2026-11-30T15:59:59Z')), { day: '2026-11-30', month: '2026-11' })
  assert.deepEqual(membership.periods(Date.parse('2026-11-30T16:00:00Z')), { day: '2026-12-01', month: '2026-12' })
})

test('zero daily or monthly quota denies downloads; unlimited VIP and admin remain independent', async () => {
  await configure('user', { dailyDownloads: 0 })
  assert.equal((await request('/api/download', 'POST', { song: track }, userToken)).status, 429)
  await configure('user', { dailyDownloads: null, monthlyDownloads: 0 })
  assert.equal((await request('/api/download', 'POST', { song: track }, userToken)).status, 429)
  await configure('vip', { downloadEnabled: false, playbackEnabled: false })
  assert.equal((await request('/api/download', 'POST', { song: track }, vipToken)).status, 403)
  assert.equal((await consume((await downloadLink(adminToken)).url, adminToken)).status, 200)
  await configure('vip', { downloadEnabled: true })
  setUsage('u:' + vip.id, 100000, 1000000, 1000000, 10000000)
  assert.equal((await consume((await downloadLink(vipToken)).url, vipToken)).status, 200)
  await configure('user', { monthlyDownloads: null })
  assert.equal((await consume((await downloadLink(otherToken)).url, otherToken)).status, 200)
})

test('concurrent tickets cannot overspend the final allowance and each ticket transfers only once', async () => {
  await configure('user', { dailyDownloads: 1 })
  const links = await Promise.all(Array.from({ length: 6 }, () => downloadLink(userToken)))
  const results = await Promise.all(links.map(link => consume(link.url, userToken)))
  assert.equal(results.filter(result => result.status === 200).length, 1)
  assert.equal(results.filter(result => result.status === 429).length, 5)
  assert.equal(membership.usage('u:' + user.id).day.downloads, 1)
  const winner = links[results.findIndex(result => result.status === 200)]
  assert.equal((await consume(winner.url, userToken)).status, 409)
  assert.equal(membership.usage('u:' + user.id).day.downloads, 1)
  membership.resetUsage('u:' + user.id)
  const same = (await downloadLink(userToken)).url
  const repeat = await Promise.all([consume(same, userToken), consume(same, userToken)])
  assert.deepEqual(repeat.map(result => result.status).sort(), [200, 409])
  assert.equal(membership.usage('u:' + user.id).day.downloads, 1)
})

test('daily and monthly byte quotas reject oversized files before transfer without consuming counts', async () => {
  await configure('user', { dailyBytes: 9 })
  const first = await downloadLink(userToken)
  assert.equal((await consume(first.url, userToken)).status, 429)
  assert.equal(membership.usage('u:' + user.id).day.downloads, 0)
  await configure('user', { dailyBytes: 10, monthlyBytes: 10 })
  assert.equal((await consume(first.url, userToken)).status, 200)
  assert.deepEqual(membership.usage('u:' + user.id).day, { downloads: 1, bytes: 10 })
  assert.equal((await request('/api/download', 'POST', { song: track }, userToken)).status, 429)
  await configure('user', { dailyBytes: null })
  assert.equal((await request('/api/download', 'POST', { song: track }, userToken)).status, 429)
})

test('unknown-length transfers enforce byte budget before each chunk and refund unused reservations', async () => {
  await configure('user', { dailyBytes: 8 })
  fetchMedia = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('12345'))
      setTimeout(() => { controller.enqueue(new TextEncoder().encode('67890')); controller.close() }, 40)
    },
  }), { headers: { 'content-type': 'audio/mpeg' } })
  const link = await downloadLink(userToken)
  await assert.rejects(() => consume(link.url, userToken))
  assert.deepEqual(membership.usage('u:' + user.id).day, { downloads: 1, bytes: 5 })
  const subject = 'u:' + other.id
  const ticket = membership.issueDownload(subject, 'https://93.184.216.34/test', '128k', 'a.mp3').split('t=')[1]
  const meter = membership.beginDownload(ticket, subject, 'user', 8)
  meter.beforeChunk(3)
  meter.finish(); meter.finish()
  assert.deepEqual(membership.usage(subject).day, { downloads: 1, bytes: 3 })
})

test('client disconnect refunds unsent reserved bytes and keeps only transmitted traffic', async () => {
  await configure('user', { dailyBytes: 100 })
  fetchMedia = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('12345'))
      setTimeout(() => { controller.enqueue(new TextEncoder().encode('unused')); controller.close() }, 150)
    },
  }), { headers: { 'content-type': 'audio/mpeg', 'content-length': '100' } })
  const link = await downloadLink(userToken)
  const controller = new AbortController()
  const response = await originalFetch(base + link.url, { headers: { Authorization: 'Bearer ' + userToken }, signal: controller.signal })
  assert.equal(response.status, 200)
  assert.equal((await response.body!.getReader().read()).value!.length, 5)
  controller.abort()
  const deadline = Date.now() + 3000
  while (membership.usage('u:' + user.id).day.bytes !== 5 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.deepEqual(membership.usage('u:' + user.id).day, { downloads: 1, bytes: 5 })
})

test('cached downloads use the same quota, identity and quality checks and do not bypass transfer accounting', async () => {
  await audio.ensure(track)
  await configure('user', { downloadQualities: ['320k'], dailyBytes: 10, dailyDownloads: 1 })
  const link = await downloadLink(userToken)
  assert.equal(link.quality, '320k')
  assert.equal((await consume(link.url, otherToken)).status, 403)
  assert.equal((await consume(link.url, userToken)).body, '1234567890')
  assert.deepEqual(membership.usage('u:' + user.id).day, { downloads: 1, bytes: 10 })
  assert.equal((await request('/api/download', 'POST', { song: track }, userToken)).status, 429)
})

test('download tickets recheck changed permissions and cannot be forged, shared, ranged or used after expiry', async () => {
  const link = await downloadLink(userToken)
  assert.equal((await consume(link.url, otherToken)).status, 403)
  assert.equal((await consume(link.url, userToken, { Range: 'bytes=0-3' })).status, 416)
  assert.equal((await consume('/api/download/file?t=forged', userToken)).status, 403)
  assert.equal((await consume('/api/download/file?u=fake&e=9999999999999&s=fake', userToken)).status, 403)
  await configure('user', { downloadEnabled: false })
  assert.equal((await consume(link.url, userToken)).status, 403)
  await configure('user', { downloadEnabled: true, downloadQualities: ['128k'] })
  assert.equal((await consume(link.url, userToken)).status, 403)
  await configure('user', { downloadQualities: [...QUALITIES] })
  getDb().prepare('UPDATE download_tickets SET expires_at = 1').run()
  assert.equal((await consume(link.url, userToken)).status, 403)
  assert.equal(membership.usage('u:' + user.id).day.downloads, 0)
})

test('failed source resolution or file retrieval does not consume download quota', async () => {
  resolveMedia = async () => { throw new Error('provider offline') }
  assert.equal((await request('/api/download', 'POST', { song: track }, userToken)).status, 500)
  assert.equal(membership.usage('u:' + user.id).day.downloads, 0)
  resolveMedia = async qualities => qualities[0]
  fetchMedia = async () => new Response('not audio', { status: 502 })
  assert.equal((await consume((await downloadLink(userToken)).url, userToken)).status, 404)
  assert.equal(membership.usage('u:' + user.id).day.downloads, 0)
})

test('guests share persistent IP quotas despite new cookies, changed user agents and spoofed forwarded headers', async () => {
  assert.equal((await request('/api/download', 'POST', { song: track })).status, 401)
  await configure('guest', { downloadEnabled: true, dailyDownloads: 1 })
  const headers = { 'User-Agent': 'browser-one', Cookie: 'random=first', 'X-Forwarded-For': '203.0.113.1' }
  const link = await downloadLink('', headers)
  assert.equal((await consume(link.url, '', headers)).status, 200)
  assert.equal((await request('/api/download', 'POST', { song: track }, '', {
    'User-Agent': 'browser-two', Cookie: 'random=second', 'X-Forwarded-For': '198.51.100.1', 'X-Real-IP': '198.51.100.2',
  })).status, 429)
  const info = await (await request('/api/access')).json() as any
  assert.equal(info.audience, 'guest')
  assert.equal(info.usage.day.downloads, 1)
})

test('trusted proxies resolve the nearest untrusted hop; IPv6 subnet rotation cannot reset quotas', () => {
  assert.equal(clientIp(fakeReq('::ffff:127.0.0.1', '198.51.100.1')), '127.0.0.1')
  process.env.MIYIN_TRUSTED_PROXIES = '127.0.0.1/32,10.0.0.0/8'
  assert.equal(clientIp(fakeReq('127.0.0.1', 'forged')), '127.0.0.1')
  assert.equal(clientIp(fakeReq('127.0.0.1', '198.51.100.1')), '198.51.100.1')
  assert.equal(clientIp(fakeReq('127.0.0.1', '203.0.113.100,198.51.100.1,10.0.0.3')), '198.51.100.1')
  assert.equal(clientIp(fakeReq('192.0.2.1', '198.51.100.1')), '192.0.2.1')
  assert.equal(membership.quotaSubject(fakeReq('2001:db8:1234:5678::1'), null), membership.quotaSubject(fakeReq('2001:db8:1234:5678::abcd'), null))
  assert.notEqual(membership.quotaSubject(fakeReq('2001:db8:1234:5678::1'), null), membership.quotaSubject(fakeReq('2001:db8:1234:5679::1'), null))
})

test('disabling membership restrictions releases every identity without deleting saved policies or quota usage', async () => {
  await configure('guest', { playbackEnabled: false, downloadEnabled: false, dailyDownloads: 0, monthlyBytes: 0 })
  await configure('user', { playbackQualities: [], downloadEnabled: false, dailyDownloads: 0 })
  const saved = getAppConfig().membership.audiences
  assert.equal((await request('/api/admin/config', 'PUT', { membership: { enabled: false } }, adminToken)).status, 200)
  for (const token of ['', userToken, vipToken, adminToken]) {
    assert.equal((await request('/api/url', 'POST', { song: track, qualities: ['flac24bit'] }, token)).status, 200)
    assert.equal((await consume((await downloadLink(token)).url, token)).status, 200)
  }
  assert.deepEqual(getAppConfig().membership.audiences, saved)
  assert.equal((await request('/api/admin/config', 'PUT', { membership: { enabled: true } }, adminToken)).status, 200)
  assert.equal((await request('/api/download', 'POST', { song: track })).status, 401)
  assert.equal(membership.usage('u:' + user.id).day.downloads, 1)
})

test('durable quota survives a new server process and cannot be reset by reconnecting', async () => {
  await configure('user', { dailyDownloads: 1 })
  assert.equal((await consume((await downloadLink(userToken)).url, userToken)).status, 200)
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const membership = await import(${JSON.stringify(new URL('../src/membership.ts', import.meta.url).href)});
    const config = await import(${JSON.stringify(new URL('../src/app-config.ts', import.meta.url).href)});
    assert.equal(membership.usage(${JSON.stringify('u:' + user.id)}).day.downloads, 1);
    assert.throws(() => membership.checkDownloadAllowance(${JSON.stringify('u:' + user.id)}, config.accessPolicy('user')), /额度/);
    console.log('QUOTA_PERSISTENCE_OK');
  `], { env: { ...process.env, MIYIN_DATA_DIR: temp }, encoding: 'utf8', timeout: 15000 })
  assert.equal(child.status, 0, child.stdout + child.stderr)
  assert.match(child.stdout, /QUOTA_PERSISTENCE_OK/)
})

test('only admins can inspect or reset another user quota, and resetting one user leaves others intact', async () => {
  const subject = 'u:' + user.id
  setUsage(subject, 2, 5, 20, 50)
  setUsage('u:' + other.id, 3, 6, 30, 60)
  const endpoint = '/api/admin/users/' + user.id + '/access'
  for (const token of ['', userToken, vipToken]) for (const method of ['GET', 'DELETE']) {
    assert.equal((await request(endpoint, method, undefined, token)).status, 404)
  }
  const response = await request(endpoint, 'GET', undefined, adminToken)
  assert.equal(response.status, 200)
  const info = await response.json() as any
  assert.deepEqual(info.usage.day, { downloads: 2, bytes: 20 })
  assert.equal((await request(endpoint, 'DELETE', undefined, adminToken)).status, 200)
  assert.equal(membership.usage(subject).day.downloads, 0)
  assert.equal(membership.usage('u:' + other.id).day.downloads, 3)
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'admin.quota.reset'").get()!.n, 1)
  assert.equal((await request('/api/admin/users/missing/access', 'GET', undefined, adminToken)).status, 404)
  const ticket = membership.issueDownload(subject, 'https://93.184.216.34/test', '128k', 'test.mp3').split('t=')[1]
  const meter = membership.beginDownload(ticket, subject, 'user', 8)
  meter.beforeChunk(3)
  membership.resetUsage(subject)
  meter.finish()
  assert.equal(membership.usage(subject).day.bytes, 0, 'refunds after admin reset cannot create negative usage')
})
