import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { AdminUser, AdminUserList, AdminPlaylistSummary, Playlist, Song } from '../lib/types'
import { useToast } from '../state/toast'
import { Modal } from './Modal'

export function UserPicker({ onSelect, disabled = false }: { onSelect: (user: AdminUser) => void; disabled?: boolean }) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<AdminUserList | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setResult(null); setError('')
    const timer = setTimeout(() => {
      api.admin.users({ q, page, limit: 8 }).then(data => { if (!cancelled) setResult(data) })
        .catch(e => { if (!cancelled) setError((e as Error).message) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [q, page])
  return <div className="stack gap-16">
    <input className="input" aria-label="搜索用户" placeholder="搜索用户名或昵称" value={q} disabled={disabled} onChange={e => { setQ(e.target.value); setPage(1) }} />
    {error && <p role="alert">{error}</p>}
    {!result && !error && <p className="dim">正在查找用户…</p>}
    {result?.users.map(user => <button key={user.id} className="admin-user-choice" disabled={disabled} onClick={() => onSelect(user)}>
      <strong>{user.nickname}</strong><span className="dim">@{user.username} · {user.playlists} 个歌单 · {user.favorites} 首喜欢{user.status === 'disabled' ? ' · 已停用' : ''}</span>
    </button>)}
    {result?.users.length === 0 && <p className="dim">没有找到用户</p>}
    {result && <div className="row gap-8"><button className="btn btn--sm" disabled={page === 1 || disabled} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页 · {result.total} 位用户</span><button className="btn btn--sm" disabled={!result.hasMore || disabled} onClick={() => setPage(page + 1)}>下一页</button></div>}
  </div>
}

type Action = 'create' | 'edit' | 'copy' | 'delete' | 'remove' | null
export function AdminPlaylists({ initialUser }: { initialUser: AdminUser | null }) {
  const toast = useToast()
  const [owner, setOwner] = useState(initialUser)
  const [list, setList] = useState<AdminPlaylistSummary[]>([])
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [action, setAction] = useState<Action>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [target, setTarget] = useState<AdminUser | null>(null)
  const [removing, setRemoving] = useState<Song | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [songPage, setSongPage] = useState(1)
  const [choosingUser, setChoosingUser] = useState(!initialUser)

  useEffect(() => {
    if (!owner) return
    let cancelled = false
    setLoading(true); setError('')
    api.admin.userPlaylists(owner.id).then(data => { if (!cancelled) setList(data.playlists) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [owner?.id, version])
  useEffect(() => {
    setPlaylist(null); setDetailError(''); setQuery(''); setSongPage(1)
    if (!owner || !selectedId) return
    let cancelled = false
    api.admin.playlist(owner.id, selectedId).then(data => { if (!cancelled) setPlaylist(data.playlist) })
      .catch(e => { if (!cancelled) setDetailError((e as Error).message) })
    return () => { cancelled = true }
  }, [owner?.id, selectedId, version])

  const begin = (next: Action) => {
    setName(next === 'create' ? '' : playlist?.name ?? '')
    setDescription(next === 'create' ? '' : playlist?.description ?? '')
    setTarget(null); setAction(next)
  }
  const submit = async () => {
    if (!owner || busy) return
    setBusy(true)
    try {
      if (action === 'create') {
        const result = await api.admin.createPlaylist(owner.id, { name, description }); setSelectedId(result.playlist.id)
      } else if (playlist) {
        if (action === 'edit') await api.admin.updatePlaylist(owner.id, playlist.id, { name, description })
        else if (action === 'delete') { await api.admin.deletePlaylist(owner.id, playlist.id); setSelectedId('') }
        else if (action === 'copy' && target) await api.admin.copyPlaylist(owner.id, playlist.id, target.id, name)
        else if (action === 'remove' && removing) await api.admin.removePlaylistSong(owner.id, playlist.id, removing.platform + '_' + removing.songmid)
        else return
      } else return
      toast.success(action === 'copy' ? '已复制给 ' + target?.nickname + '，原歌单保持独立' : '歌单已更新')
      setAction(null); setVersion(v => v + 1)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const filteredSongs = playlist?.songs.filter(s => (s.name + ' ' + s.singer).toLowerCase().includes(query.toLowerCase())) ?? []
  return <div className="stack gap-16">
    <div className="admin-toolbar glass"><div className="grow"><h2>歌单管理</h2><p className="dim">{owner ? owner.nickname + '（@' + owner.username + '）的歌单' : '选择用户以查看其歌单与歌曲'}</p></div>
      <button className="btn btn--sm" disabled={busy} onClick={() => setChoosingUser(true)}>选择用户</button>
      {owner && <><button className="btn btn--sm" disabled={busy || loading} onClick={() => setVersion(v => v + 1)}>刷新</button><button className="btn btn--primary btn--sm" onClick={() => begin('create')}>新建歌单</button></>}
    </div>
    {error && <p role="alert">{error}</p>}
    {owner && <div className="admin-playlists-grid">
      <div className="glass admin-playlist-list">
        {loading ? <p>正在加载歌单…</p> : list.length === 0 ? <p className="dim">这个用户还没有歌单</p> : list.map(p => <button className={'admin-user-choice' + (p.id === selectedId ? ' is-active' : '')} key={p.id} onClick={() => setSelectedId(p.id)}>
          <strong>{p.name}</strong><span className="dim">{p.songCount} 首 · {new Date(p.updatedAt).toLocaleDateString()}</span>
        </button>)}
      </div>
      <div className="glass admin-playlist-detail stack gap-16">
        {detailError ? <p role="alert">{detailError}</p> : !playlist ? <p className="dim">{selectedId ? '正在加载歌曲…' : '从左侧选择歌单'}</p> : <>
          <h2>{playlist.name}</h2><p className="dim">{playlist.description || '暂无简介'} · {playlist.songs.length} 首</p>
          <div className="row gap-8 wrap"><button className="btn btn--sm" onClick={() => begin('edit')}>编辑名称与简介</button><button className="btn btn--sm btn--primary" onClick={() => begin('copy')}>复制给其他用户</button><button className="btn btn--sm" onClick={() => begin('delete')}>删除歌单</button></div>
          <input className="input" aria-label="搜索歌单歌曲" placeholder="搜索歌名或歌手" value={query} onChange={e => { setQuery(e.target.value); setSongPage(1) }} />
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>歌曲</th><th>歌手</th><th>平台</th><th>操作</th></tr></thead><tbody>
            {filteredSongs.slice((songPage - 1) * 50, songPage * 50).map(song => <tr key={song.platform + '_' + song.songmid}><td>{song.name}</td><td>{song.singer}</td><td>{song.platform}</td><td><button className="btn btn--sm btn--ghost" onClick={() => { setRemoving(song); begin('remove') }}>移除</button></td></tr>)}
          </tbody></table></div>
          {!filteredSongs.length && <p className="dim">没有歌曲</p>}
          {filteredSongs.length > 50 && <div className="row gap-8"><button className="btn btn--sm" disabled={songPage === 1} onClick={() => setSongPage(songPage - 1)}>上一页</button><span>{songPage} / {Math.ceil(filteredSongs.length / 50)}</span><button className="btn btn--sm" disabled={songPage * 50 >= filteredSongs.length} onClick={() => setSongPage(songPage + 1)}>下一页</button></div>}
        </>}
      </div>
    </div>}
    <Modal open={choosingUser} title="查看用户歌单" onClose={() => setChoosingUser(false)}><UserPicker onSelect={user => { setOwner(user); setList([]); setSelectedId(''); setPlaylist(null); setChoosingUser(false) }} /></Modal>
    <Modal open={action !== null} title={{ create: '新建歌单', edit: '编辑歌单', copy: '复制歌单给用户', delete: '删除歌单', remove: '移除歌曲' }[action ?? 'edit']} onClose={() => { if (!busy) setAction(null) }} footer={<><button className="btn" disabled={busy} onClick={() => setAction(null)}>取消</button><button className="btn btn--primary" disabled={busy || ((action === 'create' || action === 'edit' || action === 'copy') && !name.trim()) || (action === 'copy' && !target)} onClick={() => void submit()}>{busy ? '处理中…' : '确认'}</button></>}>
      <div className="stack gap-16">
        {(action === 'create' || action === 'edit' || action === 'copy') && <label>歌单名称<input className="input" maxLength={40} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>}
        {(action === 'create' || action === 'edit') && <label>简介<textarea className="input" maxLength={200} value={description} disabled={busy} onChange={e => setDescription(e.target.value)} /></label>}
        {action === 'copy' && <><p>将「{playlist?.name}」的 {playlist?.songs.length} 首歌曲复制成目标用户的独立新歌单。</p>{target ? <p>接收用户：<strong>{target.nickname}（@{target.username}）</strong><button className="btn btn--sm" disabled={busy} onClick={() => setTarget(null)}>重新选择</button></p> : <UserPicker disabled={busy} onSelect={setTarget} />}</>}
        {action === 'delete' && <p>确定删除 @{owner?.username} 的「{playlist?.name}」及其歌曲列表？此操作无法撤销。</p>}
        {action === 'remove' && <p>从「{playlist?.name}」移除「{removing?.name}」？其他歌单与收藏不受影响。</p>}
      </div>
    </Modal>
  </div>
}
