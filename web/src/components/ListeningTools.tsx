import { usePlayer } from '../state/player'
import { EQ_FREQUENCIES } from '../lib/equalizer'
import { Select } from './Select'

export function ListeningTools() {
  const player = usePlayer()
  return <details className="listening-tools">
    <summary>听歌设置{player.stopAfterTrack ? ' · 本曲后停止' : player.sleepUntil ? ' · 已定时' : ''}</summary>
    <div className="listening-tools__body">
      <label>睡眠定时<Select aria-label="睡眠定时" value={player.stopAfterTrack ? 'track' : player.sleepUntil ? 'active' : ''}
        onChange={value => player.setSleep(value === 'track' ? 'track' : value ? Number(value) : null)}
        options={[{ value: '', label: '关闭' }, ...(player.sleepUntil ? [{ value: 'active', disabled: true, label: '将在 ' + new Date(player.sleepUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' 暂停' }] : []),
          { value: '15', label: '15 分钟' }, { value: '30', label: '30 分钟' }, { value: '60', label: '60 分钟' }, { value: 'track', label: '播完本曲停止' }]} />
      </label>
      <label>歌词偏移 · 秒（正值提前）<input aria-label="歌词偏移" type="number" min="-10" max="10" step="0.5" value={player.lyricOffset} onChange={e => player.setLyricOffset(Number(e.target.value))} /></label>
      <label><span><input type="checkbox" checked={player.eqEnabled} onChange={e => player.setEqualizer(e.target.checked)} /> 五段均衡器</span></label>
      {player.eqEnabled && <>{EQ_FREQUENCIES.map((frequency, index) => <label key={frequency}>{frequency >= 1000 ? frequency / 1000 + ' kHz' : frequency + ' Hz'} · {player.eqGains[index]} dB<input aria-label={frequency + ' Hz 增益'} type="range" min="-12" max="12" step="1" value={player.eqGains[index]} onChange={e => player.setEqualizer(true, player.eqGains.map((gain, i) => i === index ? Number(e.target.value) : gain))} /></label>)}<button className="btn btn--sm" onClick={() => player.setEqualizer(true, [0, 0, 0, 0, 0])}>重置为原声</button></>}
    </div>
  </details>
}
