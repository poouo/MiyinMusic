import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from '../lib/api'
import { GuestLibraryKey, loadJson, saveJson } from '../lib/storage'
import { songKey } from '../lib/types'
import type { LibraryData, Playlist, Song, SingerInfo } from '../lib/types'
import { useAuth } from './auth'
import { useToast } from './toast'

const EMPTY: LibraryData = { favorites: [], playlists: [], history: [], settings: {} }

interface LibraryApi {
  followSinger: (singer: SingerInfo) => Promise<void>
  importPlaylist: (playlist: { name: string; description?: string; songs: Song[] }) => Promise<void>
  data: LibraryData
  ready: boolean
  guest: boolean
  isFavorite: (song: Song) => boolean
  toggleFavorite: (song: Song) => Promise<void>
  recordPlay: (song: Song) => void
  clearHistory: () => Promise<void>
  createPlaylist: (name: string) => Promise<Playlist | null>
  renamePlaylist: (id: string, name: string) => Promise<void>
  deletePlaylist: (id: string) => Promise<void>
  addToPlaylist: (id: string, song: Song) => Promise<void>
  removeFromPlaylist: (id: string, key: string) => Promise<void>
}

const LibraryContext = createContext<LibraryApi | null>(null)

function loadGuest(): LibraryData {
  const data = loadJson<LibraryData>(GuestLibraryKey, EMPTY)
  return {
    favorites: Array.isArray(data.favorites) ? data.favorites : [],
    playlists: Array.isArray(data.playlists) ? data.playlists : [],
    history: Array.isArray(data.history) ? data.history : [],
    settings: data.settings ?? {},
    updatedAt: data.updatedAt,
  }
}

function isEmpty(data: LibraryData): boolean {
  return !data.favorites.length && !data.playlists.length && !data.history.length
}

function newPlaylist(name: string): Playlist {
  return {
    id: 'local_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    description: '',
    songs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const toast = useToast()
  const [data, setData] = useState<LibraryData>(() => loadGuest())
  const [ready, setReady] = useState(false)
  const [visibleOwner, setVisibleOwner] = useState<string | null>(null)
  const accountRef = useRef(user?.id ?? null)
  accountRef.current = user?.id ?? null
  const dataRef = useRef(data)
  const migratedRef = useRef(false)

  dataRef.current = data
  const guest = !user

  // 访客模式：写入本地存储
  useEffect(() => {
    if (guest && visibleOwner === null) saveJson(GuestLibraryKey, data)
  }, [data, guest, visibleOwner])

  useEffect(() => {
    let cancelled = false
    async function sync() {
      if (!user) {
        setVisibleOwner(null)
        setData(loadGuest())
        setReady(true)
        return
      }
      setVisibleOwner(user.id)
      setData(loadJson<LibraryData>('library.account.' + user.id, EMPTY))
      try {
        const local = loadGuest()
        const result = await api.library()
        if (cancelled) return
        let library = result.library
        if (!migratedRef.current && isEmpty(library) && !isEmpty(local)) {
          migratedRef.current = true
          const imported = await api.importLibrary({
            favorites: local.favorites.map((f) => f.song),
            playlists: local.playlists.map((p) => ({ name: p.name, description: p.description, songs: p.songs })),
            history: local.history.map((h) => h.song),
          })
          library = imported.library
          toast.success('已把本机收藏与歌单同步到账号')
        }
        if (!cancelled) setData(library)
      } catch (err) {
        if (!cancelled && !(err instanceof ApiError && err.status === 401)) {
          toast.error('加载云端音乐库失败：' + (err as Error).message)
        }
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    void sync()
    return () => {
      cancelled = true
    }
  }, [user, toast])

  useEffect(() => { if (user && ready && visibleOwner === user.id) saveJson('library.account.' + user.id, data) }, [user, data, ready, visibleOwner])

  const apply = useCallback((fn: (data: LibraryData) => LibraryData) => {
    setData((prev) => fn(prev))
  }, [])

  const runRemote = useCallback(
    async (request: () => Promise<{ library: LibraryData }>, fallbackMessage: string) => {
      const owner = accountRef.current
      try {
        const result = await request()
        if (owner !== accountRef.current) return false
        setData(result.library)
        return true
      } catch (err) {
        toast.error(fallbackMessage + '：' + (err as Error).message)
        return false
      }
    },
    [toast],
  )

  const isFavorite = useCallback(
    (song: Song) => dataRef.current.favorites.some((f) => songKey(f.song) === songKey(song)),
    [],
  )

  const toggleFavorite = useCallback(
    async (song: Song) => {
      const key = songKey(song)
      const exists = dataRef.current.favorites.some((f) => songKey(f.song) === key)
      if (!user) {
        apply((prev) => ({
          ...prev,
          favorites: exists
            ? prev.favorites.filter((f) => songKey(f.song) !== key)
            : [{ song, addedAt: Date.now() }, ...prev.favorites],
        }))
        toast.success(exists ? '已取消收藏' : '已加入喜欢')
        return
      }
      const saved = exists
        ? await runRemote(() => api.removeFavorite(key), '取消收藏失败')
        : await runRemote(() => api.addFavorite(song), '收藏失败')
      if (saved) toast.success(exists ? '已取消收藏' : '已加入喜欢')
    },
    [apply, runRemote, toast, user],
  )

  const recordPlay = useCallback(
    (song: Song) => {
      const key = songKey(song)
      const entry = { song, playedAt: Date.now() }
      apply((prev) => ({
        ...prev,
        history: [entry, ...prev.history.filter((h) => songKey(h.song) !== key)].slice(0, 200),
      }))
      if (user) {
        api.addHistory(song).catch(() => undefined)
      }
    },
    [apply, user],
  )

  const clearHistory = useCallback(async () => {
    if (!user) {
      apply((prev) => ({ ...prev, history: [] }))
      return
    }
    await runRemote(() => api.clearHistory(), '清空播放记录失败')
  }, [apply, runRemote, user])

  const createPlaylist = useCallback(
    async (name: string): Promise<Playlist | null> => {
      const trimmed = name.trim()
      if (!trimmed) return null
      if (!user) {
        const playlist = newPlaylist(trimmed)
        apply((prev) => ({ ...prev, playlists: [playlist, ...prev.playlists] }))
        return playlist
      }
      try {
        const result = await api.createPlaylist(trimmed)
        if (user.id !== accountRef.current) return null
        setData(result.library)
        return result.library.playlists[0] ?? null
      } catch (err) {
        toast.error('新建歌单失败：' + (err as Error).message)
        return null
      }
    },
    [apply, toast, user],
  )

  const renamePlaylist = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      if (!user) {
        apply((prev) => ({
          ...prev,
          playlists: prev.playlists.map((p) => (p.id === id ? { ...p, name: trimmed, updatedAt: Date.now() } : p)),
        }))
        return
      }
      await runRemote(() => api.updatePlaylist(id, { name: trimmed }), '重命名失败')
    },
    [apply, runRemote, user],
  )

  const deletePlaylist = useCallback(
    async (id: string) => {
      if (!user) {
        apply((prev) => ({ ...prev, playlists: prev.playlists.filter((p) => p.id !== id) }))
        return
      }
      await runRemote(() => api.deletePlaylist(id), '删除歌单失败')
    },
    [apply, runRemote, user],
  )

  const addToPlaylist = useCallback(
    async (id: string, song: Song) => {
      const key = songKey(song)
      const target = dataRef.current.playlists.find((p) => p.id === id)
      if (target?.songs.some((s) => songKey(s) === key)) {
        toast.show('这首歌已经在歌单里了')
        return
      }
      if (!user) {
        apply((prev) => ({
          ...prev,
          playlists: prev.playlists.map((p) =>
            p.id === id ? { ...p, songs: [...p.songs, song], updatedAt: Date.now() } : p,
          ),
        }))
        toast.success('已添加到《' + (target?.name ?? '歌单') + '》')
        return
      }
      try {
        const result = await api.addPlaylistSong(id, song)
        if (user.id !== accountRef.current) return
        setData(result.library)
        const fresh = result.library.playlists.find((p) => p.id === id)
        toast.success('已添加到《' + (fresh?.name ?? target?.name ?? '歌单') + '》')
      } catch (err) {
        toast.error('添加失败：' + (err as Error).message)
      }
    },
    [apply, toast, user],
  )

  const removeFromPlaylist = useCallback(
    async (id: string, key: string) => {
      if (!user) {
        apply((prev) => ({
          ...prev,
          playlists: prev.playlists.map((p) =>
            p.id === id ? { ...p, songs: p.songs.filter((s) => songKey(s) !== key) } : p,
          ),
        }))
        return
      }
      await runRemote(() => api.removePlaylistSong(id, key), '移除失败')
    },
    [apply, runRemote, user],
  )

  const followSinger = useCallback(async (singer: SingerInfo) => {
    if (!user) { toast.error('请先登录后关注歌手'); return }
    const id = singer.platform + '-' + singer.id.replace(/^(tx|wy)-/, '')
    await runRemote(() => dataRef.current.favoriteSingers?.some(item => item.id === id) ? api.unfollowSinger(id) : api.followSinger(singer), '关注操作失败')
  }, [user, runRemote, toast])
  const importPlaylist = useCallback(async (playlist: { name: string; description?: string; songs: Song[] }) => {
    if (!user) throw new Error('请先登录后保存歌单')
    const result = await api.importLibrary({ playlists: [playlist] })
    if (user.id !== accountRef.current) return
    setData(result.library)
    toast.success('已保存为独立歌单')
  }, [user, toast])
  const value = useMemo<LibraryApi>(
    () => ({
      data,
      importPlaylist,
      followSinger,
      ready,
      guest,
      isFavorite,
      toggleFavorite,
      recordPlay,
      clearHistory,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addToPlaylist,
      removeFromPlaylist,
    }),
    [
      importPlaylist,
      followSinger,
      data,
      ready,
      guest,
      isFavorite,
      toggleFavorite,
      recordPlay,
      clearHistory,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addToPlaylist,
      removeFromPlaylist,
    ],
  )

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}

export function useLibrary(): LibraryApi {
  const ctx = useContext(LibraryContext)
  if (!ctx) throw new Error('useLibrary 必须在 LibraryProvider 内使用')
  return ctx
}
