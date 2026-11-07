import { getDb, readMeta, writeMeta } from './db.js'
import { QUALITIES, type Quality } from './types.js'

/** 受众：游客 / 普通用户 / 会员 / 管理员 */
export type Audience = 'guest' | 'user' | 'vip' | 'admin'
export const AUDIENCES: Audience[] = ['guest', 'user', 'vip', 'admin']

export interface RegistrationConfig {
  /** 是否开放注册 */
  enabled: boolean
}

export interface DownloadConfig {
  /** 下载总开关 */
  enabled: boolean
  /** 允许下载的受众 */
  roles: Audience[]
  /** 允许下载的音质 */
  qualities: Quality[]
}

export interface CacheConfig {
  /** 服务端音乐缓存开关 */
  enabled: boolean
  /** 缓存总大小上限（字节） */
  maxBytes: number
  /** 用户把歌加入歌单 / 收藏时，自动缓存到服务端 */
  warmCollections: boolean
  /** 缓存时优先尝试的音质 */
  qualities: Quality[]
}

export interface AppConfig {
  registration: RegistrationConfig
  download: DownloadConfig
  cache: CacheConfig
}

const ENV_ALLOW_REGISTER = process.env.MIYIN_ALLOW_REGISTER !== '0'

/** 默认服务端缓存 8GB，优先缓存 320k，兼顾体积与音质 */
export const DEFAULT_CACHE_BYTES = 8 * 1024 * 1024 * 1024
const MIN_CACHE_BYTES = 256 * 1024 * 1024
const MAX_CACHE_BYTES = 4 * 1024 * 1024 * 1024 * 1024

const DEFAULT_CONFIG: AppConfig = {
  registration: { enabled: ENV_ALLOW_REGISTER },
  download: { enabled: true, roles: ['user', 'vip', 'admin'], qualities: ['320k', '128k'] },
  cache: {
    enabled: true,
    maxBytes: DEFAULT_CACHE_BYTES,
    warmCollections: true,
    qualities: ['320k', '128k'],
  },
}

const META_KEY = 'app_config'

function clampCacheBytes(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONFIG.cache.maxBytes
  return Math.min(MAX_CACHE_BYTES, Math.max(MIN_CACHE_BYTES, Math.round(n)))
}

function normalize(input: unknown): AppConfig {
  const raw = (input ?? {}) as Partial<AppConfig>
  const registration: Partial<RegistrationConfig> = raw.registration ?? {}
  const download: Partial<DownloadConfig> = raw.download ?? {}
  const cache: Partial<CacheConfig> = raw.cache ?? {}
  const roles = Array.isArray(download.roles)
    ? AUDIENCES.filter((role) => download.roles?.includes(role))
    : DEFAULT_CONFIG.download.roles
  const qualities = Array.isArray(download.qualities)
    ? QUALITIES.filter((quality) => download.qualities?.includes(quality))
    : DEFAULT_CONFIG.download.qualities
  const cacheQualities = Array.isArray(cache.qualities)
    ? QUALITIES.filter((quality) => cache.qualities?.includes(quality))
    : DEFAULT_CONFIG.cache.qualities
  return {
    registration: { enabled: registration.enabled !== false },
    download: {
      enabled: download.enabled !== false,
      roles: roles.length ? roles : ['admin'],
      qualities: qualities.length ? qualities : DEFAULT_CONFIG.download.qualities,
    },
    cache: {
      enabled: cache.enabled !== false,
      maxBytes: clampCacheBytes(cache.maxBytes),
      warmCollections: cache.warmCollections !== false,
      qualities: cacheQualities.length ? cacheQualities : DEFAULT_CONFIG.cache.qualities,
    },
  }
}

export function getAppConfig(): AppConfig {
  try {
    const raw = readMeta(getDb(), META_KEY)
    if (!raw) {
      const initial = normalize({ registration: { enabled: ENV_ALLOW_REGISTER } })
      writeMeta(getDb(), META_KEY, JSON.stringify(initial))
      return initial
    }
    return normalize(JSON.parse(raw))
  } catch {
    return normalize({ registration: { enabled: ENV_ALLOW_REGISTER } })
  }
}

export function updateAppConfig(
  patch: Partial<Omit<AppConfig, 'cache'>> & { cache?: Partial<CacheConfig> },
): AppConfig {
  const current = getAppConfig()
  const next = normalize({
    registration: { ...current.registration, ...(patch.registration ?? {}) },
    download: { ...current.download, ...(patch.download ?? {}) },
    cache: { ...current.cache, ...(patch.cache ?? {}) },
  })
  writeMeta(getDb(), META_KEY, JSON.stringify(next))
  return next
}

export function audienceOf(role: string | null | undefined): Audience {
  if (!role) return 'guest'
  if (role === 'admin' || role === 'vip') return role
  return 'user'
}

/** 当前受众是否允许下载（还需二次校验音质） */
export function canDownload(role: string | null | undefined): boolean {
  const config = getAppConfig().download
  if (!config.enabled) return false
  return config.roles.includes(audienceOf(role))
}
