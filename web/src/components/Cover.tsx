import { useEffect, useRef, useState } from 'react'
import { api, imageSrc } from '../lib/api'
import { songKey } from '../lib/types'
import type { Song } from '../lib/types'

const picCache = new Map<string, string | null>()

export function hueOf(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return Math.abs(hash) % 360
}

interface CoverProps {
  song?: Pick<Song, 'platform' | 'songmid' | 'img' | 'name'> | null
  src?: string | null
  className?: string
  style?: React.CSSProperties
  radius?: number | string
  /** 是否在可见时才请求封面 */
  lazy?: boolean
  children?: React.ReactNode
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  title?: string
}

export function Cover({ song, src, className = '', style, radius, lazy = true, children, onClick, title }: CoverProps) {
  const key = song ? songKey(song) : src ?? 'blank'
  const initial = song?.name ? Array.from(song.name.trim())[0] : '♪'
  const [url, setUrl] = useState<string | null>(() => {
    if (src) return imageSrc(src) ?? null
    if (song?.img) return imageSrc(song.img) ?? null
    const cached = picCache.get(key)
    return cached ?? null
  })
  const [loaded, setLoaded] = useState(false)
  const [visible, setVisible] = useState(!lazy)
  const ref = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    setLoaded(false)
    if (src) {
      setUrl(imageSrc(src) ?? null)
      return
    }
    if (song?.img) {
      setUrl(imageSrc(song.img) ?? null)
      return
    }
    setUrl(picCache.get(key) ?? null)
  }, [key, src, song?.img])

  // 命中浏览器缓存时图片可能在监听器注册前就已完成，这里主动补一次，
  // 否则封面会一直停在占位色块上
  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth > 0) setLoaded(true)
  }, [url])

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!song || url || !visible) return
    if (picCache.has(key)) {
      const cached = picCache.get(key) ?? null
      if (cached) setUrl(cached)
      return
    }
    let cancelled = false
    api
      .pic(song.platform, song.songmid)
      .then((result) => {
        picCache.set(key, result.url || null)
        if (!cancelled && result.url) setUrl(result.url)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [song, url, visible, key])

  return (
    <div
      ref={ref}
      className={'cover ' + className}
      onClick={onClick}
      title={title}
      style={{
        borderRadius: radius ?? undefined,
        ...style,
      }}
    >
      {!url || !loaded ? (
        <div className="cover__fallback" style={{ fontSize: '34cqw' }}>
          {initial}
        </div>
      ) : null}
      {url ? (
        <img
          ref={imgRef}
          src={url}
          alt=""
          loading="lazy"
          className={loaded ? 'is-loaded' : ''}
          onLoad={() => setLoaded(true)}
          onError={() => {
            picCache.set(key, null)
            setUrl(null)
          }}
        />
      ) : null}
      {children}
    </div>
  )
}
