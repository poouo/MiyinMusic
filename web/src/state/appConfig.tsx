import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { AppConfig } from '../lib/types'

interface AppConfigApi {
  config: AppConfig | null
  refresh: () => Promise<void>
  /** 是否允许下载（未登录不算，登录判断由调用方补） */
  downloadEnabled: boolean
  allowedQualities: AppConfig['download']['qualities']
}

const AppConfigContext = createContext<AppConfigApi | null>(null)

export function AppConfigProvider({ children }: { children: ReactNode }) {
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
  }, [refresh])

  const value = useMemo<AppConfigApi>(
    () => ({
      config,
      refresh,
      downloadEnabled: config?.download?.enabled ?? false,
      allowedQualities: config?.download?.qualities ?? [],
    }),
    [config, refresh],
  )

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>
}

export function useAppConfig(): AppConfigApi {
  const ctx = useContext(AppConfigContext)
  if (!ctx) throw new Error('useAppConfig 必须在 AppConfigProvider 内使用')
  return ctx
}
