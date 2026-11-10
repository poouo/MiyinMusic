import { useEffect, useRef, useState } from 'react'
import { QUALITY_NAMES } from '../lib/types'
import type { Quality } from '../lib/types'
import { CheckIcon, ChevronDownIcon } from './Icons'
import { useAppConfig } from '../state/appConfig'
import { highestQuality, QUALITY_ORDER } from '../lib/quality'

const DESCRIPTIONS: Record<Quality, string> = {
  flac24bit: '24-bit 高解析音频',
  flac: 'FLAC 无损音频',
  '320k': 'MP3 · 320 kbps',
  '128k': 'MP3 · 128 kbps',
}

interface Props {
  value: Quality
  actual?: Quality | null
  onChange: (quality: Quality) => void
  /** 平台标注的歌曲音质，不保证每个音源都可用。 */
  available?: Quality[]
  placement?: 'top' | 'bottom'
  compact?: boolean
}

/** 点击展开的音质选择菜单（替代原来「点一下切一档」的交互） */
export function QualityMenu({ value, actual, onChange, available, placement = 'top', compact = false }: Props) {
  const { playbackQualities } = useAppConfig()
  const best = highestQuality(available)
  const title = `${actual ? '当前音质：' + QUALITY_NAMES[actual] : '尚未解析音质'} · 首选：${QUALITY_NAMES[value]}`
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="quality-menu" ref={ref}>
      <button
        className={'quality-pill' + (compact ? ' quality-pill--sm' : '')}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        aria-label={'选择音质，' + title}
      >
        <span className="quality-pill__label">{actual ? '当前' : '首选'}</span>
        <span>{QUALITY_NAMES[actual ?? value]}</span>
        <ChevronDownIcon size={13} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>

      {open ? (
        <div className={'quality-popover' + (placement === 'bottom' ? ' is-bottom' : '')}>
          <div className="quality-popover__summary">
            <div><span>当前音质</span><strong>{actual ? QUALITY_NAMES[actual] : '等待播放'}</strong></div>
            <div><span>歌曲最高（平台标注）</span><strong>{best ? QUALITY_NAMES[best] : '未知'}</strong></div>
            {actual && actual !== value ? <p>首选 {QUALITY_NAMES[value]}，本次使用 {QUALITY_NAMES[actual]}</p> : null}
          </div>
          <div className="quality-popover__title">选择首选音质</div>
          <div role="listbox" aria-label="首选播放音质">
          {QUALITY_ORDER.map((quality) => {
            const supported = available?.includes(quality) || actual === quality
            const active = quality === value
            const permitted = playbackQualities.includes(quality)
            return (
              <button
                key={quality}
                className={'quality-option' + (active ? ' is-active' : '') + (supported ? ' is-supported' : ' is-unlisted')}
                role="option"
                aria-selected={active}
                disabled={!permitted}
                onClick={() => {
                  onChange(quality)
                  setOpen(false)
                }}
              >
                <span className="quality-option__dot" />
                <span className="grow" style={{ textAlign: 'left' }}>
                  <span className="quality-option__name">{QUALITY_NAMES[quality]}
                    <span className={'quality-option__status' + (quality === actual ? ' is-current' : '')}>
                      {!permitted ? '无权限' : quality === actual ? '当前音质' : supported ? '支持' : '未标注'}
                    </span>
                  </span>
                  <span className="quality-option__desc">
                    {DESCRIPTIONS[quality]}
                  </span>
                </span>
                {active ? <span className="quality-option__selected"><CheckIcon size={13} />首选</span> : null}
              </button>
            )
          })}
          </div>
          <div className="quality-popover__hint">不可用时自动尝试其他音质，以实际播放结果为准。未标注的档位仍可尝试。</div>
        </div>
      ) : null}
    </div>
  )
}
