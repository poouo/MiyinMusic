import { usePlayer } from '../state/player'
import { useActiveLyric } from '../lib/useActiveLyric'
import { Cover } from './Cover'
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from './Icons'

export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const player = usePlayer()
  const lyric = useActiveLyric()
  const current = player.current
  if (!current) return null
  const percent = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0
  return (
    <div className="mini-player" onClick={onOpen}>
      <Cover song={current} className="mini-player__cover" radius={10}>
        <div className="mini-player__progress" style={{ width: percent + '%' }} />
      </Cover>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis" style={{ fontSize: 13.5, fontWeight: 500 }}>
          {current.name}
        </div>
        <div className="ellipsis mini-player__lyric">{lyric.ready ? lyric.line : current.singer}</div>
      </div>
      <div className="mini-player__controls" onClick={event => event.stopPropagation()}>
        <button className="icon-btn" onClick={player.prev} aria-label="上一首" title="上一首">
          <SkipBackIcon size={18} />
        </button>
        <button className="icon-btn" onClick={player.togglePlay} aria-label={player.playing ? '暂停' : '播放'}>
          {player.playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
        </button>
        <button className="icon-btn" onClick={player.next} aria-label="下一首">
          <SkipForwardIcon size={18} />
        </button>
      </div>
    </div>
  )
}
