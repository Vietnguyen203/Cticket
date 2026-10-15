import { useState } from 'react'
import { Link } from 'react-router'
import { toApiError } from '../../api/errors'
import { leaveWaitlist, listMyWaitlist, type WaitlistEntry } from '../../api/waitlist'
import { Alert, Button, Card, FullPageSpinner } from '../../components/ui'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

const STATUS: Record<WaitlistEntry['status'], [string, string]> = {
  WAITING: ['Đang chờ', 'bg-slate-100 text-slate-700'],
  OFFERED: ['Có vé cho bạn', 'bg-emerald-50 text-emerald-700'],
  BOOKED: ['Đã đặt', 'bg-sky-50 text-sky-700'],
  EXPIRED: ['Hết thời gian giữ', 'bg-slate-100 text-slate-500'],
  CANCELLED: ['Đã rời', 'bg-slate-100 text-slate-500'],
  CLOSED: ['Suất đã ngừng bán', 'bg-slate-100 text-slate-500'],
}

/** Phase 18.4: my waiting list entries; an offer shows how long it is kept and "Đặt ngay". */
export function WaitlistPage() {
  const list = useAsync(listMyWaitlist, 'my-waitlist')
  const [error, setError] = useState<string | null>(null)

  async function leave(entry: WaitlistEntry) {
    setError(null)
    try {
      await leaveWaitlist(entry.id)
      list.reload()
    } catch (err) {
      setError(toApiError(err).message)
    }
  }

  if (list.error) return <div className="mx-auto max-w-md px-4 py-16"><Alert>{list.error.message}</Alert></div>
  if (!list.data) return <FullPageSpinner />

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:py-10">
      <div>
        <h1 className="text-xl font-bold">Danh sách chờ</h1>
        <p className="text-sm text-slate-600">
          Khi có vé trả lại, người đăng ký sớm nhất nhận email và được giữ vé 30 phút để đặt; hết 30 phút thì vé được mời cho người tiếp theo.
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      {list.data.length === 0 && (
        <Card className="text-sm text-slate-600">
          Bạn chưa chờ hạng vé nào. Khi một hạng vé hết, bấm "Báo tôi khi có vé" ở trang chọn chỗ.
        </Card>
      )}
      {list.data.map((entry) => {
        const [label, classes] = STATUS[entry.status]
        const live = entry.status === 'WAITING' || entry.status === 'OFFERED'
        return (
          <Card key={entry.id} className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{entry.event.title}</p>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${classes}`}>{label}</span>
            </div>
            <p className="text-slate-600">
              {formatDateTime(entry.schedule.startAt)} · {entry.schedule.venueName} · {entry.ticketType.name} × {entry.quantity}
            </p>
            {entry.status === 'WAITING' && entry.position !== null && <p className="text-slate-600">Bạn đứng thứ {entry.position} trong danh sách.</p>}
            {entry.status === 'OFFERED' && entry.offerExpiresAt && (
              <Alert tone="success">Vé được giữ cho bạn tới {formatDateTime(entry.offerExpiresAt)}. Đặt trước giờ đó để không mất lượt.</Alert>
            )}
            <div className="flex flex-wrap gap-2">
              {entry.status === 'OFFERED' && (
                <Link
                  to={`/events/${entry.event.slug}/schedules/${entry.schedule.id}`}
                  className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800"
                >
                  Đặt ngay
                </Link>
              )}
              {live && (
                <Button variant="ghost" onClick={() => void leave(entry)}>
                  Rời danh sách
                </Button>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
