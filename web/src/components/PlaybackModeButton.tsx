import { useEffect, useId, useRef, useState } from 'react'
import { usePlayer } from '../state/player'
import { playbackMode, PLAYBACK_MODE_LABELS, type PlaybackMode } from '../lib/playback'
import { CheckIcon, RepeatIcon, ShuffleIcon } from './Icons'

const modes: PlaybackMode[] = ['shuffle', 'off', 'one', 'all']

function ModeIcon({ mode }: { mode: PlaybackMode }) {
  if (mode === 'shuffle') return <ShuffleIcon size={18} />
  if (mode !== 'off') return <RepeatIcon size={18} one={mode === 'one'} />
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 6h12M4 12h12M4 18h8m4-3 4 3-4 3" />
  </svg>
}

export function PlaybackModeButton() {
  const player = usePlayer()
  const mode = playbackMode(player.repeat, player.shuffle)
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const options = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  useEffect(() => {
    if (!open) return
    options.current[modes.indexOf(mode)]?.focus()
    const outside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  return <div className="playback-mode-menu" ref={host} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }}>
    <button ref={trigger} className={'icon-btn playback-mode' + (mode !== 'off' ? ' icon-btn--active' : '')}
      title={PLAYBACK_MODE_LABELS[mode]} aria-label={'播放模式：' + PLAYBACK_MODE_LABELS[mode]}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setOpen(true) }
      }}><ModeIcon mode={mode} /></button>
    {open && <div id={id} className="playback-mode-popover" role="menu" aria-label="播放模式" onKeyDown={event => {
      const index = options.current.indexOf(document.activeElement as HTMLButtonElement)
      let next = index
      if (event.key === 'ArrowDown') next = (index + 1) % modes.length
      else if (event.key === 'ArrowUp') next = (index + modes.length - 1) % modes.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = modes.length - 1
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return }
      else return
      event.preventDefault(); event.stopPropagation(); options.current[next]?.focus()
    }}>
      {modes.map((value, index) => <button key={value} ref={element => { options.current[index] = element }}
        role="menuitemradio" aria-checked={mode === value} className={'playback-mode-option' + (mode === value ? ' is-active' : '')}
        onClick={() => { player.setPlaybackMode(value); setOpen(false); trigger.current?.focus() }}>
        <ModeIcon mode={value} /><span>{PLAYBACK_MODE_LABELS[value]}</span>{mode === value && <CheckIcon size={15} />}
      </button>)}
    </div>}
  </div>
}
