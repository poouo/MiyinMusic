import { formatCount } from '../lib/format'
import type { SingerInfo } from '../lib/types'
import { Cover } from './Cover'

interface SingerTileProps {
  singer: SingerInfo
  onClick: () => void
}

/** 热门歌手：圆形头像 + 名字 + 粉丝数 */
export function SingerTile({ singer, onClick }: SingerTileProps) {
  return (
    <button className="singer-tile" onClick={onClick} title={singer.name}>
      <div className="singer-tile__avatar">
        <Cover src={singer.pic} style={{ position: 'absolute', inset: 0 }} radius="50%" />
      </div>
      <div className="singer-tile__name ellipsis">{singer.name}</div>
      <div className="singer-tile__meta ellipsis">
        {singer.followers ? formatCount(singer.followers) + ' 粉丝' : singer.area || '热门歌手'}
      </div>
    </button>
  )
}
