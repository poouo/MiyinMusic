import * as devices from './device-auth.js'
import { publicUser } from './auth.js'
import { HttpError } from './errors.js'
import { PLATFORMS, PLATFORM_NAMES, QUALITIES, type Platform, type Quality } from './types.js'
import { getProvider } from './providers/index.js'
import { sourceManager } from './lx/manager.js'
import * as library from './library.js'
import * as lyrics from './lyric-cache.js'
import * as membership from './membership.js'
import { deadline, safeAudioFilename } from './media-resolver.js'
import { assertPublicUrl } from './stream.js'
import { writeAudit } from './audit.js'
import { accessPolicy } from './app-config.js'

function integer(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new HttpError(400, '分页参数无效', 'invalid_parameter')
  return n
}

function qualityOrder(body: Record<string, unknown>, allowed: Quality[]): Quality[] {
  const quality = (body.quality ?? '320k') as Quality
  if (!QUALITIES.includes(quality) || (body.fallback !== undefined && typeof body.fallback !== 'boolean')) {
    throw new HttpError(400, '音质或自动降级参数无效', 'invalid_parameter')
  }
  const order = body.fallback === true ? QUALITIES.slice(0, QUALITIES.indexOf(quality) + 1).reverse() : [quality]
  const result = order.filter(q => allowed.includes(q))
  if (!result.length) throw new HttpError(403, '当前账号没有所选音质的权限', 'quality_forbidden')
  return result
}

/** One authorization and direct-link implementation for REST and MCP. No audio proxying. */
export async function executeDeviceOperation(identity: devices.DeviceIdentity, path: string, method = 'GET',
  query = new URLSearchParams(), input: unknown = {}): Promise<Record<string, unknown>> {
  identity = devices.refresh(identity)
  const subject = 'u:' + identity.user.id
  if (path === '/me' && method === 'GET') {
    return { user: publicUser(identity.user), key: identity.key, access: devices.access(identity.user),
      policy: accessPolicy(identity.user.role), usage: membership.usage(subject) }
  }
  if (path === '/capabilities' && method === 'GET') {
    return { apiVersion: '1', platforms: PLATFORMS.map(id => ({ id, name: PLATFORM_NAMES[id],
      available: sourceManager.availablePlatforms().includes(id) })), qualities: QUALITIES, scopes: identity.key.scopes,
      mediaUrlMode: 'direct', expiresAtKnown: false, mcp: { endpoint: '/api/v1/mcp', transport: 'streamable-http' } }
  }
  if (path === '/search' && method === 'GET') {
    devices.requireScope(identity, 'search')
    const platform = (query.get('platform') ?? 'wy') as Platform
    const q = (query.get('q') ?? '').trim()
    if (!PLATFORMS.includes(platform) || !q || q.length > 100) throw new HttpError(400, '搜索平台或关键词无效', 'invalid_parameter')
    const result = await deadline(getProvider(platform).search(q, integer(query.get('page'), 1, 10000), integer(query.get('limit'), 20, 50)), 10000)
    devices.requireScope(devices.refresh(identity), 'search')
    return { result }
  }
  if (['/playback', '/download', '/lyrics'].includes(path) && method === 'POST') {
    const scope = path === '/lyrics' ? 'lyrics' : path === '/download' ? 'download' : 'playback'
    devices.requireScope(identity, scope)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '请求格式无效', 'invalid_parameter')
    const body = input as Record<string, unknown>, song = library.sanitizeSong(body.song)
    if (scope === 'lyrics') {
      const lyric = await deadline(lyrics.get(song), 10000)
      devices.requireScope(devices.refresh(identity), scope)
      return { lyric }
    }
    const policy = scope === 'download' ? membership.assertDownload(identity.user.role) : membership.assertPlayback(identity.user.role)
    if (scope === 'download') { membership.assertDirectDownloadPolicy(policy); membership.checkDownloadAllowance(subject, policy) }
    const requestedQuality = body.quality ?? '320k'
    const allowed = qualityOrder(body, scope === 'download' ? policy.downloadQualities : policy.playbackQualities)
    let result: Awaited<ReturnType<typeof sourceManager.getMusicUrl>>
    try {
      result = await deadline(sourceManager.getMusicUrl(song, allowed, undefined, true), scope === 'download' ? 20000 : 12000)
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(502, '请求的音质暂时不可用或音源解析失败', 'quality_unavailable')
    }
    if (!allowed.includes(result.quality)) throw new HttpError(502, '音源未返回允许的音质', 'quality_unavailable')
    try { await assertPublicUrl(result.url) }
    catch { throw new HttpError(502, '音源未返回有效的公开直链', 'invalid_upstream_url') }
    const current = devices.refresh(identity)
    devices.requireScope(current, scope)
    if (scope === 'download') membership.assertDownload(current.user.role, result.quality)
    else membership.assertPlayback(current.user.role, result.quality)
    const filename = safeAudioFilename(song, result.quality)
    if (scope === 'download') {
      membership.chargeDirectDownload(subject, current.user.role, result.quality)
      writeAudit({ userId: current.user.id, username: current.user.username, action: 'device.download', detail: filename + '（直链签发）' })
    }
    return { url: result.url, delivery: 'direct', expiresAt: null, quality: result.quality, requestedQuality,
      downgraded: result.quality !== requestedQuality, duration: result.duration ?? song.interval,
      platform: song.platform, ...(scope === 'download' ? { filename } : {}) }
  }
  if (path === '/playlists' && method === 'GET') {
    devices.requireScope(identity, 'library')
    return { playlists: library.playlistSummaries(identity.user.id) }
  }
  const playlist = /^\/playlists\/([^/]+)$/.exec(path)
  if (playlist && method === 'GET') {
    devices.requireScope(identity, 'library')
    return { playlist: library.getPlaylist(identity.user.id, decodeURIComponent(playlist[1])) }
  }
  if (path === '/favorites' && method === 'GET') {
    devices.requireScope(identity, 'library')
    const page = integer(query.get('page'), 1, 10000), limit = integer(query.get('limit'), 20, 100)
    const entries = library.getFavorites(identity.user.id), offset = (page - 1) * limit
    return { songs: entries.slice(offset, offset + limit).map(entry => entry.song), page, limit,
      total: entries.length, hasMore: offset + limit < entries.length }
  }
  throw new HttpError(404, '设备 API 接口不存在', 'not_found')
}
