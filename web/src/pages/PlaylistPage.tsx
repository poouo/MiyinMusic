import { useState } from 'react'
import { navigate } from '../lib/router'
import { useLibrary } from '../state/library'
import { usePlayer } from '../state/player'
import { useToast } from '../state/toast'
import type { Song } from '../lib/types'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { Cover } from '../components/Cover'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { SongList } from '../components/SongList'
import { ArrowLeftIcon, PlayIcon, TrashIcon } from '../components/Icons'

export function PlaylistPage({ id }: { id: string }) {
  const library = useLibrary()
  const player = usePlayer()
  const toast = useToast()
  const playlist = library.data.playlists.find((item) => item.id === id) ?? null
  const [addTarget, setAddTarget] = useState<Song | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(playlist?.name ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!playlist) {
    return (
      <EmptyState
        title="歌单不存在"
        description="它可能已经被删除了。"
        action={
          <button className="btn btn--sm" onClick={() => navigate('/library')}>
            返回音乐库
          </button>
        }
      />
    )
  }

  const songs = playlist.songs
  const each = songs.length

  return (
    <div className="fade-in" style={{ position: 'relative' }}>
      <div className="backdrop-cover">
        {songs[0] ? <Cover song={songs[0]} style={{ width: '100%', height: '100%' }} lazy={false} /> : null}
      </div>

      <button className="btn btn--ghost btn--sm hide-mobile" onClick={() => navigate('/library')} style={{ marginBottom: 8 }}>
        <ArrowLeftIcon size={15} /> 音乐库
      </button>

      <div className="detail-hero" style={{ position: 'relative' }}>
        <div className="detail-hero__cover">
          {songs[0] ? (
            <Cover song={songs[0]} style={{ width: '100%', height: '100%' }} radius={20} lazy={false} />
          ) : (
            <div className="cover" style={{ width: '100%', height: '100%', borderRadius: 20 }}>
              <div className="cover__fallback" style={{ fontSize: 40 }}>♪</div>
            </div>
          )}
        </div>
        <div className="detail-hero__info">
          <div className="detail-hero__eyebrow">歌单</div>
          <h1 className="detail-hero__title">{playlist.name}</h1>
          <div className="detail-hero__meta">
            <span>{each} 首歌曲</span>
            {playlist.description ? <span>· {playlist.description}</span> : null}
          </div>
          <div className="detail-actions">
            <button
              className="btn btn--primary"
              disabled={!each}
              onClick={() => player.playSongs(songs, 0)}
            >
              <PlayIcon size={16} /> 播放全部
            </button>
            <button
              className="btn"
              onClick={() => {
                setName(playlist.name)
                setRenaming(true)
              }}
            >
              重命名
            </button>
            <button className="btn btn--danger" onClick={() => setConfirmDelete(true)}>
              <TrashIcon size={15} /> 删除
            </button>
          </div>
        </div>
      </div>

      {each === 0 ? (
        <EmptyState
          icon={<PlayIcon size={22} />}
          title="歌单还是空的"
          description="在任意歌曲右侧点击「添加到歌单」即可加入。"
          action={
            <button className="btn btn--sm" onClick={() => navigate('/search')}>
              去搜索歌曲
            </button>
          }
        />
      ) : (
        <SongList
          songs={songs}
          onPlay={(index) => player.playSongs(songs, index)}
          onAddToPlaylist={setAddTarget}
          onRemove={(song) => {
            void library.removeFromPlaylist(playlist.id, song.platform + '_' + song.songmid)
          }}
          removeLabel="从歌单移除"
        />
      )}

      <Modal open={renaming} title="重命名歌单" onClose={() => setRenaming(false)}>
        <div className="stack gap-12">
          <input
            className="input"
            autoFocus
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost" onClick={() => setRenaming(false)}>
              取消
            </button>
            <button
              className="btn btn--primary"
              disabled={!name.trim()}
              onClick={() => {
                void library.renamePlaylist(playlist.id, name).then(() => {
                  setRenaming(false)
                  toast.success('已重命名')
                })
              }}
            >
              保存
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmDelete} title="删除歌单" onClose={() => setConfirmDelete(false)}>
        <div className="stack gap-16">
          <div>
            确定要删除《{playlist.name}》吗？歌曲本身不会被删除，只是这个歌单会消失。
          </div>
          <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost" onClick={() => setConfirmDelete(false)}>
              取消
            </button>
            <button
              className="btn btn--danger"
              onClick={() => {
                void library.deletePlaylist(playlist.id).then(() => {
                  toast.success('歌单已删除')
                  navigate('/library')
                })
                setConfirmDelete(false)
              }}
            >
              删除
            </button>
          </div>
        </div>
      </Modal>

      <AddToPlaylistModal open={!!addTarget} song={addTarget} onClose={() => setAddTarget(null)} />
    </div>
  )
}
