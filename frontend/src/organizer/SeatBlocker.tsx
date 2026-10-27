import { useState } from 'react'
import { changeSeatBlocks, getScheduleSeatMap } from '../api/organizer'
import { toApiError } from '../api/errors'
import type { Seat } from '../api/types'
import { ConfirmDialog } from '../admin/components'
import { Alert, Button } from '../components/ui'
import { useAsync } from '../utils/useAsync'

const COLORS: Record<string, string> = {
  AVAILABLE: 'bg-surface text-slate-700 ring-slate-300',
  HELD: 'bg-amber-100 text-amber-800 ring-amber-300',
  SOLD: 'bg-slate-300 text-slate-500 ring-slate-300',
  BLOCKED: 'bg-red-100 text-red-700 ring-red-300',
}

/** SEAT-02 on a published schedule: block broken / reserved seats, or put them back on sale. */
export function SeatBlocker({ scheduleId }: { scheduleId: string }) {
  const map = useAsync(() => getScheduleSeatMap(scheduleId), `seatmap:${scheduleId}`)
  const [selected, setSelected] = useState<string[]>([])
  const [action, setAction] = useState<'BLOCK' | 'UNBLOCK' | null>(null)
  const [result, setResult] = useState<string | null>(null)

  if (map.error) return <Alert>{map.error.message}</Alert>
  if (!map.data) return <p className="text-sm text-slate-500">Đang tải sơ đồ ghế…</p>
  const seats = map.data.zones.flatMap((z) => z.seats)
  if (seats.length === 0) return null
  const statusOf = (id: string) => seats.find((s) => s.seatId === id)?.status
  const toBlock = selected.filter((id) => statusOf(id) === 'AVAILABLE')
  const toUnblock = selected.filter((id) => statusOf(id) === 'BLOCKED')

  const toggle = (seat: Seat) => {
    if (seat.status !== 'AVAILABLE' && seat.status !== 'BLOCKED') return
    setSelected((s) => (s.includes(seat.seatId) ? s.filter((id) => id !== seat.seatId) : [...s, seat.seatId]))
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">Khóa / mở ghế</h4>
      <p className="text-xs text-slate-500">Chọn ghế còn trống để khóa (ghế hỏng, ghế mời), hoặc ghế đang khóa để mở bán lại. Ghế đang giữ / đã bán không đổi được.</p>
      {result && <Alert tone="success">{result}</Alert>}
      {map.data.zones
        .filter((zone) => zone.seats.length > 0)
        .map((zone) => {
          const rows = [...new Set(zone.seats.map((s) => s.rowLabel))].sort()
          return (
            <div key={zone.id} className="overflow-x-auto rounded-lg bg-slate-50 p-3">
              <p className="mb-2 text-xs font-medium text-slate-600">{zone.name}</p>
              {rows.map((rowLabel) => (
                <div key={rowLabel} className="mb-1 flex items-center gap-1 whitespace-nowrap">
                  <span className="w-6 shrink-0 text-xs font-semibold text-slate-500">{rowLabel}</span>
                  {zone.seats
                    .filter((s) => s.rowLabel === rowLabel)
                    .sort((a, b) => a.seatNumber - b.seatNumber)
                    .map((seat) => (
                      <button
                        key={seat.seatId}
                        type="button"
                        onClick={() => toggle(seat)}
                        aria-pressed={selected.includes(seat.seatId)}
                        aria-label={`Ghế ${seat.code}, ${seat.status}`}
                        title={`${seat.code} · ${seat.status}`}
                        className={`h-7 w-7 shrink-0 rounded text-[10px] ring-1 ring-inset ${COLORS[seat.status]} ${
                          selected.includes(seat.seatId) ? 'outline outline-2 outline-offset-1 outline-brand-600' : ''
                        }`}
                      >
                        {seat.seatNumber}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          )
        })}
      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
        <span>⬜ trống</span>
        <span className="text-amber-700">■ đang giữ</span>
        <span>■ đã bán</span>
        <span className="text-red-700">■ đã khóa</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" disabled={toBlock.length === 0} onClick={() => setAction('BLOCK')}>
          Khóa {toBlock.length || ''} ghế
        </Button>
        <Button variant="secondary" disabled={toUnblock.length === 0} onClick={() => setAction('UNBLOCK')}>
          Mở {toUnblock.length || ''} ghế
        </Button>
      </div>
      {action && (
        <ConfirmDialog
          open
          title={action === 'BLOCK' ? `Khóa ${toBlock.length} ghế` : `Mở bán lại ${toUnblock.length} ghế`}
          message="Người đang xem sơ đồ ghế thấy thay đổi ngay. Thao tác được ghi vào audit log."
          confirmLabel={action === 'BLOCK' ? 'Khóa' : 'Mở'}
          danger={action === 'BLOCK'}
          askReason
          onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            try {
              const done = await changeSeatBlocks(scheduleId, action, action === 'BLOCK' ? toBlock : toUnblock, reason)
              setResult(
                `Đã ${action === 'BLOCK' ? 'khóa' : 'mở'} ${done.applied.length} ghế` +
                  (done.rejected.length ? `; ${done.rejected.length} ghế vừa đổi trạng thái nên bỏ qua.` : '.'),
              )
            } catch (err) {
              throw toApiError(err)
            }
            setSelected([])
            map.reload()
          }}
        />
      )}
    </div>
  )
}
