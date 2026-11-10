import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { logger } from '../log.js'
import { HttpError } from '../errors.js'
import { assertPublicUrl } from '../stream.js'
import { probeAudio, assertComplete, assertQuality } from '../media-validation.js'
import { request } from '../http-client.js'
import type { MusicUrlResult, Platform, Quality, Song } from '../types.js'
import { PLATFORM_NAMES, PLATFORMS, QUALITIES } from '../types.js'
import { BUILTIN_SOURCES, candidateUrls } from './catalog.js'
import { listSources, saveSources } from './repo.js'
import { SourceRuntime, type LxInited } from './sandbox.js'
import { resolvePrioritized, ResolutionPool } from './resolve.js'

const log = logger('sources')

export type SourceStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SourceMeta {
  name?: string
  version?: string
  author?: string
  description?: string
  homepage?: string
}

export interface PersistedSource {
  id: string
  kind: 'builtin' | 'custom'
  name: string
  url?: string
  script?: string
  enabled: boolean
  order?: number
}

interface SourceState extends PersistedSource {
  status: SourceStatus
  error?: string
  meta: SourceMeta
  platforms: Record<string, { actions: string[]; qualitys: Quality[] }>
  updatedAt?: number
  stats: { ok: number; fail: number; lastError?: string; lastOkAt?: number }
  runtime?: SourceRuntime
}

export interface PublicSource {
  id: string
  kind: 'builtin' | 'custom'
  name: string
  url?: string
  enabled: boolean
  status: SourceStatus
  error?: string
  meta: SourceMeta
  platforms: { platform: Platform; platformName: string; actions: string[]; qualitys: Quality[] }[]
  updatedAt?: number
  stats: { ok: number; fail: number; lastError?: string; lastOkAt?: number }
}

export interface SourceUpdateFailure {
  id: string
  name: string
  error: string
}

export interface SourceUpdateState {
  running: boolean
  startedAt: number
  finishedAt: number
  total: number
  checked: number
  updated: number
  failed: SourceUpdateFailure[]
}

const HEADER_FIELDS = ['name', 'description', 'version', 'author', 'homepage'] as const

function parseMeta(script: string): SourceMeta {
  const head = script.slice(0, 4000)
  const meta: SourceMeta = {}
  for (const field of HEADER_FIELDS) {
    const re = new RegExp('@' + field + '[ \\t]*[:：][ \\t]*(.+)', 'i')
    const m = re.exec(head)
    if (m) meta[field] = m[1].trim()
  }
  return meta
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err
  if (typeof err === 'string') return new Error(err)
  return new Error(String(err))
}

export class SourceManager {
  constructor(private readonly probe = probeAudio) {}
  private sources = new Map<string, SourceState>()
  private loading = new Map<string, Promise<void>>()
  private urlCache = new Map<string, { value: MusicUrlResult; expire: number }>()
  private pending = new Map<string, Promise<MusicUrlResult>>()
  private revision = 0
  private unhealthy = new Map<string, { failures: number; retryAt: number }>()
  private resolutionPool = new ResolutionPool()
  private bootstrapped: Promise<void> | null = null
  private updateState: SourceUpdateState = {
    running: false,
    startedAt: 0,
    finishedAt: 0,
    total: 0,
    checked: 0,
    updated: 0,
    failed: [],
  }

  async bootstrap(): Promise<void> {
    if (this.bootstrapped) return this.bootstrapped
    this.bootstrapped = this.doBootstrap()
    return this.bootstrapped
  }

  private async doBootstrap(): Promise<void> {
    const persisted = this.readState()
    const persistedMap = new Map(persisted.map((s) => [s.id, s]))

    let order = Math.max(-1, ...persisted.map(s => s.order ?? 0)) + 1
    for (const builtin of BUILTIN_SOURCES) {
      const saved = persistedMap.get(builtin.id)
      this.sources.set(builtin.id, {
        id: builtin.id,
        kind: 'builtin',
        name: saved?.name ?? builtin.name,
        url: candidateUrls(builtin.path)[0],
        enabled: saved?.enabled ?? true,
        order: saved?.order ?? order++,
        status: 'idle',
        meta: { name: builtin.name },
        platforms: {},
        stats: { ok: 0, fail: 0 },
      })
      persistedMap.delete(builtin.id)
    }
    for (const custom of persistedMap.values()) {
      this.sources.set(custom.id, {
        ...custom,
        status: 'idle',
        meta: { name: custom.name },
        platforms: {},
        stats: { ok: 0, fail: 0 },
      })
    }
    const ordered = [...this.sources.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    ordered.forEach((source, index) => { source.order = index })
    this.writeState()

    const scheduled: Promise<void>[] = []
    for (const source of this.sources.values()) {
      if (source.enabled) scheduled.push(this.load(source.id))
    }
    // 启动时把已启用的音源全部加载完成（脚本通常很小，几秒内结束）
    await this.runWithConcurrency(scheduled, 4)
  }

  private async runWithConcurrency(
    tasks: (Promise<void> | (() => Promise<void>))[],
    limit: number,
  ): Promise<void> {
    const queue = [...tasks]
    const workers: Promise<void>[] = []
    const worker = async (): Promise<void> => {
      while (queue.length) {
        const task = queue.shift()
        if (!task) break
        if (typeof task === 'function') await task().catch(() => undefined)
        else await task.catch(() => undefined)
      }
    }
    for (let i = 0; i < Math.min(limit, tasks.length); i++) workers.push(worker())
    await Promise.all(workers)
  }

  private readState(): PersistedSource[] {
    try {
      return listSources()
    } catch (err) {
      log.warn('读取音源配置失败：', toError(err).message)
      return []
    }
  }

  private writeState(): void {
    try {
      saveSources(
        [...this.sources.values()]
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map(({ id, kind, name, url, script, enabled, order }) => ({ id, kind, name, url, script, enabled, order })),
      )
    } catch (err) {
      log.warn('保存音源配置失败：', toError(err).message)
    }
  }

  private cacheFile(id: string): string {
    return path.join(config.cacheDir, 'source-' + id + '.js')
  }

  private readCache(id: string): string | null {
    try {
      const file = this.cacheFile(id)
      if (!fs.existsSync(file)) return null
      const text = fs.readFileSync(file, 'utf8')
      return text.length > 100 ? text : null
    } catch {
      return null
    }
  }

  private writeCache(id: string, script: string): void {
    try {
      fs.mkdirSync(config.cacheDir, { recursive: true })
      fs.writeFileSync(this.cacheFile(id), script)
    } catch (err) {
      log.warn('写入音源缓存失败：', toError(err).message)
    }
  }

  private async downloadScript(source: SourceState): Promise<string> {
    const urls = candidateUrls(source.url ?? '')
    let lastError: Error | null = null
    for (const url of urls) {
      try {
        const res = await request(url, {
          timeoutMs: config.sourceLoadTimeoutMs,
          retries: 0,
          headers: { Accept: 'text/plain,*/*' },
        })
        if (res.status >= 400) {
          lastError = new Error('HTTP ' + res.status)
          continue
        }
        const text = res.text
        if (text.length < 100 || !/lx\.|globalThis|function|=>/.test(text)) {
          lastError = new Error('返回内容不是有效的音源脚本')
          continue
        }
        return text
      } catch (err) {
        lastError = toError(err)
      }
    }
    throw lastError ?? new Error('下载音源脚本失败')
  }

  load(id: string): Promise<void> {
    const running = this.loading.get(id)
    if (running) return running
    const task = this.doLoad(id).finally(() => this.loading.delete(id))
    this.loading.set(id, task)
    return task
  }

  private async doLoad(id: string): Promise<void> {
    const source = this.sources.get(id)
    if (!source) throw new Error('音源不存在：' + id)

    source.status = 'loading'
    source.error = undefined
    const started = Date.now()
    try {
      let script = source.script ?? null
      if (!script) {
        script = this.readCache(id)
        // 没有缓存时必须联网，成功后写入缓存以便下次离线可用
        if (!script) {
          script = await this.downloadScript(source)
          this.writeCache(id, script)
        } else {
          void this.refreshInBackground(source, script)
        }
      }
      if (script.length < 100) throw new Error('音源脚本内容为空')
      source.updatedAt = Date.now()

      const runtime = new SourceRuntime(script, {
        filename: id + '.js',
        initTimeoutMs: 15000,
        actionTimeoutMs: config.actionTimeoutMs,
        debug: config.debugSource,
        onLog: (level, args) => {
          if (level === 'error') log.debug('[' + id + ']', ...args)
        },
      })
      source.runtime?.dispose()
      source.runtime = runtime
      const inited: LxInited = await runtime.init()

      if (inited.status === false) {
        throw new Error((inited as unknown as { message?: string }).message ?? '音源脚本初始化失败')
      }
      if (!inited.sources || !Object.keys(inited.sources).length) {
        throw new Error('音源脚本没有声明任何可用平台')
      }

      const platforms: SourceState['platforms'] = {}
      for (const [platform, info] of Object.entries(inited.sources)) {
        if (!PLATFORMS.includes(platform as Platform)) {
          if (platform === 'local') continue
          continue
        }
        const qualitys = (info.qualitys ?? []).filter((q): q is Quality => QUALITIES.includes(q as Quality))
        platforms[platform] = {
          actions: Array.isArray(info.actions) ? info.actions : [],
          qualitys: qualitys.length ? qualitys : ['128k'],
        }
      }
      if (!Object.keys(platforms).length) throw new Error('音源脚本未提供受支持的平台')

      source.platforms = platforms
      source.status = 'ready'
      if (!source.meta.name || source.meta.name === source.name) {
        source.meta = { ...source.meta, ...parseMeta(script) }
      }
      log.info('音源就绪', source.name, '(' + id + ')', Object.keys(platforms).join('/'), Date.now() - started + 'ms')
    } catch (err) {
      source.status = 'error'
      source.error = toError(err).message
      source.platforms = {}
      source.stats.lastError = source.error
      log.warn('音源不可用', source.name, '(' + id + ')：', source.error)
      throw err
    }
  }

  private refreshInBackground(source: SourceState, cachedScript: string): void {
    void (async () => {
      try {
        const fresh = await this.downloadScript(source)
        if (fresh === cachedScript) return
        this.writeCache(source.id, fresh)
        source.script = undefined
        await this.doLoad(source.id)
      } catch {
        /* 静默失败，继续使用缓存 */
      }
    })()
  }

  list(): PublicSource[] {
    return [...this.sources.values()]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((s) => this.toPublic(s))
  }

  reorder(ids: unknown): PublicSource[] {
    if (!Array.isArray(ids) || ids.length !== this.sources.size || new Set(ids).size !== ids.length ||
      ids.some(id => typeof id !== 'string' || !this.sources.has(id))) {
      throw new HttpError(400, '音源列表已变化，请刷新后重新排序')
    }
    // Commit to disk first: a failed save must leave the previous order intact.
    const ordered = ids.map((id, order) => ({ ...this.sources.get(id)!, order }))
    saveSources(ordered)
    for (const source of ordered) this.sources.get(source.id)!.order = source.order
    this.invalidateUrls()
    this.unhealthy.clear()
    return this.list()
  }

  private invalidateUrls(): void {
    this.revision++
    this.urlCache.clear()
  }

  private toPublic(s: SourceState): PublicSource {
    return {
      id: s.id,
      kind: s.kind,
      name: s.meta.name ?? s.name,
      url: s.url,
      enabled: s.enabled,
      status: s.status,
      error: s.error,
      meta: s.meta,
      platforms: Object.entries(s.platforms).map(([platform, info]) => ({
        platform: platform as Platform,
        platformName: PLATFORM_NAMES[platform as Platform] ?? platform,
        actions: info.actions,
        qualitys: info.qualitys,
      })),
      updatedAt: s.updatedAt,
      stats: s.stats,
    }
  }

  async reload(id: string): Promise<PublicSource> {
    const source = this.sources.get(id)
    if (!source) throw new Error('音源不存在')
    await this.doLoad(id)
    this.invalidateUrls()
    for (const key of this.unhealthy.keys()) if (key.startsWith(id + ':')) this.unhealthy.delete(key)
    return this.toPublic(source)
  }

  setEnabled(id: string, enabled: boolean): PublicSource {
    const source = this.sources.get(id)
    if (!source) throw new Error('音源不存在')
    source.enabled = enabled
    this.invalidateUrls()
    this.writeState()
    if (enabled && source.status !== 'ready') void this.load(id).catch(() => undefined)
    return this.toPublic(source)
  }

  async addCustom(input: { name?: string; url?: string; script?: string }): Promise<PublicSource> {
    const id = 'custom-' + Date.now().toString(36)
    let script = input.script ?? null
    const source: SourceState = {
      id,
      kind: 'custom',
      name: input.name || '自定义音源',
      url: input.url,
      script: script ?? undefined,
      enabled: true,
      order: Math.max(-1, ...[...this.sources.values()].map(s => s.order ?? 0)) + 1,
      status: 'idle',
      meta: { name: input.name || '自定义音源' },
      platforms: {},
      stats: { ok: 0, fail: 0 },
    }
    this.sources.set(id, source)
    this.invalidateUrls()
    this.writeState()
    if (!script && input.url) {
      script = await this.downloadScript(source)
      this.writeCache(id, script)
    }
    if (!script) throw new Error('请提供音源脚本内容或地址')
    source.script = undefined
    await this.doLoad(id)
    return this.toPublic(source)
  }

  removeCustom(id: string): void {
    const source = this.sources.get(id)
    if (!source) throw new Error('音源不存在')
    if (source.kind === 'builtin') throw new Error('内置音源不能删除，可以关闭')
    source.runtime?.dispose()
    this.sources.delete(id)
    this.invalidateUrls()
    try {
      fs.rmSync(this.cacheFile(id), { force: true })
    } catch {
      /* ignore */
    }
    this.writeState()
  }

  /** 从 GitHub 拉取最新脚本：返回是否发生变化 */
  private async refreshScript(source: SourceState): Promise<{ updated: boolean }> {
    const fresh = await this.downloadScript(source)
    const cached = this.readCache(source.id)
    if (fresh === cached) return { updated: false }
    this.writeCache(source.id, fresh)
    source.updatedAt = Date.now()
    // 已经加载过的音源立即换成新脚本；停用的音源只更新磁盘缓存
    if (source.enabled && (source.status === 'ready' || source.status === 'error')) {
      await this.doLoad(source.id)
    }
    return { updated: true }
  }

  /** 后台更新全部内置音源（GitHub 仓库更新后使用） */
  startUpdate(): SourceUpdateState {
    if (this.updateState.running) return this.getUpdateState()
    const builtins = [...this.sources.values()].filter((source) => source.kind === 'builtin')
    this.updateState = {
      running: true,
      startedAt: Date.now(),
      finishedAt: 0,
      total: builtins.length,
      checked: 0,
      updated: 0,
      failed: [],
    }
    void (async () => {
      try {
        await this.runWithConcurrency(
          builtins.map((source) => async () => {
            try {
              const result = await this.refreshScript(source)
              if (result.updated) this.updateState.updated++
            } catch (err) {
              this.updateState.failed.push({ id: source.id, name: source.name, error: toError(err).message })
            } finally {
              this.updateState.checked++
            }
          }),
          4,
        )
      } finally {
        this.updateState.running = false
        this.updateState.finishedAt = Date.now()
        log.info(
          '音源更新完成：' +
            this.updateState.updated +
            ' 个更新 / ' +
            this.updateState.checked +
            ' 个检查，失败 ' +
            this.updateState.failed.length +
            ' 个',
        )
      }
    })()
    return this.getUpdateState()
  }

  getUpdateState(): SourceUpdateState {
    return { ...this.updateState, failed: [...this.updateState.failed] }
  }

  /** 手动更新单个音源脚本 */
  async updateSource(id: string): Promise<PublicSource> {
    const source = this.sources.get(id)
    if (!source) throw new Error('音源不存在')
    await this.refreshScript(source)
    if (source.enabled && source.status !== 'ready') await this.load(id)
    return this.toPublic(source)
  }

  /** 支持指定平台且提供播放地址的音源 */
  private candidates(platform: Platform): SourceState[] {
    return [...this.sources.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).filter(
      (s) =>
        s.enabled &&
        s.status === 'ready' &&
        s.runtime &&
        s.platforms[platform] &&
        s.platforms[platform].actions.includes('musicUrl'),
    )
  }

  availablePlatforms(): Platform[] {
    const set = new Set<Platform>()
    for (const s of this.sources.values()) {
      if (s.enabled && s.status === 'ready') {
        for (const p of Object.keys(s.platforms)) if (PLATFORMS.includes(p as Platform)) set.add(p as Platform)
      }
    }
    return PLATFORMS.filter((p) => set.has(p))
  }

  async getMusicUrl(
    song: Song,
    preferred: Quality[] = QUALITIES,
    onlySourceId?: string,
    strictQualities = false,
    excludedSourceIds: string[] = [],
  ): Promise<MusicUrlResult> {
    const key =
      this.revision + ':' + song.platform + '_' + song.songmid + '_' + preferred.join(',') + '_' + (onlySourceId ?? '*') + (strictQualities ? '!s' : '') + ':' + [...excludedSourceIds].sort().join(',') + ':' + song.interval
    const revision = this.revision
    const cached = this.urlCache.get(key)
    if (cached && cached.expire > Date.now()) return cached.value

    const inflight = this.pending.get(key)
    if (inflight) return inflight

    const task = this.resolveUrl(song, preferred, onlySourceId, strictQualities, excludedSourceIds)
      .then((result) => {
        if (revision === this.revision) this.urlCache.set(key, { value: result, expire: Date.now() + 4 * 60_000 })
        return result
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, task)
    return task
  }

  private buildQualityOrder(song: Song, preferred: Quality[], candidates: SourceState[], strict = false): Quality[] {
    const declared = new Set<Quality>()
    for (const c of candidates) {
      for (const q of c.platforms[song.platform]?.qualitys ?? []) declared.add(q)
    }
    const songQualities = song.qualities?.length ? song.qualities : Array.from(declared)
    const supported = new Set(songQualities.filter((q) => declared.has(q)))
    if (!supported.size) {
      // 音源没有声明音质时，保守地只尝试常见的两档
      supported.add('320k')
      supported.add('128k')
    }
    const order: Quality[] = []
    for (const q of preferred) if (supported.has(q) && !order.includes(q)) order.push(q)
    if (strict) return order
    for (const q of ['320k', '128k', 'flac', 'flac24bit'] as Quality[]) {
      if (supported.has(q) && !order.includes(q)) order.push(q)
    }
    return order
  }

  private async resolveUrl(
    song: Song,
    preferred: Quality[],
    onlySourceId?: string,
    strictQualities = false,
    excludedSourceIds: string[] = [],
  ): Promise<MusicUrlResult> {
    let candidates = this.candidates(song.platform).filter(c => !excludedSourceIds.includes(c.id))
    if (onlySourceId) candidates = candidates.filter((c) => c.id === onlySourceId)
    if (!candidates.length) {
      throw new Error('没有可用的音源支持 ' + (PLATFORM_NAMES[song.platform] ?? song.platform) + '，请到「设置 - 音源」启用或刷新')
    }
    if (song.platform === 'kg' && !song.hash) {
      throw new Error('该酷狗歌曲缺少 hash，无法获取播放地址')
    }

    const order = this.buildQualityOrder(song, preferred, candidates, strictQualities)
    if (!order.length) throw new Error('该歌曲没有可用音质')
    const musicInfo = this.toMusicInfo(song)
    let lastError: Error | null = null
    // Finish before the HTTP route's 12-second deadline, including quality fallback.
    const deadline = Date.now() + 10500

    for (const [qualityIndex, quality] of order.entries()) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      const budgetMs = qualityIndex === order.length - 1 ? remaining : Math.min(7000, remaining - (order.length - qualityIndex - 1) * 1500)
      if (budgetMs <= 0) continue
      const usable = candidates.filter((c) => {
        const q = c.platforms[song.platform]?.qualitys ?? []
        return q.length === 0 || q.includes(quality)
      })
      if (!usable.length) continue
      // Preserve the administrator's order within each group. Only repeated
      // connection failures get a short cooldown; missing songs do not.
      const now = Date.now()
      if (!onlySourceId) usable.sort((a, b) =>
        Number((this.unhealthy.get(a.id + ':' + song.platform)?.retryAt ?? 0) > now) -
        Number((this.unhealthy.get(b.id + ':' + song.platform)?.retryAt ?? 0) > now))
      try {
        const result = await resolvePrioritized(
          usable.map(source => async (signal: AbortSignal) => {
            const healthKey = source.id + ':' + song.platform
            let started = false
            try {
              return await this.resolutionPool.run(source.id, signal, async () => {
                started = true
                const value = await source.runtime!.request({
                  action: 'musicUrl',
                  source: song.platform,
                  info: { type: quality, musicInfo },
                }, signal)
                if (typeof value !== 'string' || !/^https?:\/\//.test(value)) {
                  throw new Error('音源返回的播放地址无效')
                }
                // Invalid/private/unresolvable addresses must not win the race.
                await assertPublicUrl(value)
                const audio = await this.probe(value, signal)
                assertComplete(audio, song.interval)
                assertQuality(audio, quality)
                signal.throwIfAborted()
                source.stats.ok++
                source.stats.lastOkAt = Date.now()
                source.stats.lastError = undefined
                this.unhealthy.delete(healthKey)
                return { url: value, quality, sourceId: source.id, sourceName: source.meta.name ?? source.name, platform: song.platform, duration: audio.duration }
              })
            } catch (error) {
              if (!started || (signal.aborted && signal.reason?.name === 'AbortError')) throw error
              const message = toError(error).message
              source.stats.fail++
              source.stats.lastError = message
              if (/timeout|超时|fetch failed|block.?ip|ECONN|ENOTFOUND|域名解析失败/i.test(message)) {
                const failures = (this.unhealthy.get(healthKey)?.failures ?? 0) + 1
                this.unhealthy.set(healthKey, { failures, retryAt: failures >= 2 ? Date.now() + 30000 : 0 })
              }
              throw error
            }
          }),
          { budgetMs, attemptMs: onlySourceId ? budgetMs : Math.min(7000, budgetMs) },
        )
        return result
      } catch (err) {
        lastError = this.aggregateError(err)
      }
    }
    throw new Error(lastError?.message ?? '所有音源都无法获取该歌曲的播放地址')
  }

  private aggregateError(err: unknown): Error {
    if (err instanceof AggregateError) {
      const messages = err.errors.map((e) => toError(e).message).filter(Boolean)
      const unique = [...new Set(messages)]
      return new Error(unique.length ? unique.join(' / ') : '音源请求失败')
    }
    return toError(err)
  }

  private toMusicInfo(song: Song): Record<string, unknown> {
    const mm = String(Math.floor(song.interval / 60)).padStart(2, '0')
    const ss = String(Math.floor(song.interval % 60)).padStart(2, '0')
    const types = (song.qualities ?? []).map((q) => ({ type: q, size: '' }))
    const _types: Record<string, { size: string; hash?: string }> = {}
    for (const q of song.qualities ?? []) _types[q] = { size: '', hash: song.hash }
    const info: Record<string, unknown> = {
      name: song.name,
      singer: song.singer,
      source: song.platform,
      songmid: song.songmid,
      id: song.songmid,
      songId: song.songId ?? song.songmid,
      albumName: song.albumName,
      interval: mm + ':' + ss,
      _interval: Math.round(song.interval),
      img: song.img ?? null,
      lrc: null,
      types,
      _types,
      typeUrl: {},
      otherSource: null,
    }
    // 空字符串会让音源脚本里的 `a ?? b` 短路失败，所以只在有值时才带上
    if (song.hash) info.hash = song.hash
    if (song.albumId) info.albumId = song.albumId
    if (song.albumMid) info.albumMid = song.albumMid
    if (song.strMediaMid) info.strMediaMid = song.strMediaMid
    if (song.copyrightId) info.copyrightId = song.copyrightId
    return info
  }

  dispose(): void {
    for (const s of this.sources.values()) s.runtime?.dispose()
  }
}

export const sourceManager = new SourceManager()
