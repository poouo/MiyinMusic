import { usePlayer } from '../state/player'
import { formatDuration } from '../lib/format'
import { songKey } from '../lib/types'
import { Cover } from './Cover'
import { PlayIcon, TrashIcon } from './Icons'

export function QueueList() {
  const player = usePlayer()
  if (!player.queue.length) {
    return <div className="empty">播放队列是空的</div>
  }
  return (
    <div className="list">
      {player.queue.map((song, index) => {
        const isCurrent = index === player.index
        return (
          <div key={songKey(song) + '_' + index} className={'song-row' + (isCurrent ? ' is-current' : '')} style={{ gridTemplateColumns: '26px 42px minmax(0, 1fr) 56px 36px', padding: '6px 8px' }}>
            <div className="song-row__index" onClick={() => player.playAt(index)}>
              {isCurrent ? <PlayIcon size={14} /> : index + 1}
            </div>
            <Cover song={song} className="song-row__cover" radius={9} style={{ width: 42, height: 42 }} />
            <div className="grow" onClick={() => player.playAt(index)}>
              <div className="song-row__name ellipsis">{song.name}</div>
              <div className="song-row__singer ellipsis">{song.singer}</div>
            </div>
            <div className="song-row__time">{formatDuration(song.interval)}</div>
            <button className="icon-btn" title="移出队列" onClick={() => player.removeFromQueue(index)}>
              <TrashIcon size={15} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
