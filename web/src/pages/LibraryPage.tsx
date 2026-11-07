import { useMemo, useState } from 'react'
import { navigate } from '../lib/router'
import { useAuth } from '../state/auth'
import { useAuthModal } from '../state/authModal'
import { useLibrary } from '../state/library'
import { usePlayer } from '../state/player'
import { useToast } from '../state/toast'
import type { Song } from '../lib/types'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { Cover } from '../components/Cover'
import { EmptyState } from '../components/EmptyState'
import { SongList } from '../components/SongList'
import { ClockIcon, FolderIcon, HeartIcon, ListMusicIcon, PlusIcon, TrashIcon, UserIcon } from '../components/Icons'

type Tab = 'favorites' | 'playlists' | 'history'

export function LibraryPage() {
  const library = useLibrary()
  const player = usePlayer()
  const auth = useAuth()
  const authModal = useAuthModal()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('favorites')
  const [addTarget, setAddTarget] = useState<Song | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const favorites = useMemo(() => library.data.favorites.map((entry) => entry.song), [library.data.favorites])
  const history = useMemo(() => library.data.history.map((entry) => entry.song), [library.data.history])

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const playlist = await library.createPlaylist(trimmed)
    setName('')
    setCreating(false)
    if (playlist) navigate('/playlist/' + playlist.id)
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">音乐库</h1>
          <p className="page-sub">
            {auth.user ? '已登录 ' + auth.user.nickname + '，收藏与歌单会保存到账号' : '当前为访客模式，数据只保存在本机'}
          </p>
        </div>
        <div className="row gap-8">
          <button className="btn btn--sm btn--primary" onClick={() => setCreating(true)}>
            <PlusIcon size={15} /> 新建歌单
          </button>
        </div>
      </div>

      {!auth.user ? (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <div className="avatar" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <UserIcon size={16} />
          </div>
          <div className="grow">
            <div style={{ fontWeight: 650 }}>登录后可跨设备同步</div>
            <div className="dim" style={{ fontSize: 12.5 }}>
              收藏、歌单和播放记录会保存到服务器，换设备也能接着听。
            </div>
          </div>
          <button className="btn btn--sm btn--primary" onClick={() => authModal.open('login', '登录后收藏与歌单会同步到账号')}>
            立即登录
          </button>
        </div>
      ) : null}

      <div className="chip-row" style={{ marginBottom: 18 }}>
        <button className={'chip' + (tab === 'favorites' ? ' is-active' : '')} onClick={() => setTab('favorites')}>
          <HeartIcon size={14} filled={tab === 'favorites'} /> 喜欢 {favorites.length}
        </button>
        <button className={'chip' + (tab === 'playlists' ? ' is-active' : '')} onClick={() => setTab('playlists')}>
          <FolderIcon size={14} /> 歌单 {library.data.playlists.length}
        </button>
        <button className={'chip' + (tab === 'history' ? ' is-active' : '')} onClick={() => setTab('history')}>
          <ClockIcon size={14} /> 最近 {history.length}
        </button>
      </div>

      {tab === 'favorites' ? (
        favorites.length === 0 ? (
          <EmptyState
            icon={<HeartIcon size={24} />}
            title="还没有喜欢的歌"
            description="在歌曲右侧点击心形按钮，就能把喜欢的歌收进这里。"
            action={
              <button className="btn btn--sm" onClick={() => navigate('/search')}>
                去搜索
              </button>
            }
          />
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="dim" style={{ fontSize: 12.5 }}>
                共 {favorites.length} 首
              </div>
              <div className="row gap-8">
                <button className="btn btn--sm" onClick={() => player.playSongs(favorites, 0)}>
                  播放全部
                </button>
              </div>
            </div>
            <SongList
              songs={favorites}
              onPlay={(index) => player.playSongs(favorites, index)}
              onAddToPlaylist={setAddTarget}
              onRemove={(song) => void library.toggleFavorite(song)}
              removeLabel="取消收藏"
            />
          </>
        )
      ) : null}

      {tab === 'playlists' ? (
        library.data.playlists.length === 0 ? (
          <EmptyState
            icon={<FolderIcon size={24} />}
            title="还没有歌单"
            description="创建一个歌单，把想听的歌收在一起。"
            action={
              <button className="btn btn--sm btn--primary" onClick={() => setCreating(true)}>
                创建歌单
              </button>
            }
          />
        ) : (
          <div className="grid-cards">
            {library.data.playlists.map((playlist) => (
              <button key={playlist.id} className="tile" onClick={() => navigate('/playlist/' + playlist.id)}>
                <div className="tile__cover">
                  {playlist.songs[0] ? (
                    <Cover song={playlist.songs[0]} style={{ position: 'absolute', inset: 0 }} radius={14} />
                  ) : (
                    <div className="cover" style={{ position: 'absolute', inset: 0, borderRadius: 14 }}>
                      <div className="cover__fallback" style={{ fontSize: 26 }}>
                        <ListMusicIcon size={26} />
                      </div>
                    </div>
                  )}
                </div>
                <div className="tile__name ellipsis">{playlist.name}</div>
                <div className="tile__meta">{playlist.songs.length} 首</div>
              </button>
            ))}
          </div>
        )
      ) : null}

      {tab === 'history' ? (
        history.length === 0 ? (
          <EmptyState
            icon={<ClockIcon size={24} />}
            title="还没有播放记录"
            description="播放过的歌曲会自动出现在这里。"
          />
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="dim" style={{ fontSize: 12.5 }}>
                共 {history.length} 首
              </div>
              <button
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  void library.clearHistory().then(() => toast.success('已清空播放记录'))
                }}
              >
                <TrashIcon size={14} /> 清空记录
              </button>
            </div>
            <SongList
              songs={history}
              onPlay={(index) => player.playSongs(history, index)}
              onAddToPlaylist={setAddTarget}
              showIndex={false}
            />
          </>
        )
      ) : null}

      {creating ? (
        <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && setCreating(false)}>
          <div className="modal" style={{ width: 'min(420px, 100%)' }}>
            <div className="modal__head">
              <div className="modal__title">新建歌单</div>
            </div>
            <div className="modal__body">
              <input
                className="input"
                autoFocus
                placeholder="歌单名称"
                value={name}
                maxLength={40}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void handleCreate()}
              />
            </div>
            <div className="modal__foot">
              <button className="btn btn--ghost" onClick={() => setCreating(false)}>
                取消
              </button>
              <button className="btn btn--primary" onClick={() => void handleCreate()} disabled={!name.trim()}>
                创建
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AddToPlaylistModal open={!!addTarget} song={addTarget} onClose={() => setAddTarget(null)} />
    </div>
  )
}