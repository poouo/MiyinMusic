import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { after, before, beforeEach, test } from 'node:test'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'miyin-admin-test-'))
process.env.MIYIN_DATA_DIR = temp
const { getDb, closeDb } = await import('../src/db.js')
const auth = await import('../src/auth.js')
const library = await import('../src/library.js')
const { handleApi } = await import('../src/routes.js')
const { serveStatic } = await import('../src/static.js')
const { config: serverConfig } = await import('../src/config.js')
const fixtureWeb = path.join(temp, 'web')
fs.mkdirSync(path.join(fixtureWeb, 'admin'), { recursive: true })
fs.writeFileSync(path.join(fixtureWeb, 'index.html'), '<script src="/assets/player-test.js"></script>')
fs.writeFileSync(path.join(fixtureWeb, 'admin/index.html'), '<script src="/assets/admin-test.js"></script>')
Object.assign(serverConfig, { webDist: fixtureWeb })
const { HttpError } = await import('../src/errors.js')
const { sendError } = await import('../src/http-util.js')
const guard = await import('../src/login-guard.js')
const config = await import('../src/app-config.js')
let server: http.Server, base: string, actor: string, owner: string, target: string, ordinary: string
let adminToken: string, userToken: string, playlistId: string
const song = (id: number) => ({ platform: 'wy' as const, songmid: String(id), name: '歌曲 ' + id, singer: '歌手', albumName: '', interval: 200, qualities: ['320k'], hash: 'provider-field' })
const url = (id = playlistId, userId = owner) => '/api/admin/users/' + userId + '/playlists' + (id ? '/' + id : '')
const request = (path: string, method = 'GET', body?: unknown, token = adminToken) => fetch(base + path, {
  method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
})
before(async () => {
  actor = (await auth.register({ username: 'adminactor', password: 'testpassword123' })).id
  owner = (await auth.register({ username: 'sourceowner', password: 'testpassword123' })).id
  target = (await auth.register({ username: 'targetuser', password: 'testpassword123' })).id
  ordinary = (await auth.register({ username: 'ordinaryuser', password: 'testpassword123' })).id
  adminToken = auth.createSession(actor); userToken = auth.createSession(ordinary)
  server = http.createServer((req, res) => {
    const parsed = new URL(req.url!, base)
    void (async () => {
      try {
        if (parsed.pathname.startsWith('/api/')) { if (!await handleApi(req, res, parsed)) sendError(res, 404, 'not found') }
        else await serveStatic(req, res, parsed.pathname)
      } catch (e) { sendError(res, e instanceof HttpError ? e.status : 500, (e as Error).message) }
    })()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port
})
beforeEach(() => {
  getDb().prepare('DELETE FROM playlists').run()
  playlistId = library.createPlaylist(owner, { name: '原歌单', description: '说明' }).playlists[0].id
  library.addPlaylistSong(owner, playlistId, song(2)); library.addPlaylistSong(owner, playlistId, song(1))
})
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  closeDb()
  const resolved = fs.realpathSync(temp)
  assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase())
  assert.ok(path.basename(resolved).startsWith('miyin-admin-test-'))
  fs.rmSync(resolved, { recursive: true })
})

test('every playlist operation is hidden from guests and ordinary users', async () => {
  for (const token of ['', userToken]) {
    for (const [path, method] of [[url(''), 'GET'], [url(), 'GET'], [url(), 'PATCH'], [url(), 'DELETE'], [url(''), 'POST'], [url() + '/copy', 'POST'], [url() + '/songs/wy_1', 'DELETE']]) {
      assert.equal((await request(path, method, {}, token)).status, 404)
    }
  }
})
test('list summaries and details enforce the specified owner', async () => {
  const response = await request(url('')); assert.equal(response.status, 200)
  const data = await response.json() as any
  assert.equal(data.playlists[0].songCount, 2); assert.equal(data.playlists[0].songs, undefined)
  assert.equal((await request(url(playlistId, target))).status, 404)
  const detail = await (await request(url())).json() as any
  assert.deepEqual(detail.playlist.songs.map((s: any) => s.songmid), ['2', '1'])
})
test('copies preserve order and provider fields and remain independent', async () => {
  const response = await request(url() + '/copy', 'POST', { targetUserId: target, name: '复制的歌单' })
  assert.equal(response.status, 201)
  const { playlist } = await response.json() as any
  assert.notEqual(playlist.id, playlistId); assert.equal(playlist.description, '说明')
  assert.deepEqual(playlist.songs.map((s: any) => s.songmid), ['2', '1']); assert.equal(playlist.songs[0].hash, 'provider-field')
  await request(url(playlist.id, target) + '/songs/wy_2', 'DELETE')
  assert.equal(library.getPlaylist(owner, playlistId).songs.length, 2)
  assert.equal(library.getPlaylist(target, playlist.id).songs.length, 1)
  assert.ok(getDb().prepare("SELECT 1 FROM audit_log WHERE action = 'admin.playlist.copy'").get())
})
test('copy failures are atomic and cannot exceed target capacity', async () => {
  assert.equal((await request(url() + '/copy', 'POST', { targetUserId: 'missing' })).status, 404)
  for (let i = 0; i < 200; i++) library.createPlaylist(target, { name: '已有 ' + i })
  const rowsBefore = getDb().prepare('SELECT COUNT(*) AS c FROM playlist_songs').get()
  assert.equal((await request(url() + '/copy', 'POST', { targetUserId: target })).status, 400)
  assert.deepEqual(getDb().prepare('SELECT COUNT(*) AS c FROM playlist_songs').get(), rowsBefore)
  assert.equal(library.getLibrary(target).playlists.length, 200)
})
test('create edit remove and delete operations work with audit records', async () => {
  assert.equal((await request(url(''), 'POST', { name: '新建', description: '' })).status, 201)
  assert.equal((await request(url(), 'PATCH', { name: '更名', description: '新说明' })).status, 200)
  assert.equal(library.getPlaylist(owner, playlistId).name, '更名')
  assert.equal((await request(url() + '/songs/wy_1', 'DELETE')).status, 200)
  assert.equal(library.getPlaylist(owner, playlistId).songs.length, 1)
  assert.equal((await request(url(), 'DELETE')).status, 200)
  assert.throws(() => library.getPlaylist(owner, playlistId), /不存在/)
})
test('force logout invalidates database sessions as well as cached sessions', async () => {
  const token = auth.createSession(target)
  assert.ok((await (await request('/api/auth/me', 'GET', undefined, token)).json() as any).user)
  assert.equal((await request('/api/admin/users/' + target + '/logout', 'POST')).status, 200)
  assert.equal(auth.getSessionUser(token), null)
  assert.equal((await (await request('/api/auth/me', 'GET', undefined, token)).json() as any).user, null)
})
test('unlocking a user leaves unrelated accounts locked', async () => {
  for (let i = 0; i < 5; i++) { guard.recordLoginFailure('one', 'sourceowner'); guard.recordLoginFailure('two', 'targetuser') }
  await request('/api/admin/users/' + owner + '/unlock', 'POST')
  assert.doesNotThrow(() => guard.assertNotLocked('unused', 'sourceowner'))
  assert.throws(() => guard.assertNotLocked('unused', 'targetuser'), /频繁/)
})
test('partial configuration updates preserve download permissions', async () => {
  config.updateAppConfig({ download: { enabled: false, roles: ['admin'], qualities: ['128k'] } })
  await request('/api/admin/config', 'PUT', { registration: { enabled: false } })
  assert.deepEqual(config.getAppConfig().download, { enabled: false, roles: ['admin'], qualities: ['128k'] })
})
test('admin HTML uses a separate entry point, including deep links', async () => {
  for (const path of ['/admin', '/admin/', '/admin/users']) {
    const response = await fetch(base + path); assert.equal(response.status, 200)
    const html = await response.text(); assert.match(html, /assets\/admin-/); assert.doesNotMatch(html, /assets\/player-/)
  }
})
