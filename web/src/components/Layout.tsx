import { useEffect, useState, type ReactNode } from 'react'
import { navigate, useRoute } from '../lib/router'
import { useSettings } from '../state/settings'
import { useAuth } from '../state/auth'
import { useAuthModal } from '../state/authModal'
import { useLibrary } from '../state/library'
import { initials } from '../lib/format'
import { MiniPlayer } from './MiniPlayer'
import { ThemeSwitcher } from './ThemeSwitcher'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  ActivityIcon,
  HeartIcon,
  HomeIcon,
  LibraryIcon,
  ListMusicIcon,
  MusicIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  SlidersIcon,
  UserIcon,
} from './Icons'
import { Modal } from './Modal'

const BASE_NAV = [
  { path: '/', label: '发现', icon: HomeIcon },
  { path: '/search', label: '搜索', icon: SearchIcon },
  { path: '/charts', label: '排行榜', icon: ActivityIcon },
  { path: '/square', label: '歌单广场', icon: ListMusicIcon },
  { path: '/library', label: '音乐库', icon: LibraryIcon },
  { path: '/settings', label: '设置', icon: SlidersIcon },
]

const BASE_TABS = [
  { path: '/', label: '发现', icon: HomeIcon },
  { path: '/search', label: '搜索', icon: SearchIcon },
  { path: '/library', label: '音乐库', icon: LibraryIcon },
  { path: '/settings', label: '设置', icon: SlidersIcon },
]

const ADMIN_NAV = { path: '/admin', label: '管理后台', icon: ShieldIcon }

interface LayoutProps {
  children: ReactNode
  onOpenNowPlaying: () => void
}

export function Layout({ children, onOpenNowPlaying }: LayoutProps) {
  const route = useRoute()
  const { settings, update } = useSettings()
  const auth = useAuth()
  const authModal = useAuthModal()
  const library = useLibrary()
  const isAdmin = auth.user?.role === 'admin'
  const NAV = isAdmin ? [...BASE_NAV.slice(0, -1), ADMIN_NAV, BASE_NAV[BASE_NAV.length - 1]] : BASE_NAV
  const TABS = isAdmin ? [...BASE_TABS.slice(0, 3), { path: '/admin', label: '后台', icon: ShieldIcon }, BASE_TABS[3]] : BASE_TABS
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        navigate('/search')
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.content .searchbox input')?.focus())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pageLabel = BASE_NAV.find((item) => item.path === route.path)?.label
    ?? (route.path === '/liked' ? '我的喜欢' : route.path.startsWith('/singer/') ? '歌手' : '歌单详情')

  const isActive = (path: string) =>
    path === '/' ? route.path === '/' : route.path === path || route.path.startsWith(path + '/')

  const isPlaylistActive = (id: string) => route.path === '/playlist/' + id

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const playlist = await library.createPlaylist(trimmed)
    setCreating(false)
    setName('')
    if (playlist) navigate('/playlist/' + playlist.id)
  }

  return (
    <div className="app">
      <aside className={"sidebar" + (settings.sidebarCollapsed ? " sidebar--collapsed" : "")}>
        <button className="brand" onClick={() => navigate('/')} aria-label="觅音首页">
          <div className="brand__mark">
            <MusicIcon size={20} />
          </div>
          <div>
            <div className="brand__name">觅音</div>
            <div className="brand__sub">MiYin Music</div>
          </div>
        </button>

        <div className="nav__title">听音乐</div>
        <nav className="nav" aria-label="主导航">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.path}
                className={'nav__item' + (isActive(item.path) ? ' is-active' : '')}
                title={item.label}
                aria-label={item.label}
                aria-current={isActive(item.path) ? 'page' : undefined}
                onClick={() => navigate(item.path)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="nav__title row" style={{ justifyContent: 'space-between' }}>
          <span>我的歌单</span>
          <button className="icon-btn" style={{ width: 24, height: 24 }} title="新建歌单" aria-label="新建歌单" onClick={() => setCreating(true)}>
            <PlusIcon size={15} />
          </button>
        </div>

        <div className="side-playlists">
          <button
            className={'side-playlist' + (route.path === '/liked' ? ' is-active' : '')}
            onClick={() => navigate('/liked')}
            title="我的喜欢"
            aria-label="我的喜欢"
          >
            <HeartIcon size={18} />
            <span className="ellipsis">我的喜欢</span>
            <span className="faint" style={{ fontSize: 12, marginLeft: 'auto' }}>
              {library.data.favorites.length}
            </span>
          </button>
          {library.data.playlists.length === 0 ? (
            <div className="faint" style={{ padding: '8px 12px', fontSize: 12 }}>
              还没有自建歌单
            </div>
          ) : (
            library.data.playlists.map((playlist) => (
              <button
                key={playlist.id}
                className={'side-playlist' + (isPlaylistActive(playlist.id) ? ' is-active' : '')}
                onClick={() => navigate('/playlist/' + playlist.id)}
                title={playlist.name}
                aria-label={playlist.name}
              >
                <FolderIcon size={18} />
                <span className="ellipsis">{playlist.name}</span>
                <span className="faint" style={{ fontSize: 12, marginLeft: 'auto' }}>
                  {playlist.songs.length}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="sidebar__footer">
          <button className="icon-btn sidebar__toggle" onClick={() => update({ sidebarCollapsed: !settings.sidebarCollapsed })} title={settings.sidebarCollapsed ? '展开导航栏' : '收起导航栏'} aria-label={settings.sidebarCollapsed ? '展开导航栏' : '收起导航栏'} aria-expanded={!settings.sidebarCollapsed}>
            {settings.sidebarCollapsed ? <ChevronRightIcon size={18} /> : <ChevronLeftIcon size={18} />}
          </button>
          {auth.user ? (
            <button className="user-chip" onClick={() => navigate('/settings')}>
              <div className="avatar" style={{ background: auth.user.avatarColor }}>
                {initials(auth.user.nickname)}
              </div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis" style={{ fontSize: 13, fontWeight: 500 }}>
                  {auth.user.nickname}
                </div>
                <div className="ellipsis faint" style={{ fontSize: 12 }}>
                  {auth.user.role === 'admin' ? '管理员' : auth.user.role === 'vip' ? '会员' : '普通用户'}
                </div>
              </div>
            </button>
          ) : (
            <button className="user-chip" onClick={() => authModal.open('login')}>
              <div className="avatar" style={{ background: 'var(--surface-active)', color: 'var(--text-dim)' }}>
                <UserIcon size={16} />
              </div>
              <div className="grow">
                <div style={{ fontSize: 13, fontWeight: 500 }}>登录 / 注册</div>
                <div className="faint" style={{ fontSize: 12 }}>同步歌单与收藏</div>
              </div>
            </button>
          )}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="topbar__brand" onClick={() => navigate('/')} aria-label="觅音首页">
            <div className="brand__mark">
              <MusicIcon size={16} />
            </div>
            <span>觅音</span>
          </button>
          <span className="topbar__context">{pageLabel}</span>
          <div className="grow" />
          <button className="topbar__search" onClick={() => navigate('/search')} aria-label="搜索音乐">
            <SearchIcon size={18} />
            <span>搜索歌曲、歌手</span>
            <kbd>Ctrl K</kbd>
          </button>
          <ThemeSwitcher variant="icon" />
          <button className="icon-btn" onClick={() => navigate('/settings')} aria-label="设置">
            <SlidersIcon size={20} />
          </button>
        </header>

        <main className="content" id="main-content">
          {children}
        </main>
      </div>

      <MiniPlayer onOpen={onOpenNowPlaying} />

      <nav className="mobile-tabs" aria-label="移动端导航">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.path}
              className={'mobile-tab' + (isActive(tab.path) ? ' is-active' : '')}
              aria-current={isActive(tab.path) ? 'page' : undefined}
              onClick={() => navigate(tab.path)}
            >
              <Icon size={21} />
              {tab.label}
            </button>
          )
        })}
      </nav>

      <Modal open={creating} title="新建歌单" onClose={() => setCreating(false)}>
        <div className="stack gap-12">
          <input
            className="input"
            autoFocus
            placeholder="给歌单起个名字"
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void handleCreate()}
          />
          <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost" onClick={() => setCreating(false)}>
              取消
            </button>
            <button className="btn btn--primary" onClick={() => void handleCreate()} disabled={!name.trim()}>
              创建
            </button>
          </div>
        </div>
      </Modal>

    </div>
  )
}
