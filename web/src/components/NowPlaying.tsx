import { useEffect, useMemo, useRef, useState } from 'react'
import { useLibrary } from '../state/library'
import { usePlayer } from '../state/player'
import { useDownload } from '../lib/useDownload'
import { formatDuration, parseLyric, parseTranslation } from '../lib/format'
import { songKey } from '../lib/types'
import { Cover } from './Cover'
import { QualityMenu } from './QualityMenu'
import { QueueList } from './QueueList'
import { Modal } from './Modal'
import { VolumeControl } from './VolumeControl'
import { PlaybackModeButton } from './PlaybackModeButton'
import { QualityTag } from './SongList'
import {
  ChevronDownIcon,
  DownloadIcon,
  HeartIcon,
  ListMusicIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from './Icons'
import { Range } from './Range'
import { ListeningTools } from './ListeningTools'

interface Props {
  open: boolean
  onClose: () => void
}

export function NowPlaying({ open, onClose }: Props) {
  const player = usePlayer()
  const library = useLibrary()
  const { download, canDownload } = useDownload()
  const [queueOpen, setQueueOpen] = useState(false)
  const [immersive, setImmersive] = useState(false)
  const pointerOutside = useRef(false)
  const lyricsRef = useRef<HTMLDivElement | null>(null)
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const current = player.current
  const lines = useMemo(() => parseLyric(player.lyric?.lyric ?? ''), [player.lyric])
  const translation = useMemo(() => parseTranslation(player.lyric?.tlyric ?? ''), [player.lyric])
  const activeIndex = useMemo(() => {
    let index = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= player.currentTime + player.lyricOffset + 0.18) index = i
      else break
    }
    return index
  }, [lines, player.currentTime, player.lyricOffset])

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
      if (event.key === 'Escape' && !queueOpen) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, queueOpen])

  useEffect(() => {
    if (!open || !player.playing || queueOpen || !window.matchMedia('(hover: hover)').matches) { setImmersive(false); return }
    let timer: ReturnType<typeof setTimeout> | undefined
    const restore = () => { pointerOutside.current = false; clearTimeout(timer); setImmersive(false) }
    const leave = () => {
      pointerOutside.current = true
      clearTimeout(timer)
      timer = setTimeout(() => setImmersive(true), 8000)
    }
    const onOut = (event: MouseEvent) => { if (!event.relatedTarget) leave() }
    document.addEventListener('mouseout', onOut)
    document.addEventListener('pointermove', restore)
    document.addEventListener('keydown', restore)
    window.addEventListener('blur', leave)
    if (pointerOutside.current) leave()
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('pointermove', restore)
      document.removeEventListener('keydown', restore)
      window.removeEventListener('blur', leave)
    }
  }, [open, player.playing, queueOpen])

  if (!open || !current) return null

  const favorite = library.isFavorite(current)

  return (
    <div className={"now-playing" + (immersive ? " now-playing--immersive" : "")} role="dialog" aria-modal="true" aria-label="正在播放">
      <div className="np__inner">
        <div className="np__head">
          <button className="icon-btn icon-btn--lg" onClick={onClose} aria-label="收起">
            <ChevronDownIcon size={24} />
          </button>
          <div className="dim" style={{ fontSize: 13, fontWeight: 500 }}>
            正在播放
          </div>
          <div className="row gap-4">
            <ListeningTools />
            <button
              className="icon-btn"
              title="播放队列"
              aria-label="播放队列"
              onClick={() => setQueueOpen(true)}
            >
              <ListMusicIcon size={19} />
            </button>
          </div>
        </div>

        <div className="np__body">
          <div className="np__art">
            <Cover song={current} className="np__cover" radius={12} lazy={false} />
          </div>

          <div className="np__reading">
            <div className="np__meta">
              <div className="np__title ellipsis">{current.name}</div>
              <div className="np__singer ellipsis">
                {current.singer}
                {current.albumName ? ' · ' + current.albumName : ''}
              </div>
              <div className="row gap-8 center" style={{ marginTop: 8, justifyContent: 'center' }}>
                {player.actualQuality ? <><span className="dim" style={{ fontSize: 12 }}>正在播放</span><QualityTag qualities={[player.actualQuality]} />{player.actualQuality === '128k' && <span className="dim">标准</span>}</> : null}
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
                    onClick={() => player.seek(Math.max(0, line.time - player.lyricOffset))}
                  >
                    {line.text}
                    {trans ? <div className="lyric-trans">{trans}</div> : null}
                  </div>
                )
              })
            )}
          </div>
          </div>
        </div>

        <div className="np__controls" {...(immersive ? { inert: "" } : {})}>
          <div className="np__seek">
            <span className="player__time">{formatDuration(player.currentTime)}</span>
            <Range value={player.currentTime} max={player.duration || 0} onChange={(value) => player.seek(value)} ariaLabel="播放进度" />
            <span className="player__time">{formatDuration(player.duration)}</span>
          </div>
          <div className="np__buttons">
            <PlaybackModeButton />
            <button className="icon-btn icon-btn--lg" onClick={player.prev} title="上一首">
              <SkipBackIcon size={22} />
            </button>
            <button className="play-btn" style={{ width: 56, height: 56 }} onClick={player.togglePlay} aria-label={player.playing ? '暂停' : '播放'}>
              {player.playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
            </button>
            <button className="icon-btn icon-btn--lg" onClick={() => player.next()} title="下一首">
              <SkipForwardIcon size={22} />
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
          <div className="np__volume"><VolumeControl /></div>
        </div>
      </div>
      <Modal open={queueOpen} title={'播放队列 · ' + player.queue.length + ' 首'} onClose={() => setQueueOpen(false)}>
        <QueueList />
      </Modal>
    </div>
  )
}
