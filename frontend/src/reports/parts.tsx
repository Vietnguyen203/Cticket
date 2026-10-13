import type { ReactNode } from 'react'
import { Button, Card } from '../components/ui'
import { downloadCsv, type Cell } from './csv'
import { percent } from './numbers'

/** One figure with its label (and an optional line under it). */
export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'red' }) {
  return (
    <Card className="!p-4">
      <p className="text-sm text-slate-600">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'red' ? 'text-red-700' : 'text-slate-900'}`}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
    </Card>
  )
}

/** Sold / sellable as a bar. */
export function FillBar({ rate }: { rate: number | null }) {
  const width = rate === null ? 0 : Math.min(100, Math.round(rate * 100))
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 rounded bg-slate-100">
        <div className={`h-2 rounded ${width >= 90 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${width}%` }} />
      </div>
      <span className="tabular-nums text-xs text-slate-600">{percent(rate)}</span>
    </div>
  )
}

/** A section with a title and a "Tải CSV" button for its table. */
export function ReportSection({
  title,
  note,
  csv,
  children,
}: {
  title: string
  note?: ReactNode
  csv?: { filename: string; rows: () => Cell[][] }
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">{title}</h2>
          {note && <p className="text-xs text-slate-500">{note}</p>}
        </div>
        {csv && (
          <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => downloadCsv(csv.filename, csv.rows())}>
            Tải CSV
          </Button>
        )}
      </div>
      {children}
    </section>
  )
}
