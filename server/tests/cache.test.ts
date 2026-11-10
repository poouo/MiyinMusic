import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { after, afterEach, before, beforeEach, mock, test } from 'node:test'
import type { LyricResult, Quality, Song } from '../src/types.js'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'miyin-cache-test-'))
process.env.MIYIN_DATA_DIR = temp
const { getDb, closeDb } = await import('../src/db.js')
const auth = await import('../src/auth.js')
const library = await import('../src/library.js')
const audio = await import('../src/audio-cache.js')
const lyrics = await import('../src/lyric-cache.js')
const { updateAppConfig, getAppConfig, DEFAULT_CACHE_BYTES } = await import('../src/app-config.js')
const { sourceManager } = await import('../src/lx/manager.js')
const { getProvider } = await import('../src/providers/index.js')
const { handleApi } = await import('../src/routes.js')
const { HttpError } = await import('../src/errors.js')
const { sendError } = await import('../src/http-util.js')
const { QUALITIES } = await import('../src/types.js')
const originalFetch = globalThis.fetch
const fullLyric: LyricResult = { lyric: '[00:01.00]原词', tlyric: '[00:01.00]译文', lxlyric: '[00:01.00]<00:01.000,1000>原词' }
const song = (id: string, platform: Song['platform'] = 'wy'): Song => ({
  platform, songmid: id, name: '歌曲 ' + id, singer: '歌手', albumName: '', interval: 200, qualities: ['128k'],
})
let server: http.Server, base: string, alice: string, bob: string, aliceToken: string, bobToken: string
let resolutions: string[], downloads: string[], lyricRequests: string[]
let resolveQuality: (track: Song, quality: Quality) => Promise<Quality>
let fetchAudio: (url: URL) => Promise<Response>
let fetchLyric: (track: Song) => Promise<LyricResult>

const request = (endpoint: string, method: string, body?: unknown, token = aliceToken) => fetch(base + endpoint, {
  method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})
async function drain() {
  const deadline = Date.now() + 10000
  while (audio.stats().warming) {
    if (Date.now() > deadline) throw new Error('cache worker did not finish')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

before(async () => {
  alice = (await auth.register({ username: 'cachealice', password: 'testpassword123' })).id
  bob = (await auth.register({ username: 'cachebob', password: 'testpassword123' })).id
  aliceToken = auth.createSession(alice); bobToken = auth.createSession(bob)
  audio.init()
  server = http.createServer((req, res) => {
    void (async () => {
      try {
        if (!await handleApi(req, res, new URL(req.url!, base))) sendError(res, 404, 'not found')
      } catch (error) {
        sendError(res, error instanceof HttpError ? error.status : 500, (error as Error).message)
      }
    })()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port
})

beforeEach(() => {
  updateAppConfig({ cache: { enabled: true, warmCollections: true, maxBytes: DEFAULT_CACHE_BYTES } })
  audio.clear()
  getDb().exec('DELETE FROM favorites; DELETE FROM playlists')
  resolutions = []; downloads = []; lyricRequests = []
  resolveQuality = async (_track, quality) => quality
  fetchAudio = async () => new Response('test audio data', { headers: { 'content-type': 'audio/mpeg' } })
  fetchLyric = async () => fullLyric
  mock.method(sourceManager, 'getMusicUrl', async (track: Song, preferred: Quality[], onlySourceId: unknown, strict: boolean) => {
    assert.equal(strict, true)
    assert.equal(onlySourceId, undefined)
    assert.equal(preferred.length, 1)
    // Cache warming must also probe higher qualities for old 128k-only metadata.
    assert.deepEqual(track.qualities, QUALITIES)
    resolutions.push(track.platform + '/' + track.songmid + '/' + preferred[0])
    const quality = await resolveQuality(track, preferred[0])
    return { url: 'https://93.184.216.34/' + track.platform + '/' + track.songmid + '/' + quality,
      quality, platform: track.platform, sourceId: 'fixture', sourceName: 'fixture' }
  })
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname === '127.0.0.1') return originalFetch(input, init)
    assert.equal(url.hostname, '93.184.216.34', 'tests cannot contact real music services')
    downloads.push(url.pathname)
    return fetchAudio(url)
  })
  for (const platform of ['wy', 'tx'] as const) mock.method(getProvider(platform), 'lyric', async (track: Song) => {
    lyricRequests.push(track.platform + '/' + track.songmid)
    return fetchLyric(track)
  })
})

afterEach(async () => {
  await drain()
  mock.restoreAll()
})
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  closeDb()
  const resolved = fs.realpathSync(temp)
  assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase())
  assert.ok(path.basename(resolved).startsWith('miyin-cache-test-'))
  fs.rmSync(resolved, { recursive: true })
})

test('an existing standard file cannot skip the other three qualities, and repeated requests reuse every file', async () => {
  resolveQuality = async (_track, quality) => {
    if (quality !== '128k') throw new Error('not available yet')
    return quality
  }
  assert.deepEqual((await audio.ensure(song('upgrade'))).map(item => item.quality), ['128k'])
  resolveQuality = async (_track, quality) => quality
  assert.deepEqual((await audio.ensure(song('upgrade'))).map(item => item.quality), QUALITIES)
  assert.equal(audio.stats().count, 4)
  assert.equal(new Set(downloads).size, 4)
  assert.equal(downloads.length, 4)
  const calls = resolutions.length
  await audio.ensure({ ...song('upgrade'), name: '另一个用户的歌名' })
  assert.equal(resolutions.length, calls)
  assert.equal(downloads.length, 4)
  const files = getDb().prepare('SELECT file_name FROM audio_cache').all().map(row => String(row.file_name))
  assert.equal(new Set(files).size, 4)
  for (const file of files) assert.equal(fs.readFileSync(path.join(temp, 'audio-cache', file), 'utf8'), 'test audio data')
})

test('simultaneous requests for one song download each quality once', async () => {
  const result = await Promise.all(Array.from({ length: 6 }, () => audio.ensure(song('concurrent'))))
  assert.ok(result.every(items => items.length === 4))
  assert.equal(resolutions.length, 4)
  assert.equal(downloads.length, 4)
  assert.equal(audio.stats().count, 4)
})

test('unavailable or mismatched qualities never block other files or get mislabeled', async () => {
  resolveQuality = async (_track, quality) => {
    if (quality === '320k') throw new Error('unavailable')
    return quality === 'flac' ? '128k' : quality
  }
  const result = await audio.ensure(song('partial'))
  assert.deepEqual(result.map(item => item.quality), ['128k', 'flac24bit'])
  assert.equal(downloads.length, 2)
  assert.equal(audio.lookup(song('partial'), ['flac']), null)
  assert.equal(audio.lookup(song('partial'), ['320k']), null)
})

test('two users share all audio and lyrics while favorites and playlists stay independent through the API', async () => {
  const track = song('shared')
  const replies = await Promise.all([request('/api/library/favorites', 'POST', { song: track }),
    request('/api/library/favorites', 'POST', { song: { ...track, name: '另一份标题' } }, bobToken)])
  for (const reply of replies) assert.equal(reply.status, 200)
  const alicePlaylist = library.createPlaylist(alice, { name: '甲的歌单' }).playlists[0].id
  const bobPlaylist = library.createPlaylist(bob, { name: '乙的歌单' }).playlists[0].id
  for (const [id, token] of [[alicePlaylist, aliceToken], [bobPlaylist, bobToken]]) {
    assert.equal((await request('/api/library/playlists/' + id + '/songs', 'POST', { song: track }, token)).status, 200)
  }
  await drain()
  assert.equal(audio.stats().count, 4)
  assert.equal(audio.stats().lyricCount, 1)
  assert.equal(downloads.length, 4)
  assert.equal(lyricRequests.length, 1)
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM favorites').get()!.n, 2)
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM playlist_songs').get()!.n, 2)
  assert.equal((await request('/api/library/favorites/wy_shared', 'DELETE')).status, 200)
  assert.equal((await request('/api/library/playlists/' + alicePlaylist + '/songs/wy_shared', 'DELETE')).status, 200)
  assert.equal(library.getFavorites(alice).length, 0)
  assert.equal(library.getFavorites(bob).length, 1)
  assert.equal(library.getPlaylist(alice, alicePlaylist).songs.length, 0)
  assert.equal(library.getPlaylist(bob, bobPlaylist).songs.length, 1)
  assert.equal((await request('/api/library/playlists/' + alicePlaylist + '/songs', 'POST', { song: track }, bobToken)).status, 404)
  fetchLyric = async () => { throw new Error('upstream offline') }
  for (const token of [aliceToken, bobToken]) {
    const response = await request('/api/lyric', 'POST', { song: track }, token)
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json() as { lyric: LyricResult }).lyric, fullLyric)
  }
  assert.equal(audio.stats().count, 4)
  assert.equal(downloads.length, 4)
  assert.equal(lyricRequests.length, 1)
})

test('platform is part of shared identity; matching song IDs on different platforms remain distinct', async () => {
  await Promise.all([audio.ensure(song('42')), audio.ensure(song('42', 'tx')),
    lyrics.get(song('42')), lyrics.get(song('42', 'tx'))])
  assert.equal(audio.stats().count, 8)
  assert.equal(audio.stats().lyricCount, 2)
  assert.notEqual(audio.lookup(song('42'), ['128k'])!.key, audio.lookup(song('42', 'tx'), ['128k'])!.key)
})

test('lyrics persist with translation and word timing, stale refresh failure or empty response preserves them', async () => {
  const track = song('lyric')
  assert.deepEqual(await lyrics.get(track), fullLyric)
  assert.deepEqual(await lyrics.get(track), fullLyric)
  assert.equal(lyricRequests.length, 1)
  getDb().prepare('UPDATE lyric_cache SET fetched_at = 1').run()
  fetchLyric = async () => { throw new Error('offline') }
  assert.deepEqual(await lyrics.get(track), fullLyric)
  fetchLyric = async () => ({ lyric: '' })
  assert.deepEqual(await lyrics.get(track), fullLyric)
  assert.equal(lyrics.stats().count, 1)
  fetchLyric = async () => ({ lyric: '[00:02.00]新版' })
  assert.deepEqual(await lyrics.get(track), { lyric: '[00:02.00]新版' })
  assert.ok(Number(getDb().prepare('SELECT fetched_at FROM lyric_cache').get()!.fetched_at) > 1)
  fetchLyric = async () => ({ lyric: '' })
  assert.deepEqual(await lyrics.get(song('empty')), { lyric: '' })
  assert.equal(lyrics.stats().count, 1)
  fetchLyric = async () => fullLyric
  assert.deepEqual(await lyrics.get(song('empty')), fullLyric)
  assert.equal(lyrics.stats().count, 2)
})

test('concurrent lyric requests coalesce and clearing prevents old in-flight lyrics from returning to storage', async () => {
  let release!: (value: LyricResult) => void
  fetchLyric = () => new Promise(resolve => { release = resolve })
  const pending = [lyrics.get(song('clear-lyric')), lyrics.get(song('clear-lyric'))]
  assert.equal(lyricRequests.length, 1)
  audio.clear()
  release(fullLyric)
  assert.deepEqual(await Promise.all(pending), [fullLyric, fullLyric])
  assert.equal(lyrics.stats().count, 0)
})

test('clearing during download prevents old audio tasks from repopulating files or records', async () => {
  let release!: (value: Response) => void
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  fetchAudio = () => new Promise(resolve => { release = resolve; started() })
  const pending = audio.ensure(song('clear-audio'))
  await ready
  audio.clear()
  release(new Response('late audio'))
  assert.deepEqual(await pending, [])
  assert.equal(audio.stats().count, 0)
  assert.deepEqual(fs.readdirSync(path.join(temp, 'audio-cache')), [])
})

test('startup backfill queues every unique collection song beyond 200 and manual warming works with auto off', async () => {
  updateAppConfig({ cache: { warmCollections: false, qualities: ['128k'] } })
  assert.deepEqual(getAppConfig().cache.qualities, QUALITIES)
  const insert = getDb().prepare('INSERT INTO favorites (user_id, song_key, song_json, added_at) VALUES (?, ?, ?, ?)')
  for (let i = 0; i < 205; i++) {
    const track = song('backfill-' + i)
    insert.run(alice, 'wy_' + track.songmid, JSON.stringify(track), Date.now())
    insert.run(bob, 'wy_' + track.songmid, JSON.stringify({ ...track, qualities: undefined }), Date.now())
  }
  resolveQuality = async () => { throw new Error('not available') }
  fetchLyric = async () => ({ lyric: '' })
  assert.equal(audio.warmCollections(false), 0)
  assert.equal(audio.warm(song('automatic')), false)
  assert.equal(audio.warmCollections(), 205)
  assert.equal(audio.warmCollections(), 0)
  await drain()
  assert.equal(new Set(resolutions).size, 205 * 4)
  assert.equal(resolutions.length, 205 * 4)
  assert.equal(lyricRequests.length, 205)
})

test('disabled cache never warms or persists lyrics, but still allows online lyrics', async () => {
  updateAppConfig({ cache: { enabled: false } })
  assert.equal(audio.warm(song('disabled'), true), false)
  assert.equal(audio.warmCollections(), 0)
  assert.deepEqual(await audio.ensure(song('disabled')), [])
  assert.deepEqual(await lyrics.get(song('disabled')), fullLyric)
  assert.equal(audio.stats().count, 0)
  assert.equal(lyrics.stats().count, 0)
  assert.equal(downloads.length, 0)
})

test('cache capacity evicts least-recent audio and totals and clearing include lyrics', async () => {
  await audio.ensure(song('lru'))
  await lyrics.get(song('lru'))
  updateAppConfig({ cache: { maxBytes: 256 * 1024 * 1024 } })
  getDb().prepare("UPDATE audio_cache SET bytes = ?, last_access_at = CASE quality WHEN '128k' THEN 1 ELSE 2 END")
    .run(100 * 1024 * 1024)
  audio.enforceLimit()
  assert.equal(audio.lookup(song('lru'), ['128k']), null)
  assert.equal(audio.stats().count, 2)
  assert.ok(audio.stats().bytes <= audio.stats().maxBytes)
  assert.equal(audio.stats().bytes, 200 * 1024 * 1024 + lyrics.stats().bytes)
  const total = audio.stats()
  assert.deepEqual(audio.clear(), { removed: total.count + total.lyricCount, bytes: total.bytes })
  assert.equal(audio.stats().bytes, 0)
  assert.equal(audio.stats().lyricCount, 0)
  assert.deepEqual(fs.readdirSync(path.join(temp, 'audio-cache')), [])
})

test('audio and complete lyrics survive a separate server process with upstream offline', async () => {
  const track = song('restart')
  await audio.ensure(track)
  await lyrics.get(track)
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const audio = await import(${JSON.stringify(new URL('../src/audio-cache.ts', import.meta.url).href)});
    const lyrics = await import(${JSON.stringify(new URL('../src/lyric-cache.ts', import.meta.url).href)});
    globalThis.fetch = () => { throw new Error('offline'); };
    audio.init();
    const track = ${JSON.stringify(track)};
    for (const quality of ['128k', '320k', 'flac', 'flac24bit']) assert.equal(audio.lookup(track, [quality]).quality, quality);
    assert.deepEqual(await lyrics.get(track), ${JSON.stringify(fullLyric)});
    console.log('PERSISTENCE_OK');
  `], { env: { ...process.env, MIYIN_DATA_DIR: temp }, encoding: 'utf8', timeout: 15000 })
  assert.equal(child.status, 0, child.stdout + child.stderr)
  assert.match(child.stdout, /PERSISTENCE_OK/)
})

test('failure to persist lyrics does not break successfully fetched online lyrics', async () => {
  getDb().exec("CREATE TRIGGER fail_lyric_cache BEFORE INSERT ON lyric_cache BEGIN SELECT RAISE(ABORT, 'disk unavailable'); END")
  try {
    assert.deepEqual(await lyrics.get(song('disk-error')), fullLyric)
    assert.equal(lyrics.stats().count, 0)
  } finally {
    getDb().exec('DROP TRIGGER fail_lyric_cache')
  }
})

test('cached lyrics remain usable offline when updating their access timestamp fails', async () => {
  const track = song('readonly-lyric')
  await lyrics.get(track)
  fetchLyric = async () => { throw new Error('offline') }
  getDb().exec("CREATE TRIGGER fail_lyric_touch BEFORE UPDATE ON lyric_cache BEGIN SELECT RAISE(ABORT, 'read only'); END")
  try {
    assert.deepEqual(await lyrics.get(track), fullLyric)
    assert.equal(lyrics.stats().count, 1)
  } finally {
    getDb().exec('DROP TRIGGER fail_lyric_touch')
  }
})
