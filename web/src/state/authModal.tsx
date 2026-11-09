import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../lib/api'
import { errorMessage, useAuth } from './auth'
import { useToast } from './toast'
import { MusicIcon, XIcon } from '../components/Icons'

type Mode = 'login' | 'register'

interface AuthModalApi {
  open: (mode?: Mode, hint?: string) => void
  close: () => void
  isOpen: boolean
}

const AuthModalContext = createContext<AuthModalApi | null>(null)

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const toast = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('login')
  const [hint, setHint] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [allowRegister, setAllowRegister] = useState(true)

  const open = useCallback((next: Mode = 'login', message?: string) => {
    setMode(next)
    setHint(message ?? null)
    setError(null)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    setError(null)
    setPassword('')
  }, [])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    api
      .config()
      .then((config) => {
        if (!cancelled) setAllowRegister(config.allowRegister !== false)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'login') {
        await auth.login(username.trim(), password)
        toast.success('欢迎回来，' + username.trim())
      } else {
        await auth.register(username.trim(), password, nickname.trim() || undefined)
        toast.success('注册成功，已自动登录')
      }
      close()
      setPassword('')
      setNickname('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const value = useMemo<AuthModalApi>(() => ({ open, close, isOpen }), [open, close, isOpen])

  return (
    <AuthModalContext.Provider value={value}>
      {children}
      {isOpen ? (
        <div className="modal-backdrop auth-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <div className="auth-modal" role="dialog" aria-modal="true">
            <div className="auth-modal__glow" />
            <button className="icon-btn auth-modal__close" onClick={close} aria-label="关闭">
              <XIcon size={18} />
            </button>

            <div className="row gap-12" style={{ marginBottom: 6 }}>
              <div className="brand__mark" style={{ width: 42, height: 42, borderRadius: 13 }}>
                <MusicIcon size={21} />
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 500 }}>觅音</div>
                <div className="faint" style={{ fontSize: 12 }}>
                  MiYin Music
                </div>
              </div>
            </div>

            <p className="dim auth-modal__desc">
              {hint ?? '登录后，收藏与歌单可在不同设备间同步'}
            </p>

            {allowRegister ? (
              <div className="auth-tabs">
                <button className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError(null) }}>
                  登录
                </button>
                <button className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError(null) }}>
                  注册
                </button>
              </div>
            ) : (
              <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>
                本服务器已关闭新用户注册
              </div>
            )}

            <form className="stack gap-12" onSubmit={submit}>
              <div className="field">
                <label htmlFor="auth-username">用户名</label>
                <input
                  id="auth-username"
                  className="input"
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="3-24 位字母、数字或下划线"
                  required
                />
              </div>
              {mode === 'register' ? (
                <div className="field">
                  <label htmlFor="auth-nickname">昵称（可选）</label>
                  <input
                    id="auth-nickname"
                    className="input"
                    value={nickname}
                    maxLength={24}
                    onChange={(event) => setNickname(event.target.value)}
                    placeholder="展示用的名字"
                  />
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="auth-password">密码</label>
                <input
                  id="auth-password"
                  className="input"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'}
                  required
                />
              </div>

              {error ? <div className="auth-modal__error">{error}</div> : null}

              <button className="btn btn--primary btn--block btn--lg" type="submit" disabled={submitting}>
                {submitting ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
              </button>
            </form>

            <button className="btn btn--ghost btn--sm btn--block" style={{ marginTop: 10 }} onClick={close}>
              先随便听听
            </button>
          </div>
        </div>
      ) : null}
    </AuthModalContext.Provider>
  )
}

export function useAuthModal(): AuthModalApi {
  const ctx = useContext(AuthModalContext)
  if (!ctx) throw new Error('useAuthModal 必须在 AuthModalProvider 内使用')
  return ctx
}
