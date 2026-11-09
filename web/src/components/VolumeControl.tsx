import { usePlayer } from '../state/player'
import { VolumeIcon, VolumeMuteIcon } from './Icons'
import { Range } from './Range'

/** Shared by the desktop bar and expanded player; never hidden on narrow screens. */
export function VolumeControl() {
  const player = usePlayer()
  const value = player.muted ? 0 : player.volume
  const percent = Math.round(value * 100)

  return (
    <div className="volume-control" role="group" aria-label="音量控制">
      <button
        className="icon-btn"
        aria-label={player.muted ? '取消静音' : '静音'}
        aria-pressed={player.muted}
        title={player.muted ? '取消静音' : '静音'}
        onClick={player.toggleMute}
      >
        {value === 0 ? <VolumeMuteIcon size={18} /> : <VolumeIcon size={18} level={value > 0.5 ? 2 : 1} />}
      </button>
      <Range
        className="volume-control__range"
        value={value}
        max={1}
        ariaLabel="音量"
        valueText={percent + '%'}
        onChange={(next) => {
          player.setVolume(next)
          if (player.muted && next > 0) player.toggleMute()
        }}
      />
      <span className="volume-control__value" aria-hidden="true">{percent}%</span>
    </div>
  )
}
