import { useState } from 'react'
import { useLibrary } from '../state/library'
import { usePlayer } from '../state/player'
import { useSettings } from '../state/settings'
import { useDownload } from '../lib/useDownload'
import { useActiveLyric } from '../lib/useActiveLyric'
import { PlayerLyric } from './PlayerLyric'
import { formatDuration } from '../lib/format'
import { Cover } from './Cover'
import { Modal } from './Modal'
import { QueueList } from './QueueList'
import { QualityMenu } from './QualityMenu'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  HeartIcon,
  ListMusicIcon,
  LoaderIcon,
  MaximizeIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  VolumeIcon,
  VolumeMuteIcon,
} from './Icons'
import { Range } from './Range'

export function PlayerBar({ onOpenNowPlaying }: { onOpenNowPlaying: () => void }) {
  const player = usePlayer()
  const library = useLibrary()
  const { settings, update } = useSettings()
  const { download, canDownload } = useDownload()
  const lyric = useActiveLyric()
  const [queueOpen, setQueueOpen] = useState(false)
  const current = player.current
  const favorite = current ? library.isFavorite(current) : false
  const collapsed = settings.compactPlayer

  if (!current) return null

  // 收起状态：只留一个小的播放状态，悬停出现「展开 / 展开全部」
  if (collapsed) {
    const percent = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0
    return (
      <div className="player-orb" title={current.name}>
        <button className="player-orb__cover" onClick={onOpenNowPlaying} aria-label="打开播放页">
          <Cover song={current} radius="50%" style={{ width: '100%', height: '100%' }} />
          <span className="player-orb__ring" style={{ background: 'conic-gradient(var(--accent) ' + percent + '%, transparent 0)' }} />
          <span className="player-orb__pulse" data-playing={player.playing ? '1' : '0'} />
        </button>
        <div className="player-orb__actions">
          <button className="icon-btn" title="展开播放条" onClick={() => update({ compactPlayer: false })}>
            <ChevronRightIcon size={18} />
          </button>
          <button className="icon-btn" title="展开全部" onClick={onOpenNowPlaying}>
            <MaximizeIcon size={17} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="player glass-bar">
        <div className="player__now">
          <Cover song={current} className="player__cover" radius={12} onClick={onOpenNowPlaying} />
          <div className="player__meta" onClick={onOpenNowPlaying}>
            <div className="player__title ellipsis">{current.name}</div>
            <div className="player__singer ellipsis">{current.singer || '未知歌手'}</div>
          </div>
        </div>

        <div className="player__transport">
          <button
            className={'icon-btn' + (player.shuffle ? ' icon-btn--active' : '')}
            title={player.shuffle ? '随机播放：开' : '随机播放'}
            onClick={player.toggleShuffle}
          >
            <ShuffleIcon size={15} />
          </button>
          <button className="icon-btn" title="上一首" onClick={player.prev}>
            <SkipBackIcon size={18} />
          </button>
          <button className="play-btn play-btn--sm" onClick={player.togglePlay} aria-label={player.playing ? '暂停' : '播放'}>
            {player.loading ? <LoaderIcon size={17} /> : player.playing ? <PauseIcon size={17} /> : <PlayIcon size={17} />}
          </button>
          <button className="icon-btn" title="下一首" onClick={() => player.next()}>
            <SkipForwardIcon size={18} />
          </button>
          <button
            className={'icon-btn' + (player.repeat !== 'off' ? ' icon-btn--active' : '')}
            title={player.repeat === 'one' ? '单曲循环' : player.repeat === 'all' ? '列表循环' : '顺序播放'}
            onClick={player.cycleRepeat}
          >
            <RepeatIcon size={15} one={player.repeat === 'one'} />
          </button>
        </div>

        <div className="player__stage" onClick={onOpenNowPlaying} title="展开播放页">
          <div className="player__lyric">
            <span className="player__lyric-badge">
              <MusicIcon size={11} />
            </span>
            {lyric.ready ? (
              <PlayerLyric
                text={lyric.line}
                start={lyric.start}
                end={lyric.end}
                time={player.currentTime}
                playing={player.playing}
                lineKey={lyric.index}
              />
            ) : (
              <span className="player__lyric-text is-empty">{lyric.line}</span>
            )}
          </div>
          <div className="player__progress" onClick={(event) => event.stopPropagation()}>
            <span className="player__time">{formatDuration(player.currentTime)}</span>
            <Range value={player.currentTime} max={player.duration || 0} onChange={(value) => player.seek(value)} ariaLabel="播放进度" />
            <span className="player__time">{formatDuration(player.duration)}</span>
          </div>
        </div>

        <div className="player__right">
          <button
            className={'icon-btn' + (favorite ? ' icon-btn--active' : '')}
            title={favorite ? '取消收藏' : '收藏'}
            onClick={() => void library.toggleFavorite(current)}
          >
            <HeartIcon size={17} filled={favorite} />
          </button>
          {canDownload ? (
            <button className="icon-btn" title="下载这首歌" onClick={() => void download(current)}>
              <DownloadIcon size={16} />
            </button>
          ) : null}
          <QualityMenu value={player.quality} onChange={player.setQuality} available={current.qualities} compact />
          <button className="icon-btn" title="播放队列" onClick={() => setQueueOpen(true)}>
            <ListMusicIcon size={17} />
          </button>
          <button className="icon-btn" title={player.muted ? '取消静音' : '静音'} onClick={player.toggleMute}>
            {player.muted || player.volume === 0 ? (
              <VolumeMuteIcon size={17} />
            ) : (
              <VolumeIcon size={17} level={player.volume > 0.5 ? 2 : 1} />
            )}
          </button>
          <button className="icon-btn" title="收起播放条" onClick={() => update({ compactPlayer: true })}>
            <ChevronDownIcon size={18} />
          </button>
        </div>
      </div>

      <Modal open={queueOpen} title={'播放队列 · ' + player.queue.length + ' 首'} onClose={() => setQueueOpen(false)}>
        <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
          <button className="btn btn--sm btn--ghost" onClick={player.clearQueue}>
            清空队列
          </button>
        </div>
        <QueueList />
      </Modal>
    </>
  )
}