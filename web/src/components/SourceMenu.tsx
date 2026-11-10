import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { SourceInfo } from '../lib/types'
import { usePlayer } from '../state/player'
import { CheckIcon, ChevronDownIcon } from './Icons'

export function SourceMenu() {
  const player = usePlayer()
  const [open, setOpen] = useState(false)
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const platform = player.current?.platform
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true); setError('')
    void api.sources().then(result => { if (active) setSources(result.sources.filter(source => source.enabled && source.status === 'ready' && source.platforms.some(p => p.platform === platform && p.actions.includes('musicUrl')))) })
      .catch(() => { if (active) setError('暂时无法获取音源，请稍后重试') }).finally(() => { if (active) setLoading(false) })
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', key)
    return () => { active = false; document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key) }
  }, [open, platform])
  const options = [{ id: '', name: '自动选择' }, ...sources]
  return <div className="quality-menu" ref={ref}>
    <button className="quality-pill quality-pill--sm" aria-label="选择播放源" aria-haspopup="listbox" aria-expanded={open}
      title={'当前播放源：' + (player.sourceName || '等待解析')} onClick={() => setOpen(value => !value)}>
      <span className="quality-pill__label">源</span><span style={{ maxWidth: 82, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.sourceName || '自动'}</span><ChevronDownIcon size={13} />
    </button>
    {open && <div className="quality-popover" style={{ maxHeight: 'min(420px, 65vh)', overflowY: 'auto' }}>
      <div className="quality-popover__title">播放源 · 切换保留进度</div>
      <div role="listbox" aria-label="播放源">{options.map(source => {
        const selected = (player.selectedSourceId || '') === source.id
        return <button key={source.id} role="option" aria-selected={selected} className={'quality-option' + (selected ? ' is-active' : '')}
          onClick={() => { player.setSource(source.id || null); setOpen(false) }}>
          <span className="grow" style={{ textAlign: 'left' }}>{source.name}</span>{selected && <CheckIcon size={15} />}
        </button>
      })}</div>
      <div className="quality-popover__hint">{loading ? '正在获取可用音源…' : error || '已启用且支持当前歌曲平台的音源。自动模式会跳过异常音频，具体歌曲以解析结果为准。'}</div>
    </div>}
  </div>
}
