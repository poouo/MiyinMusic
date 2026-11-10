import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../lib/api'
import { imageSrc } from '../lib/api'
import { loadJson, saveJson } from '../lib/storage'
import { songKey } from '../lib/types'
import type { LyricResult, Quality, RepeatMode, Song } from '../lib/types'
import { useLibrary } from './library'
import { useSettings } from './settings'
import { useToast } from './toast'
import { nextPlaybackMode, nextTrackIndex, playbackMode, playbackSettings, type PlaybackMode } from '../lib/playback'
import { BrowserEqualizer } from '../lib/equalizer'
import { PlaybackLoad } from '../lib/playbackLoad'
import type { UrlResult } from '../lib/types'

interface PersistedState {
  queue: Song[]
  index: number
  repeat: RepeatMode
  shuffle: boolean
  position?: number
}

interface PlayerApi {
  actualQuality: Quality | null
  eqEnabled: boolean
  eqGains: number[]
  setEqualizer: (enabled: boolean, gains?: number[]) => void
  sleepUntil: number | null
  stopAfterTrack: boolean
  setSleep: (minutes: number | 'track' | null) => void
  lyricOffset: number
  setLyricOffset: (seconds: number) => void
  queue: Song[]
  index: number
  current: Song | null
  playing: boolean
  loading: boolean
  error: string | null
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  repeat: RepeatMode
  shuffle: boolean
  quality: Quality
  sourceName: string | null
  lyric: LyricResult | null
  lyricLoading: boolean
  playSongs: (songs: Song[], startIndex?: number) => void
  playSong: (song: Song, list?: Song[]) => void
  togglePlay: () => void
  next: () => void
  prev: () => void
  seek: (time: number) => void
  setVolume: (value: number) => void
  toggleMute: () => void
  cycleRepeat: () => void
  setPlaybackMode: (mode: PlaybackMode) => void
  toggleShuffle: () => void
  setQuality: (quality: Quality) => void
  playAt: (index: number) => void
  addToQueue: (song: Song, position?: 'next' | 'end') => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
  stop: () => void
}

const PlayerContext = createContext<PlayerApi | null>(null)

const PERSIST_KEY = 'player.v1'

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { settings, update: updateSettings } = useSettings()
  const library = useLibrary()
  const toast = useToast()

  const persisted = useRef<PersistedState>(
    loadJson<PersistedState>(PERSIST_KEY, { queue: [], index: 0, repeat: 'all', shuffle: false }),
  )

  const [queue, setQueue] = useState<Song[]>(() => persisted.current.queue ?? [])
  const [index, setIndex] = useState(() => {
    const saved = persisted.current.index ?? 0
    return Math.min(Math.max(0, saved), Math.max(0, (persisted.current.queue?.length ?? 1) - 1))
  })
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(persisted.current.position ?? 0)
  const resumeRef = useRef({ key: queue[index] ? songKey(queue[index]) : undefined, time: persisted.current.position ?? 0 })
  const [lyricOffset, offsetState] = useState(() => loadJson<number>('lyric.offset', 0))
  const setLyricOffset = useCallback((seconds: number) => { const value = Math.max(-10, Math.min(10, seconds)); offsetState(value); saveJson('lyric.offset', value) }, [])
  const [sleepUntil, setSleepUntil] = useState<number | null>(null)
  const [stopAfterTrack, setStopAfterTrack] = useState(false)
  const sleepRef = useRef({ until: sleepUntil, track: stopAfterTrack })
  sleepRef.current = { until: sleepUntil, track: stopAfterTrack }
  const setSleep = useCallback((minutes: number | 'track' | null) => {
    setSleepUntil(typeof minutes === 'number' && minutes > 0 ? Date.now() + minutes * 60000 : null)
    setStopAfterTrack(minutes === 'track')
  }, [])
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(() => {
    const saved = persisted.current as unknown as { volume?: number }
    return typeof saved.volume === 'number' ? saved.volume : settings.volume
  })
  const [muted, setMuted] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>(persisted.current.shuffle ? 'all' : persisted.current.repeat ?? 'all')
  const [shuffle, setShuffle] = useState(!!persisted.current.shuffle)
  const [sourceName, setSourceName] = useState<string | null>(null)
  const [actualQuality, setActualQuality] = useState<Quality | null>(null)
  const [eqEnabled, setEqEnabled] = useState(false)
  const [eqGains, setEqGains] = useState<number[]>(() => loadJson('equalizer.gains', [0, 0, 0, 0, 0]))
  const eqRef = useRef<BrowserEqualizer | null>(null)
  const prefetched = useRef<{ key: string; at: number; result: UrlResult | null } | null>(null)
  const [lyric, setLyric] = useState<LyricResult | null>(null)
  const [lyricLoading, setLyricLoading] = useState(false)
  const [requestId, setRequestId] = useState(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  // 只有用户主动播放（或自动切歌）时才真正开始播放，避免刷新页面触发浏览器自动播放限制
  const intentRef = useRef(false)
  const sourceDirtyRef = useRef(false)
  const tokenRef = useRef(0)
  const audioFailureRef = useRef<(error: unknown) => void>(() => {})
  const audioResumeRef = useRef<() => boolean>(() => false)
  const lyricCache = useRef(new Map<string, LyricResult | null>())
  // 连续失败计数：避免源失效时在整张列表里来回报错、刷屏卡死
  const failCountRef = useRef(0)
  const lastErrorRef = useRef({ text: '', at: 0 })
  const goNextRef = useRef<(manual?: boolean, preserveFailures?: boolean) => void>(() => {})
  const mediaControls = useRef({ play: () => {}, pause: () => {} })
  const shuffleHistory = useRef<string[]>([])
  const reportFailureRef = useRef<(song: Song | null, reason: string) => void>(() => {})
  const stateRef = useRef({ queue, index, repeat, shuffle, playing, loading, quality: settings.quality })

  const current = queue[index] ?? null
  const quality = settings.quality[0] ?? '320k'

  stateRef.current = { queue, index, repeat, shuffle, playing, loading, quality: settings.quality }

  // ---------- 音频元素 ----------
  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'auto'
    audio.volume = volume
    audioRef.current = audio

    const onTime = () => setCurrentTime(audio.currentTime || 0)
    const onMeta = (event: Event) => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
      const resume = resumeRef.current
      const active = stateRef.current.queue[stateRef.current.index]
      if (event.type === 'loadedmetadata' && audio.duration > 0 && active && resume.key === songKey(active) && resume.time > 0) {
        audio.currentTime = Math.min(resume.time, Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.1) : resume.time)
        setCurrentTime(audio.currentTime)
        resumeRef.current.time = 0
      }
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onWaiting = () => setLoading(true)
    const onPlaying = () => {
      setLoading(false)
      failCountRef.current = 0
    }
    const onError = () => {
      // Replacing a source may leave an old event queued; only handle a current MediaError.
      if (!audio.error || sourceDirtyRef.current || !intentRef.current) return
      const reasons: Record<number, string> = { 1: '音频加载已中断', 2: '音频传输失败', 3: '音频解码失败', 4: '音频地址失效或格式不受支持' }
      audioFailureRef.current(new Error(reasons[audio.error.code] ?? '音频播放失败'))
    }

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('durationchange', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('error', onError)
    audio.addEventListener('ended', onEnded)

    return () => {
      audio.pause()
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('ended', onEnded)
      audioRef.current = null
      void eqRef.current?.close()
      eqRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 音量 ----------
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = Math.min(1, Math.max(0, volume))
    audio.muted = muted
    updateSettings({ volume })
  }, [volume, muted, updateSettings])

  // ---------- 持久化 ----------
  const snapshotRef = useRef({ queue, index, repeat, shuffle, volume, position: currentTime })
  snapshotRef.current = { queue, index, repeat, shuffle, volume, position: currentTime }
  useEffect(() => { saveJson(PERSIST_KEY, snapshotRef.current) }, [queue, index, repeat, shuffle, volume])
  useEffect(() => {
    const save = () => saveJson(PERSIST_KEY, snapshotRef.current)
    const timer = window.setInterval(save, 2000)
    window.addEventListener('pagehide', save)
    return () => { save(); clearInterval(timer); window.removeEventListener('pagehide', save) }
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (sleepRef.current.until && Date.now() >= sleepRef.current.until) {
        intentRef.current = false
        tokenRef.current += 1
        audioRef.current?.pause()
        setLoading(false)
        setSleep(null)
      }
    }, 500)
    return () => clearInterval(timer)
  }, [setSleep])

  // ---------- 核心：加载并播放 ----------
  useEffect(() => {
    const audio = audioRef.current
    const song = queue[index]
    if (!audio || !song) {
      setLoading(false)
      return
    }
    if (!intentRef.current) {
      setLoading(false)
      return
    }
    const token = ++tokenRef.current
    sourceDirtyRef.current = true
    audio.pause()
    setLoading(true)
    setError(null)
    setSourceName(null)
    setActualQuality(null)
    setCurrentTime(resumeRef.current.key === songKey(song) ? resumeRef.current.time : 0)
    setDuration(0)

    const load = new PlaybackLoad()
    const qualities = stateRef.current.quality
    const start = (refresh = false, reuseSource = false) => {
      const attempt = load.begin(reuseSource)
      if (!reuseSource) {
        sourceDirtyRef.current = true
        audio.pause()
      }
      setLoading(true)
      const fail = (err: unknown, retryable: boolean) => {
        if (token !== tokenRef.current || !intentRef.current) return
        const name = err instanceof Error ? err.name : ''
        const blocked = name === 'NotAllowedError'
        const aborted = name === 'AbortError'
        const action = load.fail(attempt, retryable && !blocked && !aborted)
        if (action === 'ignore') return
        if (blocked || aborted) {
          intentRef.current = false
          audio.pause()
          setLoading(false)
          setPlaying(false)
          const message = blocked ? '浏览器阻止了自动播放，请点击播放继续' : '播放已中断，请点击播放重试'
          setError(message)
          toast.error(message)
          return
        }
        sourceDirtyRef.current = true
        if (action === 'retry') {
          if (audio.currentTime > 0) resumeRef.current = { key: songKey(song), time: audio.currentTime }
          // Keep the retry inside this load so refreshing the URL cannot reset its budget.
          start(true)
          return
        }
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        setLoading(false)
        setPlaying(false)
        reportFailureRef.current(song, message)
      }
      const play = () => {
        audioFailureRef.current = err => fail(err, true)
        void eqRef.current?.resume()
        void audio.play().then(() => {
          if (token === tokenRef.current && load.isCurrent(attempt) && intentRef.current) {
            setPlaying(true)
            setLoading(false)
            setError(null)
            if (!reuseSource) library.recordPlay(song)
          }
        }).catch(err => fail(err, true))
      }
      if (reuseSource) { play(); return }
      const cached = prefetched.current
      const key = songKey(song) + ':' + qualities.join(',')
      const resolved = !refresh && cached?.key === key && cached.result && Date.now() - cached.at < 45000 ? Promise.resolve(cached.result) : api.musicUrl(song, qualities)
      prefetched.current = null
      resolved
      .then((result) => {
        if (token !== tokenRef.current || !load.isCurrent(attempt) || !intentRef.current) return
        setSourceName(result.sourceName)
        setActualQuality(result.quality)
        audio.src = result.playUrl
        sourceDirtyRef.current = false
        play()
      })
      .catch(err => fail(err, false))
    }
    audioResumeRef.current = () => {
      if (token !== tokenRef.current || sourceDirtyRef.current || !audio.src || audio.error) return false
      start(false, true)
      return true
    }
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId])

  useEffect(() => {
    if (!playing || !duration || duration - currentTime > 25 || duration - currentTime <= 0 || shuffle || repeat === 'one' || stopAfterTrack || (sleepUntil && sleepUntil < Date.now() + 25000)) return
    const next = nextTrackIndex(index, queue.length, playbackMode(repeat, shuffle), false)
    if (next < 0 || next === index) return
    const song = queue[next]
    const key = songKey(song) + ':' + settings.quality.join(',')
    if (prefetched.current?.key === key) return
    const pending = { key, at: Date.now(), result: null as UrlResult | null }
    prefetched.current = pending
    void api.musicUrl(song, settings.quality).then(result => { if (prefetched.current === pending) pending.result = result }).catch(() => {})
  }, [playing, duration, currentTime, queue, index, repeat, shuffle, settings.quality, sleepUntil, stopAfterTrack])

  // ---------- 歌词 ----------
  useEffect(() => {
    if (!current) {
      setLyric(null)
      return
    }
    const key = songKey(current)
    const cached = lyricCache.current.get(key)
    if (cached !== undefined) {
      setLyric(cached)
      setLyricLoading(false)
      return
    }
    let cancelled = false
    setLyricLoading(true)
    setLyric(null)
    api
      .lyric(current)
      .then((result) => {
        lyricCache.current.set(key, result.lyric)
        if (!cancelled) setLyric(result.lyric)
      })
      .catch(() => {
        lyricCache.current.set(key, null)
        if (!cancelled) setLyric(null)
      })
      .finally(() => {
        if (!cancelled) setLyricLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [current])

  // ---------- 媒体会话 ----------
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!current) {
      navigator.mediaSession.metadata = null
      return
    }
    const cover = current.img
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.name,
      artist: current.singer,
      album: current.albumName,
      artwork: cover
        ? [{ src: imageSrc(cover) ?? '', sizes: '500x500', type: 'image/jpeg' }]
        : undefined,
    })
    navigator.mediaSession.setActionHandler('play', () => mediaControls.current.play())
    navigator.mediaSession.setActionHandler('pause', () => mediaControls.current.pause())
    navigator.mediaSession.setActionHandler('previoustrack', () => goPrev())
    navigator.mediaSession.setActionHandler('nexttrack', () => goNext(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  // ---------- 导航 ----------
  const goNext = useCallback(
    (manual = false, preserveFailures = false) => {
      const state = stateRef.current
      if (!state.queue.length) return
      if (manual && !preserveFailures) { failCountRef.current = 0; lastErrorRef.current = { text: '', at: 0 } }
      intentRef.current = true
      if (state.repeat === 'one' && !manual) {
        const audio = audioRef.current
        if (audio) {
          audio.currentTime = 0
          if (!audioResumeRef.current()) setRequestId(id => id + 1)
        }
        return
      }
      tokenRef.current += 1
      const nextIndex = nextTrackIndex(state.index, state.queue.length, playbackMode(state.repeat, state.shuffle), manual)
      if (nextIndex < 0) {
        intentRef.current = false
        audioRef.current?.pause()
        setPlaying(false)
        return
      }
      if (state.shuffle && state.queue[state.index]) {
        shuffleHistory.current = [...shuffleHistory.current.slice(-99), songKey(state.queue[state.index])]
      }
      setIndex(nextIndex)
      setRequestId((id) => id + 1)
    },
    [],
  )

  const goPrev = useCallback(() => {
    const state = stateRef.current
    const audio = audioRef.current
    if (!state.queue.length) return
    failCountRef.current = 0
    lastErrorRef.current = { text: '', at: 0 }
    intentRef.current = true
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }
    tokenRef.current += 1
    if (state.shuffle && state.queue.length > 1) {
      let next = -1
      while (shuffleHistory.current.length && next < 0) {
        const key = shuffleHistory.current.pop()
        next = state.queue.findIndex((song) => songKey(song) === key)
      }
      if (next < 0) next = nextTrackIndex(state.index, state.queue.length, 'shuffle', true)
      setIndex(next)
      setRequestId((id) => id + 1)
      return
    }
    const prevIndex = state.index - 1
    setIndex(prevIndex < 0 ? (state.repeat === 'off' ? 0 : state.queue.length - 1) : prevIndex)
    setRequestId((id) => id + 1)
  }, [])

  const onEnded = useCallback(() => {
    if (sleepRef.current.track) {
      intentRef.current = false
      audioRef.current?.pause()
      setSleep(null)
      return
    }
    goNext(false)
  }, [goNext, setSleep])

  goNextRef.current = goNext

  /** 播放失败：同一首歌只提示一次，连续失败就停下，不再一首首刷屏 */
  const reportFailure = useCallback(
    (song: Song | null, reason: string) => {
      failCountRef.current += 1
      const now = Date.now()

      if (failCountRef.current >= 3) {
        const text = '连续多首歌曲无法播放，已暂停。可以换一个音质或稍后再试'
        if (lastErrorRef.current.text !== text) {
          lastErrorRef.current = { text, at: now }
          toast.error(text)
        }
        audioRef.current?.pause()
        intentRef.current = false
        return
      }

      const hasNext = stateRef.current.queue.length > 1
      const text = '《' + (song?.name ?? '这首歌') + '》' + reason + (hasNext ? '，已自动跳过' : '，请点击播放重试')
      if (lastErrorRef.current.text !== text || now - lastErrorRef.current.at > 2500) {
        lastErrorRef.current = { text, at: now }
        toast.error(text)
      }
      if (hasNext) {
        const token = tokenRef.current
        window.setTimeout(() => {
          if (token !== tokenRef.current || !intentRef.current) return
          // Advance past the failed song even in single-repeat mode without resetting the failure count.
          goNextRef.current(true, true)
        }, 240)
      } else {
        intentRef.current = false
      }
    },
    [toast],
  )

  reportFailureRef.current = reportFailure

  // ---------- 对外操作 ----------
  const playSongs = useCallback((songs: Song[], startIndex = 0) => {
    if (!songs.length) return
    tokenRef.current += 1
    failCountRef.current = 0
    lastErrorRef.current = { text: '', at: 0 }
    shuffleHistory.current = []
    resumeRef.current.time = 0
    intentRef.current = true
    const safeIndex = Math.min(Math.max(0, startIndex), songs.length - 1)
    setQueue(songs)
    setIndex(safeIndex)
    setRequestId((id) => id + 1)
  }, [])

  const playSong = useCallback(
    (song: Song, list?: Song[]) => {
      const queueList = list && list.length ? list : [song]
      const found = queueList.findIndex((item) => songKey(item) === songKey(song))
      playSongs(queueList, found >= 0 ? found : 0)
    },
    [playSongs],
  )

  const playAt = useCallback((target: number) => {
    const state = stateRef.current
    if (target < 0 || target >= state.queue.length) return
    tokenRef.current += 1
    failCountRef.current = 0
    lastErrorRef.current = { text: '', at: 0 }
    resumeRef.current.time = 0
    intentRef.current = true
    setIndex(target)
    setRequestId((id) => id + 1)
  }, [])

  const togglePlay = useCallback(() => {
    void eqRef.current?.resume()
    const audio = audioRef.current
    if (!audio) return
    if (!stateRef.current.queue.length) return
    if (stateRef.current.loading && intentRef.current) {
      tokenRef.current += 1; intentRef.current = false; audio.pause(); setLoading(false); return
    }
    failCountRef.current = 0
    lastErrorRef.current = { text: '', at: 0 }
    setError(null)
    if (!audio.src || sourceDirtyRef.current || audio.error) {
      intentRef.current = true
      setRequestId((id) => id + 1)
      return
    }
    if (audio.paused) {
      intentRef.current = true
      if (!audioResumeRef.current()) {
        const active = stateRef.current.queue[stateRef.current.index]
        if (active) resumeRef.current = { key: songKey(active), time: audio.currentTime }
        setRequestId(id => id + 1)
      }
    }
    else { intentRef.current = false; audio.pause() }
  }, [])

  mediaControls.current = {
    play: () => { if (!intentRef.current) togglePlay() },
    pause: () => { intentRef.current = false; tokenRef.current++; audioRef.current?.pause(); setLoading(false) },
  }

  const seek = useCallback((time: number) => {
    const audio = audioRef.current
    if (!audio) return
    const target = Math.max(0, Math.min(time, audio.duration || time))
    audio.currentTime = target
    const song = stateRef.current.queue[stateRef.current.index]
    if ((!audio.src || sourceDirtyRef.current) && song) resumeRef.current = { key: songKey(song), time: target }
    setCurrentTime(target)
  }, [])

  const setVolume = useCallback((value: number) => {
    setVolumeState(Math.min(1, Math.max(0, value)))
  }, [])

  const toggleMute = useCallback(() => setMuted((prev) => !prev), [])

  const setPlaybackMode = useCallback((mode: PlaybackMode) => {
    const next = playbackSettings(mode)
    stateRef.current = { ...stateRef.current, ...next }
    setShuffle(next.shuffle)
    setRepeat(next.repeat)
    shuffleHistory.current = []
  }, [])

  const cycleRepeat = useCallback(() => {
    const state = stateRef.current
    const next = nextPlaybackMode(playbackMode(state.repeat, state.shuffle))
    setPlaybackMode(next)
  }, [setPlaybackMode])

  const toggleShuffle = useCallback(() => {
    setShuffle((prev) => !prev)
    setRepeat('all')
    shuffleHistory.current = []
  }, [])

  const setQuality = useCallback(
    (next: Quality) => {
      if (current) resumeRef.current = { key: songKey(current), time: audioRef.current?.currentSrc ? audioRef.current.currentTime : currentTime }
      if (current) {
        sourceDirtyRef.current = true
        tokenRef.current += 1
      }
      const rest = settings.quality.filter((q) => q !== next)
      updateSettings({ quality: [next, ...rest] })
      if (current) setRequestId((id) => id + 1)
    },
    [current, currentTime, settings.quality, updateSettings],
  )

  const addToQueue = useCallback(
    (song: Song, position: 'next' | 'end' = 'end') => {
      setQueue((prev) => {
        const exists = prev.some((item) => songKey(item) === songKey(song))
        if (exists) return prev
        if (position === 'next') {
          const copy = [...prev]
          copy.splice(stateRef.current.index + 1, 0, song)
          return copy
        }
        return [...prev, song]
      })
      toast.success('已加入播放队列')
    },
    [toast],
  )

  const removeFromQueue = useCallback((target: number) => {
    const state = stateRef.current
    if (target < 0 || target >= state.queue.length) return
    const nextQueue = state.queue.filter((_, i) => i !== target)
    setQueue(nextQueue)
    if (target !== state.index) {
      setIndex(target < state.index ? state.index - 1 : state.index)
      return
    }

    // The removed song's pending URL and audio must never outlive its queue entry.
    const shouldResume = state.playing || (state.loading && intentRef.current)
    tokenRef.current += 1
    intentRef.current = nextQueue.length > 0 && shouldResume
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setIndex(Math.min(target, Math.max(0, nextQueue.length - 1)))
    setCurrentTime(0)
    setDuration(0)
    setPlaying(false)
    setLoading(false)
    setError(null)
    setSourceName(null)
    setActualQuality(null)
    setRequestId(id => id + 1)
  }, [])

  const clearQueue = useCallback(() => {
    tokenRef.current += 1
    intentRef.current = false
    shuffleHistory.current = []
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setQueue([])
    setIndex(0)
    setPlaying(false)
    setLoading(false)
    setError(null)
    setSourceName(null)
    setActualQuality(null)
    setCurrentTime(0)
    setDuration(0)
  }, [])

  const stop = useCallback(() => {
    clearQueue()
  }, [clearQueue])

  const setEqualizer = useCallback((enabled: boolean, gains = eqGains) => {
    try {
      if (enabled && audioRef.current && !eqRef.current) eqRef.current = new BrowserEqualizer(audioRef.current)
      eqRef.current?.apply(enabled, gains)
      if (enabled) void eqRef.current?.resume()
      setEqEnabled(enabled); setEqGains(gains); saveJson('equalizer.gains', gains)
    } catch (error) { setEqEnabled(false); toast.error(error instanceof Error ? error.message : '此浏览器无法启用均衡器') }
  }, [eqGains, toast])

  const value = useMemo<PlayerApi>(
    () => ({
      actualQuality, eqEnabled, eqGains, setEqualizer,
      sleepUntil, stopAfterTrack, setSleep, lyricOffset, setLyricOffset,
      queue,
      index,
      current,
      playing,
      loading,
      error,
      currentTime,
      duration,
      volume,
      muted,
      repeat,
      shuffle,
      quality,
      sourceName,
      lyric,
      lyricLoading,
      playSongs,
      playSong,
      togglePlay,
      next: () => goNext(true),
      prev: goPrev,
      seek,
      setVolume,
      toggleMute,
      cycleRepeat,
      setPlaybackMode,
      toggleShuffle,
      setQuality,
      playAt,
      addToQueue,
      removeFromQueue,
      clearQueue,
      stop,
    }),
    [
      actualQuality, eqEnabled, eqGains, setEqualizer,
      sleepUntil, stopAfterTrack, setSleep, lyricOffset, setLyricOffset,
      queue,
      index,
      current,
      playing,
      loading,
      error,
      currentTime,
      duration,
      volume,
      muted,
      repeat,
      shuffle,
      quality,
      sourceName,
      lyric,
      lyricLoading,
      playSongs,
      playSong,
      togglePlay,
      goNext,
      goPrev,
      seek,
      setVolume,
      toggleMute,
      cycleRepeat,
      setPlaybackMode,
      toggleShuffle,
      setQuality,
      playAt,
      addToQueue,
      removeFromQueue,
      clearQueue,
      stop,
    ],
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer 必须在 PlayerProvider 内使用')
  return ctx
}
