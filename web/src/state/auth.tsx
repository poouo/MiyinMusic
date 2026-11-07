import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError } from '../lib/api'
import type { User } from '../lib/types'

interface AuthApi {
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
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const result = await api.me()
      setUser(result.user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login({ username, password })
    setUser(result.user)
  }, [])

  const register = useCallback(async (username: string, password: string, nickname?: string) => {
    const result = await api.register({ username, password, nickname })
    setUser(result.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      /* ignore */
    }
    setUser(null)
  }, [])

  const apiValue = useMemo<AuthApi>(
    () => ({ user, loading, login, register, logout, refresh, setUser }),
    [user, loading, login, register, logout, refresh],
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
