import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { navigate } from '../lib/router'
import type { Platform, PlaylistInfo } from '../lib/types'
import { EmptyState } from '../components/EmptyState'
import { PlaylistTile } from '../components/PlaylistTile'
import { LoaderIcon } from '../components/Icons'

const FILTERS: { key: Platform | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'wy', label: '网易云音乐' },
  { key: 'tx', label: 'QQ 音乐' },
]

/** 歌单广场：按平台筛选，支持加载更多 */
export function SquarePage() {
  const [platform, setPlatform] = useState<Platform | 'all'>('all')
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const load = useCallback(async (target: Platform | 'all', nextPage: number, append: boolean) => {
    const id = ++requestId.current
    if (append) setLoadingMore(true)
    else {
      setLoading(true)
      setError(null)
    }
    try {
      const result = await api.discoverPlaylists({ page: nextPage, limit: 24, platform: target })
      if (id !== requestId.current) return
      setPlaylists((current) => {
        const merged = append ? [...current] : []
        const seen = new Set(merged.map((item) => item.id))
        for (const item of result.playlists) {
          if (seen.has(item.id)) continue
          seen.add(item.id)
          merged.push(item)
        }
        return merged
      })
      setPage(nextPage)
      setHasMore(result.hasMore)
    } catch (err) {
      if (id !== requestId.current) return
      if (!append) {
        setPlaylists([])
        setError(err instanceof Error ? err.message : '歌单加载失败')
      }
    } finally {
      if (id === requestId.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    void load(platform, 1, false)
  }, [platform, load])

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">歌单广场</h1>
          <p className="page-sub">网易云音乐 / QQ 音乐精选歌单 · 每天更新</p>
        </div>
        {!loading && !error ? <span className="faint" style={{ fontSize: 12.5 }}>已加载 {playlists.length} 个歌单</span> : null}
      </div>

      <div className="chip-row" style={{ marginBottom: 18 }}>
        {FILTERS.map((filter) => (
          <button
            key={filter.key}
            className={'chip' + (platform === filter.key ? ' is-active' : '')}
            onClick={() => setPlatform(filter.key)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid-cards">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="skeleton" style={{ aspectRatio: '1 / 1.22', borderRadius: 16 }} />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="歌单加载失败"
          description={error}
          action={
            <button className="btn btn--sm" onClick={() => void load(platform, 1, false)}>
              重新加载
            </button>
          }
        />
      ) : playlists.length === 0 ? (
        <EmptyState
          title="暂时没有歌单"
          description="上游平台暂时没有返回内容，稍后再来看看。"
          action={
            <button className="btn btn--sm" onClick={() => navigate('/')}>
              回到发现页
            </button>
          }
        />
      ) : (
        <>
          <div className="grid-cards">
            {playlists.map((playlist) => (
              <PlaylistTile
                key={playlist.id}
                playlist={playlist}
                onClick={() => navigate('/square/' + encodeURIComponent(playlist.id))}
              />
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 26 }}>
            {hasMore ? (
              <button className="btn btn--ghost" disabled={loadingMore} onClick={() => void load(platform, page + 1, true)}>
                {loadingMore ? <LoaderIcon size={15} /> : null}
                {loadingMore ? '加载中…' : '加载更多歌单'}
              </button>
            ) : (
              <span className="faint" style={{ fontSize: 12.5 }}>没有更多歌单了</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
