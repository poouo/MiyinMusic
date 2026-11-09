import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadJson, saveJson } from '../lib/storage'
import type { Platform, Quality } from '../lib/types'
import { PLATFORMS } from '../lib/types'

export type ThemeMode = 'auto' | 'dark' | 'light' | 'midnight' | 'forest' | 'sakura' | 'mono'

export interface ThemeOption {
  id: ThemeMode
  name: string
  scheme: 'light' | 'dark' | 'auto'
  /** 预览用的三个色块 */
  dots: [string, string, string]
}

export const THEMES: ThemeOption[] = [
  { id: 'auto', name: '跟随系统', scheme: 'auto', dots: ['#151515', '#faf9f6', '#ed9668'] },
  { id: 'dark', name: '石墨', scheme: 'dark', dots: ['#151515', '#ed9668', '#a3a3a0'] },
  { id: 'light', name: '日光', scheme: 'light', dots: ['#faf9f6', '#a74b28', '#767570'] },
  { id: 'midnight', name: '午夜蓝', scheme: 'dark', dots: ['#141618', '#8eafd9', '#a3a7ad'] },
  { id: 'forest', name: '森林', scheme: 'dark', dots: ['#141715', '#90b59a', '#a4aaa5'] },
  { id: 'sakura', name: '樱花', scheme: 'light', dots: ['#fcf9fa', '#a14364', '#80777a'] },
  { id: 'mono', name: '纯黑', scheme: 'dark', dots: ['#000000', '#f5f5f5', '#9a9a9a'] },
]

const LIGHT_THEMES: ThemeMode[] = ['light', 'sakura']

export interface Settings {
  theme: ThemeMode
  quality: Quality[]
  defaultPlatform: Platform
  volume: number
  showTranslation: boolean
  /** 播放条是否收成紧凑模式 */
  compactPlayer: boolean
  sidebarCollapsed: boolean
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  quality: ['flac', '320k', '128k'],
  defaultPlatform: 'wy',
  volume: 0.8,
  showTranslation: true,
  compactPlayer: false,
  sidebarCollapsed: false,
}

interface SettingsApi {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  resolvedTheme: ThemeMode
  scheme: 'light' | 'dark'
}

const SettingsContext = createContext<SettingsApi | null>(null)

function systemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = loadJson<Partial<Settings>>('settings.v1', {})
    const merged = { ...DEFAULT_SETTINGS, ...saved }
    if (!PLATFORMS.includes(merged.defaultPlatform)) merged.defaultPlatform = DEFAULT_SETTINGS.defaultPlatform
    if (!Array.isArray(merged.quality) || !merged.quality.length) merged.quality = DEFAULT_SETTINGS.quality
    if (!THEMES.some((theme) => theme.id === merged.theme)) merged.theme = 'auto'
    return merged
  })
  const [system, setSystem] = useState<'dark' | 'light'>(systemTheme)

  useEffect(() => {
    saveJson('settings.v1', settings)
    document.documentElement.dataset.sidebarCollapsed = String(settings.sidebarCollapsed)
  }, [settings])

  useEffect(() => {
    if (!window.matchMedia) return
    const query = window.matchMedia('(prefers-color-scheme: light)')
    const handler = () => setSystem(query.matches ? 'light' : 'dark')
    query.addEventListener('change', handler)
    return () => query.removeEventListener('change', handler)
  }, [])

  const resolvedTheme: ThemeMode = settings.theme === 'auto' ? system : settings.theme
  const scheme: 'light' | 'dark' = LIGHT_THEMES.includes(resolvedTheme) ? 'light' : 'dark'

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    root.dataset.scheme = scheme
    root.style.colorScheme = scheme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      const paint = window.getComputedStyle(root).getPropertyValue('--bg').trim()
      meta.setAttribute('content', paint || (scheme === 'dark' ? '#07080d' : '#f4f5fa'))
    }
  }, [resolvedTheme, scheme])

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  const api = useMemo<SettingsApi>(
    () => ({ settings, update, resolvedTheme, scheme }),
    [settings, update, resolvedTheme, scheme],
  )

  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings 必须在 SettingsProvider 内使用')
  return ctx
}
