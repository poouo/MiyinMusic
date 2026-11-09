import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { navigate } from '../lib/router'
import { useLibrary } from '../state/library'
import { usePlayer } from '../state/player'
import { useSettings } from '../state/settings'
import { formatCount } from '../lib/format'
import { PLATFORM_NAMES, PLATFORMS } from '../lib/types'
import type { ChartInfo, PlaylistInfo, SingerInfo, Song, SourceInfo } from '../lib/types'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { ChartTile } from '../components/ChartTile'
import { Cover } from '../components/Cover'
import { EmptyState } from '../components/EmptyState'
import { PlaylistTile } from '../components/PlaylistTile'
import { SingerTile } from '../components/SingerTile'
import { SongList } from '../components/SongList'
import { SongTile } from '../components/SongTile'
import { ForYou } from '../components/ForYou'
import {
  ChevronRightIcon,
  ClockIcon,
  DiscIcon,
  FolderIcon,
  MusicIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
} from '../components/Icons'

let chartsCache: ChartInfo[] | null = null
let sourcesCache: SourceInfo[] | null = null
let playlistsCache: PlaylistInfo[] | null = null
let newSongsCache: Song[] | null = null
let singersCache: SingerInfo[] | null = null

export function DiscoverPage() {
  const library = useLibrary()
  const player = usePlayer()
  const { settings, update } = useSettings()

  const [charts, setCharts] = useState<ChartInfo[]>(chartsCache ?? [])
  const [chartsLoading, setChartsLoading] = useState(!chartsCache)
  const [sources, setSources] = useState<SourceInfo[]>(sourcesCache ?? [])
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>(playlistsCache ?? [])
  const [playlistsLoading, setPlaylistsLoading] = useState(!playlistsCache)
  const [newSongs, setNewSongs] = useState<Song[]>(newSongsCache ?? [])
  const [newSongsLoading, setNewSongsLoading] = useState(!newSongsCache)
  const [singers, setSingers] = useState<SingerInfo[]>(singersCache ?? [])
  const [singersLoading, setSingersLoading] = useState(!singersCache)

  const [query, setQuery] = useState('')
  const [addTarget, setAddTarget] = useState<Song | null>(null)

  // 各平台榜单交替展示，避免首页只看到同一个平台
  const mixedCharts = useMemo(() => {
    const byPlatform = new Map<string, ChartInfo[]>()
    for (const chart of charts) {
      const list = byPlatform.get(chart.platform) ?? []
      list.push(chart)
      byPlatform.set(chart.platform, list)
    }
    const out: ChartInfo[] = []
    for (let round = 0; round < 8 && out.length < 12; round++) {
      for (const list of byPlatform.values()) {
        if (list[round] && out.length < 12) out.push(list[round])
      }
    }
    return out
  }, [charts])

  useEffect(() => {
    let cancelled = false

    if (chartsCache) setCharts(chartsCache)
    else {
      api
        .charts()
        .then((result) => {
          chartsCache = result.charts
          if (!cancelled) setCharts(result.charts)
        })
        .catch(() => undefined)
        .finally(() => { if (!cancelled) setChartsLoading(false) })
    }

    if (sourcesCache) setSources(sourcesCache)
    else {
      api
        .sources()
        .then((result) => {
          sourcesCache = result.sources
          if (!cancelled) setSources(result.sources)
        })
        .catch(() => undefined)
    }

    if (playlistsCache) {
      setPlaylists(playlistsCache)
      setPlaylistsLoading(false)
    } else {
      api
        .discoverPlaylists({ limit: 12 })
        .then((result) => {
          playlistsCache = result.playlists
          if (!cancelled) setPlaylists(result.playlists)
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setPlaylistsLoading(false)
        })
    }

    if (newSongsCache) {
      setNewSongs(newSongsCache)
      setNewSongsLoading(false)
    } else {
      api
        .newSongs(12)
        .then((result) => {
          newSongsCache = result.songs
          if (!cancelled) setNewSongs(result.songs)
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setNewSongsLoading(false)
        })
    }

    if (singersCache) {
      setSingers(singersCache)
      setSingersLoading(false)
    } else {
      api
        .singers(12)
        .then((result) => {
          singersCache = result.singers
          if (!cancelled) setSingers(result.singers)
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setSingersLoading(false)
        })
    }

    return () => {
      cancelled = true
    }
  }, [])

  const readySources = sources.filter((source) => source.status === 'ready')
  const history = library.data.history.slice(0, 6).map((entry) => entry.song)
  const playlists0 = library.data.playlists.slice(0, 6)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const keyword = query.trim()
    if (!keyword) {
      navigate('/search')
      return
    }
    navigate('/search?q=' + encodeURIComponent(keyword) + '&platform=' + settings.defaultPlatform)
  }

  const featured = playlists[0]

  return (
    <div className="discover-page fade-in">
      <section className="hero">
        <div className="hero__content">
          <div className="hero__eyebrow"><span className="record-tick" /> 觅音 · 音乐发现</div>
          <h1 className="hero__title">
            从五个平台，
            <br />
            找到你的下一首
          </h1>
          <p className="hero__description">搜索想听的歌，也为偶然的喜欢留一点位置</p>
          <form className="searchbox hero__search" onSubmit={submit}>
            <SearchIcon size={19} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="歌曲、歌手或专辑"
              aria-label="搜索"
            />
            <button type="submit" className="btn btn--primary btn--sm">
              搜索
            </button>
          </form>
          <div className="chip-row hero__platforms" aria-label="搜索平台">
            {PLATFORMS.map((platform) => (
              <button
                key={platform}
                className={'chip' + (settings.defaultPlatform === platform ? ' is-active' : '')}
                aria-pressed={settings.defaultPlatform === platform}
                onClick={() => update({ defaultPlatform: platform })}
              >
                {PLATFORM_NAMES[platform]}
              </button>
            ))}
          </div>
        </div>
        <div className="hero__feature">
          <div className="record-scene" aria-hidden="true">
            <div className="record"><div className="record__label"><DiscIcon size={28} /></div></div>
            {featured ? <Cover src={featured.cover} className="record-sleeve" radius={8} lazy={false} /> : <div className="record-sleeve record-sleeve--empty"><MusicIcon size={40} /><span>觅音</span></div>}
          </div>
          {featured ? (
            <button className="hero__feature-link" onClick={() => navigate('/square/' + encodeURIComponent(featured.id))}>
              <span className="hero__feature-label">精选歌单</span>
              <span className="hero__feature-name">{featured.name}</span>
              <span className="hero__feature-action">听听这张歌单 <ChevronRightIcon size={16} /></span>
            </button>
          ) : <div className="hero__feature-caption">每一次寻找，都是新的相遇</div>}
        </div>
        <div className="stat-strip">
          <div className="stat">
            <span className="stat__value">{readySources.length}</span>
            <span className="stat__label">个音源在线</span>
          </div>
          <div className="stat">
            <span className="stat__value">{charts.length || '—'}</span>
            <span className="stat__label">个榜单</span>
          </div>
          <div className="stat">
            <span className="stat__value">{formatCount(library.data.favorites.length)}</span>
            <span className="stat__label">首喜欢的歌</span>
          </div>
          <div className="stat">
            <span className="stat__value">{library.data.playlists.length}</span>
            <span className="stat__label">个歌单</span>
          </div>
        </div>
      </section>

      <ForYou />
      <section className="section">
        <div className="section__head">
          <div className="section__title">
            推荐歌单
          </div>
          <button className="section__more" onClick={() => navigate('/square')}>
            全部歌单 <ChevronRightIcon size={13} />
          </button>
        </div>
        {playlistsLoading ? (
          <div className="grid-cards">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="skeleton" style={{ aspectRatio: '1 / 1.22', borderRadius: 16 }} />
            ))}
          </div>
        ) : playlists.length === 0 ? (
          <div className="section-unavailable">暂时没有推荐歌单，可稍后重试或搜索想听的歌</div>
        ) : (
          <div className="grid-cards">
            {playlists.map((playlist) => (
              <PlaylistTile
                key={playlist.id}
                playlist={playlist}
                onClick={() => navigate('/square/' + encodeURIComponent(playlist.id))}
              />
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <div className="section__title">
            排行榜
          </div>
          <button className="section__more" onClick={() => navigate('/charts')}>
            全部榜单 <ChevronRightIcon size={13} />
          </button>
        </div>
        {chartsLoading ? (
          <div className="chart-scroller">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="skeleton" style={{ width: 156, height: 196, borderRadius: 16 }} />
            ))}
          </div>
        ) : charts.length === 0 ? (
          <div className="section-unavailable">排行榜暂时不可用，请稍后重试</div>
        ) : (
          <div className="chart-scroller">
            {mixedCharts.map((chart) => (
              <ChartTile key={chart.id} chart={chart} onClick={() => navigate('/chart/' + chart.id)} />
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <div className="section__title">
            新歌速递
          </div>
          {newSongs.length ? (
            <button className="section__more" onClick={() => player.playSongs(newSongs, 0)}>
              <PlayIcon size={12} /> 播放全部
            </button>
          ) : null}
        </div>
        {newSongsLoading ? (
          <div className="rail">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="skeleton" style={{ height: 214, borderRadius: 16 }} />
            ))}
          </div>
        ) : newSongs.length === 0 ? (
          <div className="section-unavailable">新歌暂时不可用，试试搜索喜欢的歌手</div>
        ) : (
          <div className="rail">
            {newSongs.map((song, index) => (
              <div className="rail__item" key={song.platform + '_' + song.songmid}>
                <SongTile song={song} onClick={() => player.playSongs(newSongs, index)} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <div className="section__title">
            热门歌手
          </div>
          <span className="section__more" style={{ pointerEvents: 'none' }}>
            来自 QQ 音乐
          </span>
        </div>
        {singersLoading ? (
          <div className="rail rail--singers">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="skeleton" style={{ height: 158, borderRadius: 999 }} />
            ))}
          </div>
        ) : singers.length === 0 ? (
          <div className="section-unavailable">歌手列表暂时不可用，请稍后重试</div>
        ) : (
          <div className="rail rail--singers">
            {singers.map((singer) => (
              <div className="rail__item" key={singer.id}>
                <SingerTile
                  singer={singer}
                  onClick={() => navigate('/singer/' + encodeURIComponent(singer.id) + '?name=' + encodeURIComponent(singer.name))}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {history.length > 0 ? (
      <section className="section">
        <div className="section__head">
          <div className="section__title">
            <ClockIcon size={18} /> 最近播放
          </div>
          <button className="section__more" onClick={() => navigate('/library')}>
            查看全部 <ChevronRightIcon size={13} />
          </button>
        </div>
        <SongList
          songs={history}
          onPlay={(index) => player.playSongs(history, index)}
          onAddToPlaylist={setAddTarget}
          showIndex={false}
          showAlbum={false}
        />
      </section>
      ) : null}

      <section className="section">
        <div className="section__head">
          <div className="section__title">
            <FolderIcon size={18} /> 我的歌单
          </div>
          <button className="section__more" onClick={() => navigate('/library')}>
            管理歌单 <ChevronRightIcon size={13} />
          </button>
        </div>
        {playlists0.length === 0 ? (
          <EmptyState
            icon={<FolderIcon size={24} />}
            title="还没有歌单"
            description="把喜欢的歌整理成歌单，登录后还能跨设备同步。"
            action={
              <button className="btn btn--primary btn--sm" onClick={() => navigate('/library')}>
                <PlusIcon size={15} /> 创建歌单
              </button>
            }
          />
        ) : (
          <div className="grid-cards">
            {playlists0.map((playlist) => (
              <button key={playlist.id} className="tile" onClick={() => navigate('/playlist/' + playlist.id)}>
                <div className="tile__cover">
                  {playlist.songs[0] ? (
                    <Cover song={playlist.songs[0]} radius={14} style={{ position: 'absolute', inset: 0 }} />
                  ) : (
                    <div className="cover" style={{ position: 'absolute', inset: 0, borderRadius: 14 }}>
                      <div className="cover__fallback" style={{ fontSize: 26 }}>
                        <FolderIcon size={26} />
                      </div>
                    </div>
                  )}
                </div>
                <div className="tile__name ellipsis">{playlist.name}</div>
                <div className="tile__meta">{playlist.songs.length} 首歌曲</div>
              </button>
            ))}
          </div>
        )}
      </section>

      <AddToPlaylistModal open={!!addTarget} song={addTarget} onClose={() => setAddTarget(null)} />
    </div>
  )
}
