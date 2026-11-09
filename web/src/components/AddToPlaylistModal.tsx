import { useState } from 'react'
import { useLibrary } from '../state/library'
import { useToast } from '../state/toast'
import type { Song } from '../lib/types'
import { Modal } from './Modal'
import { CheckIcon, FolderIcon, PlusIcon } from './Icons'

interface Props {
  open: boolean
  song: Song | null
  onClose: () => void
}

export function AddToPlaylistModal({ open, song, onClose }: Props) {
  const library = useLibrary()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const close = () => {
    setCreating(false)
    setName('')
    onClose()
  }

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const playlist = await library.createPlaylist(trimmed)
    if (playlist && song) {
      await library.addToPlaylist(playlist.id, song)
      close()
      return
    }
    if (playlist) {
      toast.success('已创建歌单《' + trimmed + '》')
      close()
    }
  }

  return (
    <Modal open={open} title={song ? '把《' + song.name + '》添加到' : '选择歌单'} onClose={close}>
      <div className="stack gap-8">
        {library.data.playlists.length === 0 ? (
          <div className="dim" style={{ padding: '8px 2px 14px', fontSize: 13 }}>
            还没有歌单，先创建一个吧。
          </div>
        ) : (
          library.data.playlists.map((playlist) => {
            const added = !!song && playlist.songs.some((item) => item.songmid === song.songmid && item.platform === song.platform)
            return (
              <button
                key={playlist.id}
                className="source-card"
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                onClick={() => {
                  if (!song) return
                  void library.addToPlaylist(playlist.id, song).then(close)
                }}
                disabled={added}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: 'var(--accent-soft)',
                    color: 'var(--accent)',
                    display: 'grid',
                    placeItems: 'center',
                    flex: 'none',
                  }}
                >
                  <FolderIcon size={18} />
                </div>
                <div className="grow">
                  <div style={{ fontWeight: 500 }}>{playlist.name}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {playlist.songs.length} 首
                  </div>
                </div>
                {added ? <CheckIcon size={17} /> : <PlusIcon size={17} />}
              </button>
            )
          })
        )}

        {creating ? (
          <div className="stack gap-8" style={{ marginTop: 6 }}>
            <input
              className="input"
              autoFocus
              placeholder="歌单名称"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void handleCreate()}
            />
            <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost btn--sm" onClick={() => setCreating(false)}>
                取消
              </button>
              <button className="btn btn--primary btn--sm" onClick={() => void handleCreate()} disabled={!name.trim()}>
                创建并添加
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn btn--ghost"
            style={{ justifyContent: 'flex-start', marginTop: 4 }}
            onClick={() => setCreating(true)}
          >
            <PlusIcon size={16} /> 新建歌单
          </button>
        )}
      </div>
    </Modal>
  )
}
