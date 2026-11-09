import { useState } from 'react'
import { navigate } from '../lib/router'
import { useLibrary } from '../state/library'
import { usePlayer } from '../state/player'
import { useAuthModal } from '../state/authModal'
import { useAuth } from '../state/auth'
import type { Song } from '../lib/types'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { Cover } from '../components/Cover'
import { EmptyState } from '../components/EmptyState'
import { SongList } from '../components/SongList'
import { ArrowLeftIcon, HeartIcon, PlayIcon } from '../components/Icons'

export function LikedPage() {
  const library = useLibrary()
  const player = usePlayer()
  const auth = useAuth()
  const authModal = useAuthModal()
  const [addTarget, setAddTarget] = useState<Song | null>(null)

  const songs = library.data.favorites.map((entry) => entry.song)

  return (
    <div className="fade-in liked-page">

      <button className="btn btn--ghost btn--sm hide-mobile" onClick={() => navigate('/library')} style={{ marginBottom: 8 }}>
        <ArrowLeftIcon size={15} /> 音乐库
      </button>

      <div className="detail-hero" style={{ position: 'relative' }}>
        <div
          className="detail-hero__cover"
          style={{
            background: 'var(--bg-elev-2)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--accent)',
            border: '1px solid var(--border)',
          }}
        >
          <HeartIcon size={74} filled />
        </div>
        <div className="detail-hero__info">
          <div className="detail-hero__eyebrow">内置歌单</div>
          <h1 className="detail-hero__title">我的喜欢</h1>
          <div className="detail-hero__meta">
            <span>{songs.length} 首歌曲</span>
            <span>·</span>
            <span>{auth.user ? '已同步到账号' : '保存在本机，登录后可同步'}</span>
          </div>
          <div className="detail-actions">
            <button className="btn btn--primary" disabled={!songs.length} onClick={() => player.playSongs(songs, 0)}>
              <PlayIcon size={16} /> 播放全部
            </button>
            {!auth.user ? (
              <button className="btn" onClick={() => authModal.open('login', '登录后「我的喜欢」会同步到账号')}>
                登录同步
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {songs.length === 0 ? (
        <EmptyState
          icon={<HeartIcon size={22} />}
          title="还没有喜欢的歌"
          action={
            <button className="btn btn--sm" onClick={() => navigate('/search')}>
              去搜索歌曲
            </button>
          }
        />
      ) : (
        <>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="dim" style={{ fontSize: 12.5 }}>
              共 {songs.length} 首
            </div>
          </div>
          <SongList
            songs={songs}
            onPlay={(index) => player.playSongs(songs, index)}
            onAddToPlaylist={setAddTarget}
            onRemove={(song) => void library.toggleFavorite(song)}
            removeLabel="取消喜欢"
          />
        </>
      )}

      <AddToPlaylistModal open={!!addTarget} song={addTarget} onClose={() => setAddTarget(null)} />
    </div>
  )
}
