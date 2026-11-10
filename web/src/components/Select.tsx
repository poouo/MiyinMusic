import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, ChevronDownIcon } from './Icons'

interface SelectOption<T extends string> { value: T; label: string; disabled?: boolean }
interface Props<T extends string> {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  'aria-label': string
  className?: string
  style?: CSSProperties
  disabled?: boolean
}

/** A shared, keyboard-accessible listbox rendered outside scrolling cards and dialogs. */
export function Select<T extends string>({ value, options, onChange, className = '', style, disabled, 'aria-label': label }: Props<T>) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<CSSProperties>({})
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const search = useRef({ text: '', at: 0 })
  const id = useId()
  const selected = options.find(option => option.value === value)

  const show = () => {
    const selectedIndex = options.findIndex(option => option.value === value && !option.disabled)
    setActive(selectedIndex >= 0 ? selectedIndex : options.findIndex(option => !option.disabled))
    setOpen(true)
  }
  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }
  const choose = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    close(true)
  }

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const margin = 8
      const below = window.innerHeight - rect.bottom - margin - 6
      const above = rect.top - margin - 6
      const upwards = below < Math.min(options.length * 40 + 12, 240) && above > below
      const width = Math.min(Math.max(rect.width, 160), window.innerWidth - margin * 2)
      setPosition({
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)), width,
        maxHeight: Math.min(280, Math.max(80, upwards ? above : below)),
        ...(upwards ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      })
    }
    place()
    list.current?.focus({ preventScroll: true })
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, options.length])

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, id])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false)
    }
    const focus = (event: FocusEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', focus)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focus) }
  }, [open])

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
    if (event.key === 'Tab') { close(true); return }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const direction = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1
      let next = event.key === 'Home' ? -1 : event.key === 'End' ? options.length : active
      for (let i = 0; i < options.length; i++) {
        next = (next + direction + options.length) % options.length
        if (!options[next].disabled) { setActive(next); break }
      }
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const text = Date.now() - search.current.at < 700 ? search.current.text + event.key : event.key
      search.current = { text, at: Date.now() }
      const next = options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(text.toLocaleLowerCase()))
      if (next >= 0) setActive(next)
    }
  }

  return <>
    <button ref={trigger} type="button" className={'input custom-select ' + className} style={style} disabled={disabled}
      aria-label={label} aria-description={selected?.label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? close() : show()}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show() } }}>
      <span className="ellipsis">{selected?.label ?? '请选择'}</span>
      <ChevronDownIcon size={15} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
    </button>
    {open && createPortal(<div ref={list} id={id} className="custom-select__list" style={position} role="listbox" tabIndex={-1}
      aria-label={label} aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined} onKeyDown={onKey}
      onClick={event => event.stopPropagation()}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value}
        aria-disabled={option.disabled || undefined}
        className={'custom-select__option' + (index === active ? ' is-focused' : '') + (option.value === value ? ' is-selected' : '')}
        onPointerMove={() => { if (!option.disabled) setActive(index) }} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{option.label}</span>{option.value === value ? <CheckIcon size={15} /> : null}
      </div>)}
    </div>, document.body)}
  </>
}
