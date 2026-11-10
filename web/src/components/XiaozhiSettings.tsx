import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { DeviceScope, XiaozhiStatus } from '../lib/types'
import { useToast } from '../state/toast'
import { Modal } from './Modal'

const STATES: Record<XiaozhiStatus['state'], string> = {
  disabled: '未连接', connecting: '连接中', connected: '已连接', reconnecting: '正在重连', blocked: '权限受限', error: '配置异常',
}
const SCOPES: { id: DeviceScope; name: string }[] = [
  { id: 'search', name: '搜索' }, { id: 'playback', name: '播放直链' }, { id: 'lyrics', name: '歌词' },
  { id: 'library', name: '我的歌单与喜欢' }, { id: 'download', name: '下载直链' },
]

export function XiaozhiSettings({ allowed, onChange }: { allowed: boolean; onChange: () => void }) {
  const toast = useToast()
  const [status, setStatus] = useState<XiaozhiStatus | null>(null)
  const [endpoint, setEndpoint] = useState('')
  const [scopes, setScopes] = useState<DeviceScope[]>(['search', 'playback'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const revision = useRef(0)
  const mutating = useRef(false)
  useEffect(() => {
    let cancelled = false, initialized = false, pending = false
    const refresh = async () => {
      if (pending || mutating.current) return
      pending = true
      const current = revision.current
      try {
        const result = await api.deviceApi.xiaozhi()
        if (cancelled || current !== revision.current) return
        setStatus(result); setError('')
        if (!initialized) { if (result.scopes) setScopes(result.scopes); initialized = true }
      } catch (e) { if (!cancelled && current === revision.current) setError((e as Error).message) }
      finally { pending = false }
    }
    void refresh()
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])
  const save = async (enabled: boolean) => {
    revision.current++; mutating.current = true
    setBusy(true)
    try {
      const result = await api.deviceApi.saveXiaozhi({ enabled, ...(enabled ? { scopes, ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}) } : {}) })
      setStatus(result); setEndpoint(''); setError(''); onChange()
      toast.success(enabled ? '小智接入配置已保存' : '已断开小智连接')
    } catch (e) { toast.error((e as Error).message) } finally { mutating.current = false; setBusy(false) }
  }
  const remove = async () => {
    revision.current++; mutating.current = true
    setBusy(true)
    try {
      setStatus(await api.deviceApi.removeXiaozhi()); setEndpoint(''); setRemoving(false); setError(''); onChange()
      toast.success('小智接入已移除')
    } catch (e) { toast.error((e as Error).message) } finally { mutating.current = false; setBusy(false) }
  }
  return <section className="card card--pad-lg stack gap-16" aria-labelledby="xiaozhi-heading">
    <div className="row gap-12" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <h2 id="xiaozhi-heading" style={{ fontSize: 18 }}>小智 AI</h2>
      <span role="status" className="setting-desc">{status ? STATES[status.state] : '正在加载…'}</span>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {status?.message ? <p role="alert">{status.message}</p> : null}
    {!allowed ? <p className="dim">启用设备 API 授权后可连接小智。</p> : <>
      <label className="field">MCP 接入点
        <input className="input" type="password" autoComplete="new-password" spellCheck={false} value={endpoint} maxLength={4096}
          placeholder={status?.configured ? '已保存；粘贴新地址以更换接入点' : 'wss://api.xiaozhi.me/mcp/?token=…'}
          onChange={event => setEndpoint(event.target.value)} />
      </label>
      <a className="setting-desc" href="https://xiaozhi.me" target="_blank" rel="noreferrer">小智控制台 → 配置角色 → MCP 接入点 ↗</a>
      <div className="chip-row" role="group" aria-label="小智工具权限">{SCOPES.map(item => <button key={item.id} role="checkbox" aria-checked={scopes.includes(item.id)}
        disabled={busy} className={'chip' + (scopes.includes(item.id) ? ' is-active' : '')}
        onClick={() => setScopes(current => current.includes(item.id) ? current.filter(scope => scope !== item.id) : [...current, item.id])}>{item.name}</button>)}</div>
      <p className="setting-desc">服务端保持连接，关闭网页后仍可用。实际播放需设备固件支持音乐 URL 播放。</p>
    </>}
    <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
      {allowed ? <button className="btn btn--primary" disabled={busy || !status || !scopes.length || (!status.configured && !endpoint.trim())}
        onClick={() => void save(true)}>{busy ? '处理中…' : '保存并连接'}</button> : null}
      {status?.enabled ? <button className="btn" disabled={busy} onClick={() => void save(false)}>断开连接</button> : null}
      {status?.configured ? <button className="btn btn--ghost" disabled={busy} onClick={() => setRemoving(true)}>移除接入</button> : null}
    </div>
    <Modal open={removing} title="移除小智接入？" onClose={() => setRemoving(false)}><div className="stack gap-16">
      <p>将断开连接，并删除对应的小智设备密钥。</p>
      <button className="btn btn--primary" disabled={busy} onClick={() => void remove()}>确认移除</button>
    </div></Modal>
  </section>
}
