import { formatCount } from '../lib/format'
import { PLATFORM_NAMES } from '../lib/types'
import type { PlaylistInfo } from '../lib/types'
import { Cover } from './Cover'
import { PlayIcon } from './Icons'

interface PlaylistTileProps {
  playlist: PlaylistInfo
  onClick: () => void
}

/** 歌单 / 歌单广场卡片：封面 + 平台角标 + 播放量 */
export function PlaylistTile({ playlist, onClick }: PlaylistTileProps) {
  return (
    <button className="tile" onClick={onClick} title={playlist.name}>
      <div className="tile__cover">
        <Cover src={playlist.cover} style={{ position: 'absolute', inset: 0 }} radius={14} />
        <span className="media-badge">{PLATFORM_NAMES[playlist.platform]}</span>
        {playlist.playCount ? (
          <span className="media-count">
            <PlayIcon size={10} /> {formatCount(playlist.playCount)}
          </span>
        ) : null}
        <span className="media-play">
          <span className="media-play__btn">
            <PlayIcon size={17} />
          </span>
        </span>
      </div>
      <div className="tile__name ellipsis">{playlist.name}</div>
      <div className="tile__meta ellipsis">
        {playlist.creator || (playlist.trackCount ? playlist.trackCount + ' 首歌曲' : '精选歌单')}
      </div>
    </button>
  )
}
