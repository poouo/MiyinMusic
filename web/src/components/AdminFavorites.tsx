import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PLATFORM_NAMES, type AdminFavorites as FavoritesResult, type AdminUser } from '../lib/types'
import { formatDuration } from '../lib/format'
import { UserPicker } from './AdminPlaylists'
import { Modal } from './Modal'
import { HeartIcon, RefreshIcon, SearchIcon } from './Icons'

export function AdminFavorites({ initialUser }: { initialUser: AdminUser | null }) {
  const [owner, setOwner] = useState(initialUser)
  const [choosingUser, setChoosingUser] = useState(!initialUser)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [version, setVersion] = useState(0)
  const [data, setData] = useState<FavoritesResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!owner) return
    let cancelled = false
    setLoading(true)
    setData(null)
    setError('')
    const timer = setTimeout(() => {
      api.admin.userFavorites(owner.id, { q: query, page, limit: 50 })
        .then(result => {
          if (cancelled) return
          const lastPage = Math.max(1, Math.ceil(result.total / result.limit))
          if (result.page > lastPage) setPage(lastPage)
          else setData(result)
        })
        .catch((err: Error) => { if (!cancelled) setError(err.message) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [owner?.id, query, page, version])

  return (
    <div className="admin-favorites stack gap-16">
      <div className="admin-toolbar glass">
        <div className="grow">
          <h2>用户收藏</h2>
          <p className="dim">{owner ? owner.nickname + '（@' + owner.username + '）的「我的喜欢」' : '选择用户以查看其「我的喜欢」'}</p>
        </div>
        <button className="btn btn--sm" onClick={() => setChoosingUser(true)}>选择用户</button>
        {owner && <button className="btn btn--sm" disabled={loading} onClick={() => setVersion(value => value + 1)}><RefreshIcon size={14} /> 刷新</button>}
      </div>

      {owner && (
        <div className="admin-card glass stack gap-16" aria-busy={loading}>
          <div className="row gap-8 wrap">
            <HeartIcon size={18} />
            <h3 style={{ margin: 0 }}>我的喜欢</h3>
            <span className="dim">{data ? data.totalFavorites + ' 首' : '只读查看'}</span>
          </div>
          <div className="admin-search">
            <SearchIcon size={16} />
            <input aria-label="搜索用户收藏" placeholder="搜索歌名、歌手或专辑" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} />
          </div>
          {loading ? <p className="dim" role="status">正在加载收藏…</p> : error ? (
            <div className="stack gap-8"><p role="alert">{error}</p><button className="btn btn--sm" onClick={() => setVersion(value => value + 1)}>重试</button></div>
          ) : data && data.favorites.length > 0 ? (
            <>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>歌曲</th><th>歌手</th><th>专辑</th><th>平台</th><th className="num">时长</th><th>收藏时间</th></tr></thead>
                  <tbody>
                    {data.favorites.map(({ song, addedAt }) => (
                      <tr key={song.platform + '_' + song.songmid}>
                        <td>{song.name}</td><td>{song.singer || '未知歌手'}</td><td>{song.albumName || '—'}</td>
                        <td>{PLATFORM_NAMES[song.platform] ?? song.platform}</td>
                        <td className="num">{formatDuration(song.interval)}</td>
                        <td>{new Date(addedAt).toLocaleString('zh-CN', { hour12: false })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row gap-8 wrap">
                <button className="btn btn--sm" disabled={page === 1} onClick={() => setPage(value => value - 1)}>上一页</button>
                <span className="dim">第 {data.page} / {Math.ceil(data.total / data.limit)} 页 · {query.trim() ? '匹配 ' : '共 '}{data.total} 首</span>
                <button className="btn btn--sm" disabled={!data.hasMore} onClick={() => setPage(value => value + 1)}>下一页</button>
              </div>
            </>
          ) : data && <p className="dim">{query.trim() ? '没有匹配的收藏歌曲' : '这个用户还没有喜欢的歌曲'}</p>}
        </div>
      )}

      <Modal open={choosingUser} title="查看用户收藏" onClose={() => setChoosingUser(false)}>
        <UserPicker onSelect={user => {
          setOwner(user); setQuery(''); setPage(1); setData(null); setError('')
          setVersion(value => value + 1); setChoosingUser(false)
        }} />
      </Modal>
    </div>
  )
}
