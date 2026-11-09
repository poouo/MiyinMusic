import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, test } from 'node:test'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'miyin-library-test-'))
process.env.MIYIN_DATA_DIR = temp
const { getDb, closeDb } = await import('../src/db.js')
const { register } = await import('../src/auth.js')
const library = await import('../src/library.js')
let userId: string
const song = (id: number) => ({ platform: 'wy' as const, songmid: String(id), name: '歌曲 ' + id,
  singer: '歌手', albumName: '', interval: 200, qualities: ['320k'] })

before(async () => { userId = (await register({ username: 'librarytest', password: 'testpassword123' })).id })
beforeEach(() => {
  for (const table of ['favorites', 'history', 'playlists', 'user_settings']) {
    getDb().prepare('DELETE FROM ' + table + ' WHERE user_id = ?').run(userId)
  }
})
after(() => {
  closeDb()
  const resolved = fs.realpathSync(temp)
  assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase())
  assert.ok(path.basename(resolved).startsWith('miyin-library-test-'))
  fs.rmSync(resolved, { recursive: true })
})

test('repeated favorite requests are idempotent', () => {
  library.addFavorite(userId, song(1))
  assert.equal(library.addFavorite(userId, song(1)).favorites.length, 1)
})

test('imports deduplicate songs and safely retry the same playlist', () => {
  const input = { playlists: [{ name: '外链歌单', songs: [song(1), song(1), song(2)] }] }
  library.importLibrary(userId, input)
  const result = library.importLibrary(userId, input)
  assert.equal(result.playlists.length, 1)
  assert.deepEqual(result.playlists[0].songs.map((s) => s.songmid), ['1', '2'])
})

test('over-limit imports fail before changing any data', () => {
  assert.throws(() => library.importLibrary(userId, { favorites: [song(1)],
    playlists: Array.from({ length: 201 }, (_, i) => ({ name: '歌单 ' + i, songs: [] })) }), /200/)
  assert.equal(library.getLibrary(userId).favorites.length, 0)
  assert.equal(library.getLibrary(userId).playlists.length, 0)
})

test('a playlist cannot bypass the 2000 song cap', () => {
  assert.throws(() => library.importLibrary(userId, { playlists: [{ name: '太多',
    songs: Array.from({ length: 2001 }, (_, i) => song(i)) }] }), /2000/)
  assert.equal(library.getLibrary(userId).playlists.length, 0)
})

test('invalid container shapes return a useful error', () => {
  assert.throws(() => library.importLibrary(userId, { favorites: {} as never }), /数组/)
  assert.throws(() => library.importLibrary(userId, { playlists: [{ name: '错误', songs: 'oops' }] }), /数组/)
})

test('imported history stays bounded and keeps input order', () => {
  const result = library.importLibrary(userId, { history: Array.from({ length: 230 }, (_, i) => song(i)) })
  assert.equal(result.history.length, 200)
  assert.equal(result.history[0].song.songmid, '0')
  assert.equal(result.history[199].song.songmid, '199')
})
