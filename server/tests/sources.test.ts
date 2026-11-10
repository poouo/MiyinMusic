import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { after, test } from 'node:test'
import { resolvePrioritized, ResolutionPool } from '../src/lx/resolve.js'
import { SourceRuntime } from '../src/lx/sandbox.js'
import type { LxRequestPayload } from '../src/lx/sandbox.js'
import type { Song } from '../src/types.js'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'miyin-sources-test-'))
process.env.MIYIN_DATA_DIR = temp
const { SourceManager } = await import('../src/lx/manager.js')
const { listSources } = await import('../src/lx/repo.js')
const { closeDb } = await import('../src/db.js')
after(() => { closeDb(); fs.rmSync(temp, { recursive: true, force: true }) })

const track: Song = { platform: 'tx', songmid: 'test', name: 'Test', singer: 'Test', interval: 200, albumName: '', qualities: ['320k', '128k'] }
const goodUrl = 'https://1.1.1.1/audio.mp3'
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const cancel = () => { clearTimeout(timer); reject(signal.reason) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, ms)
  signal.addEventListener('abort', cancel, { once: true })
})
function fixture(handlers: ((payload: LxRequestPayload, signal: AbortSignal) => Promise<string>)[]) {
  const manager = new SourceManager()
  const sources = new Map(handlers.map((handler, order) => [String(order), {
    id: String(order), name: String(order), kind: 'builtin', enabled: true, order, status: 'ready', meta: {},
    platforms: { tx: { actions: ['musicUrl'], qualitys: ['320k', '128k'] } }, stats: { ok: 0, fail: 0, lastError: undefined as string | undefined },
    runtime: { request: handler, dispose() {} },
  }]))
  Object.assign(manager, { sources })
  return { manager, sources }
}

test('priority hedging reaches later sources, bounds concurrency and aborts losers', async () => {
  const started: number[] = []
  let active = 0, peak = 0, cancelled = 0
  const result = await resolvePrioritized(Array.from({ length: 8 }, (_, index) => async signal => {
    started.push(index); active++; peak = Math.max(peak, active)
    try { await wait(index === 5 ? 2 : 500, signal); return index }
    catch (error) { cancelled++; throw error }
    finally { active-- }
  }), { budgetMs: 500, attemptMs: 35, hedgeMs: 5, concurrency: 3 })
  assert.equal(result, 5)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(started, Array.from({ length: started.length }, (_, index) => index)); assert.ok(started.includes(5)); assert.ok(peak <= 3)
  assert.equal(active, 0); assert.equal(cancelled, started.length - 1)
})

test('first priority wins before any hedge; total budget cancels hanging tasks', async () => {
  let calls = 0
  assert.equal(await resolvePrioritized([async () => 'first', async () => { calls++; return 'second' }], { budgetMs: 100 }), 'first')
  assert.equal(calls, 0)
  await assert.rejects(resolvePrioritized([async signal => { await wait(500, signal) }], { budgetMs: 20 }), AggregateError)
})

test('shared capacity bounds total and per-source concurrency without blocking other sources', async () => {
  const pool = new ResolutionPool(4, 2)
  let active = 0, peak = 0, sameSource = 0, sourcePeak = 0
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => {
    const id = index < 8 ? 'busy' : 'other'
    return pool.run(id, new AbortController().signal, async () => {
      active++; peak = Math.max(peak, active)
      if (id === 'busy') { sameSource++; sourcePeak = Math.max(sourcePeak, sameSource) }
      await new Promise(resolve => setTimeout(resolve, 15))
      active--; if (id === 'busy') sameSource--
      return index
    })
  }))
  assert.equal(results.length, 12); assert.ok(peak <= 4); assert.ok(sourcePeak <= 2)
})

test('one user cancellation cannot abort another user, and cancelled queued work never starts', async () => {
  const pool = new ResolutionPool(2, 2)
  const first = new AbortController(), second = new AbortController(), queued = new AbortController()
  let queuedCalls = 0
  const a = pool.run('source', first.signal, async () => { await wait(500, first.signal) })
  const aRejected = assert.rejects(a)
  const b = pool.run('source', second.signal, async () => { await wait(45, second.signal); return 'user-b' })
  const c = pool.run('source', queued.signal, async () => { queuedCalls++ })
  const cRejected = assert.rejects(c)
  await new Promise(resolve => setImmediate(resolve))
  queued.abort(); first.abort()
  await aRejected; await cRejected; assert.equal(await b, 'user-b'); assert.equal(queuedCalls, 0)
})

test('simultaneous listeners share resolution, but different songs keep independent results', async () => {
  let calls = 0
  const { manager } = fixture([async (payload, signal) => {
    calls++; await wait(20, signal); return goodUrl + '?song=' + payload.info.musicInfo.songmid
  }])
  const [a, b, c] = await Promise.all([
    manager.getMusicUrl(track, ['320k'], undefined, true), manager.getMusicUrl(track, ['320k'], undefined, true),
    manager.getMusicUrl({ ...track, songmid: 'other' }, ['320k'], undefined, true),
  ])
  assert.equal(calls, 2); assert.equal(a.url, b.url); assert.notEqual(a.url, c.url)
})

test('manager tries beyond the first three and records individual errors only', async () => {
  const { manager, sources } = fixture([
    async () => { throw new Error('blocked') }, async () => { throw new Error('missing') },
    async () => { throw new Error('offline') }, async () => goodUrl,
  ])
  assert.equal((await manager.getMusicUrl(track, ['320k'], undefined, true)).sourceId, '3')
  assert.equal(sources.get('0')!.stats.lastError, 'blocked')
  assert.equal(sources.get('1')!.stats.lastError, 'missing')
  assert.equal(sources.get('2')!.stats.fail, 1); assert.equal(sources.get('3')!.stats.ok, 1)
})

test('reordering persists, validates complete IDs, invalidates cached and pending old results', async () => {
  let release!: (value: string) => void
  const { manager } = fixture([async () => new Promise(resolve => { release = resolve }), async () => goodUrl])
  const old = manager.getMusicUrl(track, ['320k'], undefined, true)
  await new Promise(resolve => setImmediate(resolve))
  manager.reorder(['1', '0'])
  assert.deepEqual(listSources().map(s => s.id), ['1', '0'])
  release(goodUrl)
  await old
  assert.equal((await manager.getMusicUrl(track, ['320k'], undefined, true)).sourceId, '1')
  assert.throws(() => manager.reorder(['0', '0']))
  assert.throws(() => manager.reorder(['0']))
  assert.throws(() => manager.reorder(['0', 'unknown']))
  assert.deepEqual(listSources().map(s => s.id), ['1', '0'])
})

test('bad playback addresses fall through and requested source stays explicit', async () => {
  const { manager } = fixture([async () => 'http://127.0.0.1/private', async () => goodUrl])
  assert.equal((await manager.getMusicUrl(track, ['320k'], undefined, true)).sourceId, '1')
  await assert.rejects(manager.getMusicUrl(track, ['320k'], '0', true), /地址不合法/)
})

test('a hanging preferred quality leaves time for an allowed fallback', async () => {
  const { manager } = fixture([async (payload, signal) => {
    if (payload.info.type === '320k') await wait(30000, signal)
    return goodUrl
  }])
  const started = Date.now()
  assert.equal((await manager.getMusicUrl(track, ['320k', '128k'], undefined, true)).quality, '128k')
  assert.ok(Date.now() - started < 10000)
})

test('cancelling one sandbox action aborts its HTTP request without affecting another user', async () => {
  let aborted = false
  const server = http.createServer((req, res) => {
    const timer = setTimeout(() => res.end('ok'), req.url === '/slow' ? 1000 : 60)
    res.on('close', () => { clearTimeout(timer); if (req.url === '/slow' && !res.writableFinished) aborted = true })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port
  const runtime = new SourceRuntime(`
    lx.on('request', payload => new Promise((resolve, reject) => {
      lx.request(${JSON.stringify(base)} + '/' + payload.info.type, {}, (error, response, body) => error ? reject(error) : resolve(body))
    }));
    lx.send('inited', { sources: { tx: { actions: ['musicUrl'], qualitys: ['128k'] } } });
  `)
  try {
    await runtime.init()
    const controller = new AbortController()
    const first = runtime.request({ action: 'musicUrl', source: 'tx', info: { type: 'slow', musicInfo: {} } }, controller.signal)
    const rejected = assert.rejects(first)
    const second = runtime.request({ action: 'musicUrl', source: 'tx', info: { type: 'fast', musicInfo: {} } })
    await new Promise(resolve => setTimeout(resolve, 25)); controller.abort()
    await rejected; assert.equal(await second, 'ok')
    assert.equal(aborted, true)
  } finally { runtime.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
