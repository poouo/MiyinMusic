import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowedPlaylistUrl, playlistIdFromUrl, resolvePlaylistLink, fullPlaylist } from '../src/playlist-import.js'
import { preferenceSeeds } from '../src/recommendations.js'
import type { PlaylistDetail, Song } from '../src/types.js'

const song = (id: number, singer = '歌手'): Song => ({ platform: 'tx', songmid: String(id), name: '歌曲 ' + id, singer, albumName: '', interval: 200, qualities: ['320k'] })
const page = (songs: Song[], offset: number, total: number, hasMore: boolean): PlaylistDetail => ({ playlist: { id: 'tx-123', platform: 'tx', name: '完整歌单' }, songs, total, offset, limit: 300, hasMore })

test('playlist URLs accept official desktop, mobile, hash and share text routes', async () => {
  for (const [url, id] of [
    ['https://y.qq.com/n/ryqq/playlist/123', 'tx-123'],
    ['https://i.y.qq.com/n2/m/share/details/taoge.html?disstid=456', 'tx-456'],
    ['https://i2.y.qq.com/n3/other/pages/details/playlist.html?platform=11&appshare=android_qq&id=3204901235&ADTAG=wxfshare', 'tx-3204901235'],
    ['https://music.163.com/#/playlist?id=789', 'wy-789'],
    ['https://music.163.com/playlist?id=789', 'wy-789'],
  ]) {
    assert.equal(playlistIdFromUrl(allowedPlaylistUrl(url)), id)
    assert.equal(await resolvePlaylistLink('分享歌单 ' + url + ' 一起听'), id)
  }
})
test('playlist resolver rejects credentials, custom ports, spoofed hosts and non-web protocols', () => {
  for (const url of ['http://127.0.0.1/a', 'https://y.qq.com.evil.test/a', 'https://i2.y.qq.com.evil.test/playlist?id=1', 'https://y.qq.com@evil.test/a', 'https://user:password@y.qq.com/a', 'https://y.qq.com:8443/a', 'file:///etc/passwd']) assert.throws(() => allowedPlaylistUrl(url))
})
test('every share-link redirect is validated before fetching the next hop', async () => {
  let requests = 0
  const fetcher = (async () => { requests++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }) }) as typeof fetch
  await assert.rejects(() => resolvePlaylistLink('https://163cn.tv/short', fetcher))
  assert.equal(requests, 1)
  const valid = (async () => new Response(null, { status: 302, headers: { location: 'https://music.163.com/playlist?id=789' } })) as typeof fetch
  assert.equal(await resolvePlaylistLink('https://163cn.tv/short', valid), 'wy-789')
})
test('full playlist advances by raw page length and deduplicates only after retrieval', async () => {
  const offsets: number[] = []
  const result = await fullPlaylist('tx-123', async (_id, options) => {
    const offset = options?.offset ?? 0; offsets.push(offset)
    return offset === 0 ? page([song(1), song(2)], offset, 4, true) : page([song(2), song(3)], offset, 4, false)
  })
  assert.deepEqual(offsets, [0, 2]); assert.deepEqual(result.songs.map(song => song.songmid), ['1', '2', '3']); assert.equal(result.hasMore, false)
})
test('empty, incomplete, oversized and interrupted playlists never return a partial import', async () => {
  for (const read of [
    async () => page([], 0, 0, false),
    async () => page([song(1)], 0, 10, false),
    async () => page([song(1)], 0, 2001, false),
    async (_id: string, options?: { offset?: number }) => { if (options?.offset) throw new Error('network'); return page([song(1)], 0, 2, true) },
  ]) await assert.rejects(() => fullPlaylist('tx-123', read))
})
test('preference seeds weight likes above history, split collaborations and preserve platform identity', () => {
  const result = preferenceSeeds({ favorites: [{ song: song(1, '甲、乙'), addedAt: 1 }], history: [{ song: song(2, '丙'), playedAt: 1 }, { song: { ...song(3, '甲'), platform: 'wy' }, playedAt: 2 }] })
  assert.equal(result.length, 3)
  assert.equal(result[0].score, 3); assert.equal(result[1].score, 3)
  assert.equal(result[0].reason, '你喜欢')
  assert.deepEqual(preferenceSeeds({ favorites: [], history: [] }), [])
})
