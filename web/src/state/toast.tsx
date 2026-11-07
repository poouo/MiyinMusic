import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type ToastKind = 'info' | 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)
  const timers = useRef<number[]>([])

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const show = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = ++counter.current
      setItems((prev) => [...prev.slice(-2), { id, message, kind }])
      const timer = window.setTimeout(() => remove(id), kind === 'error' ? 4200 : 2600)
      timers.current.push(timer)
    },
    [remove],
  )

  useEffect(() => {
    return () => {
      for (const timer of timers.current) window.clearTimeout(timer)
      timers.current = []
    }
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message: string) => show(message, 'success'),
      error: (message: string) => show(message, 'error'),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={'toast' + (item.kind === 'error' ? ' toast--error' : item.kind === 'success' ? ' toast--success' : '')}
            onClick={() => remove(item.id)}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用')
  return ctx
}
