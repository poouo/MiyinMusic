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
const audioCache = await import('../src/audio-cache.js')
const { sourceManager } = await import('../src/lx/manager.js')
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
  getDb().prepare('DELETE FROM favorites').run()
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

test('singer follows are account scoped, idempotent, removable and persist in the library', async () => {
  const endpoint = '/api/library/singers'
  const singer = { id: '0025NhlN2yWrP4', platform: 'tx', name: '周杰伦' }
  assert.equal((await request(endpoint, 'POST', { singer }, '')).status, 401)
  assert.equal((await request('/api/playlists/preview', 'POST', { id: 'invalid' }, '')).status, 401)
  for (let i = 0; i < 2; i++) assert.equal((await request(endpoint, 'POST', { singer }, userToken)).status, 200)
  const data = await (await request('/api/library', 'GET', undefined, userToken)).json() as any
  assert.deepEqual(data.library.favoriteSingers.map((item: any) => item.id), ['tx-0025NhlN2yWrP4'])
  assert.equal(library.getLibrary(owner).settings.favoriteSingers, undefined)
  assert.equal((await request(endpoint + '/tx-0025NhlN2yWrP4', 'DELETE', undefined, userToken)).status, 200)
  assert.equal((await (await request('/api/library', 'GET', undefined, userToken)).json() as any).library.favoriteSingers.length, 0)
  assert.equal((await request(endpoint, 'POST', { singer: { ...singer, platform: 'local' } }, userToken)).status, 400)
  assert.equal((await request(endpoint, 'POST', { singer: { ...singer, id: 123 } }, userToken)).status, 400)
  assert.equal((await request(endpoint, 'POST', { singer: { ...singer, name: {} } }, userToken)).status, 400)
})
test('list summaries and details enforce the specified owner', async () => {
  const response = await request(url('')); assert.equal(response.status, 200)
  const data = await response.json() as any
  assert.equal(data.playlists[0].songCount, 2); assert.equal(data.playlists[0].songs, undefined)
  assert.equal((await request(url(playlistId, target))).status, 404)
  const detail = await (await request(url())).json() as any
  assert.deepEqual(detail.playlist.songs.map((s: any) => s.songmid), ['2', '1'])
})

test('malformed followed singers in old settings cannot break library or follow operations', async () => {
  getDb().prepare('INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value')
    .run(ordinary, 'favoriteSingers', JSON.stringify([null, 1, {}, { id: '123', platform: 'local', name: 'bad' }, { id: '6452', platform: 'wy', name: '周杰伦' }]))
  const data = await (await request('/api/library', 'GET', undefined, userToken)).json() as any
  assert.deepEqual(data.library.favoriteSingers.map((item: any) => item.id), ['wy-6452'])
  assert.equal((await request('/api/library/singers', 'POST', { singer: { id: 'tx-0025NhlN2yWrP4', platform: 'tx', name: '周杰伦' } }, userToken)).status, 200)
  assert.equal((await request('/api/library/singers/wy-6452', 'DELETE', undefined, userToken)).status, 200)
  library.updateSettings(ordinary, { favoriteSingers: [] })
})

test('user favorites can only be inspected by admins and never expose another owner', async () => {
  library.addFavorite(owner, song(4))
  library.addFavorite(target, song(9))
  const endpoint = '/api/admin/users/' + owner + '/favorites'
  for (const token of ['', userToken]) {
    assert.equal((await request(endpoint, 'GET', undefined, token)).status, 404)
  }
  const response = await request(endpoint)
  assert.equal(response.status, 200)
  const data = await response.json() as any
  assert.equal(data.user.id, owner)
  assert.equal(data.totalFavorites, 1)
  assert.deepEqual(data.favorites.map((entry: any) => entry.song.songmid), ['4'])
  assert.equal(data.favorites[0].song.hash, 'provider-field')
  assert.ok(data.favorites[0].addedAt > 0)
  assert.equal(data.history, undefined)
  assert.equal(data.settings, undefined)
  assert.equal(data.user.passwordHash, undefined)
  const other = await (await request('/api/admin/users/' + target + '/favorites')).json() as any
  assert.deepEqual(other.favorites.map((entry: any) => entry.song.songmid), ['9'])
  assert.equal((await request('/api/admin/users/missing/favorites')).status, 404)
  assert.equal((await request(endpoint, 'DELETE')).status, 404)
  assert.equal(library.getFavorites(owner).length, 1)
})

test('favorites support stable newest-first pagination and song, singer or album search', async () => {
  const endpoint = '/api/admin/users/' + owner + '/favorites'
  for (let i = 1; i <= 51; i++) {
    library.addFavorite(owner, { ...song(i), singer: i === 51 ? 'Singer A' : '歌手', albumName: i === 1 ? 'Special Album' : '' })
    getDb().prepare('UPDATE favorites SET added_at = ? WHERE user_id = ? AND song_key = ?').run(1000 + i, owner, 'wy_' + i)
  }
  const first = await (await request(endpoint)).json() as any
  assert.equal(first.favorites.length, 50)
  assert.equal(first.total, 51)
  assert.equal(first.hasMore, true)
  assert.equal(first.favorites[0].song.songmid, '51')
  const second = await (await request(endpoint + '?page=2')).json() as any
  assert.deepEqual(second.favorites.map((entry: any) => entry.song.songmid), ['1'])
  assert.equal(second.hasMore, false)
  for (const [query, id] of [['歌曲 51', '51'], ['singer a', '51'], ['special album', '1']]) {
    const match = await (await request(endpoint + '?q=' + encodeURIComponent(query))).json() as any
    assert.equal(match.total, 1)
    assert.equal(match.totalFavorites, 51)
    assert.equal(match.favorites[0].song.songmid, id)
  }
  const empty = await (await request(endpoint + '?q=absent')).json() as any
  assert.equal(empty.total, 0)
  assert.deepEqual(empty.favorites, [])
  const invalid = await (await request(endpoint + '?page=NaN&limit=Infinity')).json() as any
  assert.equal(invalid.page, 1)
  assert.equal(invalid.limit, 50)
  assert.equal((await (await request(endpoint + '?limit=999')).json() as any).limit, 100)
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

function cachedPlaybackSong(quality: '128k' | '320k') {
  config.updateAppConfig({ cache: { enabled: true, warmCollections: false } })
  audioCache.init()
  getDb().prepare('DELETE FROM audio_cache').run()
  const track = { ...song(999), qualities: ['320k', '128k'] }
  const filename = 'quality-regression.mp3'
  fs.writeFileSync(path.join(serverConfig.audioCacheDir, filename), Buffer.alloc(128))
  getDb().prepare(`INSERT INTO audio_cache
    (cache_key, song_key, platform, songmid, quality, file_name, bytes, created_at, last_access_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('quality-fixture', 'wy_999', 'wy', '999', quality, filename, 128, Date.now(), Date.now())
  return track
}

test('source priority writes require an administrator and audit the saved order', async t => {
  const reorder = t.mock.method(sourceManager, 'reorder', (ids: unknown) => {
    assert.deepEqual(ids, ['test']); return [{ id: 'test', name: 'Test' }] as ReturnType<typeof sourceManager.reorder>
  })
  assert.equal((await request('/api/sources/order', 'PUT', { ids: ['test'] }, '')).status, 401)
  assert.equal((await request('/api/sources/order', 'PUT', { ids: ['test'] }, userToken)).status, 403)
  assert.equal(reorder.mock.callCount(), 0)
  assert.equal((await request('/api/sources/order', 'PUT', { ids: ['test'] })).status, 200)
  assert.equal(reorder.mock.callCount(), 1)
  assert.ok(getDb().prepare("SELECT id FROM audit_log WHERE action = 'admin.sources.order'").get())
})

test('HQ playback resolves higher quality before using a standard server cache', async t => {
  const track = cachedPlaybackSong('128k')
  const resolve = t.mock.method(sourceManager, 'getMusicUrl', async (_song, qualities, _source, strict) => {
    assert.deepEqual(qualities, ['320k']); assert.equal(strict, true)
    return { url: 'https://audio.example/hq.mp3', quality: '320k' as const, sourceId: 'test', sourceName: 'test', platform: 'wy' as const }
  })
  const response = await request('/api/url', 'POST', { song: track, qualities: ['320k', '128k'] })
  assert.equal(response.status, 200)
  const body = await response.json() as any
  assert.equal(body.quality, '320k'); assert.equal(body.cached, false)
  assert.equal(resolve.mock.callCount(), 1)
})

test('cached standard audio remains playable when the higher-quality source fails', async t => {
  const track = cachedPlaybackSong('128k')
  t.mock.method(sourceManager, 'getMusicUrl', async () => { throw new Error('source unavailable') })
  const response = await request('/api/url', 'POST', { song: track, qualities: ['320k', '128k'] })
  assert.equal(response.status, 200)
  const body = await response.json() as any
  assert.equal(body.quality, '128k'); assert.equal(body.cached, true)
})

test('a matching HQ cache plays immediately without requesting the source', async t => {
  const track = cachedPlaybackSong('320k')
  const resolve = t.mock.method(sourceManager, 'getMusicUrl', async () => { throw new Error('unexpected resolution') })
  const response = await request('/api/url', 'POST', { song: track, qualities: ['320k', '128k'] })
  assert.equal(response.status, 200)
  const body = await response.json() as any
  assert.equal(body.quality, '320k'); assert.equal(body.cached, true)
  assert.equal(resolve.mock.callCount(), 0)
})

test('standard playback does not upgrade to an HQ cache or hide a source error', async t => {
  const track = cachedPlaybackSong('320k')
  t.mock.method(sourceManager, 'getMusicUrl', async (_song, qualities) => {
    assert.deepEqual(qualities, ['128k']); throw new Error('standard unavailable')
  })
  const response = await request('/api/url', 'POST', { song: track, qualities: ['128k'] })
  assert.equal(response.status, 500)
})
