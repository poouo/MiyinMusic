import type { RepeatMode } from './types'

export type PlaybackMode = 'off' | 'all' | 'one' | 'shuffle'
export const PLAYBACK_MODE_LABELS: Record<PlaybackMode, string> = {
  off: '顺序播放', all: '列表循环', one: '单曲循环', shuffle: '随机播放',
}
const MODES: PlaybackMode[] = ['off', 'all', 'one', 'shuffle']
export function playbackMode(repeat: RepeatMode, shuffle: boolean): PlaybackMode {
  return shuffle ? 'shuffle' : repeat
}
export function playbackSettings(mode: PlaybackMode): { repeat: RepeatMode; shuffle: boolean } {
  return { repeat: mode === 'shuffle' ? 'all' : mode, shuffle: mode === 'shuffle' }
}
export function nextPlaybackMode(mode: PlaybackMode): PlaybackMode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length]
}

/** -1 means stop; manual next always advances, including in single repeat. */
export function nextTrackIndex(index: number, count: number, mode: PlaybackMode, manual: boolean, random = Math.random): number {
  if (count <= 0) return -1
  if (mode === 'one' && !manual) return index
  if (mode === 'shuffle' && count > 1) {
    const pick = Math.min(count - 2, Math.floor(Math.max(0, random()) * (count - 1)))
    return pick >= index ? pick + 1 : pick
  }
  if (index + 1 < count) return index + 1
  return mode !== 'off' || manual ? 0 : -1
}
