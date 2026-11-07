import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { navigate } from '../lib/router'
import { formatCount } from '../lib/format'
import { PLATFORM_NAMES } from '../lib/types'
import type { PlaylistInfo, Song } from '../lib/types'
import { usePlayer } from '../state/player'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { Cover } from '../components/Cover'
import { EmptyState } from '../components/EmptyState'
import { SongList } from '../components/SongList'
import { ArrowLeftIcon, LoaderIcon, PlayIcon } from '../components/Icons'

const PAGE_SIZE = 100

/** 平台公开歌单详情（歌单广场点进来） */
export function SquarePlaylistPage({ id }: { id: string }) {
  const player = usePlayer()
  const [playlist, setPlaylist] = useState<PlaylistInfo | null>(null)
  const [songs, setSongs] = useState<Song[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addTarget, setAddTarget] = useState<Song | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSongs([])
    setPlaylist(null)
    api
      .playlist(id, { limit: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        setPlaylist(result.playlist)
        setSongs(result.songs)
        setTotal(result.total)
        setHasMore(result.hasMore)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const loadMore = async () => {
    if (!hasMore || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await api.playlist(id, { offset: songs.length, limit: PAGE_SIZE })
      setSongs((current) => {
        const seen = new Set(current.map((song) => song.platform + '_' + song.songmid))
        const merged = [...current]
        for (const song of result.songs) {
          const key = song.platform + '_' + song.songmid
          if (seen.has(key)) continue
          seen.add(key)
          merged.push(song)
        }
        return merged
      })
      setHasMore(result.hasMore)
      setTotal(result.total)
    } catch {
      /* 加载更多失败时保持当前列表 */
    } finally {
      setLoadingMore(false)
    }
  }

  const platformName = playlist ? PLATFORM_NAMES[playlist.platform] : ''

  return (
    <div className="fade-in" style={{ position: 'relative' }}>
      {playlist?.cover ? (
        <div className="backdrop-cover">
          <Cover src={playlist.cover} style={{ width: '100%', height: '100%' }} lazy={false} />
        </div>
      ) : null}

      <button className="btn btn--ghost btn--sm hide-mobile" onClick={() => navigate('/square')} style={{ marginBottom: 8 }}>
        <ArrowLeftIcon size={15} /> 歌单广场
      </button>

      {loading ? (
        <div className="stack gap-16">
          <div className="row gap-16" style={{ alignItems: 'flex-end' }}>
            <div className="skeleton" style={{ width: 188, height: 188, borderRadius: 20 }} />
            <div className="stack gap-10 grow">
              <div className="skeleton" style={{ width: '50%', height: 22, borderRadius: 8 }} />
              <div className="skeleton" style={{ width: '30%', height: 14, borderRadius: 8 }} />
              <div className="skeleton" style={{ width: '80%', height: 14, borderRadius: 8 }} />
            </div>
          </div>
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="skeleton" style={{ height: 58, borderRadius: 12 }} />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="歌单加载失败"
          description={error}
          action={
            <button className="btn btn--sm" onClick={() => navigate('/square')}>
              返回歌单广场
            </button>
          }
        />
      ) : playlist ? (
        <>
          <div className="detail-hero" style={{ position: 'relative' }}>
            <div className="detail-hero__cover">
              <Cover src={playlist.cover} style={{ width: '100%', height: '100%' }} radius={20} lazy={false} />
            </div>
            <div className="detail-hero__info">
              <div className="detail-hero__eyebrow">歌单 · {platformName}</div>
              <h1 className="detail-hero__title">{playlist.name}</h1>
              <div className="detail-hero__meta">
                {playlist.creator ? <span>{playlist.creator}</span> : null}
                <span>· {total || songs.length} 首歌曲</span>
                {playlist.playCount ? <span>· {formatCount(playlist.playCount)} 次播放</span> : null}
              </div>
              {playlist.tags?.length ? (
                <div className="chip-row" style={{ marginTop: 10 }}>
                  {playlist.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="tag tag--platform">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              {playlist.description ? <p className="detail-hero__desc">{playlist.description}</p> : null}
              <div className="detail-actions">
                <button
                  className="btn btn--primary"
                  disabled={!songs.length}
                  onClick={() => player.playSongs(songs, 0)}
                >
                  <PlayIcon size={16} /> 播放全部
                </button>
              </div>
            </div>
          </div>

          {songs.length === 0 ? (
            <EmptyState title="这个歌单还是空的" description="换一个歌单看看吧。" />
          ) : (
            <>
              <SongList songs={songs} onPlay={(index) => player.playSongs(songs, index)} onAddToPlaylist={setAddTarget} />
              {hasMore ? (
                <div className="row" style={{ justifyContent: 'center', marginTop: 22 }}>
                  <button className="btn btn--ghost" disabled={loadingMore} onClick={() => void loadMore()}>
                    {loadingMore ? <LoaderIcon size={15} /> : null}
                    {loadingMore ? '加载中…' : '加载更多歌曲'}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </>
      ) : null}

      <AddToPlaylistModal open={!!addTarget} song={addTarget} onClose={() => setAddTarget(null)} />
    </div>
  )
}
