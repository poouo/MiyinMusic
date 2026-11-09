import { PLATFORM_NAMES } from '../lib/types'
import type { ChartInfo } from '../lib/types'
import { ChevronRightIcon, DiscIcon } from './Icons'

export function ChartTile({ chart, onClick }: { chart: ChartInfo; onClick: () => void }) {
  return (
    <button className="tile chart-card" onClick={onClick}>
      <div className={'tile__cover chart-card__art chart-card__art--' + chart.platform}>
        <div className="chart-card__badge">{PLATFORM_NAMES[chart.platform]}</div>
        <DiscIcon className="chart-card__disc" size={96} />
        <div className="chart-card__title">
          {chart.name.replace(/榜$/, '')}
        </div>
      </div>
      <div className="tile__name ellipsis">{chart.name}</div>
      <div className="tile__meta">
        {PLATFORM_NAMES[chart.platform]} · 查看榜单 <ChevronRightIcon size={12} />
      </div>
    </button>
  )
}
