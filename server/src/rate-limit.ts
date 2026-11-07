import { HttpError } from './errors.js'

interface Bucket {
  count: number
  resetAt: number
}

export interface Limiter {
  /** 返回 true 表示放行，false 表示超限 */
  hit(key: string): boolean
}

/**
 * 极简滑动窗口限流，用于保护搜索 / 取址 / 拉流这类会被反复调用的接口，
 * 多个用户共用一台服务器时避免单个客户端把上游额度或带宽占满。
 */
export function createLimiter(limit: number, windowMs: number): Limiter {
  const buckets = new Map<string, Bucket>()
  let lastSweep = Date.now()

  return {
    hit(key: string): boolean {
      const now = Date.now()
      if (now - lastSweep > windowMs * 2) {
        for (const [k, bucket] of buckets) {
          if (bucket.resetAt < now) buckets.delete(k)
        }
        lastSweep = now
      }
      const bucket = buckets.get(key)
      if (!bucket || bucket.resetAt < now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs })
        return true
      }
      bucket.count++
      return bucket.count <= limit
    },
  }
}

const limiters = {
  /** 所有接口的总闸门（音频流单独计数） */
  api: createLimiter(900, 60_000),
  search: createLimiter(60, 60_000),
  url: createLimiter(120, 60_000),
  lyric: createLimiter(120, 60_000),
  stream: createLimiter(600, 60_000),
  download: createLimiter(30, 60_000),
  upload: createLimiter(10, 60_000),
} as const

export type LimiterName = keyof typeof limiters

export function getRateLimiter(name: LimiterName) {
  return limiters[name]
}

export function enforce(name: LimiterName, key: string): void {
  if (!getRateLimiter(name).hit(key)) {
    throw new HttpError(429, '操作太频繁了，请稍后再试', 'rate_limited')
  }
}

/** 已登录用户按用户 ID 限流，未登录按 IP */
export function rateKey(req: { socket: { remoteAddress?: string } }, user: { id: string } | null, ip: string): string {
  return user ? 'u:' + user.id : 'ip:' + ip
}