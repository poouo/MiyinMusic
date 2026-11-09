import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Song } from '../lib/types'
import { usePlayer } from '../state/player'
import { Cover } from '../components/Cover'
import { SongList } from '../components/SongList'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'

export function AlbumPage({ id }: { id: string }) {
  const player = usePlayer()
  const [data, setData] = useState<Awaited<ReturnType<typeof api.album>> | null>(null)
  const [error, setError] = useState('')
  const [attempt, retry] = useState(0)
  const [target, setTarget] = useState<Song | null>(null)
  useEffect(() => {
    let active = true; setData(null); setError('')
    api.album(id).then(value => { if (active) setData(value) }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [id, attempt])
  return <div><button className="btn btn--ghost" onClick={() => window.history.back()}>返回</button>
    {error ? <p role="alert">{error} <button className="btn" onClick={() => retry(value => value + 1)}>重试</button></p> : !data ? <p>专辑加载中…</p> : <>
      <div className="detail-hero"><Cover src={data.cover} className="detail-hero__cover" /><div className="detail-hero__info"><div className="detail-hero__eyebrow">专辑</div><h1 className="detail-hero__title">{data.name}</h1><p>{data.singer} · {data.songs.length} 首</p><button className="btn btn--primary" onClick={() => player.playSongs(data.songs)}>播放全部</button></div></div>
      <SongList songs={data.songs} onAddToPlaylist={setTarget} />
    </>}
    <AddToPlaylistModal open={!!target} song={target} onClose={() => setTarget(null)} />
  </div>
}
