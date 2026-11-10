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

export type ManagedAudience = Exclude<Audience, 'admin'>
export const MANAGED_AUDIENCES: ManagedAudience[] = ['guest', 'user', 'vip']

export interface AudiencePolicy {
  playbackEnabled: boolean
  playbackQualities: Quality[]
  downloadEnabled: boolean
  downloadQualities: Quality[]
  /** null means unlimited; zero means no allowance. */
  dailyDownloads: number | null
  monthlyDownloads: number | null
  dailyBytes: number | null
  monthlyBytes: number | null
}

export interface MembershipConfig {
  enabled: boolean
  audiences: Record<ManagedAudience, AudiencePolicy>
}

export type MembershipPatch = {
  enabled?: boolean
  audiences?: Partial<Record<ManagedAudience, Partial<AudiencePolicy>>>
}

export function unrestrictedPolicy(): AudiencePolicy {
  return {
    playbackEnabled: true, playbackQualities: [...QUALITIES],
    downloadEnabled: true, downloadQualities: [...QUALITIES],
    dailyDownloads: null, monthlyDownloads: null, dailyBytes: null, monthlyBytes: null,
  }
}

export interface CacheConfig {
  /** 服务端音乐缓存开关 */
  enabled: boolean
  /** 缓存总大小上限（字节） */
  maxBytes: number
  /** 用户把歌加入歌单 / 收藏时，自动缓存到服务端 */
  warmCollections: boolean
  /** 兼容旧客户端字段；服务端固定缓存全部可用音质 */
  qualities: Quality[]
}

export interface AppConfig {
  registration: RegistrationConfig
  download: DownloadConfig
  cache: CacheConfig
  membership: MembershipConfig
}

const ENV_ALLOW_REGISTER = process.env.MIYIN_ALLOW_REGISTER !== '0'

/** 默认服务端缓存 8GB，各可用音质独立保存 */
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
    qualities: [...QUALITIES],
  },
  membership: {
    enabled: true,
    audiences: {
      guest: { ...unrestrictedPolicy(), downloadEnabled: false, downloadQualities: ['320k', '128k'] },
      user: { ...unrestrictedPolicy(), downloadQualities: ['320k', '128k'] },
      vip: unrestrictedPolicy(),
    },
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
  const membership = raw.membership
  const roles = Array.isArray(download.roles)
    ? AUDIENCES.filter((role) => download.roles?.includes(role))
    : DEFAULT_CONFIG.download.roles
  const qualities = Array.isArray(download.qualities)
    ? QUALITIES.filter((quality) => download.qualities?.includes(quality))
    : DEFAULT_CONFIG.download.qualities
  const audiences = {} as Record<ManagedAudience, AudiencePolicy>
  for (const audience of MANAGED_AUDIENCES) {
    // Existing deployments keep their download permissions until configured here.
    const fallback = { ...unrestrictedPolicy(), downloadEnabled: download.enabled !== false && roles.includes(audience),
      downloadQualities: [...qualities] }
    const policy = membership?.audiences?.[audience]
    audiences[audience] = {
      playbackEnabled: policy?.playbackEnabled !== false,
      playbackQualities: Array.isArray(policy?.playbackQualities)
        ? QUALITIES.filter(q => policy.playbackQualities!.includes(q)) : [...QUALITIES],
      downloadEnabled: policy?.downloadEnabled ?? fallback.downloadEnabled,
      downloadQualities: Array.isArray(policy?.downloadQualities)
        ? QUALITIES.filter(q => policy.downloadQualities!.includes(q)) : fallback.downloadQualities,
      ...Object.fromEntries((['dailyDownloads', 'monthlyDownloads', 'dailyBytes', 'monthlyBytes'] as const).map(key => {
        const value = policy?.[key]
        return [key, typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null]
      })) as Pick<AudiencePolicy, 'dailyDownloads' | 'monthlyDownloads' | 'dailyBytes' | 'monthlyBytes'>,
    }
  }
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
      qualities: [...QUALITIES],
    },
    membership: { enabled: membership?.enabled !== false, audiences },
  }
}

export function getAppConfig(): AppConfig {
  try {
    const raw = readMeta(getDb(), META_KEY)
    if (!raw) {
      const initial = normalize({ registration: { enabled: ENV_ALLOW_REGISTER }, membership: DEFAULT_CONFIG.membership })
      writeMeta(getDb(), META_KEY, JSON.stringify(initial))
      return initial
    }
    return normalize(JSON.parse(raw))
  } catch {
    return normalize({ registration: { enabled: ENV_ALLOW_REGISTER } })
  }
}

export function updateAppConfig(
  patch: Partial<Omit<AppConfig, 'cache' | 'membership'>> & { cache?: Partial<CacheConfig>; membership?: MembershipPatch },
): AppConfig {
  const current = getAppConfig()
  const membership = {
    ...current.membership, ...patch.membership,
    audiences: { ...current.membership.audiences },
  }
  for (const audience of MANAGED_AUDIENCES) {
    membership.audiences[audience] = { ...current.membership.audiences[audience], ...patch.membership?.audiences?.[audience] }
    // Compatibility with clients that still save the old download policy.
    if (patch.download && !patch.membership) {
      const legacy = { ...current.download, ...patch.download }
      membership.audiences[audience].downloadEnabled = legacy.enabled && legacy.roles.includes(audience)
      membership.audiences[audience].downloadQualities = [...legacy.qualities]
    }
  }
  const next = normalize({
    registration: { ...current.registration, ...(patch.registration ?? {}) },
    download: { ...current.download, ...(patch.download ?? {}) },
    cache: { ...current.cache, ...(patch.cache ?? {}) },
    membership,
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
  const policy = accessPolicy(role)
  return policy.downloadEnabled && policy.downloadQualities.length > 0
}

export function accessPolicy(role: string | null | undefined, config = getAppConfig()): AudiencePolicy {
  const audience = audienceOf(role)
  if (!config.membership.enabled || audience === 'admin') return unrestrictedPolicy()
  return config.membership.audiences[audience]
}

/** Retained for older clients; actual authorization always uses the per-audience policy. */
export function publicDownloadConfig(config = getAppConfig()): DownloadConfig {
  const roles = AUDIENCES.filter(audience => {
    const policy = accessPolicy(audience === 'guest' ? null : audience, config)
    return policy.downloadEnabled && policy.downloadQualities.length > 0
  })
  return { enabled: roles.length > 0, roles, qualities: QUALITIES.filter(quality => roles.some(audience =>
    accessPolicy(audience === 'guest' ? null : audience, config).downloadQualities.includes(quality))) }
}
