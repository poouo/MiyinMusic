import { useEffect, useMemo, useRef, useState } from 'react'
import { useLibrary } from '../state/library'
import { usePlayer } from '../state/player'
import { useDownload } from '../lib/useDownload'
import { formatDuration, parseLyric, parseTranslation } from '../lib/format'
import { PLATFORM_NAMES, songKey } from '../lib/types'
import { imageSrc } from '../lib/api'
import { Cover } from './Cover'
import { QualityMenu } from './QualityMenu'
import { QueueList } from './QueueList'
import { QualityTag } from './SongList'
import {
  ChevronDownIcon,
  DownloadIcon,
  HeartIcon,
  ListMusicIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from './Icons'
import { Range } from './Range'

interface Props {
  open: boolean
  onClose: () => void
}

export function NowPlaying({ open, onClose }: Props) {
  const player = usePlayer()
  const library = useLibrary()
  const { download, canDownload } = useDownload()
  const [view, setView] = useState<'cover' | 'queue'>('cover')
  const lyricsRef = useRef<HTMLDivElement | null>(null)
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const current = player.current
  const lines = useMemo(() => parseLyric(player.lyric?.lyric ?? ''), [player.lyric])
  const translation = useMemo(() => parseTranslation(player.lyric?.tlyric ?? ''), [player.lyric])
  const activeIndex = useMemo(() => {
    let index = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= player.currentTime + 0.18) index = i
      else break
    }
    return index
  }, [lines, player.currentTime])

  useEffect(() => {
    if (!open) return
    const el = lineRefs.current.get(activeIndex)
    const container = lyricsRef.current
    if (!el || !container) return
    const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [activeIndex, open])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === ' ' && event.target === document.body) {
        event.preventDefault()
        player.togglePlay()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, player])

  if (!open || !current) return null

  const favorite = library.isFavorite(current)
  const background = imageSrc(current.img ?? undefined)

  return (
    <div className="now-playing">
      {background ? <div className="np__bg" style={{ backgroundImage: 'url(' + background + ')' }} /> : null}
      <div className="np__shade" />
      <div className="np__inner">
        <div className="np__head">
          <button className="icon-btn icon-btn--lg" onClick={onClose} aria-label="收起">
            <ChevronDownIcon size={24} />
          </button>
          <div className="dim" style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700 }}>
            正在播放
          </div>
          <div className="row gap-4">
            <button
              className={'icon-btn' + (view === 'cover' ? ' icon-btn--active' : '')}
              title="歌词"
              onClick={() => setView('cover')}
            >
              <MicIcon size={19} />
            </button>
            <button
              className={'icon-btn' + (view === 'queue' ? ' icon-btn--active' : '')}
              title="播放队列"
              onClick={() => setView('queue')}
            >
              <ListMusicIcon size={19} />
            </button>
          </div>
        </div>

        <div className="np__body">
          {view === 'cover' ? (
            <>
              <div className="np__art">
                <Cover song={current} className="np__cover" radius={26} lazy={false} />
                <div className="np__meta">
                  <div className="np__title ellipsis">{current.name}</div>
                  <div className="np__singer ellipsis">
                    {current.singer}
                    {current.albumName ? ' · ' + current.albumName : ''}
                  </div>
                  <div className="row gap-8 center" style={{ marginTop: 8, justifyContent: 'center' }}>
                    <QualityTag qualities={current.qualities} />
                  </div>
                </div>
              </div>

              <div className="np__lyrics" ref={lyricsRef}>
                {player.lyricLoading ? (
                  <div className="dim" style={{ padding: 20 }}>歌词加载中…</div>
                ) : lines.length === 0 ? (
                  <div className="dim" style={{ padding: 20 }}>暂无歌词</div>
                ) : (
                  lines.map((line, index) => {
                    const trans = translation.get(line.time.toFixed(2))
                    return (
                      <div
                        key={songKey(current) + '_' + index}
                        ref={(el) => {
                          if (el) lineRefs.current.set(index, el)
                          else lineRefs.current.delete(index)
                        }}
                        className={'lyric-line' + (index === activeIndex ? ' is-active' : '')}
                        onClick={() => player.seek(line.time)}
                      >
                        {line.text}
                        {trans ? <div className="lyric-trans">{trans}</div> : null}
                      </div>
                    )
                  })
                )}
              </div>
            </>
          ) : (
            <div style={{ gridColumn: '1 / -1', minHeight: 0, overflowY: 'auto', maxHeight: '100%' }}>
              <QueueList />
            </div>
          )}
        </div>

        <div className="np__controls">
          <div className="np__seek">
            <span className="player__time">{formatDuration(player.currentTime)}</span>
            <Range value={player.currentTime} max={player.duration || 0} onChange={(value) => player.seek(value)} ariaLabel="播放进度" />
            <span className="player__time">{formatDuration(player.duration)}</span>
          </div>
          <div className="np__buttons">
            <button
              className={'icon-btn' + (player.shuffle ? ' icon-btn--active' : '')}
              onClick={player.toggleShuffle}
              title="随机播放"
            >
              <ShuffleIcon size={19} />
            </button>
            <button className="icon-btn icon-btn--lg" onClick={player.prev} title="上一首">
              <SkipBackIcon size={22} />
            </button>
            <button className="play-btn" style={{ width: 58, height: 58 }} onClick={player.togglePlay}>
              {player.playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
            </button>
            <button className="icon-btn icon-btn--lg" onClick={() => player.next()} title="下一首">
              <SkipForwardIcon size={22} />
            </button>
            <button
              className={'icon-btn' + (player.repeat !== 'off' ? ' icon-btn--active' : '')}
              onClick={player.cycleRepeat}
              title="循环模式"
            >
              <RepeatIcon size={19} one={player.repeat === 'one'} />
            </button>
            <button
              className={'icon-btn' + (favorite ? ' icon-btn--active' : '')}
              onClick={() => void library.toggleFavorite(current)}
              title="收藏"
            >
              <HeartIcon size={20} filled={favorite} />
            </button>
            {canDownload ? (
              <button className="icon-btn" onClick={() => void download(current)} title="下载">
                <DownloadIcon size={20} />
              </button>
            ) : null}
            <QualityMenu
              value={player.quality}
              onChange={player.setQuality}
              available={current.qualities}
              placement="top"
              compact
            />
          </div>
        </div>
      </div>
    </div>
  )
}