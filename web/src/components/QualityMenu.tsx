import { useEffect, useRef, useState } from 'react'
import { QUALITY_NAMES } from '../lib/types'
import type { Quality } from '../lib/types'
import { CheckIcon, ChevronDownIcon } from './Icons'

const QUALITIES: Quality[] = ['flac24bit', 'flac', '320k', '128k']

const DESCRIPTIONS: Record<Quality, string> = {
  flac24bit: '最高解析度',
  flac: '无损音质',
  '320k': '高品质',
  '128k': '标准音质',
}

interface Props {
  value: Quality
  onChange: (quality: Quality) => void
  /** 当前歌曲实际支持的音质，用于标注不可用项 */
  available?: Quality[]
  placement?: 'top' | 'bottom'
  compact?: boolean
}

/** 点击展开的音质选择菜单（替代原来「点一下切一档」的交互） */
export function QualityMenu({ value, onChange, available, placement = 'top', compact = false }: Props) {
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
        title="选择音质"
      >
        <span>{QUALITY_NAMES[value]}</span>
        <ChevronDownIcon size={13} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>

      {open ? (
        <div className={'quality-popover' + (placement === 'bottom' ? ' is-bottom' : '')} role="listbox">
          <div className="quality-popover__title">播放音质</div>
          {QUALITIES.map((quality) => {
            const supported = !available || available.length === 0 || available.includes(quality)
            const active = quality === value
            return (
              <button
                key={quality}
                className={'quality-option' + (active ? ' is-active' : '') + (supported ? '' : ' is-disabled')}
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(quality)
                  setOpen(false)
                }}
              >
                <span className="quality-option__dot" />
                <span className="grow" style={{ textAlign: 'left' }}>
                  <span className="quality-option__name">{QUALITY_NAMES[quality]}</span>
                  <span className="quality-option__desc">
                    {DESCRIPTIONS[quality]}
                    {supported ? '' : ' · 该歌曲可能不支持'}
                  </span>
                </span>
                {active ? <CheckIcon size={15} /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
