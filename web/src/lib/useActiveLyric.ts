import { useMemo } from 'react'
import { parseLyric } from './format'
import { usePlayer } from '../state/player'

export interface ActiveLyric {
  line: string
  /** 当前句开始 / 结束时间（秒） */
  start: number
  end: number
  index: number
  ready: boolean
}

/** 当前正在唱的那一句歌词 */
export function useActiveLyric(): ActiveLyric {
  const player = usePlayer()
  const lines = useMemo(() => parseLyric(player.lyric?.lyric ?? ''), [player.lyric])

  const index = useMemo(() => {
    let found = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= player.currentTime + player.lyricOffset + 0.2) found = i
      else break
    }
    return found
  }, [lines, player.currentTime, player.lyricOffset])

  if (!player.current) return { line: '', start: 0, end: 0, index: -1, ready: false }
  if (index < 0) {
    return { line: player.current.name, start: 0, end: 0, index: -1, ready: lines.length > 0 }
  }

  const start = lines[index].time - player.lyricOffset
  const end = (lines[index + 1]?.time ?? lines[index].time + Math.max(4, player.duration - lines[index].time)) - player.lyricOffset
  return { line: lines[index].text, start, end, index, ready: true }
}
