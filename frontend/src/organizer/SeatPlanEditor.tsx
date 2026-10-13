import { useState } from 'react'
import type { LayoutZone, ScheduleTicketType } from '../api/admin'
import { toApiError } from '../api/errors'
import { saveSeatPlan, type SeatPlanDetail } from '../api/organizer'
import { Alert, Button } from '../components/ui'
import { assignmentsOf, MIXED, rowChoicesOf, rowKey, type RowChoices } from './setup'

/** Which ticket type each row of seats sells (DRAFT events). */
export function SeatPlanEditor({
  scheduleId,
  zones,
  plan,
  ticketTypes,
  onSaved,
}: {
  scheduleId: string
  zones: LayoutZone[]
  plan: SeatPlanDetail
  ticketTypes: ScheduleTicketType[]
  onSaved: () => void
}) {
  const reserved = ticketTypes.filter((tt) => tt.inventoryMode === 'RESERVED')
  const [choices, setChoices] = useState<RowChoices>(() => rowChoicesOf(zones, plan))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seated = zones.filter((z) => z.kind === 'SEATED' && z.seats.length > 0)
  const dirty = JSON.stringify(choices) !== JSON.stringify(rowChoicesOf(zones, plan))

  if (seated.length === 0) return null
  if (reserved.length === 0) {
    return <p className="text-sm text-slate-500">Thêm một hạng vé loại "Ghế ngồi" để gán hàng ghế.</p>
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await saveSeatPlan(scheduleId, assignmentsOf(zones, plan, choices))
      onSaved()
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  const setAll = (zone: LayoutZone, ticketTypeId: string) =>
    setChoices((current) => {
      const next = { ...current }
      for (const rowLabel of new Set(zone.seats.map((s) => s.rowLabel))) next[rowKey(zone.id, rowLabel)] = ticketTypeId
      return next
    })

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">Gán hàng ghế cho hạng vé</h4>
      {error && <Alert>{error}</Alert>}
      {seated.map((zone) => {
        const rows = [...new Set(zone.seats.map((s) => s.rowLabel))].sort()
        return (
          <div key={zone.id} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{zone.name}</span>
              <label className="text-xs text-slate-500">
                Cả khu:{' '}
                <select onChange={(e) => e.target.value !== '-' && setAll(zone, e.target.value)} value="-" className="rounded border border-slate-300 px-1 py-0.5">
                  <option value="-">chọn…</option>
                  <option value="">không bán</option>
                  {reserved.map((tt) => (
                    <option key={tt.id} value={tt.id}>
                      {tt.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {rows.map((rowLabel) => {
                const key = rowKey(zone.id, rowLabel)
                const seats = zone.seats.filter((s) => s.rowLabel === rowLabel).length
                return (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <span className="w-14 shrink-0 text-slate-600">
                      Hàng {rowLabel} <span className="text-xs text-slate-400">({seats})</span>
                    </span>
                    <select
                      value={choices[key] ?? ''}
                      onChange={(e) => setChoices({ ...choices, [key]: e.target.value })}
                      className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1"
                    >
                      <option value="">không bán</option>
                      {choices[key] === MIXED && <option value={MIXED}>(nhiều hạng, giữ nguyên)</option>}
                      {reserved.map((tt) => (
                        <option key={tt.id} value={tt.id}>
                          {tt.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
      <Button onClick={save} loading={busy} disabled={!dirty}>
        Lưu gán ghế
      </Button>
    </div>
  )
}
