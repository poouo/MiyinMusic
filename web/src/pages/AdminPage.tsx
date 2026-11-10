import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { AdminPlaylists } from '../components/AdminPlaylists'
import { Select } from '../components/Select'
import { AdminFavorites } from '../components/AdminFavorites'
import { MembershipSettings } from '../components/MembershipSettings'
import { formatCount, initials, timeAgo } from '../lib/format'
import {
  AUDIENCE_NAMES,
  QUALITY_NAMES,
  PLATFORM_NAMES,
  ROLE_NAMES,
  type AdminOverview,
  type AdminUser,
  type AdminUserList,
  type Audience,
  type AuditEntry,
  type CacheConfig,
  type CacheStats,
  type DownloadConfig,
  type MembershipConfig,
  type AccessInfo,
  type Quality,
  type SourceInfo,
  type UserRole,
} from '../lib/types'
import { useAuth } from '../state/auth'
import { useAppConfig } from '../state/appConfig'
import { useToast } from '../state/toast'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import {
  ActivityIcon,
  AlertIcon,
  ArrowLeftIcon,
  BanIcon,
  CheckIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  CrownIcon,
  DatabaseIcon,
  DownloadIcon,
  FileTextIcon,
  HeartIcon,
  KeyIcon,
  LoaderIcon,
  LockIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  ServerIcon,
  ShieldIcon,
  TrashIcon,
  UsersIcon,
} from '../components/Icons'

type Section = 'favorites' | 'playlists' | 'overview' | 'users' | 'sources' | 'site' | 'download' | 'cache' | 'audit'

const SECTIONS: { id: Section; label: string; icon: typeof UsersIcon }[] = [
  { id: 'overview', label: '概览', icon: ActivityIcon },
  { id: 'users', label: '用户管理', icon: UsersIcon },
  { id: 'playlists', label: '歌单管理', icon: FileTextIcon },
  { id: 'favorites', label: '用户收藏', icon: HeartIcon },
  { id: 'sources', label: '音源', icon: ServerIcon },
  { id: 'site', label: '站点设置', icon: LockIcon },
  { id: 'download', label: '会员与权限', icon: CrownIcon },
  { id: 'cache', label: '音乐缓存', icon: DatabaseIcon },
  { id: 'audit', label: '操作日志', icon: FileTextIcon },
]

const AUDIT_LABELS: Record<string, string> = {
  'user.register': '注册',
  'user.login': '登录',
  'user.login.fail': '登录失败',
  'user.password': '修改密码',
  'user.download': '下载',
  'admin.user.create': '后台新建用户',
  'admin.user.password': '后台重置密码',
  'admin.user.role': '后台修改角色',
  'admin.user.status': '后台启停用户',
  'admin.user.rename': '后台修改昵称',
  'admin.user.delete': '后台删除用户',
  'admin.playlist.create': '新建用户歌单',
  'admin.playlist.update': '修改用户歌单',
  'admin.playlist.delete': '删除用户歌单',
  'admin.playlist.copy': '复制用户歌单',
  'admin.playlist.removeSong': '移除歌单歌曲',
  'admin.user.logout': '强制退出用户',
  'admin.config': '后台修改站点配置',
  'admin.quota.reset': '重置下载额度',
  'admin.unlock': '后台解除锁定',
}

const ROLES: UserRole[] = ['admin', 'vip', 'user']

function RoleChip({ role }: { role: UserRole }) {
  return <span className={'role-chip' + (role === 'admin' ? ' is-admin' : role === 'vip' ? ' is-vip' : '')}>{ROLE_NAMES[role]}</span>
}

function NotFound() {
  return (
    <div className="admin-notfound">
      <EmptyState
        icon={<AlertIcon size={24} />}
        title="页面不存在"
        description="你访问的页面可能已经被移动或删除了。"
        action={
          <button className="btn btn--sm" onClick={() => window.location.assign('/')}>
            <ArrowLeftIcon size={15} /> 回到首页
          </button>
        }
      />
    </div>
  )
}

export function AdminPage() {
  const auth = useAuth()
  if (auth.loading) return <div className="admin-loading">正在验证登录状态…</div>
  if (!auth.user) return <AdminLogin />
  if (auth.user.role !== 'admin') return <div className="stack gap-16"><NotFound /><button className="btn" onClick={() => void auth.logout()}>切换管理员账号</button></div>
  return <AdminPanel />
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat-card glass">
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value}</div>
      {hint ? <div className="stat-card__hint">{hint}</div> : null}
    </div>
  )
}

function AdminPanel() {
  const auth = useAuth()
  const [section, setSection] = useState<Section>('overview')
  const [playlistUser, setPlaylistUser] = useState<AdminUser | null>(null)
  const [favoriteUser, setFavoriteUser] = useState<AdminUser | null>(null)

  return (
    <div className="fade-in admin">
      <div className="page-head">
        <div>
          <h1 className="page-title">
            <ShieldIcon size={22} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            管理后台
          </h1>
          <p className="page-sub">当前管理员：{auth.user?.nickname}</p>
        </div>
        <button className="btn btn--sm btn--ghost" onClick={() => void auth.logout()}>退出后台</button>
        <button className="btn btn--sm btn--ghost" onClick={() => window.location.assign('/')}>
          <ArrowLeftIcon size={15} /> 返回前台
        </button>
      </div>

      <div className="admin-layout">
        <aside className="admin-nav">
          {SECTIONS.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={'admin-nav__item' + (section === item.id ? ' is-active' : '')}
                onClick={() => setSection(item.id)}
              >
                <Icon size={17} />
                {item.label}
              </button>
            )
          })}
        </aside>

        <div className="admin-body">
          {section === 'overview' ? <OverviewSection onJump={setSection} /> : null}
          {section === 'users' ? <UsersSection onPlaylists={user => { setPlaylistUser(user); setSection('playlists') }} onFavorites={user => { setFavoriteUser(user); setSection('favorites') }} /> : null}
          {section === 'playlists' ? <AdminPlaylists initialUser={playlistUser} /> : null}
          {section === 'favorites' ? <AdminFavorites initialUser={favoriteUser} /> : null}
          {section === 'sources' ? <SourcesSection /> : null}
          {section === 'site' ? <SiteSection /> : null}
          {section === 'download' ? <DownloadSection /> : null}
          {section === 'cache' ? <CacheSection /> : null}
          {section === 'audit' ? <AuditSection /> : null}
        </div>
      </div>
    </div>
  )
}

function OverviewSection({ onJump }: { onJump: (section: Section) => void }) {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [system, setSystem] = useState<{ node: string; platform: string; arch: string; uptime: number; memory: { rss: number } } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.admin
      .overview()
      .then((result) => !cancelled && setData(result))
      .catch((err: Error) => !cancelled && setError(err.message))
    api.admin
      .system()
      .then((result) => !cancelled && setSystem(result))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [attempt])

  if (error) {
    return (
      <EmptyState
        icon={<AlertIcon size={22} />}
        title="概览加载失败"
        description={error}
        action={
          <button
            className="btn btn--sm"
            onClick={() => {
              setError(null)
              setData(null)
              setAttempt((prev) => prev + 1)
            }}
          >
            <RefreshIcon size={14} /> 重试
          </button>
        }
      />
    )
  }
  if (!data) return <div className="admin-loading"><LoaderIcon size={18} /> 加载中…</div>

  const maxSeries = Math.max(1, ...data.series.map((item) => item.count))
  const maxPlatform = Math.max(1, ...data.platforms.map((item) => item.count))
  const dbSize = ((data.database.bytes + data.database.walBytes) / 1024 / 1024).toFixed(1)

  return (
    <div className="stack gap-18">
      <div className="stat-grid">
        <StatCard label="用户总数" value={formatCount(data.stats.users)} hint={'今天新增 ' + data.stats.newUsersToday} />
        <StatCard label="在线会话" value={formatCount(data.stats.sessions)} hint={'今日登录 ' + data.stats.loginsToday} />
        <StatCard label="播放记录" value={formatCount(data.stats.history)} hint={'今日播放 ' + data.stats.playsToday} />
        <StatCard label="收藏 / 歌单" value={data.stats.favorites + ' / ' + data.stats.playlists} hint={'今日收藏 ' + data.stats.favoritesToday} />
      </div>

      <div className="admin-cols">
        <div className="admin-card glass">
          <div className="admin-card__head">
            <div className="admin-card__title">近 7 天注册</div>
            <div className="faint" style={{ fontSize: 12 }}>共 {data.series.reduce((sum, item) => sum + item.count, 0)} 人</div>
          </div>
          <div className="bar-chart">
            {data.series.map((item) => (
              <div key={item.date} className="bar-chart__item">
                <div className="bar-chart__value">{item.count || ''}</div>
                <div className="bar-chart__bar" style={{ height: Math.max(4, (item.count / maxSeries) * 100) + '%' }} />
                <div className="bar-chart__label">{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="admin-card glass">
          <div className="admin-card__head">
            <div className="admin-card__title">播放平台分布</div>
          </div>
          {data.platforms.length === 0 ? (
            <div className="faint" style={{ fontSize: 12.5 }}>还没有播放记录</div>
          ) : (
            <div className="stack gap-10">
              {data.platforms.map((item) => (
                <div key={item.platform} className="hbar">
                  <span className="hbar__label">{PLATFORM_NAMES[item.platform as keyof typeof PLATFORM_NAMES] ?? item.platform}</span>
                  <span className="hbar__track">
                    <span className="hbar__fill" style={{ width: (item.count / maxPlatform) * 100 + '%' }} />
                  </span>
                  <span className="hbar__value">{item.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="admin-cols">
        <div className="admin-card glass">
          <div className="admin-card__head">
            <div className="admin-card__title">最近注册</div>
            <button className="section__more" onClick={() => onJump('users')}>管理用户</button>
          </div>
          <div className="stack gap-10">
            {data.recentUsers.map((user) => (
              <div key={user.id} className="admin-mini-row">
                <div className="avatar" style={{ width: 28, height: 28, fontSize: 12, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  {initials(user.nickname)}
                </div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>
                    {user.nickname}
                    {user.role === 'admin' ? <CrownIcon size={11} style={{ marginLeft: 5, color: 'var(--gold)' }} /> : null}
                  </div>
                  <div className="faint ellipsis" style={{ fontSize: 11 }}>
                    @{user.username} · {timeAgo(user.createdAt)}
                  </div>
                </div>
                {user.status === 'disabled' ? <span className="tag tag--platform">已停用</span> : null}
              </div>
            ))}
          </div>
        </div>

        <div className="admin-card glass">
          <div className="admin-card__head">
            <div className="admin-card__title">运行状态</div>
            <button className="section__more" onClick={() => onJump('sources')}>音源</button>
          </div>
          <div className="admin-kv"><span>音源</span><span>{data.sources.ready} / {data.sources.total} 可用</span></div>
          <div className="admin-kv"><span>数据库</span><span>{dbSize} MB · SQLite WAL</span></div>
          <div className="admin-kv admin-kv--stack">
            <span>数据表行数</span>
            <span>
              {data.database.tables
                .filter((table) => ['users', 'playlists', 'favorites', 'history'].includes(table.name))
                .map((table) => (
                  <span key={table.name} className="row-chip">{table.name} {formatCount(table.rows)}</span>
                ))}
            </span>
          </div>
          {system ? (
            <>
              <div className="admin-kv"><span>Node</span><span>{system.node} · {system.platform}/{system.arch}</span></div>
              <div className="admin-kv"><span>运行时长</span><span>{Math.floor(system.uptime / 60)} 分钟 · 内存 {(system.memory.rss / 1024 / 1024).toFixed(0)} MB</span></div>
            </>
          ) : null}
        </div>
      </div>

      <div className="admin-card glass">
        <div className="admin-card__head">
          <div className="admin-card__title">最近操作</div>
          <button className="section__more" onClick={() => onJump('audit')}>全部日志</button>
        </div>
        <div className="stack gap-6">
          {data.audit.slice(0, 6).map((entry) => (
            <div key={entry.id} className="admin-mini-row">
              <span className="audit-dot" />
              <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 86 }}>{AUDIT_LABELS[entry.action] ?? entry.action}</span>
              <span className="grow ellipsis dim" style={{ fontSize: 12.5 }}>{entry.detail || entry.username || '—'}</span>
              <span className="faint" style={{ fontSize: 11 }}>{timeAgo(entry.createdAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function UsersSection({ onPlaylists, onFavorites }: { onPlaylists: (user: AdminUser) => void; onFavorites: (user: AdminUser) => void }) {
  const toast = useToast()
  const auth = useAuth()
  const [list, setList] = useState<AdminUserList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [editRole, setEditRole] = useState<UserRole>('user')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null)
  const [creating, setCreating] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', password: '', nickname: '', role: 'user' as UserRole })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.admin.users({ q, role, status, page, limit: 15 })
      setList(result)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
      toast.error('加载用户失败：' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [q, role, status, page, toast])

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250)
    return () => clearTimeout(timer)
  }, [load])

  const act = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn()
      toast.success(message)
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const create = async () => {
    if (!newUser.username.trim() || newUser.password.length < 6) {
      toast.error('用户名不能为空，密码至少 6 位')
      return
    }
    try {
      await api.admin.createUser({
        username: newUser.username.trim(),
        password: newUser.password,
        nickname: newUser.nickname.trim() || undefined,
        role: newUser.role,
      })
      toast.success('用户已创建')
      setCreating(false)
      setNewUser({ username: '', password: '', nickname: '', role: 'user' })
      await load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="stack gap-16">
      <div className="admin-toolbar glass">
        <div className="admin-search">
          <SearchIcon size={16} />
          <input value={q} onChange={(event) => { setQ(event.target.value); setPage(1) }} placeholder="搜索用户名或昵称" />
        </div>
        <Select className="admin-select" aria-label="筛选用户角色" value={role} onChange={value => { setRole(value); setPage(1) }}
          options={[{ value: '', label: '全部角色' }, { value: 'admin', label: '管理员' }, { value: 'vip', label: '会员' }, { value: 'user', label: '普通用户' }]} />
        <Select className="admin-select" aria-label="筛选用户状态" value={status} onChange={value => { setStatus(value); setPage(1) }}
          options={[{ value: '', label: '全部状态' }, { value: 'active', label: '正常' }, { value: 'disabled', label: '已停用' }]} />
        <button className="btn btn--sm btn--ghost" onClick={() => void load()} disabled={loading}>
          <RefreshIcon size={14} /> 刷新
        </button>
        <button
          className="btn btn--sm btn--ghost"
          title="清空所有登录失败计数"
          onClick={() => void act(() => api.admin.unlockAll(), '已解除全部登录锁定')}
        >
          <LockIcon size={14} /> 解除锁定
        </button>
        <button className="btn btn--sm btn--primary" onClick={() => setCreating(true)}>
          <PlusIcon size={14} /> 新建用户
        </button>
      </div>

      {!list ? (
        error ? (
          <EmptyState
            icon={<AlertIcon size={22} />}
            title="用户列表加载失败"
            description={error}
            action={
              <button className="btn btn--sm" onClick={() => void load()}>
                <RefreshIcon size={14} /> 重试
              </button>
            }
          />
        ) : (
          <div className="admin-loading"><LoaderIcon size={18} /> 加载中…</div>
        )
      ) : list.users.length === 0 ? (
        <EmptyState icon={<UsersIcon size={22} />} title="没有符合条件的用户" />
      ) : (
        <>
          <div className="admin-table-wrap glass">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th className="num">歌单</th>
                  <th className="num">收藏</th>
                  <th>最后登录</th>
                  <th className="right">操作</th>
                </tr>
              </thead>
              <tbody>
                {list.users.map((user) => {
                  const self = user.id === auth.user?.id
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="admin-user">
                          <div className="avatar" style={{ width: 30, height: 30, fontSize: 12, background: user.avatarColor }}>
                            {initials(user.nickname)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div className="ellipsis" style={{ fontWeight: 600 }}>
                              {user.nickname}
                              {self ? <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>（你）</span> : null}
                            </div>
                            <div className="faint ellipsis" style={{ fontSize: 11 }}>
                              @{user.username} · 注册于 {timeAgo(user.createdAt)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td><RoleChip role={user.role} /></td>
                      <td>
                        <span className={'status-chip' + (user.status === 'disabled' ? ' is-off' : '')}>
                          {user.status === 'disabled' ? '已停用' : '正常'}
                        </span>
                      </td>
                      <td className="num"><button className="btn btn--sm btn--ghost" onClick={() => onPlaylists(user)} title="查看用户歌单">{user.playlists} · 查看</button></td>
                      <td className="num"><button className="btn btn--sm btn--ghost" onClick={() => onFavorites(user)} title="查看用户收藏">{user.favorites} · 查看</button></td>
                      <td className="faint" style={{ fontSize: 12 }}>{user.lastLoginAt ? timeAgo(user.lastLoginAt) : '从未登录'}</td>
                      <td>
                        <div className="admin-actions">
                          <button
                            className="icon-btn"
                            title="编辑"
                            onClick={() => {
                              setEditing(user)
                              setEditRole(user.role)
                              setNickname(user.nickname)
                              setPassword('')
                            }}
                          >
                            <FileTextIcon size={15} />
                          </button>
                          <button
                            className="icon-btn"
                            title={user.role === 'admin' ? '降为普通用户' : '设为管理员'}
                            disabled={self}
                            onClick={() => void act(() => api.admin.updateUser(user.id, { role: user.role === 'admin' ? 'user' : 'admin' }), '角色已更新')}
                          >
                            <CrownIcon size={15} />
                          </button>
                          <button
                            className="icon-btn"
                            title={user.status === 'disabled' ? '启用' : '停用'}
                            disabled={self}
                            onClick={() => void act(() => api.admin.updateUser(user.id, { status: user.status === 'disabled' ? 'active' : 'disabled' }), '状态已更新')}
                          >
                            <BanIcon size={15} />
                          </button>
                          <button className="icon-btn" title="强制下线" onClick={() => void act(() => api.admin.revokeSessions(user.id), '已强制下线')}>
                            <KeyIcon size={15} />
                          </button>
                          <button className="icon-btn" title="解除登录锁定" onClick={() => void act(() => api.admin.unlockUser(user.id), '已解除锁定')}>
                            <LockIcon size={15} />
                          </button>
                          <button className="icon-btn admin-danger" title="删除" disabled={self} onClick={() => setConfirmDelete(user)}>
                            <TrashIcon size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="admin-pager">
            <span className="faint" style={{ fontSize: 12.5 }}>共 {list.total} 位用户 · 第 {list.page} 页</span>
            <div className="row gap-8">
              <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>上一页</button>
              <button className="btn btn--sm" disabled={!list.hasMore} onClick={() => setPage((prev) => prev + 1)}>下一页</button>
            </div>
          </div>
        </>
      )}

      <Modal open={creating} title="新建用户" onClose={() => setCreating(false)}>
        <div className="stack gap-14">
          <div className="field">
            <label>用户名</label>
            <input className="input" value={newUser.username} onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} placeholder="3-24 位字母、数字或下划线" />
          </div>
          <div className="field">
            <label>昵称（可选）</label>
            <input className="input" value={newUser.nickname} maxLength={24} onChange={(event) => setNewUser({ ...newUser, nickname: event.target.value })} />
          </div>
          <div className="field">
            <label>初始密码</label>
            <input className="input" type="password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} placeholder="至少 6 位" />
          </div>
          <div className="field">
            <label>角色</label>
            <div className="role-select">
              {ROLES.map((item) => (
                <button key={item} className={'role-pick' + (newUser.role === item ? ' is-active' : '')} onClick={() => setNewUser({ ...newUser, role: item })}>
                  {ROLE_NAMES[item]}
                </button>
              ))}
            </div>
          </div>
          <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost" onClick={() => setCreating(false)}>取消</button>
            <button className="btn btn--primary" onClick={() => void create()}>创建</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editing} title={editing ? '编辑「' + editing.username + '」' : ''} onClose={() => setEditing(null)}>
        {editing ? (
          <div className="stack gap-14">
            <div className="field">
              <label>昵称</label>
              <input className="input" value={nickname} maxLength={24} onChange={(event) => setNickname(event.target.value)} />
            </div>
            <div className="field">
              <label>角色</label>
              <div className="role-select">
                {ROLES.map((item) => (
                  <button
                    key={item}
                    className={'role-pick' + (editRole === item ? ' is-active' : '')}
                    disabled={editing.id === auth.user?.id}
                    onClick={() => setEditRole(item)}
                  >
                    {ROLE_NAMES[item]}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>重置密码（留空表示不改）</label>
              <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位" />
            </div>
            <UserDownloadUsage userId={editing.id} />
            <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => setEditing(null)}>取消</button>
              <button
                className="btn btn--primary"
                onClick={() => {
                  const tasks: Promise<unknown>[] = []
                  if (nickname.trim() && nickname.trim() !== editing.nickname) tasks.push(api.admin.updateUser(editing.id, { nickname: nickname.trim() }))
                  if (editRole !== editing.role) tasks.push(api.admin.updateUser(editing.id, { role: editRole }))
                  if (password.length >= 6) tasks.push(api.admin.resetPassword(editing.id, password))
                  if (!tasks.length) {
                    setEditing(null)
                    return
                  }
                  void act(async () => {
                    await Promise.all(tasks)
                  }, '已保存').then(() => setEditing(null))
                }}
              >
                保存
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={!!confirmDelete} title="删除用户" onClose={() => setConfirmDelete(null)}>
        <div className="stack gap-16">
          <div>
            确定删除 <b>{confirmDelete?.nickname}</b>（@{confirmDelete?.username}）吗？
            <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>该用户的歌单、收藏、播放记录与会话会一并删除，且无法恢复。</div>
          </div>
          <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost" onClick={() => setConfirmDelete(null)}>取消</button>
            <button
              className="btn btn--danger"
              onClick={() => {
                const target = confirmDelete
                setConfirmDelete(null)
                if (target) void act(() => api.admin.deleteUser(target.id), '用户已删除')
              }}
            >
              删除
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function SourcesSection() {
  const toast = useToast()
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedIds, setSavedIds] = useState<string[]>([])
  const [dragged, setDragged] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const dirty = sources.map(s => s.id).join(',') !== savedIds.join(',')
  const busy = loading || saving

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.sources()
      setSources(result.sources)
      setSavedIds(result.sources.map(s => s.id))
    } catch (err) {
      toast.error('加载音源失败：' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const move = (id: string, targetId: string) => {
    if (busy || id === targetId) return
    setSources(current => {
      const from = current.findIndex(s => s.id === id)
      const to = current.findIndex(s => s.id === targetId)
      if (from < 0 || to < 0) return current
      const next = [...current]
      next.splice(to, 0, next.splice(from, 1)[0])
      return next
    })
  }
  const save = async () => {
    setSaving(true)
    try {
      const result = await api.reorderSources(sources.map(s => s.id))
      setSources(result.sources)
      setSavedIds(result.sources.map(s => s.id))
      toast.success('音源优先级已保存，下次解析生效')
    } catch (error) { toast.error('保存失败：' + (error as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="stack gap-16">
      <div className="admin-toolbar glass">
        <div className="grow">
          <div style={{ fontWeight: 700 }}>音源脚本</div>
          <div className="faint" style={{ fontSize: 12 }}>拖动手柄或点击上下箭头排序，靠前的音源优先尝试；响应慢时自动尝试后备音源。</div>
        </div>
        {dirty && <button className="btn btn--sm btn--primary" onClick={() => void save()} disabled={busy}>{saving ? '保存中…' : '保存优先级'}</button>}
        <button className="btn btn--sm" onClick={() => void load()} disabled={busy}>
          <RefreshIcon size={14} /> {dirty ? '撤销排序' : '刷新'}
        </button>
      </div>

      <div className="admin-table-wrap glass">
        <table className="admin-table">
          <thead>
            <tr><th>优先级</th><th>音源</th><th>平台</th><th>状态</th><th className="right">操作</th></tr>
          </thead>
          <tbody>
            {sources.map((source, index) => (
              <tr key={source.id}
                className={(dragged === source.id ? 'source-row--dragging ' : '') + (dropTarget === source.id ? 'source-row--target' : '')}
                onDragOver={event => { if (dragged && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(source.id) } }}
                onDrop={event => { event.preventDefault(); if (dragged) move(dragged, source.id); setDragged(null); setDropTarget(null) }}
              >
                <td>
                  <div className="source-priority">
                    <button className="icon-btn source-drag" draggable={!busy} disabled={busy}
                      aria-label={'拖动调整 ' + source.name + ' 的优先级'} title="拖动排序，也可以使用右侧上下箭头"
                      onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', source.id); setDragged(source.id) }}
                      onDragEnd={() => { setDragged(null); setDropTarget(null) }}
                    ><svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">{[5, 10, 15].map(y => <g key={y}><circle cx="5" cy={y} r="1.3" /><circle cx="11" cy={y} r="1.3" /></g>)}</svg></button>
                    <span className="source-rank">{index + 1}</span>
                    <div className="source-priority__steps">
                      <button className="icon-btn" disabled={busy || index === 0} aria-label={'提高 ' + source.name + ' 的优先级'} onClick={() => move(source.id, sources[index - 1].id)}><ChevronUpIcon size={14} /></button>
                      <button className="icon-btn" disabled={busy || index === sources.length - 1} aria-label={'降低 ' + source.name + ' 的优先级'} onClick={() => move(source.id, sources[index + 1].id)}><ChevronDownIcon size={14} /></button>
                    </div>
                  </div>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{source.name}</div>
                  <div className="faint" style={{ fontSize: 11 }}>
                    {source.kind === 'custom' ? '自定义 · ' : ''}
                    {source.meta.version ? 'v' + source.meta.version.replace(/^v/i, '') : source.id}
                  </div>
                </td>
                <td className="dim" style={{ fontSize: 12 }}>
                  {source.status === 'ready'
                    ? source.platforms.filter((item) => item.actions.includes('musicUrl')).map((item) => PLATFORM_NAMES[item.platform]).join(' · ')
                    : '—'}
                </td>
                <td>
                  <span className={'status-chip' + (source.status === 'ready' ? '' : ' is-off')}>
                    {source.status === 'ready' ? '已就绪' : source.status === 'loading' ? '加载中' : '不可用'}
                  </span>
                  <div className="faint" style={{ fontSize: 11, marginTop: 5 }}>解析成功 {source.stats.ok} · 失败 {source.stats.fail}</div>
                </td>
                <td>
                  <div className="admin-actions">
                    <button className="icon-btn" title={dirty ? '请先保存或撤销排序' : '重新加载'} disabled={busy || dirty} onClick={() => void api.reloadSource(source.id).then(load).catch((err: Error) => toast.error(err.message))}>
                      <RefreshIcon size={15} />
                    </button>
                    <button
                      className={'switch' + (source.enabled ? ' is-on' : '')}
                      disabled={busy || dirty}
                      onClick={() => void api.updateSource(source.id, { enabled: !source.enabled }).then(load).catch((err: Error) => toast.error(err.message))}
                      aria-label="启用音源"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function UserDownloadUsage({ userId }: { userId: string }) {
  const toast = useToast()
  const [access, setAccess] = useState<AccessInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setAccess(null)
    api.admin.userAccess(userId).then(result => !cancelled && setAccess(result))
      .catch(error => !cancelled && setError((error as Error).message))
    return () => { cancelled = true }
  }, [userId])
  const reset = async () => {
    setBusy(true)
    try { setAccess(await api.admin.resetUserQuota(userId)); toast.success('下载额度已重置') }
    catch (error) { toast.error((error as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="field">
    <label>下载用量</label>
    {access ? <>
      <div className="dim" style={{ fontSize: 13, lineHeight: 1.8 }}>
        今日 {access.usage.day.downloads} / {access.dailyDownloads ?? '不限'} 次 · {formatBytes(access.usage.day.bytes)} / {access.dailyBytes === null ? '不限' : formatBytes(access.dailyBytes)}<br />
        本月 {access.usage.month.downloads} / {access.monthlyDownloads ?? '不限'} 次 · {formatBytes(access.usage.month.bytes)} / {access.monthlyBytes === null ? '不限' : formatBytes(access.monthlyBytes)}
      </div>
      <button className="btn btn--sm btn--ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void reset()}>{busy ? '重置中…' : '重置下载额度'}</button>
    </> : <span className="dim">{error || '加载中…'}</span>}
  </div>
}

function useAdminConfig(section: 'site' | 'membership' | 'cache') {
  const toast = useToast()
  const appConfig = useAppConfig()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [registration, setRegistration] = useState(true)
  const [download, setDownload] = useState<DownloadConfig | null>(null)
  const [cache, setCache] = useState<CacheConfig | null>(null)
  const [membership, setMembership] = useState<MembershipConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    api.admin
      .config()
      .then((result) => {
        if (cancelled) return
        setRegistration(result.config.registration.enabled)
        setDownload(result.config.download)
        setCache(result.config.cache)
        setMembership(result.config.membership)
      })
      .catch((err: Error) => toast.error(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [toast])

  const save = async () => {
    if (!download || !cache || !membership) return
    setSaving(true)
    try {
      const result = await api.admin.saveConfig(section === 'site' ? { registration: { enabled: registration } }
        : section === 'cache' ? { cache } : { membership })
      setRegistration(result.config.registration.enabled)
      setDownload(result.config.download)
      setCache(result.config.cache)
      setMembership(result.config.membership)
      void appConfig.refresh()
      toast.success('设置已保存')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return { loading, saving, registration, setRegistration, download, setDownload, cache, setCache, membership, setMembership, save }
}

function SiteSection() {
  const { loading, saving, registration, setRegistration, save } = useAdminConfig('site')

  if (loading) return <div className="admin-loading"><LoaderIcon size={18} /> 加载中…</div>

  return (
    <div className="stack gap-16">
      <div className="admin-card glass">
        <div className="admin-card__head">
          <div>
            <div className="admin-card__title">开放注册</div>
            <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
              关闭后登录弹窗不再显示「注册」，接口也会拒绝新用户注册。
            </div>
          </div>
          <button
            className={'switch' + (registration ? ' is-on' : '')}
            onClick={() => setRegistration(!registration)}
            aria-label="开放注册"
          />
        </div>
        <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn--primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存设置'}
          </button>
        </div>
      </div>

      <div className="admin-card glass">
        <div className="admin-card__head"><div className="admin-card__title">角色说明</div></div>
        <div className="dim" style={{ fontSize: 13, lineHeight: 1.9 }}>
          · 游客：未登录，可浏览与在线播放，权限在「会员与权限」配置。<br />
          · 普通用户：自行注册的账号。<br />
          · 会员：由管理员在用户管理里指定，权限在「会员与权限」配置。<br />
          · 管理员：可进入本后台，默认拥有全部权限。
        </div>
      </div>
    </div>
  )
}

function DownloadSection() {
  const { loading, saving, membership, setMembership, save } = useAdminConfig('membership')
  if (loading || !membership) return <div className="admin-loading"><LoaderIcon size={18} /> 加载中…</div>
  return <MembershipSettings value={membership} onChange={setMembership} saving={saving} onSave={() => void save()} />
}

function formatBytes(bytes: number): string {
  const n = Number(bytes) || 0
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2).replace(/\.00$/, '') + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1).replace(/\.0$/, '') + ' MB'
  if (n >= 1024) return Math.round(n / 1024) + ' KB'
  return n + ' B'
}

function CacheSection() {
  const toast = useToast()
  const { loading, saving, cache, setCache, save } = useAdminConfig('cache')
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const result = await api.admin.cache()
      setStats(result.cache)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }, [toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading || !cache) return <div className="admin-loading"><LoaderIcon size={18} /> 加载中…</div>

  const gb = Math.round((cache.maxBytes / 1024 / 1024 / 1024) * 10) / 10
  const usedPercent = stats && stats.maxBytes > 0 ? Math.min(100, (stats.bytes / stats.maxBytes) * 100) : 0

  const setGb = (value: number) => {
    if (!Number.isFinite(value)) return
    const safe = Math.min(4096, Math.max(1, Math.round(value)))
    setCache({ ...cache, maxBytes: safe * 1024 ** 3 })
  }

  const clearCache = async () => {
    if (!window.confirm('确定清空服务端音频和歌词缓存吗？')) return
    setBusy(true)
    try {
      const result = await api.admin.clearCache()
      toast.success('已清空 ' + result.removed.removed + ' 项缓存，释放 ' + formatBytes(result.removed.bytes))
      await refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const warmCache = async () => {
    setBusy(true)
    try {
      const result = await api.admin.warmCache()
      toast.success('已加入预热队列：' + result.queued + ' 首')
      await refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack gap-16">
      <div className="admin-card glass">
        <div className="admin-card__head">
          <div>
            <div className="admin-card__title">服务端音乐缓存</div>
            <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
              保存全部可用音质和歌词，同一首歌由所有用户共享缓存。
            </div>
          </div>
          <button
            className={'switch' + (cache.enabled ? ' is-on' : '')}
            onClick={() => setCache({ ...cache, enabled: !cache.enabled })}
            aria-label="缓存开关"
          />
        </div>
        <div className="admin-card__head" style={{ marginTop: 14 }}>
          <div>
            <div className="admin-card__title">收藏 / 歌单自动缓存</div>
            <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
              收藏、加入歌单和服务启动后自动补齐缓存。
            </div>
          </div>
          <button
            className={'switch' + (cache.warmCollections ? ' is-on' : '')}
            onClick={() => setCache({ ...cache, warmCollections: !cache.warmCollections })}
            aria-label="自动缓存歌单"
          />
        </div>
      </div>

      <div className="admin-card glass">
        <div className="admin-card__head">
          <div>
            <div className="admin-card__title">缓存总容量（自定义）</div>
            <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
              按你的存储空间自由填写，最大 4096 GB；4TB NAS 建议先设 2048 GB，给系统和其他数据留余量。
            </div>
          </div>
          <div className="row gap-8" style={{ alignItems: 'center' }}>
            <input
              className="input"
              type="number"
              min={1}
              max={4096}
              step={1}
              value={gb}
              onChange={(event) => setGb(Number(event.target.value))}
              style={{ width: 110, height: 36 }}
            />
            <span className="faint" style={{ fontSize: 12.5 }}>GB</span>
          </div>
        </div>
        <div className="row gap-8" style={{ flexWrap: 'wrap', marginTop: 10 }}>
          {[64, 128, 256, 512, 1024, 2048, 4096].map((size) => (
            <button
              key={size}
              className={'chip' + (Math.abs(gb - size) < 0.05 ? ' is-active' : '')}
              onClick={() => setGb(size)}
            >
              {size >= 1024 ? (size / 1024) + ' TB' : size + ' GB'}
            </button>
          ))}
        </div>

        <div className="cache-bar">
          <div className="cache-bar__fill" style={{ width: usedPercent + '%' }} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span className="dim" style={{ fontSize: 12.5 }}>
            {stats ? '已用 ' + formatBytes(stats.bytes) + ' · ' + stats.count + ' 个音频文件（上限 ' + formatBytes(cache.maxBytes) + '）' : '正在读取缓存统计…'}
            {stats ? ' · ' + (stats.lyricCount ?? 0) + ' 首歌词' : ''}
            {stats && stats.warming > 0 ? ' · ' + stats.warming + ' 首排队中' : ''}
          </span>
          <div className="row gap-8">
            <button className="btn btn--sm btn--ghost" onClick={() => void refresh()}>刷新统计</button>
            <button className="btn btn--sm btn--ghost" onClick={() => void warmCache()} disabled={busy}>预热歌单</button>
            <button className="btn btn--sm btn--danger" onClick={() => void clearCache()} disabled={busy}>清空缓存</button>
          </div>
        </div>
        {stats ? <div className="cache-dir">缓存目录：{stats.dir}</div> : null}
      </div>

      <div className="admin-card glass">
        <div className="admin-card__head">
          <div>
            <div className="admin-card__title">全部可用音质</div>
            <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
              标准、高品质、无损、Hi-Res 分别保存，无法获取的音质自动跳过。
            </div>
          </div>
        </div>
        <div className="quality-grid">
          {(['128k', '320k', 'flac', 'flac24bit'] as Quality[]).map((quality) => (
            <div key={quality} className="quality-card is-on">
              <span className="quality-card__check"><CheckIcon size={14} /></span>
              <span>
                <span className="quality-card__name">{QUALITY_NAMES[quality]}</span>
                <span className="quality-card__meta">{quality}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-card glass">
        <div className="admin-card__head"><div className="admin-card__title">当前策略</div></div>
        <div className="dim" style={{ fontSize: 13, lineHeight: 1.9 }}>
          · 缓存：{cache.enabled ? '开启' : '关闭'} · 自动缓存歌单：{cache.warmCollections ? '开启' : '关闭'}<br />
          · 总容量：{formatBytes(cache.maxBytes)} · 全部可用音质 · 歌词持久缓存<br />
          · 用户歌单与收藏各自独立，音频和歌词共享；超过容量按最近使用时间清理。
        </div>
        <div className="row gap-8" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn btn--primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AuditSection() {
  const toast = useToast()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const limit = 30

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.admin.audit({ page, limit })
      setEntries(result.audit.entries)
      setTotal(result.audit.total)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, toast])

  useEffect(() => {
    void load()
  }, [load])

  const pages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="stack gap-16">
      <div className="admin-table-wrap glass">
        <table className="admin-table">
          <thead>
            <tr><th>时间</th><th>操作</th><th>用户</th><th>详情</th><th>IP</th></tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="faint" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {new Date(entry.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </td>
                <td><span className="audit-chip">{AUDIT_LABELS[entry.action] ?? entry.action}</span></td>
                <td className="dim" style={{ fontSize: 12 }}>{entry.username ? '@' + entry.username : '—'}</td>
                <td className="dim ellipsis" style={{ fontSize: 12, maxWidth: 320 }}>{entry.detail || '—'}</td>
                <td className="faint" style={{ fontSize: 11 }}>{entry.ip || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-pager">
        <span className="faint" style={{ fontSize: 12.5 }}>共 {total} 条 · 第 {page} / {pages} 页</span>
        <div className="row gap-8">
          <button className="btn btn--sm" disabled={page <= 1 || loading} onClick={() => setPage((prev) => prev - 1)}>上一页</button>
          <button className="btn btn--sm" disabled={page >= pages || loading} onClick={() => setPage((prev) => prev + 1)}>下一页</button>
        </div>
      </div>
    </div>
  )
}
function AdminLogin() {
  const auth = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <form className="admin-login glass stack gap-16" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('')
    try { await auth.login(username.trim(), password); setPassword('') }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }}>
    <ShieldIcon size={34} /><h1>觅音管理后台</h1><p className="dim">使用管理员账号登录，管理用户与音乐内容。</p>
    <label>用户名<input className="input" autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} /></label>
    <label>密码<input className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}<button className="btn btn--primary" disabled={busy}>{busy ? '正在登录…' : '登录后台'}</button>
    <a href="/" className="dim">返回音乐播放器</a>
  </form>
}
