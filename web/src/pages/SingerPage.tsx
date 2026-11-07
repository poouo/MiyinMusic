import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { navigate, useRoute } from '../lib/router'
import { formatCount } from '../lib/format'
import type { SingerInfo, Song } from '../lib/types'
import { usePlayer } from '../state/player'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { Cover } from '../components/Cover'
import { EmptyState } from '../components/EmptyState'
import { SongList } from '../components/SongList'
import { ArrowLeftIcon, PlayIcon } from '../components/Icons'

/** 热门歌手详情：头像 + 热门歌曲（歌曲来自 QQ 音乐搜索） */
export function SingerPage({ id }: { id: string }) {
  const route = useRoute()
  const player = usePlayer()
  const name = route.query.get('name') ?? ''
  const [singer, setSinger] = useState<SingerInfo | null>(null)
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addTarget, setAddTarget] = useState<Song | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSongs([])
    api
      .singer(id, name)
      .then((result) => {
        if (cancelled) return
        setSinger(result.singer)
        setSongs(result.songs)
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
  }, [id, name])

  return (
    <div className="fade-in" style={{ position: 'relative' }}>
      {singer?.pic ? (
        <div className="backdrop-cover">
          <Cover src={singer.pic} style={{ width: '100%', height: '100%' }} lazy={false} />
        </div>
      ) : null}

      <button className="btn btn--ghost btn--sm hide-mobile" onClick={() => navigate('/')} style={{ marginBottom: 8 }}>
        <ArrowLeftIcon size={15} /> 发现
      </button>

      {loading ? (
        <div className="stack gap-16">
          <div className="row gap-16" style={{ alignItems: 'flex-end' }}>
            <div className="skeleton" style={{ width: 160, height: 160, borderRadius: '50%' }} />
            <div className="stack gap-10 grow">
              <div className="skeleton" style={{ width: '40%', height: 22, borderRadius: 8 }} />
              <div className="skeleton" style={{ width: '26%', height: 14, borderRadius: 8 }} />
            </div>
          </div>
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="skeleton" style={{ height: 58, borderRadius: 12 }} />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="歌手加载失败"
          description={error}
          action={
            <button className="btn btn--sm" onClick={() => navigate('/')}>
              返回发现
            </button>
          }
        />
      ) : singer ? (
        <>
          <div className="detail-hero" style={{ position: 'relative' }}>
            <div className="singer-hero__avatar">
              <Cover src={singer.pic} style={{ width: '100%', height: '100%' }} radius="50%" lazy={false} />
            </div>
            <div className="detail-hero__info">
              <div className="detail-hero__eyebrow">歌手 · QQ 音乐</div>
              <h1 className="detail-hero__title">{singer.name}</h1>
              <div className="detail-hero__meta">
                {singer.followers ? <span>{formatCount(singer.followers)} 粉丝</span> : null}
                {singer.area ? <span>· {singer.area}</span> : null}
                <span>· {songs.length} 首热门歌曲</span>
              </div>
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
            <EmptyState title="暂时没有歌曲" description="换一位歌手看看吧。" />
          ) : (
            <SongList songs={songs} onPlay={(index) => player.playSongs(songs, index)} onAddToPlaylist={setAddTarget} />
          )}
        </>
      ) : null}

      <AddToPlaylistModal open={!!addTarget} song={addTarget} onClose={() => setAddTarget(null)} />
    </div>
  )
}
