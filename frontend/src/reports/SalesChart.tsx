import { useState } from 'react'
import type { DayRow } from '../api/reports'
import { formatVnd } from '../utils/format'
import { niceScale, shortDate, shortVnd } from './numbers'

const CHART_HEIGHT = 180
const MAX_LABELS = 8

/**
 * Revenue per day (and refunds in red when there are any): plain flex bars,
 * no chart library. Hover or tap a day to read its figures.
 */
export function SalesChart({ days }: { days: DayRow[] }) {
  const [picked, setPicked] = useState<number | null>(null)
  const hasRefunds = days.some((d) => d.refunds.amount > 0)
  const { top, ticks } = niceScale(Math.max(0, ...days.map((d) => Math.max(d.revenue, d.refunds.amount))))
  const labelEvery = Math.max(1, Math.ceil(days.length / MAX_LABELS))
  const shown = days[picked ?? days.length - 1]

  if (days.length === 0) return null
  return (
    <div>
      <div className="mb-2 flex min-h-10 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold">{shortDate(shown.date)}</span>
        <span>
          Doanh thu <b>{formatVnd(shown.revenue)}</b>
        </span>
        <span className="text-slate-600">
          {shown.orders} đơn · {shown.tickets} vé
        </span>
        {shown.refunds.orders > 0 && <span className="text-red-700">Hoàn {formatVnd(shown.refunds.amount)}</span>}
      </div>
      <div className="flex gap-2">
        {/* y axis */}
        <div className="relative w-12 shrink-0 text-right text-[11px] text-slate-500" style={{ height: CHART_HEIGHT }}>
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(tick / top) * 100}%` }}>
              {shortVnd(tick)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative border-b border-l border-slate-300" style={{ height: CHART_HEIGHT }}>
            {ticks.slice(1).map((tick) => (
              <div key={tick} className="absolute inset-x-0 border-t border-dashed border-slate-200" style={{ bottom: `${(tick / top) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end gap-px px-px" onMouseLeave={() => setPicked(null)}>
              {days.map((day, i) => (
                <button
                  key={day.date}
                  type="button"
                  aria-label={`${shortDate(day.date)}: ${formatVnd(day.revenue)}`}
                  onMouseEnter={() => setPicked(i)}
                  onClick={() => setPicked(i)}
                  className={`flex h-full min-w-0 flex-1 items-end justify-center gap-px rounded-t ${picked === i ? 'bg-slate-100' : ''}`}
                >
                  <span className="w-full max-w-6 rounded-t bg-brand-600" style={{ height: `${(day.revenue / top) * 100}%` }} />
                  {hasRefunds && (
                    <span className="w-full max-w-3 rounded-t bg-red-400" style={{ height: `${(day.refunds.amount / top) * 100}%` }} />
                  )}
                </button>
              ))}
            </div>
          </div>
          {/* x axis */}
          <div className="flex gap-px px-px pt-1 text-[11px] text-slate-500">
            {days.map((day, i) => (
              <span key={day.date} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
                {i % labelEvery === 0 ? shortDate(day.date) : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
      {hasRefunds && (
        <p className="mt-2 flex gap-4 text-xs text-slate-600">
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded bg-brand-600" /> Doanh thu
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded bg-red-400" /> Hoàn tiền
          </span>
        </p>
      )}
    </div>
  )
}
