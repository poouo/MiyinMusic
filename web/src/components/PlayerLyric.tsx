import { useEffect, useLayoutEffect, useRef } from 'react'

interface Props {
  text: string
  start: number
  end: number
  time: number
  playing: boolean
  lineKey: string | number
}

/**
 * 播放条上的当前歌词：长句按这句的时长横向滚动。
 * 注意：只在换行 / 尺寸变化时读取一次布局，之后每帧只写 transform，
 * 避免每帧 scrollWidth 触发强制重排把页面拖卡。
 */
export function PlayerLyric({ text, start, end, time, playing, lineKey }: Props) {
  const boxRef = useRef<HTMLSpanElement | null>(null)
  const trackRef = useRef<HTMLSpanElement | null>(null)
  const overflowRef = useRef(0)
  const anchor = useRef({ time, at: performance.now() })

  useEffect(() => {
    anchor.current = { time, at: performance.now() }
  }, [time])

  // 换行或窗口尺寸变化时重新测量
  useLayoutEffect(() => {
    const measure = () => {
      const box = boxRef.current
      const track = trackRef.current
      overflowRef.current = box && track ? track.scrollWidth - box.clientWidth : 0
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (boxRef.current) observer.observe(boxRef.current)
    return () => observer.disconnect()
  }, [text, lineKey])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    const apply = (nowMs: number) => {
      const overflow = overflowRef.current
      if (overflow <= 1) {
        track.style.transform = 'none'
        return
      }
      const elapsed = playing ? (nowMs - anchor.current.at) / 1000 : 0
      const current = anchor.current.time + elapsed
      const span = Math.max(0.8, end - start)
      const progress = Math.min(1, Math.max(0, (current - start) / span))
      track.style.transform = 'translateX(' + (-overflow * progress).toFixed(1) + 'px)'
    }

    if (!playing) {
      apply(performance.now())
      return
    }

    let raf = 0
    let last = 0
    const tick = (nowMs: number) => {
      raf = requestAnimationFrame(tick)
      // 约 12fps 足够顺滑，又能把开销压到最低
      if (nowMs - last < 80) return
      last = nowMs
      apply(nowMs)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [start, end, playing, lineKey])

  return (
    <span className="player__lyric-text" ref={boxRef}>
      <span className="player__lyric-track" ref={trackRef} key={lineKey}>
        {text}
      </span>
    </span>
  )
}
