import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { AppConfig } from '../lib/types'
import { useAuth } from './auth'
import type { Quality } from '../lib/types'

interface AppConfigApi {
  config: AppConfig | null
  refresh: () => Promise<void>
  /** Current identity's download permission. The server is authoritative. */
  downloadEnabled: boolean
  allowedQualities: AppConfig['download']['qualities']
  playbackQualities: Quality[]
}

const AppConfigContext = createContext<AppConfigApi | null>(null)

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [config, setConfig] = useState<AppConfig | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await api.config()
      setConfig(next)
    } catch {
      /* 忽略：接口异常时按默认策略处理 */
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh, user?.id, user?.role])

  const value = useMemo<AppConfigApi>(
    () => {
      const audience = user?.role ?? 'guest'
      const unlimited = config?.membership?.enabled === false || audience === 'admin'
      const policy = audience === 'admin' ? undefined : config?.membership?.audiences[audience]
      const all: Quality[] = ['128k', '320k', 'flac', 'flac24bit']
      return {
      config,
      refresh,
      downloadEnabled: unlimited || (policy ? policy.downloadEnabled && policy.downloadQualities.length > 0
        : !!config?.download?.enabled && config.download.roles.includes(audience)),
      allowedQualities: unlimited ? all : policy?.downloadQualities ?? config?.download?.qualities ?? [],
      playbackQualities: unlimited ? all : policy ? (policy.playbackEnabled ? policy.playbackQualities : []) : all,
    } },
    [config, refresh, user?.role],
  )

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>
}

export function useAppConfig(): AppConfigApi {
  const ctx = useContext(AppConfigContext)
  if (!ctx) throw new Error('useAppConfig 必须在 AppConfigProvider 内使用')
  return ctx
}
