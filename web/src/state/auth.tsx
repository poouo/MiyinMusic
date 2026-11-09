import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from '../lib/api'
import type { User } from '../lib/types'
import { loadJson, saveJson } from '../lib/storage'

interface AuthApi {
  offline: boolean
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, nickname?: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  setUser: (user: User | null) => void
}

const AuthContext = createContext<AuthApi | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => loadJson('auth.last-user', null))
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const versionRef = useRef(0)
  const replaceUser = useCallback((next: User | null) => { versionRef.current++; setUser(next) }, [])

  const refresh = useCallback(async () => {
    const version = ++versionRef.current
    try {
      const result = await api.me()
      if (version !== versionRef.current) return
      setUser(result.user)
      setOffline(false)
    } catch (error) {
      if (version !== versionRef.current) return
      if (error instanceof ApiError && error.status === 401) setUser(null)
      else setOffline(true)
    } finally {
      if (version === versionRef.current) setLoading(false)
    }
  }, [])
  useEffect(() => { saveJson('auth.last-user', user) }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (username: string, password: string) => {
    const version = ++versionRef.current
    const result = await api.login({ username, password })
    if (version !== versionRef.current) return
    setLoading(false)
    setOffline(false)
    setUser(result.user)
  }, [])

  const register = useCallback(async (username: string, password: string, nickname?: string) => {
    const version = ++versionRef.current
    const result = await api.register({ username, password, nickname })
    if (version !== versionRef.current) return
    setLoading(false)
    setOffline(false)
    setUser(result.user)
  }, [])

  const logout = useCallback(async () => {
    const version = ++versionRef.current
    try {
      await api.logout()
    } catch {
      /* ignore */
    }
    if (version === versionRef.current) { setUser(null); setOffline(false); setLoading(false) }
  }, [])

  const apiValue = useMemo<AuthApi>(
    () => ({ user, offline, loading, login, register, logout, refresh, setUser: replaceUser }),
    [user, offline, loading, login, register, logout, refresh, replaceUser],
  )

  return <AuthContext.Provider value={apiValue}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}
