import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { navigate } from '../lib/router'
import { useAuth, errorMessage } from '../state/auth'
import { useToast } from '../state/toast'
import { MusicIcon } from '../components/Icons'

export function AuthPage() {
  const auth = useAuth()
  const toast = useToast()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [allowRegister, setAllowRegister] = useState(true)

  useEffect(() => {
    let cancelled = false
    api
      .config()
      .then((result) => {
        if (!cancelled) setAllowRegister(result.allowRegister !== false)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'login') {
        await auth.login(username.trim(), password)
        toast.success('欢迎回来')
      } else {
        await auth.register(username.trim(), password, nickname.trim() || undefined)
        toast.success('注册成功，已自动登录')
      }
      navigate('/')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="row gap-12" style={{ marginBottom: 10 }}>
          <div className="brand__mark">
            <MusicIcon size={20} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '0.03em' }}>觅音</div>
            <div className="faint" style={{ fontSize: 11.5, letterSpacing: '0.16em' }}>
              MIYIN MUSIC
            </div>
          </div>
        </div>
        <p className="dim" style={{ fontSize: 13, marginTop: 0, marginBottom: 20 }}>
          登录后收藏、歌单与播放记录都会保存在账号中，多设备同步。
        </p>

        {allowRegister ? (
          <div className="auth-tabs">
            <button className={mode === 'login' ? 'is-active' : ''} onClick={() => setMode('login')}>
              登录
            </button>
            <button className={mode === 'register' ? 'is-active' : ''} onClick={() => setMode('register')}>
              注册
            </button>
          </div>
        ) : (
          <div className="dim" style={{ fontSize: 12.5, marginBottom: 16 }}>
            本服务器已关闭新用户注册。
          </div>
        )}

        <form key={mode} className="stack gap-14 auth-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="username">用户名</label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="3-24 位字母、数字或下划线"
              required
            />
          </div>
          {mode === 'register' ? (
            <div className="field">
              <label htmlFor="nickname">昵称（可选）</label>
              <input
                id="nickname"
                className="input"
                value={nickname}
                maxLength={24}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="展示用的名字"
              />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'}
              required
            />
          </div>

          {error ? (
            <div
              style={{
                color: 'var(--danger)',
                fontSize: 12.5,
                background: 'rgba(255,95,109,0.08)',
                border: '1px solid rgba(255,95,109,0.25)',
                padding: '8px 12px',
                borderRadius: 10,
              }}
            >
              {error}
            </div>
          ) : null}

          <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={submitting}>
            {submitting ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>

        <button className="btn btn--ghost btn--sm btn--block" style={{ marginTop: 12 }} onClick={() => navigate('/')}>
          先随便逛逛
        </button>
      </div>
    </div>
  )
}