import { PLATFORM_NAMES } from '../lib/types'
import type { ChartInfo } from '../lib/types'
import { hueOf } from './Cover'
import { ChevronRightIcon } from './Icons'

export function ChartTile({ chart, onClick }: { chart: ChartInfo; onClick: () => void }) {
  const hue = hueOf(chart.id)
  return (
    <button className="tile chart-card" onClick={onClick}>
      <div
        className="tile__cover"
        style={{
          background:
            'linear-gradient(150deg, hsl(' + hue + ' 70% 54%), hsl(' + ((hue + 52) % 360) + ' 62% 34%))',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(120px 120px at 78% 18%, rgba(255,255,255,0.32), transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: -34,
            bottom: -34,
            width: 130,
            height: 130,
            borderRadius: '50%',
            border: '14px solid rgba(255,255,255,0.12)',
          }}
        />
        <div className="chart-card__badge">{PLATFORM_NAMES[chart.platform]}</div>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            fontSize: 27,
            fontWeight: 850,
            letterSpacing: '0.04em',
            color: 'rgba(255,255,255,0.95)',
            textShadow: '0 2px 14px rgba(0,0,0,0.28)',
          }}
        >
          {chart.name.replace(/榜$/, '')}
        </div>
      </div>
      <div className="tile__name ellipsis">{chart.name}</div>
      <div className="tile__meta">
        {PLATFORM_NAMES[chart.platform]} · 每日更新 <ChevronRightIcon size={11} style={{ verticalAlign: '-1px' }} />
      </div>
    </button>
  )
}
