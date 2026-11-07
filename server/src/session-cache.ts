import type { User } from './auth.js'

interface Entry {
  user: User | null
  expire: number
}

/** 会话缓存：多用户并发时避免每个请求都做一次 JOIN 查询 */
const TTL_MS = 5000
const MAX_ENTRIES = 5000
const cache = new Map<string, Entry>()

export const sessionCache = {
  get(token: string | null, loader: (token: string) => User | null): User | null {
    if (!token) return null
    const now = Date.now()
    const entry = cache.get(token)
    if (entry && entry.expire > now) return entry.user
    const user = loader(token)
    if (cache.size > MAX_ENTRIES) cache.clear()
    cache.set(token, { user, expire: now + TTL_MS })
    return user
  },
  delete(token: string | null): void {
    if (token) cache.delete(token)
  },
  clear(): void {
    cache.clear()
  },
}
