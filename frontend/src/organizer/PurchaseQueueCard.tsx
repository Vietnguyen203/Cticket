import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, toApiError } from '../api/errors'
import type { EventInput } from '../api/organizer'
import { getQueueStats, type QueueStats } from '../api/queue'
import type { EventDetail } from '../api/types'
import { Alert, Button, Card, TextField } from '../components/ui'

/** Backend limits (PURCHASE_QUEUE in backend/src/config/constants.js). */
const MAX_CAPACITY = 10_000
const MIN_MINUTES = 5
const MAX_MINUTES = 30
const STATS_EVERY_MS = 10_000

/**
 * Phase 21: the event's purchase queue. With it on, at most N people choose
 * seats at the same time; the others wait in line and go in by turn. Can be
 * switched on / off at any time, also while selling.
 */
export function PurchaseQueueCard({ event, onSave }: { event: EventDetail; onSave: (input: Partial<EventInput>) => Promise<void> }) {
  const saved = event.queue ?? { enabled: false, capacity: 100, sessionMinutes: 10 }
  const [form, setForm] = useState({ enabled: saved.enabled, capacity: String(saved.capacity), minutes: String(saved.sessionMinutes) })
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const editable = event.status === 'DRAFT' || event.status === 'PUBLISHED'

  const changes: Partial<EventInput> = {}
  if (form.enabled !== saved.enabled) changes.queueEnabled = form.enabled
  if (Number(form.capacity) !== saved.capacity) changes.queueCapacity = Number(form.capacity)
  if (Number(form.minutes) !== saved.sessionMinutes) changes.queueSessionMinutes = Number(form.minutes)
  const capacityOk = Number.isInteger(Number(form.capacity)) && Number(form.capacity) >= 1 && Number(form.capacity) <= MAX_CAPACITY
  const minutesOk = Number.isInteger(Number(form.minutes)) && Number(form.minutes) >= MIN_MINUTES && Number(form.minutes) <= MAX_MINUTES

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSave(changes)
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
          <h2 className="font-semibold">Hàng chờ mua vé</h2>
          <p className="text-sm text-slate-600">
            Bật khi mở bán sự kiện đông khách: chỉ một số người được chọn chỗ cùng lúc, người đến sau xếp hàng và tự vào theo thứ tự.
            Không bán trùng ghế dù bật hay tắt.
          </p>
        </div>
        {error && <Alert>{error.message}</Alert>}
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.enabled}
            disabled={!editable}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            className="h-4 w-4"
          />
          Bật hàng chờ
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Số người được mua cùng lúc"
            name="queueCapacity"
            type="number"
            min={1}
            max={MAX_CAPACITY}
            value={form.capacity}
            disabled={!editable}
            onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            error={capacityOk ? undefined : `Từ 1 đến ${MAX_CAPACITY.toLocaleString('vi-VN')}.`}
          />
          <TextField
            label="Thời gian mỗi lượt (phút)"
            name="queueSessionMinutes"
            type="number"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            value={form.minutes}
            disabled={!editable}
            onChange={(e) => setForm({ ...form, minutes: e.target.value })}
            error={minutesOk ? undefined : `Từ ${MIN_MINUTES} đến ${MAX_MINUTES} phút.`}
          />
        </div>
        <p className="text-xs text-slate-500">
          Lượt của khách kết thúc khi họ thanh toán, hủy đơn, hoặc hết thời gian mà chưa giữ chỗ. Khách đã giữ chỗ được thanh toán nốt, không phải xếp
          hàng lại. Giảm số người không đuổi ai đang mua ra.
        </p>
        {saved.enabled && event.status === 'PUBLISHED' && <QueueStatsLine eventId={event.id} />}
        <Button type="submit" loading={busy} disabled={!editable || Object.keys(changes).length === 0 || !capacityOk || !minutesOk}>
          Lưu hàng chờ
        </Button>
      </form>
    </Card>
  )
}

/** "Đang mua: 87 / 100 · Đang chờ: 1.240", refreshed every 10 seconds. */
export function QueueStatsLine({ eventId }: { eventId: string }) {
  const [stats, setStats] = useState<QueueStats | null>(null)
  useEffect(() => {
    let current = true
    const load = () =>
      getQueueStats(eventId).then(
        (next) => current && setStats(next),
        () => undefined,
      )
    void load()
    const timer = setInterval(load, STATS_EVERY_MS)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [eventId])
  if (!stats?.enabled) return null
  return (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="queue-stats">
      Hàng chờ: đang mua <strong>{stats.active?.toLocaleString('vi-VN') ?? '?'}</strong> / {stats.capacity.toLocaleString('vi-VN')} · đang chờ{' '}
      <strong>{stats.waiting?.toLocaleString('vi-VN') ?? '?'}</strong>
    </p>
  )
}
