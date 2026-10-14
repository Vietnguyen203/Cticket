import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toApiError } from '../api/errors'
import { deleteEvent, getDeletionSummary } from '../api/organizer'
import { Alert, Button } from '../components/ui'
import { formatVnd } from '../utils/format'
import { useAsync } from '../utils/useAsync'

/**
 * Delete an event for good, with everything it sold (its organizer or an
 * admin). Shows what goes first; anything but an empty draft needs the title
 * typed again (the API checks it too).
 */
export function DeleteEventDialog({ eventId, onClose, onDeleted }: { eventId: string; onClose: () => void; onDeleted: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const summary = useAsync(() => getDeletionSummary(eventId), `deletion-summary:${eventId}`)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const s = summary.data
  const emptyDraft = s ? s.status === 'DRAFT' && s.orders === 0 : false
  const confirmed = emptyDraft || (s !== undefined && s !== null && typed.trim() === s.title.trim())

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!s || !confirmed) return
    setBusy(true)
    setError(null)
    try {
      await deleteEvent(eventId, emptyDraft ? undefined : typed)
      onDeleted()
    } catch (err) {
      setError(toApiError(err).message)
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(92vw,30rem)] rounded-2xl p-0 shadow-xl backdrop:bg-slate-900/40">
      <form onSubmit={submit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-red-700">Xóa vĩnh viễn sự kiện?</h2>
        {summary.error && <Alert>{summary.error.message}</Alert>}
        {error && <Alert>{error}</Alert>}
        {!s && !summary.error && <p className="text-sm text-slate-500">Đang kiểm tra dữ liệu của sự kiện…</p>}
        {s && (
          <>
            <p className="text-sm">
              <b>{s.title}</b> và mọi thứ của nó sẽ bị xóa hẳn, <b>không hoàn tác được</b>:
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
              <li>{s.schedules} suất diễn, cùng hạng vé và sơ đồ ghế</li>
              {s.orders > 0 && (
                <li>
                  {s.orders} đơn hàng ({s.paidOrders} đã thanh toán, doanh thu {formatVnd(s.revenue)}) cùng thanh toán, hoàn tiền
                </li>
              )}
              {s.tickets > 0 && <li>{s.tickets} vé đã phát cho khách (khách mất vé, mã QR không còn dùng được)</li>}
              {s.checkIns > 0 && <li>{s.checkIns} lượt soát vé</li>}
            </ul>
            {s.paidOrders > 0 && (
              <Alert tone="warning">Khách đã trả tiền sẽ không được hoàn tiền tự động. Muốn hoàn tiền cho khách thì dùng "Hủy sự kiện" thay vì xóa.</Alert>
            )}
            {!emptyDraft && (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  Gõ lại tên sự kiện để xác nhận: <span className="font-semibold">{s.title}</span>
                </span>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                />
              </label>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Thôi
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={!confirmed}>
            Xóa vĩnh viễn
          </Button>
        </div>
      </form>
    </dialog>
  )
}
