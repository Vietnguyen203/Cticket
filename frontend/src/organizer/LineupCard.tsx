import { useState, type FormEvent } from 'react'
import { ApiError, toApiError } from '../api/errors'
import type { EventInput } from '../api/organizer'
import type { EventDetail } from '../api/types'
import { Alert, Button, Card } from '../components/ui'
import { MAX_LINEUP_ITEMS, newRow, sameLineup, toLineup, type LineupRow } from './lineup'

/**
 * "Nghệ sĩ khách mời": who takes part in the event, by name. An event has many
 * programmes and acts, so no times here. Shown on the public event page.
 * Editable in DRAFT and while on sale.
 */
export function LineupCard({ event, onSave }: { event: EventDetail; onSave: (input: Partial<EventInput>) => Promise<void> }) {
  const saved = event.lineup ?? []
  const [rows, setRows] = useState<LineupRow[]>(() => (saved.length > 0 ? saved.map(newRow) : [newRow()]))
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const editable = event.status === 'DRAFT' || event.status === 'PUBLISHED'

  const lineup = toLineup(rows)
  const changed = !sameLineup(lineup, saved)

  const setArtist = (key: number, artist: string) => {
    setDone(false)
    setRows((current) => current.map((row) => (row.key === key ? { ...row, artist } : row)))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSave({ lineup })
      setDone(true)
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <h2 className="font-semibold">Nghệ sĩ khách mời</h2>
          <p className="text-sm text-slate-600">Tên các nghệ sĩ tham gia sự kiện, hiện trên trang sự kiện. Mỗi ô một nghệ sĩ / nhóm.</p>
        </div>
        {error && <Alert>{error.message}</Alert>}
        {done && !changed && <Alert tone="success">Đã lưu danh sách nghệ sĩ.</Alert>}

        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((row, index) => (
            <li key={row.key} className="flex items-center gap-2">
              <input
                aria-label={`Nghệ sĩ ${index + 1}`}
                placeholder="Tên nghệ sĩ"
                maxLength={120}
                value={row.artist}
                disabled={!editable}
                onChange={(e) => setArtist(row.key, e.target.value)}
                className="block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100"
              />
              {editable && (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Xóa nghệ sĩ ${index + 1}`}
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => setRows((r) => (r.length > 1 ? r.filter((x) => x.key !== row.key) : [newRow()]))}
                >
                  ✕
                </Button>
              )}
            </li>
          ))}
        </ul>

        {editable && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" disabled={rows.length >= MAX_LINEUP_ITEMS} onClick={() => setRows((r) => [...r, newRow()])}>
              + Thêm nghệ sĩ
            </Button>
            <Button type="submit" loading={busy} disabled={!changed}>
              Lưu danh sách nghệ sĩ
            </Button>
            {changed && !busy && <span className="text-sm font-medium text-amber-700">Có thay đổi chưa lưu.</span>}
          </div>
        )}
        {!editable && <p className="text-sm text-slate-500">Sự kiện ở trạng thái này không sửa được danh sách nghệ sĩ.</p>}
      </form>
    </Card>
  )
}
