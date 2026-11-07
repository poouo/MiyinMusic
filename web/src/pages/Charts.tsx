import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { navigate } from '../lib/router'
import { usePlayer } from '../state/player'
import { PLATFORM_NAMES, type ChartInfo, type Platform, type Song } from '../lib/types'
import { EmptyState } from '../components/EmptyState'
import { ChartTile } from '../components/ChartTile'
import { SongList } from '../components/SongList'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { ArrowLeftIcon, PlayIcon } from '../components/Icons'

const PLATFORM_ORDER: Platform[] = ['wy', 'tx', 'kw', 'kg', 'mg']

export function ChartsPage() {
  const [charts, setCharts] = useState<ChartInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [platform, setPlatform] = useState<Platform | 'all'>('all')

  useEffect(() => {
    let cancelled = false
    api
      .charts()
      .then((result) => {
        if (!cancelled) setCharts(result.charts)
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const groups = useMemo(() => {
    const map = new Map<Platform, ChartInfo[]>()
    for (const chart of charts) {
      const list = map.get(chart.platform) ?? []
      list.push(chart)
      map.set(chart.platform, list)
    }
    return PLATFORM_ORDER.filter((id) => map.has(id)).map((id) => ({ id, list: map.get(id) as ChartInfo[] }))
  }, [charts])

  // 「全部」时各平台交替出现，避免第一屏被同一个平台占满
  const allMixed = useMemo(() => {
    const out: ChartInfo[] = []
    for (let round = 0; out.length < charts.length; round++) {
      let added = false
      for (const group of groups) {
        if (group.list[round]) {
          out.push(group.list[round])
          added = true
        }
      }
      if (!added) break
    }
    return out
  }, [charts, groups])

  const shown = platform === 'all' ? allMixed : charts.filter((chart) => chart.platform === platform)

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">排行榜</h1>
          <p className="page-sub">
            {charts.length ? charts.length + ' 个榜单 · ' + groups.length + ' 个平台' : '聚合各平台热门榜单，每天更新'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="grid-cards">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="skeleton" style={{ height: 200, borderRadius: 16 }} />
          ))}
        </div>
      ) : charts.length === 0 ? (
        <EmptyState title="暂时没有榜单" description="音源恢复后榜单会重新出现。" />
      ) : (
        <>
          <div className="chip-row" style={{ marginBottom: 18 }}>
            <button className={'chip' + (platform === 'all' ? ' is-active' : '')} onClick={() => setPlatform('all')}>
              全部 {charts.length}
            </button>
            {groups.map((group) => (
              <button
                key={group.id}
                className={'chip' + (platform === group.id ? ' is-active' : '')}
                onClick={() => setPlatform(group.id)}
              >
                {PLATFORM_NAMES[group.id]} {group.list.length}
              </button>
            ))}
          </div>

          <div className="grid-cards">
            {shown.map((chart) => (
              <ChartTile key={chart.id} chart={chart} onClick={() => navigate('/chart/' + chart.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function ChartPage({ id }: { id: string }) {
  const player = usePlayer()
  const [songs, setSongs] = useState<Song[]>([])
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addTarget, setAddTarget] = useState<Song | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .chartSongs(id, 1, 100)
      .then((result) => {
        if (cancelled) return
        setSongs(result.result.list)
        if (result.chart?.name) setName(result.chart.name)
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [id])

  const platformName = platform ? PLATFORM_NAMES[platform] : ''

  return (
    <div className="fade-in">
      <button className="btn btn--ghost btn--sm" onClick={() => navigate('/charts')} style={{ marginBottom: 10 }}>
        <ArrowLeftIcon size={15} /> 全部榜单
      </button>
      <div className="page-head">
        <div>
          <h1 className="page-title">{name || '排行榜'}</h1>
          <p className="page-sub">
            {loading ? '加载中…' : (platformName ? platformName + ' · ' : '') + '共 ' + songs.length + ' 首歌曲'}
          </p>
        </div>
        {songs.length ? (
          <button className="btn btn--primary btn--sm" onClick={() => player.playSongs(songs, 0)}>
            <PlayIcon size={15} /> 播放全部
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="stack gap-10">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="skeleton" style={{ height: 58, borderRadius: 12 }} />
          ))}
        </div>
      ) : error ? (
        <EmptyState title="榜单加载失败" description={error} />
      ) : (
        <SongList
          songs={songs}
          onPlay={(index) => player.playSongs(songs, index)}
          onAddToPlaylist={setAddTarget}
          showIndex
        />
      )}

      <AddToPlaylistModal open={!!addTarget} song={addTarget} onClose={() => setAddTarget(null)} />
    </div>
  )
}
