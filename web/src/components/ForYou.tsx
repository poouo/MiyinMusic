import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useLibrary } from '../state/library'
import { usePlayer } from '../state/player'
import { Cover } from './Cover'

export function ForYou() {
  const library = useLibrary()
  const player = usePlayer()
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.forYou>>['items']>([])
  useEffect(() => { let active = true; setItems([]); api.forYou().then(data => { if (active) setItems(data.items) }).catch(() => {}); return () => { active = false } }, [library.data.favorites, library.data.history])
  if (!items.length) return null
  return <section className="section"><div className="section-head"><h2 className="section-title">为你选歌</h2><button className="btn btn--ghost btn--sm" onClick={() => player.playSongs(items.map(item => item.song))}>播放推荐</button></div>
    <div className="preference-grid">{items.slice(0, 6).map((item, index) => <button className="preference-song" key={item.song.platform + item.song.songmid} onClick={() => player.playSongs(items.map(item => item.song), index)}>
      <Cover song={item.song} style={{ width: 56, height: 56, flexShrink: 0 }} /><span className="ellipsis"><span style={{ display: 'block' }} className="ellipsis">{item.song.name} · {item.song.singer}</span><span className="dim" style={{ fontSize: 12 }}>{item.reason}</span></span>
    </button>)}</div></section>
}
