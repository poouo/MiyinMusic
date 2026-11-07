import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'

interface RangeProps {
  value: number
  max: number
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  className?: string
  ariaLabel?: string
}

/** 轻量的可拖动进度条，支持鼠标与触摸 */
export function Range({ value, max, onChange, onCommit, className = '', ariaLabel }: RangeProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0

  const valueFromEvent = useCallback(
    (clientX: number): number => {
      const el = ref.current
      if (!el || max <= 0) return 0
      const rect = el.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return ratio * max
    },
    [max],
  )

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (max <= 0) return
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    onChange(valueFromEvent(event.clientX))
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    onChange(valueFromEvent(event.clientX))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    const next = valueFromEvent(event.clientX)
    onChange(next)
    onCommit?.(next)
  }

  return (
    <div
      ref={ref}
      className={'range ' + className}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max || 100}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') onCommit?.(Math.min(max, value + max * 0.05))
        if (event.key === 'ArrowLeft') onCommit?.(Math.max(0, value - max * 0.05))
      }}
    >
      <div className="range__track">
        <div className="range__fill" style={{ width: percent + '%' }} />
      </div>
      <div className="range__thumb" style={{ left: percent + '%' }} />
    </div>
  )
}
