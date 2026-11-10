import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { ROLE_NAMES, type DeviceAccess, type DeviceApiConfig, type DeviceApiStatus, type DeviceKey, type DeviceScope, type UserRole } from '../lib/types'
import { useToast } from '../state/toast'
import { Select } from './Select'
import { Modal } from './Modal'
import { KeyIcon, PlusIcon, RefreshIcon, TrashIcon } from './Icons'
import '../styles/device-api.css'

const SCOPES: { id: DeviceScope; name: string }[] = [
  { id: 'search', name: '搜索歌曲' }, { id: 'playback', name: '在线播放' }, { id: 'download', name: '下载歌曲' },
  { id: 'lyrics', name: '读取歌词' }, { id: 'library', name: '读取自己的歌单与喜欢' },
]
const date = (value: number | null) => value ? new Date(value).toLocaleString() : '从未使用'

function DeviceKeys({ keys, busy, onRevoke, onEdit }: { keys: DeviceKey[]; busy: boolean; onRevoke: (key: DeviceKey) => void; onEdit?: (key: DeviceKey) => void }) {
  return <div className="stack gap-12">
    {!keys.length ? <p className="dim">还没有设备密钥。</p> : keys.map(key => <div className="setting-row" key={key.id} style={{ gap: 12, flexWrap: 'wrap' }}>
      <div className="grow" style={{ minWidth: 160 }}>
        <div className="setting-label">{key.name} <code className="dim" style={{ fontSize: 12 }}>{key.prefix}…</code></div>
        <div className="setting-desc">{key.scopes.map(scope => SCOPES.find(item => item.id === scope)?.name).join(' · ')}</div>
        <div className="setting-desc">到期：{key.expiresAt ? date(key.expiresAt) : '长期有效'}{key.expiresAt && key.expiresAt <= Date.now() ? '（已过期）' : ''}<br />最近使用：{date(key.lastUsedAt)}</div>
      </div>
      <div className="row gap-8">{onEdit ? <button className="btn btn--sm" disabled={busy} onClick={() => onEdit(key)}>编辑</button> : null}
        <button className="btn btn--sm btn--ghost" disabled={busy} onClick={() => onRevoke(key)}><TrashIcon size={14} />删除</button></div>
    </div>)}
  </div>
}

function ApiGuide() {
  return <details className="card card--pad-lg device-api-guide">
    <summary style={{ cursor: 'pointer', fontWeight: 500 }}>API / MCP 接入说明与接口文档</summary>
    <div className="stack gap-14" style={{ marginTop: 18 }}>
      <p className="dim">JSON 接口使用设备密钥鉴权。将搜索返回的完整 song 对象传给播放或下载接口，保留平台专用字段。</p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, lineHeight: 1.7 }}>{`GET /api/v1/search?platform=wy&q=歌曲名&limit=20
Authorization: Bearer myk_你的设备密钥

POST /api/v1/playback
Authorization: Bearer myk_你的设备密钥
Content-Type: application/json

{"song": 搜索返回的歌曲对象, "quality": "320k", "fallback": true}`}</pre>
      <p className="dim">响应 url 为音源的完整直链，设备直接连接上游播放或下载，音频不经过本站。请勿向上游发送本站密钥。有效期、格式和 Range 支持由音源决定，过期后重新解析。</p>
      <p className="setting-desc">设备每次用 quality 指定音质（省略为 320k）。fallback 仅在传入 true 时自动向下寻找可用音质；传 false 或省略时不降级，所选音质不可用则返回错误。</p>
      <div style={{ overflowX: 'auto' }}><table className="device-api-table"><thead><tr><th>接口</th><th>用途</th></tr></thead><tbody>
        {[
          ['GET /api/v1/me', '账号、密钥权限、音质和下载额度'], ['GET /api/v1/capabilities', '平台、音质和设备能力'],
          ['GET /api/v1/search', '按 q、platform、page、limit 搜索'], ['POST /api/v1/playback', '在线播放；可通过 fallback 开启降级'],
          ['POST /api/v1/download', '获取下载地址，遵循账号下载额度'], ['POST /api/v1/lyrics', '原文、翻译和逐字歌词'],
          ['GET /api/v1/playlists', '自己的歌单列表'], ['GET /api/v1/playlists/{id}', '自己的歌单内容'], ['GET /api/v1/favorites', '分页读取我的喜欢'],
        ].map(([endpoint, purpose]) => <tr key={endpoint}><td><code style={{ whiteSpace: 'nowrap' }}>{endpoint}</code></td><td>{purpose}</td></tr>)}
      </tbody></table></div>
      <a className="btn btn--sm" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">打开完整 OpenAPI 3.0 文档</a>
      <p className="setting-desc">音质：128k / 320k / flac / flac24bit。错误为 error.code 和 error.message；401 表示密钥无效，403 表示未获授权或权限不足，429 表示频率或次数超限，502 表示所选音质不可用或音源失败。429 响应带 Retry-After。下载成功返回直链时扣次数，实际流量不经过本站；有流量额度的账号不开放直链下载。</p>
      <h3 style={{ fontSize: 15 }}>MCP 与小智 AI</h3>
      <p className="dim">支持 Streamable HTTP MCP，使用同一个设备密钥；工具按密钥权限显示。HTTP MCP 地址：</p>
      <code style={{ overflowWrap: 'anywhere' }}>{window.location.origin}/api/v1/mcp</code>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, lineHeight: 1.7 }}>{JSON.stringify({ mcpServers: { miyin: { type: 'http', url: window.location.origin + '/api/v1/mcp', headers: { Authorization: 'Bearer myk_你的设备密钥' } } } }, null, 2)}</pre>
      <p className="dim">小智后台给出 wss://… MCP 接入点时，使用随项目提供的桥接程序或 Docker 桥接容器。它会自动重连，只转发 MCP 工具消息，音频仍由设备直连音源。</p>
      <p className="setting-desc">可以调用搜歌、按歌名获取播放直链、下载直链、歌词和自己的歌单。MCP 返回链接后，需要设备固件支持 URL 音乐播放，才能真正从扬声器播出；接入本服务不会自动给固件添加解码播放器。</p>
      <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
        <a className="btn btn--sm" href="https://github.com/poouo/MiyinMusic/blob/main/docs/device-api.md" target="_blank" rel="noreferrer">完整 API 接入示例</a>
        <a className="btn btn--sm" href="https://github.com/poouo/MiyinMusic/blob/main/docs/xiaozhi-mcp.md" target="_blank" rel="noreferrer">小智 MCP 配置教程</a>
      </div>
    </div>
  </details>
}

export function DeviceApiSettings() {
  const toast = useToast()
  const [status, setStatus] = useState<DeviceApiStatus | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<DeviceScope[]>(['search', 'playback', 'lyrics', 'library'])
  const [expiry, setExpiry] = useState('90')
  const [editing, setEditing] = useState<DeviceKey | null>(null)
  const [secret, setSecret] = useState('')
  const [revoking, setRevoking] = useState<DeviceKey | null>(null)
  useEffect(() => {
    let cancelled = false
    setError('')
    api.deviceApi.status().then(data => { if (!cancelled) setStatus(data) }).catch((e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [attempt])
  const create = async () => {
    setBusy(true)
    try {
      const result = await api.deviceApi.create({ name: name.trim(), scopes, expiresInDays: expiry === 'never' ? null : Number(expiry) })
      setSecret(result.token); setName(''); setAttempt(value => value + 1)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const revoke = async () => {
    if (!revoking) return
    setBusy(true)
    try { await api.deviceApi.revoke(revoking.id); setRevoking(null); setAttempt(value => value + 1); toast.success('设备密钥已删除') }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await api.deviceApi.update(editing.id, { name: editing.name, scopes: editing.scopes })
      setEditing(null); setAttempt(value => value + 1); toast.success('设备配置已保存')
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(secret); toast.success('密钥已复制') }
    catch { toast.error('无法自动复制，请手动选择密钥复制') }
  }
  return <div className="stack gap-16">
    <div className="card card--pad-lg">
      <div className="row gap-12" style={{ flexWrap: 'wrap' }}><KeyIcon size={20} /><h2 style={{ fontSize: 18 }}>设备 API</h2><button className="btn btn--sm btn--ghost" onClick={() => setAttempt(value => value + 1)}><RefreshIcon size={14} />刷新</button></div>
      <p className="dim" style={{ margin: '14px 0' }}>为智能音箱、AI 硬件或自动化客户端创建独立凭据，API 与 MCP 共用。</p>
      {error ? <p role="alert">{error}</p> : !status ? <p className="dim">正在加载设备权限…</p> : <>
        <div className="setting-row"><div className="grow"><div className="setting-label">{status.access.allowed ? '已开放设备访问' : !status.access.enabled ? '管理员尚未开启设备 API' : '当前账号尚未获得 API 授权'}</div>
          <div className="setting-desc">每个账号每分钟 {status.access.requestsPerMinute} 次请求。音乐以直链返回，不占本站音频带宽。</div></div></div>
        {status.access.allowed ? <div className="stack gap-14" style={{ padding: '18px 0' }}>
          <label className="field">设备名称<input className="input" value={name} maxLength={60} placeholder="例如：客厅智能音箱" onChange={event => setName(event.target.value)} /></label>
          <div className="chip-row" role="group" aria-label="设备权限">{SCOPES.map(item => <button key={item.id} role="checkbox" aria-checked={scopes.includes(item.id)} className={'chip' + (scopes.includes(item.id) ? ' is-active' : '')}
            onClick={() => setScopes(current => current.includes(item.id) ? current.filter(scope => scope !== item.id) : [...current, item.id])}>{item.name}</button>)}</div>
          <div className="row gap-10" style={{ flexWrap: 'wrap' }}><Select aria-label="设备密钥有效期" value={expiry} onChange={setExpiry}
            options={[{ value: '30', label: '30 天' }, { value: '90', label: '90 天' }, { value: '365', label: '365 天' }, { value: 'never', label: '长期有效' }]} />
            <button className="btn btn--primary" disabled={busy || !name.trim() || !scopes.length} onClick={() => void create()}><PlusIcon size={16} />创建设备密钥</button></div>
        </div> : null}
        <DeviceKeys keys={status.keys} busy={busy} onRevoke={setRevoking} onEdit={setEditing} />
      </>}
    </div>
    <ApiGuide />
    <Modal open={!!secret} title="保存你的设备密钥" onClose={() => setSecret('')}>
      <div className="stack gap-16"><p className="dim">完整密钥仅显示这一次。请保存到设备端，关闭后无法找回；遗失时撤销并重新创建。</p>
        <code style={{ display: 'block', overflowWrap: 'anywhere', padding: 16, background: 'var(--accent-soft)', borderRadius: 14 }}>{secret}</code>
        <div className="row gap-10" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}><button className="btn" onClick={() => void copy()}>复制密钥</button><button className="btn btn--primary" onClick={() => setSecret('')}>已保存，关闭</button></div></div>
    </Modal>
    <Modal open={!!revoking} title="撤销设备密钥？" onClose={() => setRevoking(null)}><div className="stack gap-16">
      <p>「{revoking?.name}」将无法继续调用接口。已返回的上游音乐直链由音源决定何时失效。</p><button className="btn btn--primary" disabled={busy} onClick={() => void revoke()}>确认删除</button>
    </div></Modal>
    <Modal open={!!editing} title="编辑设备 API" onClose={() => setEditing(null)}>{editing ? <div className="stack gap-16">
      <label className="field">设备名称<input className="input" value={editing.name} maxLength={60} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
      <div className="chip-row" role="group" aria-label="编辑设备权限">{SCOPES.map(item => <button key={item.id} role="checkbox" aria-checked={editing.scopes.includes(item.id)} className={'chip' + (editing.scopes.includes(item.id) ? ' is-active' : '')}
        onClick={() => setEditing({ ...editing, scopes: editing.scopes.includes(item.id) ? editing.scopes.filter(scope => scope !== item.id) : [...editing.scopes, item.id] })}>{item.name}</button>)}</div>
      <p className="setting-desc">修改设备名称或权限无需更换密钥，保存后生效。</p>
      <button className="btn btn--primary" disabled={busy || !editing.name.trim() || !editing.scopes.length} onClick={() => void save()}>保存设备配置</button>
    </div> : null}</Modal>
  </div>
}

export function AdminDeviceApiSettings() {
  const toast = useToast()
  const [config, setConfig] = useState<DeviceApiConfig | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setError('')
    api.admin.config().then(data => { if (!cancelled) setConfig(data.config.deviceApi) }).catch((e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [attempt])
  const save = async () => {
    if (!config) return
    setSaving(true)
    try { const result = await api.admin.saveConfig({ deviceApi: config }); setConfig(result.config.deviceApi); toast.success('设备 API 设置已保存') }
    catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }
  return <div className="stack gap-16"><div className="admin-card glass">
    <div className="admin-card__head"><h3>设备 API / MCP 设置</h3></div>
    {error ? <div role="alert">{error}<button className="btn btn--sm" onClick={() => setAttempt(value => value + 1)}>重试</button></div> : !config ? <p>加载中…</p> : <>
      <div className="setting-row"><div className="grow"><div className="setting-label">开放设备 API / MCP</div><div className="setting-desc">关闭后停止 API、MCP 访问和直链签发，已创建的密钥保留；已返回的上游直链无法由本站撤销。</div></div>
        <button role="switch" aria-checked={config.enabled} aria-label="开放设备 API" className={'switch' + (config.enabled ? ' is-on' : '')} onClick={() => setConfig({ ...config, enabled: !config.enabled })} /></div>
      <div className="setting-row" style={{ flexWrap: 'wrap', gap: 12 }}><div className="grow"><div className="setting-label">默认允许的用户角色</div><div className="setting-desc">可在「用户管理 → 编辑用户 → 设备 API」单独允许或禁止某个账号。</div></div>
        <div className="chip-row">{(['user', 'vip', 'admin'] as UserRole[]).map(role => <button key={role} role="checkbox" aria-checked={config.roles.includes(role)} className={'chip' + (config.roles.includes(role) ? ' is-active' : '')}
          onClick={() => setConfig({ ...config, roles: config.roles.includes(role) ? config.roles.filter(item => item !== role) : [...config.roles, role] })}>{ROLE_NAMES[role]}</button>)}</div></div>
      <div className="setting-row"><div className="grow"><div className="setting-label">每账号每分钟请求数</div><div className="setting-desc">同一账号的所有设备共用；音频由设备直连音源，不占本站带宽。</div></div>
        <input className="input" aria-label="API 每分钟请求数" type="number" min={10} max={600} value={config.requestsPerMinute} style={{ width: 100 }} onChange={event => setConfig({ ...config, requestsPerMinute: Number(event.target.value) })} /></div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}><button className="btn btn--primary" disabled={saving || !Number.isInteger(config.requestsPerMinute) || config.requestsPerMinute < 10 || config.requestsPerMinute > 600} onClick={() => void save()}>{saving ? '保存中…' : '保存设置'}</button></div>
    </>}
  </div><ApiGuide /></div>
}

export function UserDeviceApiAccess({ userId }: { userId: string }) {
  const toast = useToast()
  const [data, setData] = useState<DeviceApiStatus | null>(null)
  const [mode, setMode] = useState<DeviceAccess['mode']>('inherit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setData(null); setError('')
    api.admin.deviceAccess(userId).then(result => { if (!cancelled) { setData(result); setMode(result.access.mode) } })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [userId, attempt])
  const save = async () => {
    setBusy(true)
    try { setData(await api.admin.saveDeviceAccess(userId, mode)); toast.success('用户设备 API 权限已保存') }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="stack gap-12" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
    <h3 style={{ fontSize: 15 }}>设备 API 权限</h3>
    {error ? <div role="alert">{error}<button className="btn btn--sm" onClick={() => setAttempt(value => value + 1)}>重试</button></div> : !data ? <p className="dim">加载中…</p> : <>
      <p className="setting-desc">{!data.access.enabled ? '设备 API 总开关已关闭。' : data.access.allowed ? '该用户可以使用设备 API。' : '该用户当前不能使用设备 API。'} 单独允许仍须开启总开关。</p>
      <div className="row gap-10" style={{ flexWrap: 'wrap' }}><Select aria-label="用户设备 API 权限" value={mode} onChange={value => setMode(value as DeviceAccess['mode'])}
        options={[{ value: 'inherit', label: '遵循角色设置' }, { value: 'allow', label: '单独允许' }, { value: 'deny', label: '单独禁止' }]} />
        <button className="btn btn--sm" disabled={busy || data.access.mode === mode} onClick={() => void save()}>保存 API 权限</button></div>
      <DeviceKeys keys={data.keys} busy={busy} onRevoke={key => {
        setBusy(true)
        void api.admin.revokeDeviceKey(userId, key.id).then(() => { setAttempt(value => value + 1); toast.success('设备密钥已撤销') })
          .catch((e: Error) => toast.error(e.message)).finally(() => setBusy(false))
      }} />
    </>}
  </div>
}
