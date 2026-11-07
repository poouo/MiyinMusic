import { PLATFORM_NAMES } from '../lib/types'
import type { Song } from '../lib/types'
import { Cover } from './Cover'
import { PlayIcon } from './Icons'

interface SongTileProps {
  song: Song
  onClick: () => void
}

/** 新歌速递里的歌曲卡片，点一下直接播放 */
export function SongTile({ song, onClick }: SongTileProps) {
  return (
    <button className="tile song-tile" onClick={onClick} title={song.name + ' - ' + song.singer}>
      <div className="tile__cover">
        <Cover song={song} style={{ position: 'absolute', inset: 0 }} radius={14} />
        <span className="media-badge">{PLATFORM_NAMES[song.platform]}</span>
        <span className="media-play">
          <span className="media-play__btn">
            <PlayIcon size={17} />
          </span>
        </span>
      </div>
      <div className="tile__name ellipsis">{song.name}</div>
      <div className="tile__meta ellipsis">{song.singer || '未知歌手'}</div>
    </button>
  )
}
