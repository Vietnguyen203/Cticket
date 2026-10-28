import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, toApiError } from '../api/errors'
import type { EventInput } from '../api/organizer'
import { getQueueStats, type QueueStats } from '../api/queue'
import type { EventDetail } from '../api/types'
import { Alert, Button, Card, NumberField, TextField } from '../components/ui'
import { QUEUE_LIMITS, queueProblems, type QueueForm } from './purchaseQueueForm'

const STATS_EVERY_MS = 10_000

/**
 * Phase 21: the event's purchase queue. With it on, at most N people choose
 * seats at the same time; the others wait in line and go in by turn. Can be
 * switched on / off at any time, also while selling.
 */
export function PurchaseQueueCard({ event, onSave }: { event: EventDetail; onSave: (input: Partial<EventInput>) => Promise<void> }) {
  const saved = event.queue ?? { enabled: false, capacity: 100, sessionMinutes: 10 }
  const [form, setForm] = useState<QueueForm>({ enabled: saved.enabled, capacity: String(saved.capacity), minutes: String(saved.sessionMinutes) })
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const editable = event.status === 'DRAFT' || event.status === 'PUBLISHED'

  const changes: Partial<EventInput> = {}
  if (form.enabled !== saved.enabled) changes.queueEnabled = form.enabled
  if (Number(form.capacity) !== saved.capacity) changes.queueCapacity = Number(form.capacity)
  if (Number(form.minutes) !== saved.sessionMinutes) changes.queueSessionMinutes = Number(form.minutes)
  const problems = queueProblems(form)

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
        <QueueFields form={form} onChange={setForm} disabled={!editable} />
        <p className="text-xs text-slate-500">
          Lượt của khách kết thúc khi họ thanh toán, hủy đơn, hoặc hết thời gian mà chưa giữ chỗ. Khách đã giữ chỗ được thanh toán nốt, không phải xếp
          hàng lại. Giảm số người không đuổi ai đang mua ra.
        </p>
        {saved.enabled && event.status === 'PUBLISHED' && <QueueStatsLine eventId={event.id} />}
        <Button type="submit" loading={busy} disabled={!editable || Object.keys(changes).length === 0 || Boolean(problems.capacity || problems.minutes)}>
          Lưu hàng chờ
        </Button>
      </form>
    </Card>
  )
}

/** The three fields (on / off, how many buy at once, minutes per turn): the editor's card and the new-event form. */
export function QueueFields({ form, onChange, disabled = false }: { form: QueueForm; onChange: (form: QueueForm) => void; disabled?: boolean }) {
  const problems = queueProblems(form)
  return (
    <>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={form.enabled} disabled={disabled} onChange={(e) => onChange({ ...form, enabled: e.target.checked })} className="h-4 w-4" />
        Bật hàng chờ
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Số người được mua cùng lúc"
          name="queueCapacity"
          value={form.capacity}
          disabled={disabled}
          onChange={(e) => onChange({ ...form, capacity: e.target.value })}
          error={problems.capacity ?? undefined}
        />
        <TextField
          label="Thời gian mỗi lượt (phút)"
          name="queueSessionMinutes"
          type="number"
          min={QUEUE_LIMITS.minMinutes}
          max={QUEUE_LIMITS.maxMinutes}
          value={form.minutes}
          disabled={disabled}
          onChange={(e) => onChange({ ...form, minutes: e.target.value })}
          error={problems.minutes ?? undefined}
        />
      </div>
    </>
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
