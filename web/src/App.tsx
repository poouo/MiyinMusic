import { useCallback, useEffect, useState } from 'react'
import { navigate, useRoute } from './lib/router'
import { AppConfigProvider } from './state/appConfig'
import { AuthProvider } from './state/auth'
import { AuthModalProvider, useAuthModal } from './state/authModal'
import { LibraryProvider } from './state/library'
import { PlayerProvider, usePlayer } from './state/player'
import { SettingsProvider } from './state/settings'
import { ToastProvider } from './state/toast'
import { Layout } from './components/Layout'
import { NowPlaying } from './components/NowPlaying'
import { PlayerBar } from './components/PlayerBar'
import { EmptyState } from './components/EmptyState'
import { DiscoverPage } from './pages/Discover'
import { SearchPage } from './pages/Search'
import { LibraryPage } from './pages/LibraryPage'
import { LikedPage } from './pages/LikedPage'
import { PlaylistPage } from './pages/PlaylistPage'
import { ChartPage, ChartsPage } from './pages/Charts'
import { SquarePage } from './pages/SquarePage'
import { SquarePlaylistPage } from './pages/SquarePlaylistPage'
import { SingerPage } from './pages/SingerPage'
import { AlbumPage } from './pages/AlbumPage'
import { SettingsPage } from './pages/SettingsPage'

function Routes({ path }: { path: string }) {
  if (path === '/' || path === '') return <DiscoverPage />
  if (path === '/search') return <SearchPage />
  if (path === '/library') return <LibraryPage />
  if (path === '/liked') return <LikedPage />
  if (path === '/charts') return <ChartsPage />
  if (path.startsWith('/chart/')) return <ChartPage id={decodeURIComponent(path.slice('/chart/'.length))} />
  if (path === '/square') return <SquarePage />
  if (path.startsWith('/square/')) return <SquarePlaylistPage id={decodeURIComponent(path.slice('/square/'.length))} />
  if (path.startsWith('/singer/')) return <SingerPage id={decodeURIComponent(path.slice('/singer/'.length))} />
  if (path.startsWith('/album/')) return <AlbumPage id={decodeURIComponent(path.slice('/album/'.length))} />
  if (path.startsWith('/playlist/')) return <PlaylistPage id={decodeURIComponent(path.slice('/playlist/'.length))} />
  if (path === '/settings') return <SettingsPage />
  if (path.startsWith('/admin')) { window.location.replace('/admin/'); return null }
  return (
    <EmptyState
      title="页面不存在"
      description="这条链接可能已经失效。"
      action={
        <button className="btn btn--sm" onClick={() => navigate('/')}>
          回到首页
        </button>
      }
    />
  )
}

function Shell() {
  const route = useRoute()
  const player = usePlayer()
  const authModal = useAuthModal()
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false)

  useEffect(() => {
    const container = document.getElementById('main-content')
    if (container) container.scrollTop = 0
  }, [route.path])

  // 旧的 #/login 链接：弹出登录框即可，不再单独占一个页面
  useEffect(() => {
    if (route.path === '/login') {
      authModal.open('login')
      navigate('/', { replace: true })
    }
  }, [route.path, authModal])

  const openNowPlaying = useCallback(() => setNowPlayingOpen(true), [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || target.closest('input, textarea, select, button, a, [role="slider"], [role="dialog"]'))) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === ' ') {
        event.preventDefault()
        player.togglePlay()
      } else if (event.key === 'ArrowRight' && event.shiftKey) {
        player.next()
      } else if (event.key === 'ArrowLeft' && event.shiftKey) {
        player.prev()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [player])

  useEffect(() => {
    if (route.path === '/login') setNowPlayingOpen(false)
  }, [route.path])

  return (
    <>
      <Layout onOpenNowPlaying={openNowPlaying}>
        <Routes path={route.path} />
      </Layout>
      <PlayerBar onOpenNowPlaying={openNowPlaying} />
      <NowPlaying open={nowPlayingOpen} onClose={() => setNowPlayingOpen(false)} />
    </>
  )
}

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <AppConfigProvider>
          <AuthProvider>
            <AuthModalProvider>
              <LibraryProvider>
                <PlayerProvider>
                  <Shell />
                </PlayerProvider>
              </LibraryProvider>
            </AuthModalProvider>
          </AuthProvider>
        </AppConfigProvider>
      </ToastProvider>
    </SettingsProvider>
  )
}
