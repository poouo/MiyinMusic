import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { navigate, useRoute } from '../lib/router'
import { usePlayer } from '../state/player'
import { useSettings } from '../state/settings'
import { PLATFORM_NAMES, PLATFORMS, type Platform, type Song } from '../lib/types'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { EmptyState } from '../components/EmptyState'
import { SongList } from '../components/SongList'
import { AlertIcon, LoaderIcon, SearchIcon } from '../components/Icons'
import { loadJson, saveJson } from '../lib/storage'

const PAGE_SIZE = 30

export function SearchPage() {
  const route = useRoute()
  const player = usePlayer()
  const { settings, update } = useSettings()
  const initialQuery = route.query.get('q') ?? ''
  const initialPlatform = (route.query.get('platform') as Platform) || settings.defaultPlatform
  const [query, setQuery] = useState(initialQuery)
  const [platform, setPlatform] = useState<Platform>(initialPlatform)
  const [songs, setSongs] = useState<Song[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addTarget, setAddTarget] = useState<Song | null>(null)
  const requestRef = useRef(0)
  const [history, setHistory] = useState<string[]>(() => loadJson('search.history', []))
  const inputRef = useRef<HTMLInputElement | null>(null)

  const runSearch = useCallback(
    async (keyword: string, target: Platform, pageNumber: number, append: boolean) => {
      if (!keyword.trim()) return
      if (!append) setHistory(previous => { const next = [keyword.trim(), ...previous.filter(item => item !== keyword.trim())].slice(0, 20); saveJson('search.history', next); return next })
      const token = ++requestRef.current
      setError(null)
      if (append) setLoadingMore(true)
      else {
        setLoading(true)
        setSongs([])
        setError(null)
      }
      try {
        const result = await api.search(target, keyword.trim(), pageNumber, PAGE_SIZE)
        if (token !== requestRef.current) return
        setSongs((prev) => append ? Array.from(new Map([...prev, ...result.result.list].map(song => [song.platform + '_' + song.songmid, song])).values()) : result.result.list)
        setTotal(result.result.total)
        setHasMore(result.result.hasMore)
        setPage(pageNumber)
      } catch (err) {
        if (token !== requestRef.current) return
        setError(err instanceof ApiError ? err.message : '搜索失败，请稍后重试')
        if (!append) setSongs([])
      } finally {
        if (token === requestRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [],
  )

  useEffect(() => {
    const keyword = route.query.get('q') ?? ''
    const requested = route.query.get('platform') as Platform
    const target = PLATFORMS.includes(requested) ? requested : settings.defaultPlatform
    setQuery(keyword)
    if (PLATFORMS.includes(target)) setPlatform(target)
    if (keyword) void runSearch(keyword, target, 1, false)
    else {
      setSongs([])
      setTotal(0)
      setHasMore(false)
      setLoading(false)
      setLoadingMore(false)
    }
    return () => { requestRef.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.path, route.query.toString()])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const keyword = query.trim()
    if (!keyword) return
    update({ defaultPlatform: platform })
    if (route.query.get('q') === keyword && route.query.get('platform') === platform) void runSearch(keyword, platform, 1, false)
    else navigate('/search?q=' + encodeURIComponent(keyword) + '&platform=' + platform, { replace: true })
  }

  const switchPlatform = (target: Platform) => {
    setPlatform(target)
    update({ defaultPlatform: target })
    const keyword = query.trim()
    if (!keyword) return
    navigate('/search?q=' + encodeURIComponent(keyword) + '&platform=' + target, { replace: true })
  }

  const keyword = route.query.get('q') ?? ''

  return (
    <div className="fade-in">
      <form className="searchbox" onSubmit={submit} style={{ marginBottom: 16 }}>
        <SearchIcon size={19} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索歌曲、歌手、专辑…"
          aria-label="搜索"
        />
        {query ? (
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            aria-label="清空"
          >
            ×
          </button>
        ) : null}
        <button type="submit" className="btn btn--primary btn--sm">
          搜索
        </button>
      </form>
      {!keyword && history.length > 0 && <div className="chip-row" style={{ marginBottom: 20 }}>
        {history.map(item => <button className="chip" key={item} onClick={() => navigate('/search?q=' + encodeURIComponent(item) + '&platform=' + platform)}>{item}</button>)}
        <button className="btn btn--ghost btn--sm" onClick={() => { setHistory([]); saveJson('search.history', []) }}>清空历史</button>
      </div>}

      <div className="chip-row" style={{ marginBottom: 18 }}>
        {PLATFORMS.map((item) => (
          <button
            key={item}
            className={'chip' + (platform === item ? ' is-active' : '')}
            onClick={() => switchPlatform(item)}
          >
            {PLATFORM_NAMES[item]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="stack gap-10" style={{ marginTop: 10 }}>
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="row gap-12" style={{ padding: '6px 8px' }}>
              <div className="skeleton" style={{ width: 46, height: 46, borderRadius: 9 }} />
              <div className="stack gap-6 grow">
                <div className="skeleton" style={{ height: 12, width: '32%' }} />
                <div className="skeleton" style={{ height: 10, width: '18%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : error && songs.length === 0 ? (
        <EmptyState
          icon={<AlertIcon size={24} />}
          title="搜索出错了"
          description={error}
          action={
            <button className="btn btn--sm" onClick={() => void runSearch(query, platform, 1, false)}>
              重试
            </button>
          }
        />
      ) : songs.length === 0 ? (
        <EmptyState
          icon={<SearchIcon size={24} />}
          title={keyword ? '没有找到相关歌曲' : '搜索你想听的音乐'}
          description={keyword ? '换个关键词，或切换到其他平台试试。' : '支持酷我、酷狗、QQ 音乐、网易云音乐、咪咕音乐。'}
        />
      ) : (
        <>
          {error && <div role="alert" className="row gap-8" style={{ marginBottom: 16 }}><span>{error}</span><button className="btn btn--sm" disabled={loadingMore} onClick={() => void runSearch(keyword || query, platform, page + 1, true)}>重试此页</button></div>}
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="dim" style={{ fontSize: 12.5 }}>
              找到 {total > 0 ? total.toLocaleString() : songs.length} 首 · {PLATFORM_NAMES[platform]}
            </div>
            <button className="btn btn--sm btn--ghost" onClick={() => player.playSongs(songs, 0)}>
              播放全部
            </button>
          </div>
          <SongList
            songs={songs}
            onPlay={(index) => player.playSongs(songs, index)}
            onAddToPlaylist={setAddTarget}
            currentKey={player.current ? player.current.platform + '_' + player.current.songmid : null}
          />
          {hasMore ? (
            <div className="center" style={{ padding: '18px 0' }}>
              <button
                className="btn btn--sm"
                disabled={loadingMore}
                onClick={() => void runSearch(keyword || query, platform, page + 1, true)}
              >
                {loadingMore ? <LoaderIcon size={15} /> : null}
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            </div>
          ) : null}
        </>
      )}

      <AddToPlaylistModal open={!!addTarget} song={addTarget} onClose={() => setAddTarget(null)} />
    </div>
  )
}
