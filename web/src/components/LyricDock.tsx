import { useMemo } from 'react'
import { usePlayer } from '../state/player'
import { parseLyric } from '../lib/format'
import { MusicIcon } from './Icons'

interface Props {
  onExpand: () => void
}

/** 悬浮在播放条上方的「当前歌词」胶囊，点击展开全屏播放页 */
export function LyricDock({ onExpand }: Props) {
  const player = usePlayer()
  const lines = useMemo(() => parseLyric(player.lyric?.lyric ?? ''), [player.lyric])

  const active = useMemo(() => {
    let index = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= player.currentTime + 0.2) index = i
      else break
    }
    return index
  }, [lines, player.currentTime])

  if (!player.current) return null

  const text = active >= 0 ? lines[active].text : player.current.name
  const next = active >= 0 && lines[active + 1] ? lines[active + 1].text : player.current.singer

  return (
    <div
      className="lyric-dock"
      onClick={onExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onExpand()
      }}
      title="展开播放页"
    >
      <span className="lyric-dock__icon">
        <MusicIcon size={13} />
      </span>
      <span className="lyric-dock__body">
        <span className="lyric-dock__line">{text}</span>
        <span className="lyric-dock__next">{next}</span>
      </span>
      <span className="lyric-dock__expand">展开</span>
    </div>
  )
}
