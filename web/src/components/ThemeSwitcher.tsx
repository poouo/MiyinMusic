import { useEffect, useRef, useState } from 'react'
import { THEMES, useSettings } from '../state/settings'
import { CheckIcon, PaletteIcon } from './Icons'

interface Props {
  /** fab：桌面右上角悬浮；icon：移动端顶栏图标 */
  variant?: 'fab' | 'icon'
}

export function ThemeSwitcher({ variant = 'fab' }: Props) {
  const { settings, update } = useSettings()
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

  const active = THEMES.find((theme) => theme.id === settings.theme) ?? THEMES[0]

  return (
    <div className={'theme-switch' + (variant === 'icon' ? ' theme-switch--icon' : '')} ref={ref}>
      <button
        className={variant === 'fab' ? 'theme-fab' : 'icon-btn'}
        onClick={() => setOpen((prev) => !prev)}
        aria-label="切换主题"
        aria-expanded={open}
        aria-haspopup="menu"
        title={'主题：' + active.name}
      >
        {variant === 'fab' ? (
          <>
            <PaletteIcon size={16} />
            <span className="theme-fab__name">{active.name}</span>
            <span className="theme-fab__dots">
              {active.dots.map((dot, index) => (
                <i key={index} style={{ background: dot }} />
              ))}
            </span>
          </>
        ) : (
          <PaletteIcon size={20} />
        )}
      </button>

      {open ? (
        <div className="theme-popover" role="menu">
          <div className="theme-popover__title">界面主题</div>
          <div className="theme-grid">
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                className={'theme-item' + (theme.id === settings.theme ? ' is-active' : '')}
                onClick={() => {
                  update({ theme: theme.id })
                  setOpen(false)
                }}
                role="menuitemradio"
                aria-checked={theme.id === settings.theme}
              >
                <span
                  className="theme-swatch"
                  style={{ background: theme.dots[0] }}
                >
                  <span className="theme-swatch__dots">
                    <i style={{ background: theme.dots[1] }} />
                    <i style={{ background: theme.dots[2] }} />
                  </span>
                </span>
                <span className="theme-item__name">{theme.name}</span>
                {theme.id === settings.theme ? <CheckIcon size={14} /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
