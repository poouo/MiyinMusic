import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { config } from './config.js'
import {
  changePassword,
  checkRateLimit,
  createSession,
  deleteUserById,
  destroySession,
  getSessionUser,
  login,
  publicUser,
  register,
  resetPasswordByAdmin,
  resetRateLimit,
  setNickname,
  setUserRole,
  setUserStatus,
  updateProfile,
  type User,
} from './auth.js'
import { HttpError, notFoundError } from './errors.js'
import * as admin from './admin.js'
import { listAudit } from './audit.js'
import { enforce } from './rate-limit.js'
import { audienceOf, getAppConfig, updateAppConfig, type CacheConfig } from './app-config.js'
import { assertNotLocked, listLocked, recordLoginFailure, clearLoginFailures, unlockAccount, unlockAll } from './login-guard.js'
import { createUserByAdmin } from './auth.js'
import { writeAudit } from './audit.js'
import * as library from './library.js'
import * as discover from './discover.js'
import * as audioCache from './audio-cache.js'
import {
  bearerToken,
  clearCookie,
  clientIp,
  notFound,
  parseCookies,
  readJson,
  sendError,
  sendJson,
  setCookie,
} from './http-util.js'
import { sourceManager } from './lx/manager.js'
import { getProvider, providers } from './providers/index.js'
import { PLATFORMS, PLATFORM_NAMES, QUALITIES, type Platform, type Quality } from './types.js'
import { logger } from './log.js'
import { decodeTarget, proxyStream } from './stream.js'
import { sessionCache } from './session-cache.js'

const log = logger('api')
const SESSION_COOKIE = 'miyin_token'
const SESSION_MAX_AGE = 30 * 24 * 60 * 60
const STREAM_SECRET = process.env.MIYIN_SECRET ?? crypto.randomBytes(32).toString('hex')

function currentToken(req: IncomingMessage): string | null {
  return bearerToken(req) ?? parseCookies(req)[SESSION_COOKIE] ?? null
}

function currentUser(req: IncomingMessage): User | null {
  return sessionCache.get(currentToken(req), getSessionUser)
}

function requireUser(req: IncomingMessage): User {
  const user = currentUser(req)
  if (!user) throw new HttpError(401, '请先登录')
  return user
}

function requireAdmin(req: IncomingMessage): User {
  const user = requireUser(req)
  if (user.role !== 'admin') throw new HttpError(403, '只有管理员可以管理音源')
  return user
}

/** 非管理员一律当作接口不存在 */
/** 给上游能力加一个总时限，避免某个音源卡住把整个请求拖死 */
function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HttpError(504, message, 'upstream_timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/** 同源校验：带 Origin 的写请求必须来自本站，避免被跨站调用 */
function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin
  if (!origin) return
  let host = ''
  try {
    host = new URL(origin).host
  } catch {
    throw new HttpError(403, '请求来源不合法', 'csrf')
  }
  if (host !== req.headers.host) throw new HttpError(403, '拒绝跨站请求', 'csrf')
}

/** 排行榜列表缓存：首页与榜单页都会请求，避免每次访问都打一遍上游 */
const CHARTS_TTL = 5 * 60 * 1000
let chartsCache: { at: number; lists: unknown[] } | null = null
let chartsPending: Promise<unknown[]> | null = null

async function loadCharts(): Promise<unknown[]> {
  if (chartsCache && Date.now() - chartsCache.at < CHARTS_TTL) return chartsCache.lists
  if (chartsPending) return chartsPending

  const jobs = Object.values(providers)
    .filter((provider) => !!provider.charts)
    .map(async (provider) => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('排行榜请求超时')), 8000),
      )
      return Promise.race([provider.charts!(), timeout])
    })

  chartsPending = Promise.allSettled(jobs).then((results) => {
    const lists: unknown[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') lists.push(...result.value)
      else log.warn('排行榜获取失败：', String(result.reason).slice(0, 80))
    }
    if (lists.length) chartsCache = { at: Date.now(), lists }
    chartsPending = null
    return lists
  })
  return chartsPending
}

/** 已登录按用户限流，未登录按 IP */
function rateKeyFor(req: IncomingMessage): string {
  const user = currentUser(req)
  return user ? 'u:' + user.id : 'ip:' + clientIp(req)
}

function requireAdminOr404(req: IncomingMessage): User {
  const user = currentUser(req)
  if (!user || user.role !== 'admin') throw notFoundError()
  return user
}

/** 播放链接有效期：2 小时 */
const STREAM_TTL = 2 * 60 * 60 * 1000
/** 下载链接有效期：5 分钟 */
const DOWNLOAD_TTL = 5 * 60 * 1000

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

/** 签名主体：登录用户按账号，游客按 UA 指纹，避免链接被复制到别处复用 */
function signSubject(req: IncomingMessage): string {
  const user = currentUser(req)
  if (user) return 'u:' + user.id
  const ua = String(req.headers['user-agent'] ?? '')
  return 'g:' + crypto.createHash('sha256').update(ua).digest('hex').slice(0, 12)
}

function signStream(target: string, expire: number, subject: string): string {
  return crypto
    .createHmac('sha256', STREAM_SECRET)
    .update('st|' + target + '|' + expire + '|' + subject)
    .digest('base64url')
    .slice(0, 24)
}

function streamUrl(target: string, req: IncomingMessage): string {
  const expire = Date.now() + STREAM_TTL
  return (
    '/api/stream?u=' +
    Buffer.from(target).toString('base64url') +
    '&e=' +
    expire +
    '&s=' +
    signStream(target, expire, signSubject(req))
  )
}

function imageProxy(url: string): string {
  if (!url) return ''
  if (url.startsWith('/api/')) return url
  return '/api/image?u=' + Buffer.from(url).toString('base64url')
}

/** 封面查询结果缓存，避免列表滚动时重复请求上游 */
const picCache = new Map<string, { url: string; expire: number }>()
const PIC_TTL = 6 * 60 * 60 * 1000
const PIC_MAX = 2000

function parsePlatform(value: string | null): Platform {
  const platform = String(value ?? '') as Platform
  if (!PLATFORMS.includes(platform)) throw new HttpError(400, '不支持的平台')
  return platform
}

function qualityOrder(input: unknown, strict = false): Quality[] {
  const list = Array.isArray(input) ? input : []
  const order = list.filter((q): q is Quality => QUALITIES.includes(q as Quality))
  if (strict) return order
  for (const q of QUALITIES) if (!order.includes(q)) order.push(q)
  return order
}

function signDownload(target: string, filename: string, expire: number, subject: string): string {
  return crypto
    .createHmac('sha256', STREAM_SECRET)
    .update('dl|' + target + '|' + filename + '|' + expire + '|' + subject)
    .digest('base64url')
    .slice(0, 24)
}

function extensionOf(quality: Quality): string {
  return quality === 'flac' || quality === 'flac24bit' ? 'flac' : 'mp3'
}

function safeFilename(song: { singer?: string; name?: string }, quality: Quality): string {
  const base = (song.name || 'music') + (song.singer ? ' - ' + song.singer : '')
  const cleaned = base.replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return cleaned + '.' + extensionOf(quality)
}

function publicLibrary(userId: string) {
  const data = library.getLibrary(userId)
  return {
    favorites: data.favorites,
    playlists: data.playlists,
    history: data.history,
    settings: data.settings,
    updatedAt: data.updatedAt,
  }
}

/** 主 API 分发；返回 false 表示该路径未匹配 */
export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const pathname = url.pathname
  const method = (req.method ?? 'GET').toUpperCase()

  // 写请求做同源校验（防 CSRF）
  if (method !== 'GET' && method !== 'HEAD') assertSameOrigin(req)
  // 全局接口限流：音频流单独计数，避免拖动进度条被误伤
  if (!pathname.startsWith('/api/stream')) enforce('api', rateKeyFor(req))

  // ---------- 基础 ----------
  if (pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, { ok: true, time: Date.now(), version: '1.0.0' })
    return true
  }

  if (pathname === '/api/config' && method === 'GET') {
    const available = sourceManager.availablePlatforms()
    sendJson(res, 200, {
      platforms: PLATFORMS.map((id) => ({ id, name: PLATFORM_NAMES[id], available: available.includes(id) })),
      qualities: QUALITIES,
      allowRegister: getAppConfig().registration.enabled,
      download: getAppConfig().download,
      loginRequired: false,
    })
    return true
  }

  // ---------- 音源 ----------
  if (pathname === '/api/sources' && method === 'GET') {
    await sourceManager.bootstrap()
    sendJson(res, 200, { sources: sourceManager.list() })
    return true
  }

  if (pathname === '/api/sources' && method === 'POST') {
    requireAdmin(req)
    const body = await readJson<{ name?: string; url?: string; script?: string }>(req, 2 * 1024 * 1024)
    const source = await sourceManager.addCustom(body)
    sendJson(res, 200, { source })
    return true
  }

  if (pathname === '/api/sources/update' && method === 'POST') {
    const actor = requireAdmin(req)
    const status = sourceManager.startUpdate()
    writeAudit({
      userId: actor.id,
      username: actor.username,
      action: 'admin.sources.update',
      detail: '开始更新 ' + status.total + ' 个内置音源',
    })
    sendJson(res, 200, { status })
    return true
  }

  if (pathname === '/api/sources/update' && method === 'GET') {
    requireAdmin(req)
    sendJson(res, 200, { status: sourceManager.getUpdateState() })
    return true
  }

  const sourceMatch = /^\/api\/sources\/([^/]+)(\/reload|\/update)?$/.exec(pathname)
  if (sourceMatch) {
    const id = decodeURIComponent(sourceMatch[1])
    if (method === 'DELETE') {
      requireAdmin(req)
      sourceManager.removeCustom(id)
      sendJson(res, 200, { ok: true })
      return true
    }
    if (method === 'PATCH') {
      requireAdmin(req)
      const body = await readJson<{ enabled?: boolean }>(req)
      const source = sourceManager.setEnabled(id, body.enabled !== false)
      sendJson(res, 200, { source })
      return true
    }
    if (method === 'POST' && sourceMatch[2] === '/update') {
      const actor = requireAdmin(req)
      const source = await sourceManager.updateSource(id)
      writeAudit({
        userId: actor.id,
        username: actor.username,
        action: 'admin.sources.update',
        detail: '更新音源 ' + source.name,
      })
      sendJson(res, 200, { source })
      return true
    }
    if (method === 'POST' && sourceMatch[2] === '/reload') {
      requireAdmin(req)
      sendJson(res, 200, { source: await sourceManager.reload(id) })
      return true
    }
  }

  // ---------- 管理后台（仅管理员，其他人一律 404） ----------
  if (pathname.startsWith('/api/admin/')) {
    const actor = requireAdminOr404(req)

    if (pathname === '/api/admin/overview' && method === 'GET') {
      const data = admin.overview()
      sendJson(res, 200, {
        ...data,
        sources: {
          total: sourceManager.list().length,
          ready: sourceManager.list().filter((source) => source.status === 'ready').length,
        },
        audit: listAudit({ page: 1, limit: 8 }).entries,
      })
      return true
    }

    if (pathname === '/api/admin/system' && method === 'GET') {
      sendJson(res, 200, {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: Math.round(process.uptime()),
        memory: process.memoryUsage(),
        database: admin.overview().database,
        generatedAt: Date.now(),
      })
      return true
    }

    if (pathname === '/api/admin/users' && method === 'GET') {
      const result = admin.listUsers({
        q: url.searchParams.get('q') ?? '',
        role: url.searchParams.get('role') ?? '',
        status: url.searchParams.get('status') ?? '',
        page: Number(url.searchParams.get('page') ?? 1),
        limit: Number(url.searchParams.get('limit') ?? 20),
      })
      sendJson(res, 200, result)
      return true
    }

    if (pathname === '/api/admin/users' && method === 'POST') {
      const body = await readJson<{ username?: string; password?: string; nickname?: string; role?: 'admin' | 'vip' | 'user' }>(req)
      const created = await createUserByAdmin(
        {
          username: String(body.username ?? ''),
          password: String(body.password ?? ''),
          nickname: body.nickname,
          role: body.role,
        },
        actor,
      )
      sendJson(res, 200, { user: admin.getUserDetail(created.id) })
      return true
    }

    if (pathname === '/api/admin/locked' && method === 'GET') {
      sendJson(res, 200, { items: listLocked() })
      return true
    }

    if (pathname === '/api/admin/unlock' && method === 'POST') {
      const body = await readJson<{ key?: string; all?: boolean }>(req)
      const removed = body.all ? unlockAll() : unlockAccount(String(body.key ?? ''))
      if (body.all) unlockAll()
      writeAudit({ userId: actor.id, username: actor.username, action: 'admin.unlock', detail: '解除了 ' + removed + ' 条登录限制' })
      sendJson(res, 200, { ok: true, removed })
      return true
    }

    const adminUserMatch = /^\/api\/admin\/users\/([^/]+)(\/password|\/logout|\/unlock)?$/.exec(pathname)
    if (adminUserMatch) {
      const userId = decodeURIComponent(adminUserMatch[1])
      const action = adminUserMatch[2]
      if (method === 'GET' && !action) {
        sendJson(res, 200, { user: admin.getUserDetail(userId) })
        return true
      }
      if (method === 'PATCH' && !action) {
        const body = await readJson<{ nickname?: string; role?: 'admin' | 'vip' | 'user'; status?: 'active' | 'disabled' }>(req)
        if (userId === actor.id && (body.role && body.role !== 'admin')) {
          throw new HttpError(400, '不能降级自己')
        }
        if (userId === actor.id && body.status === 'disabled') {
          throw new HttpError(400, '不能停用自己')
        }
        if (typeof body.nickname === 'string') setNickname(userId, body.nickname, actor)
        if (body.role === 'admin' || body.role === 'vip' || body.role === 'user') setUserRole(userId, body.role, actor)
        if (body.status === 'active' || body.status === 'disabled') setUserStatus(userId, body.status, actor)
        sessionCache.clear()
        sendJson(res, 200, { user: admin.getUserDetail(userId) })
        return true
      }
      if (method === 'POST' && action === '/password') {
        const body = await readJson<{ password?: string }>(req)
        await resetPasswordByAdmin(userId, String(body.password ?? ''), actor)
        sessionCache.clear()
        sendJson(res, 200, { ok: true })
        return true
      }
      if (method === 'POST' && action === '/unlock') {
        const detail = admin.getUserDetail(userId)
        unlockAll()
        writeAudit({ userId: actor.id, username: actor.username, action: 'admin.unlock', detail: '解锁 ' + detail.username })
        sendJson(res, 200, { ok: true })
        return true
      }
      if (method === 'POST' && action === '/logout') {
        const target = admin.getUserDetail(userId)
        sessionCache.clear()
        sendJson(res, 200, { ok: true, username: target.username })
        return true
      }
      if (method === 'DELETE' && !action) {
        if (userId === actor.id) throw new HttpError(400, '不能删除自己')
        deleteUserById(userId, actor)
        sessionCache.clear()
        sendJson(res, 200, { ok: true })
        return true
      }
    }

    if (pathname === '/api/admin/config' && method === 'GET') {
      sendJson(res, 200, { config: getAppConfig() })
      return true
    }

    if (pathname === '/api/admin/config' && method === 'PUT') {
      const body = await readJson<{
        registration?: { enabled?: boolean }
        download?: { enabled?: boolean; roles?: string[]; qualities?: string[] }
        cache?: { enabled?: boolean; maxBytes?: number; warmCollections?: boolean; qualities?: string[] }
      }>(req)
      const requested = body.download ?? {}
      const cachePatch: Partial<CacheConfig> = {}
      if (body.cache) {
        if (typeof body.cache.enabled === 'boolean') cachePatch.enabled = body.cache.enabled
        if (body.cache.maxBytes !== undefined) cachePatch.maxBytes = Number(body.cache.maxBytes)
        if (typeof body.cache.warmCollections === 'boolean') cachePatch.warmCollections = body.cache.warmCollections
        if (Array.isArray(body.cache.qualities)) {
          cachePatch.qualities = QUALITIES.filter((q) => body.cache?.qualities?.includes(q))
        }
      }
      const next = updateAppConfig({
        registration: body.registration ? { enabled: body.registration.enabled !== false } : undefined,
        download: {
          enabled: requested.enabled !== false,
          roles: (requested.roles ?? []) as never,
          qualities: QUALITIES.filter((q) => (requested.qualities ?? []).includes(q)),
        },
        cache: body.cache ? cachePatch : undefined,
      })
      writeAudit({
        userId: actor.id,
        username: actor.username,
        action: 'admin.config',
        detail:
          '开放注册：' +
          (next.registration.enabled ? '是' : '否') +
          '；下载：' +
          (next.download.enabled ? '开启' : '关闭') +
          '（' +
          next.download.roles.join('/') +
          ' · ' +
          next.download.qualities.join('/') +
          '）；缓存：' +
          (next.cache.enabled ? '开启' : '关闭') +
          '（' +
          Math.round(next.cache.maxBytes / 1024 / 1024) +
          'MB · ' +
          next.cache.qualities.join('/') +
          '）',
      })
      sendJson(res, 200, { config: next })
      return true
    }

    if (pathname === '/api/admin/cache' && method === 'GET') {
      sendJson(res, 200, { cache: audioCache.stats() })
      return true
    }

    if (pathname === '/api/admin/cache' && method === 'DELETE') {
      const removed = audioCache.clear()
      writeAudit({
        userId: actor.id,
        username: actor.username,
        action: 'admin.cache.clear',
        detail: '清空服务端音频缓存：' + removed.removed + ' 个文件 / ' + Math.round(removed.bytes / 1024 / 1024) + 'MB',
      })
      sendJson(res, 200, { ok: true, removed })
      return true
    }

    if (pathname === '/api/admin/cache/warm' && method === 'POST') {
      const queued = audioCache.warmCollections(200)
      writeAudit({
        userId: actor.id,
        username: actor.username,
        action: 'admin.cache.warm',
        detail: '预热收藏与歌单歌曲 ' + queued + ' 首',
      })
      sendJson(res, 200, { ok: true, queued })
      return true
    }

    if (pathname === '/api/admin/audit' && method === 'GET') {
      sendJson(res, 200, {
        audit: listAudit({
          page: Number(url.searchParams.get('page') ?? 1),
          limit: Number(url.searchParams.get('limit') ?? 30),
          action: url.searchParams.get('action') ?? undefined,
        }),
      })
      return true
    }

    throw notFoundError()
  }

  // ---------- 搜索 ----------
  if (pathname === '/api/search' && method === 'GET') {
    const platform = parsePlatform(url.searchParams.get('platform'))
    const keyword = (url.searchParams.get('q') ?? '').trim()
    if (!keyword) throw new HttpError(400, '请输入搜索关键词')
    if (keyword.length > 100) throw new HttpError(400, '搜索关键词过长')
    enforce('search', rateKeyFor(req))
    const page = Number(url.searchParams.get('page') ?? 1)
    const limit = Number(url.searchParams.get('limit') ?? 30)
    const result = await getProvider(platform).search(keyword, page, limit)
    sendJson(res, 200, { result: withProxyImages(result) })
    return true
  }

  // ---------- 排行榜 ----------
  if (pathname === '/api/charts' && method === 'GET') {
    sendJson(res, 200, { charts: await loadCharts() })
    return true
  }

  const chartMatch = /^\/api\/charts\/([^/]+)$/.exec(pathname)
  if (chartMatch && method === 'GET') {
    const chartId = decodeURIComponent(chartMatch[1])
    const platform = parsePlatform(chartId.split('-')[0])
    const provider = getProvider(platform)
    if (!provider.chartSongs) throw new HttpError(400, '该平台不支持排行榜')
    const page = Number(url.searchParams.get('page') ?? 1)
    const limit = Number(url.searchParams.get('limit') ?? 60)
    let chartName = ''
    let chartCover = ''
    try {
      const charts = (await provider.charts?.()) ?? []
      const found = charts.find((chart) => chart.id === chartId)
      chartName = found?.name ?? ''
      chartCover = found?.cover ?? ''
    } catch {
      /* 名称拿不到不影响歌曲列表 */
    }
    const result = await provider.chartSongs(chartId, page, limit)
    sendJson(res, 200, { result: withProxyImages(result), chart: { id: chartId, name: chartName, cover: chartCover } })
    return true
  }

  // ---------- 发现页：推荐歌单 / 新歌 / 歌手 ----------
  if (pathname === '/api/discover/playlists' && method === 'GET') {
    const platformParam = url.searchParams.get('platform')
    const platform = platformParam && platformParam !== 'all' ? parsePlatform(platformParam) : undefined
    const feed = await discover
      .getPlaylists({
        page: Number(url.searchParams.get('page') ?? 1),
        limit: Number(url.searchParams.get('limit') ?? 18),
        platform,
      })
      .catch((err) => {
        throw contentError(err)
      })
    sendJson(res, 200, {
      playlists: feed.playlists.map(withProxyCover),
      page: feed.page,
      hasMore: feed.hasMore,
    })
    return true
  }

  const publicPlaylistMatch = /^\/api\/playlist\/([^/]+)$/.exec(pathname)
  if (publicPlaylistMatch && method === 'GET') {
    const detail = await discover
      .getPlaylist(decodeURIComponent(publicPlaylistMatch[1]), {
        offset: Number(url.searchParams.get('offset') ?? 0),
        limit: Number(url.searchParams.get('limit') ?? 100),
      })
      .catch((err) => {
        throw contentError(err)
      })
    sendJson(res, 200, {
      playlist: withProxyCover(detail.playlist),
      songs: withProxyImages({ list: detail.songs }).list,
      total: detail.total,
      offset: detail.offset,
      limit: detail.limit,
      hasMore: detail.hasMore,
    })
    return true
  }

  if (pathname === '/api/discover/new-songs' && method === 'GET') {
    const songs = await discover.getNewSongs(Number(url.searchParams.get('limit') ?? 12)).catch((err) => {
      throw contentError(err)
    })
    sendJson(res, 200, { songs: withProxyImages({ list: songs }).list })
    return true
  }

  if (pathname === '/api/discover/singers' && method === 'GET') {
    const singers = await discover.getSingers(Number(url.searchParams.get('limit') ?? 12)).catch((err) => {
      throw contentError(err)
    })
    sendJson(res, 200, {
      singers: singers.map((singer) => ({ ...singer, pic: singer.pic ? imageProxy(singer.pic) : null })),
    })
    return true
  }

  const singerMatch = /^\/api\/singer\/([^/]+)$/.exec(pathname)
  if (singerMatch && method === 'GET') {
    const detail = await discover
      .getSinger(decodeURIComponent(singerMatch[1]), url.searchParams.get('name') ?? '')
      .catch((err) => {
        throw contentError(err)
      })
    sendJson(res, 200, {
      singer: { ...detail.singer, pic: detail.singer.pic ? imageProxy(detail.singer.pic) : null },
      songs: withProxyImages({ list: detail.songs }).list,
    })
    return true
  }

  // ---------- 歌词 ----------
  if (pathname === '/api/lyric' && method === 'POST') {
    enforce('lyric', rateKeyFor(req))
    const body = await readJson<{ song?: unknown }>(req)
    const song = library.sanitizeSong(body.song)
    const lyric = await getProvider(song.platform).lyric(song)
    sendJson(res, 200, { lyric })
    return true
  }

  // ---------- 封面 ----------
  if (pathname === '/api/pic' && method === 'GET') {
    const platform = parsePlatform(url.searchParams.get('platform'))
    const songmid = url.searchParams.get('songmid') ?? ''
    if (!songmid) throw new HttpError(400, '缺少歌曲 ID')
    const cacheKey = platform + ':' + songmid
    const cached = picCache.get(cacheKey)
    if (cached && cached.expire > Date.now()) {
      sendJson(res, 200, { url: cached.url })
      return true
    }
    const provider = getProvider(platform)
    if (!provider.pic) {
      sendJson(res, 200, { url: '' })
      return true
    }
    let found: string | null = null
    try {
      found = await provider.pic({ platform, songmid, name: '', singer: '', albumName: '', interval: 0, qualities: [] })
    } catch {
      found = null
    }
    const pictureUrl = found ? imageProxy(found) : ''
    if (picCache.size > PIC_MAX) picCache.clear()
    picCache.set(cacheKey, { url: pictureUrl, expire: Date.now() + PIC_TTL })
    sendJson(res, 200, { url: pictureUrl })
    return true
  }

  // ---------- 获取播放地址 ----------
  if (pathname === '/api/url' && method === 'POST') {
    const body = await readJson<{ song?: unknown; qualities?: unknown; sourceId?: string; direct?: boolean }>(req)
    enforce('url', rateKeyFor(req))
    const song = library.sanitizeSong(body.song)
    const allowed = qualityOrder(body.qualities)

    // 服务端已经缓存过（歌单 / 收藏预热）就直接放本地文件，音源失效也能继续听
    const cached = audioCache.lookup(song, allowed)
    if (cached) {
      sendJson(res, 200, {
        playUrl: streamUrl('cache:' + cached.key, req),
        quality: cached.quality,
        platform: song.platform,
        cached: true,
      })
      return true
    }

    const result = await withDeadline(
      sourceManager.getMusicUrl(song, allowed, body.sourceId),
      12000,
      '获取播放地址超时，请稍后重试或换一首',
    )
    // 默认只给同源代理地址；桌面客户端可以要 directUrl 用于本地缓存
    sendJson(res, 200, {
      playUrl: streamUrl(result.url, req),
      directUrl: body.direct === true ? result.url : undefined,
      quality: result.quality,
      platform: result.platform,
      cached: false,
    })
    return true
  }

  // ---------- 代理：音频 / 图片 ----------
  if (pathname === '/api/stream' && method === 'GET') {
    enforce('stream', rateKeyFor(req))
    const target = decodeTarget(url.searchParams.get('u') ?? '')
    const signature = url.searchParams.get('s') ?? ''
    const expire = Number(url.searchParams.get('e') ?? 0)
    const subject = signSubject(req)
    const valid =
      !!target &&
      !!signature &&
      Number.isFinite(expire) &&
      expire > Date.now() &&
      safeEqual(signature, signStream(target, expire, subject))
    if (!valid) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('播放链接无效或已过期')
      return true
    }
    if (target.startsWith('cache:')) {
      await audioCache.streamCached(req, res, target.slice('cache:'.length))
      return true
    }
    await proxyStream(req, res, target, { timeoutMs: 20000, cacheSeconds: 0 })
    return true
  }

  if (pathname === '/api/image' && method === 'GET') {
    const target = decodeTarget(url.searchParams.get('u') ?? '')
    await proxyStream(req, res, target, {
      imageOnly: true,
      maxBytes: 6 * 1024 * 1024,
      cacheSeconds: 60 * 60 * 24,
      timeoutMs: 12000,
    })
    return true
  }

  // ---------- 下载（需要登录 + 管理员开关） ----------
  if (pathname === '/api/download' && method === 'POST') {
    const viewer = currentUser(req)
    const audience = audienceOf(viewer?.role)
    const policy = getAppConfig().download
    if (!policy.enabled) throw new HttpError(403, '管理员已关闭下载功能')
    if (!policy.roles.includes(audience)) {
      if (!viewer) throw new HttpError(401, '登录后才能下载')
      throw new HttpError(403, '当前账号没有下载权限')
    }
    enforce('download', viewer ? 'u:' + viewer.id : 'ip:' + clientIp(req))
    const body = await readJson<{ song?: unknown }>(req)
    const song = library.sanitizeSong(body.song)
    const allowed = qualityOrder(policy.qualities, true)

    const cached = audioCache.lookup(song, allowed)
    if (cached) {
      const filename = safeFilename(song, cached.quality)
      const expireAt = Date.now() + DOWNLOAD_TTL
      const target = 'cache:' + cached.key
      const playUrl =
        '/api/download/file?u=' +
        Buffer.from(target).toString('base64url') +
        '&n=' +
        encodeURIComponent(filename) +
        '&e=' +
        expireAt +
        '&s=' +
        signDownload(target, filename, expireAt, signSubject(req))
      if (viewer) {
        writeAudit({
          userId: viewer.id,
          username: viewer.username,
          action: 'user.download',
          detail: song.singer + ' - ' + song.name + ' (' + cached.quality + ' · 服务端缓存)',
        })
      }
      sendJson(res, 200, {
        url: playUrl,
        quality: cached.quality,
        filename,
        sourceName: '服务端缓存',
        platform: song.platform,
        cached: true,
      })
      return true
    }

    const result = await withDeadline(
      sourceManager.getMusicUrl(song, allowed, undefined, true),
      20000,
      '下载地址获取超时，请稍后重试',
    )
    if (!policy.qualities.includes(result.quality)) {
      throw new HttpError(403, '该歌曲当前音质超出可下载范围')
    }
    const filename = safeFilename(song, result.quality)
    const expireAt = Date.now() + DOWNLOAD_TTL
    const playUrl =
      '/api/download/file?u=' +
      Buffer.from(result.url).toString('base64url') +
      '&n=' +
      encodeURIComponent(filename) +
      '&e=' +
      expireAt +
      '&s=' +
      signDownload(result.url, filename, expireAt, signSubject(req))
    if (viewer) {
      writeAudit({
        userId: viewer.id,
        username: viewer.username,
        action: 'user.download',
        detail: song.singer + ' - ' + song.name + ' (' + result.quality + ')',
      })
    }
    sendJson(res, 200, {
      url: playUrl,
      quality: result.quality,
      filename,
      sourceName: result.sourceName,
      platform: result.platform,
      cached: false,
    })
    return true
  }

  if (pathname === '/api/download/file' && method === 'GET') {
    const viewer = currentUser(req)
    const policy = getAppConfig().download
    if (!policy.enabled) throw new HttpError(403, '管理员已关闭下载功能')
    if (!policy.roles.includes(audienceOf(viewer?.role))) {
      throw new HttpError(viewer ? 403 : 401, viewer ? '当前账号没有下载权限' : '登录后才能下载')
    }
    const target = decodeTarget(url.searchParams.get('u') ?? '')
    const filename = url.searchParams.get('n') ?? 'music.mp3'
    const signature = url.searchParams.get('s') ?? ''
    const expire = Number(url.searchParams.get('e') ?? 0)
    const valid =
      !!target &&
      !!signature &&
      Number.isFinite(expire) &&
      expire > Date.now() &&
      safeEqual(signature, signDownload(target, filename, expire, signSubject(req)))
    if (!valid) {
      throw new HttpError(403, '下载链接已失效', 'invalid_signature')
    }
    if (target.startsWith('cache:')) {
      await audioCache.streamCached(req, res, target.slice('cache:'.length), { attachment: filename })
      return true
    }
    await proxyStream(req, res, target, {
      attachment: filename,
      allowRange: false,
      timeoutMs: 45000,
      cacheSeconds: 0,
    })
    return true
  }

  // ---------- 账号 ----------
  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = currentUser(req)
    sendJson(res, 200, {
      user: user ? publicUser(user) : null,
      library: user ? library.librarySummary(user.id) : null,
    })
    return true
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    if (!getAppConfig().registration.enabled) throw new HttpError(403, '本服务器已关闭注册，请联系管理员')
    const ip = clientIp(req)
    checkRateLimit(ip)
    const body = await readJson<{ username?: string; password?: string; nickname?: string }>(req)
    const user = await register({
      username: String(body.username ?? ''),
      password: String(body.password ?? ''),
      nickname: body.nickname,
      ip,
    })
    const token = createSession(user.id, { ip, userAgent: req.headers['user-agent'] })
    setCookie(res, SESSION_COOKIE, token, SESSION_MAX_AGE)
    resetRateLimit(ip)
    sendJson(res, 200, { user: publicUser(user) })
    return true
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const ip = clientIp(req)
    checkRateLimit(ip)
    const body = await readJson<{ username?: string; password?: string }>(req)
    const user = await login({ username: String(body.username ?? ''), password: String(body.password ?? ''), ip })
    const token = createSession(user.id, { ip, userAgent: req.headers['user-agent'] })
    setCookie(res, SESSION_COOKIE, token, SESSION_MAX_AGE)
    resetRateLimit(ip)
    sendJson(res, 200, { user: publicUser(user) })
    return true
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    destroySession(currentToken(req))
    sessionCache.delete(currentToken(req))
    clearCookie(res, SESSION_COOKIE)
    sendJson(res, 200, { ok: true })
    return true
  }

  if (pathname === '/api/auth/profile' && method === 'PATCH') {
    const user = requireUser(req)
    const body = await readJson<{ nickname?: string; avatarColor?: string }>(req)
    const updated = publicUser(updateProfile(user, body))
    sessionCache.clear()
    sendJson(res, 200, { user: updated })
    return true
  }

  if (pathname === '/api/auth/password' && method === 'POST') {
    const user = requireUser(req)
    const body = await readJson<{ oldPassword?: string; newPassword?: string }>(req)
    await changePassword(user, String(body.oldPassword ?? ''), String(body.newPassword ?? ''))
    sendJson(res, 200, { ok: true })
    return true
  }

  // ---------- 音乐库（需要登录） ----------
  if (pathname === '/api/library' && method === 'GET') {
    const user = requireUser(req)
    sendJson(res, 200, { library: publicLibrary(user.id) })
    return true
  }

  if (pathname === '/api/library/favorites' && method === 'POST') {
    const user = requireUser(req)
    const body = await readJson<{ song?: unknown }>(req)
    const song = library.sanitizeSong(body.song)
    sendJson(res, 200, { library: toSafeLibrary(library.addFavorite(user.id, song)) })
    void audioCache.warm(song)
    return true
  }

  if (pathname === '/api/library/favorites' && method === 'DELETE') {
    const user = requireUser(req)
    sendJson(res, 200, { library: toSafeLibrary(library.clearFavorites(user.id)) })
    return true
  }

  const favoriteMatch = /^\/api\/library\/favorites\/([^/]+)$/.exec(pathname)
  if (favoriteMatch && method === 'DELETE') {
    const user = requireUser(req)
    sendJson(res, 200, { library: toSafeLibrary(library.removeFavorite(user.id, decodeURIComponent(favoriteMatch[1]))) })
    return true
  }

  if (pathname === '/api/library/history' && method === 'POST') {
    const user = requireUser(req)
    const body = await readJson<{ song?: unknown }>(req)
    sendJson(res, 200, { library: toSafeLibrary(library.addHistory(user.id, body.song)) })
    return true
  }

  if (pathname === '/api/library/history' && method === 'DELETE') {
    const user = requireUser(req)
    sendJson(res, 200, { library: toSafeLibrary(library.clearHistory(user.id)) })
    return true
  }

  if (pathname === '/api/library/settings' && method === 'PUT') {
    const user = requireUser(req)
    const body = await readJson<Record<string, unknown>>(req)
    sendJson(res, 200, { library: toSafeLibrary(library.updateSettings(user.id, body)) })
    return true
  }

  if (pathname === '/api/library/import' && method === 'POST') {
    const user = requireUser(req)
    const body = await readJson<{
      favorites?: unknown[]
      playlists?: unknown[]
      history?: unknown[]
      settings?: Record<string, unknown>
    }>(req, 2 * 1024 * 1024)
    const imported = library.importLibrary(user.id, body)
    sendJson(res, 200, { library: toSafeLibrary(imported) })
    // 导入后顺便把收藏 / 歌单里的歌曲补进服务端缓存队列（限制数量，避免一次性过载）
    let warmed = 0
    for (const favorite of imported.favorites) {
      if (warmed++ >= 100) break
      void audioCache.warm(favorite.song)
    }
    for (const playlist of imported.playlists) {
      for (const song of playlist.songs) {
        if (warmed++ >= 150) break
        void audioCache.warm(song)
      }
      if (warmed >= 150) break
    }
    return true
  }

  if (pathname === '/api/library/playlists' && method === 'POST') {
    const user = requireUser(req)
    const body = await readJson<{ name?: string; description?: string }>(req)
    sendJson(res, 200, { library: toSafeLibrary(library.createPlaylist(user.id, body)) })
    return true
  }

  const playlistMatch = /^\/api\/library\/playlists\/([^/]+)(\/songs|\/order)?(?:\/([^/]+))?$/.exec(pathname)
  if (playlistMatch) {
    const user = requireUser(req)
    const id = decodeURIComponent(playlistMatch[1])
    const action = playlistMatch[2]
    const param = playlistMatch[3] ? decodeURIComponent(playlistMatch[3]) : ''
    if (!action) {
      if (method === 'PATCH') {
        const body = await readJson<{ name?: string; description?: string }>(req)
        sendJson(res, 200, { library: toSafeLibrary(library.updatePlaylist(user.id, id, body)) })
        return true
      }
      if (method === 'DELETE') {
        sendJson(res, 200, { library: toSafeLibrary(library.deletePlaylist(user.id, id)) })
        return true
      }
    }
    if (action === '/songs') {
      if (method === 'POST') {
        const body = await readJson<{ song?: unknown }>(req)
        const song = library.sanitizeSong(body.song)
        sendJson(res, 200, { library: toSafeLibrary(library.addPlaylistSong(user.id, id, song)) })
        void audioCache.warm(song)
        return true
      }
      if (method === 'DELETE' && param) {
        sendJson(res, 200, { library: toSafeLibrary(library.removePlaylistSong(user.id, id, param)) })
        return true
      }
    }
    if (action === '/order' && method === 'PUT') {
      const body = await readJson<{ keys?: string[] }>(req)
      sendJson(res, 200, { library: toSafeLibrary(library.reorderPlaylist(user.id, id, body.keys ?? [])) })
      return true
    }
  }

  return false
}

function toSafeLibrary(data: library.UserLibrary) {
  return {
    favorites: data.favorites,
    playlists: data.playlists,
    history: data.history,
    settings: data.settings,
    updatedAt: data.updatedAt,
  }
}

/** 发现页取数失败：参数问题返回 400，其余统一当作上游不可用 */
function contentError(err: unknown): HttpError {
  const message = err instanceof Error ? err.message : ''
  if (err instanceof HttpError) return err
  if (message === '歌单 ID 不合法' || message === '不支持该平台的歌单' || message === '缺少歌手名称' || message === '歌手 ID 不合法') {
    return new HttpError(400, message)
  }
  log.warn('发现页内容加载失败：', message)
  return new HttpError(502, '内容加载失败，请稍后重试', 'upstream_error')
}

/** 歌单封面同样走同源代理 */
function withProxyCover<T extends { cover?: string | null }>(item: T): T {
  return { ...item, cover: item.cover ? imageProxy(item.cover) : null }
}

/** 把封面换成同源代理地址，避免混合内容与防盗链 */
function withProxyImages<T extends { list: { img?: string | null }[] }>(result: T): T {
  return {
    ...result,
    list: result.list.map((song) => ({ ...song, img: song.img ? imageProxy(song.img) : null })),
  }
}

export { notFound }