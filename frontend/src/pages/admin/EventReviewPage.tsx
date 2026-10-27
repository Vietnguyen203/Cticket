import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { changeEventStatus, getEventForReview, getSeatPlan, getVenue, listTicketTypes } from '../../api/admin'
import { toApiError } from '../../api/errors'
import type { Schedule } from '../../api/types'
import { ConfirmDialog, PageHeader, StatusBadge } from '../../admin/components'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Button, Card, FullPageSpinner } from '../../components/ui'
import { DeleteEventDialog } from '../../organizer/DeleteEventDialog'
import { formatDateTime, formatVnd } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

type Decision = 'approve' | 'reject' | 'cancel'

const DECISIONS: Record<Decision, { status: 'PUBLISHED' | 'DRAFT' | 'CANCELLED'; title: string; label: string; danger: boolean; askReason: boolean; message: string }> = {
  approve: {
    status: 'PUBLISHED',
    title: 'Duyệt sự kiện',
    label: 'Duyệt và mở bán',
    danger: false,
    askReason: false,
    message: 'Ghế và vé của mọi suất được tạo ngay; vé mở bán theo giờ mở bán của từng suất.',
  },
  reject: {
    status: 'DRAFT',
    title: 'Từ chối sự kiện',
    label: 'Từ chối',
    danger: true,
    askReason: true,
    message: 'Sự kiện trở về dạng nháp; ban tổ chức sửa rồi gửi lại.',
  },
  cancel: {
    status: 'CANCELLED',
    title: 'Hủy sự kiện',
    label: 'Hủy sự kiện',
    danger: true,
    askReason: true,
    message: 'Không thể hoàn tác. Mọi đơn đang giữ chỗ bị hủy, mọi đơn đã thanh toán được hoàn tiền.',
  },
}

const LINK_BUTTON = 'inline-flex items-center rounded-lg border border-slate-300 bg-surface px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50'

/** EVT review: what the organizer submitted, then approve / reject / cancel. */
export function EventReviewPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const event = useAsync(() => getEventForReview(id), `event:${id}`)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const navigate = useNavigate()
  const canApprove = user?.permissions?.includes('event:approve') ?? false
  const canEdit = user?.permissions?.includes('event:manage:any') ?? false
  const canReport = user?.permissions?.includes('report:read:any') ?? false

  if (event.error) return <Alert>{event.error.message}</Alert>
  if (!event.data) return <FullPageSpinner />
  const e = event.data
  const decisions: Decision[] = []
  if (canApprove && e.status === 'PENDING_APPROVAL') decisions.push('approve', 'reject')
  if (canApprove && ['DRAFT', 'PENDING_APPROVAL', 'PUBLISHED'].includes(e.status)) decisions.push('cancel')

  return (
    <>
      <PageHeader
        title={e.title}
        subtitle={
          <Link to="/admin/events" className="text-brand-700 hover:underline">
            ← Danh sách sự kiện
          </Link>
        }
        actions={
          <>
            {canEdit && (
              <Link to={`/organizer/events/${e.id}`} className={LINK_BUTTON}>
                Chỉnh sửa
              </Link>
            )}
            {canReport && e.status !== 'DRAFT' && (
              <Link to={`/admin/reports/events/${e.id}`} className={LINK_BUTTON}>
                Doanh thu
              </Link>
            )}
            {decisions.map((d) => (
              <Button key={d} variant={DECISIONS[d].danger ? 'secondary' : 'primary'} onClick={() => setDecision(d)}>
                {DECISIONS[d].label}
              </Button>
            ))}
            {canEdit && (
              <Button variant="danger" onClick={() => setDeleting(true)}>
                Xóa
              </Button>
            )}
          </>
        }
      />
      {done && (
        <div className="mb-4">
          <Alert tone="success">{done}</Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={e.status} />
            {e.categories.map((c) => (
              <span key={c.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {c.name}
              </span>
            ))}
            {e.ageRestriction ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{e.ageRestriction}+</span> : null}
          </div>
          {e.bannerUrl && <img src={e.bannerUrl} alt="" className="max-h-64 w-full rounded-lg object-cover" />}
          <p className="text-sm text-slate-500">Ban tổ chức: {e.organizer.name}</p>
          <p className="whitespace-pre-line text-sm text-slate-800">{e.description || 'Chưa có mô tả.'}</p>
        </Card>
        <Card className="text-sm text-slate-600">
          <h2 className="mb-2 font-semibold text-slate-900">Duyệt cần xem</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Nội dung, hình ảnh phù hợp.</li>
            <li>Mỗi suất có địa điểm, giờ diễn, giờ mở / đóng bán hợp lý.</li>
            <li>Mọi ghế của khu ngồi đã thuộc một hạng vé, giá đúng.</li>
          </ul>
        </Card>
      </div>

      <h2 className="mb-3 mt-6 text-lg font-semibold">Suất diễn ({e.schedules.length})</h2>
      <div className="space-y-3">
        {e.schedules.map((schedule) => (
          <ScheduleReview key={schedule.id} schedule={schedule} />
        ))}
        {e.schedules.length === 0 && <p className="text-sm text-slate-500">Chưa có suất diễn.</p>}
      </div>

      {decision && (
        <ConfirmDialog
          open
          title={DECISIONS[decision].title}
          message={DECISIONS[decision].message}
          confirmLabel={DECISIONS[decision].label}
          danger={DECISIONS[decision].danger}
          askReason={DECISIONS[decision].askReason}
          onClose={() => setDecision(null)}
          onConfirm={async (reason) => {
            try {
              await changeEventStatus(e.id, DECISIONS[decision].status, reason || undefined)
            } catch (err) {
              throw toApiError(err)
            }
            setDone(`Đã ${DECISIONS[decision].label.toLowerCase()}.`)
            event.reload()
          }}
        />
      )}
      {deleting && (
        <DeleteEventDialog eventId={e.id} onClose={() => setDeleting(false)} onDeleted={() => navigate('/admin/events', { replace: true })} />
      )}
    </>
  )
}

function ScheduleReview({ schedule }: { schedule: Schedule }) {
  const ticketTypes = useAsync(() => listTicketTypes(schedule.id), `tt:${schedule.id}`)
  const plan = useAsync(() => getSeatPlan(schedule.id), `plan:${schedule.id}`)
  const venue = useAsync(() => getVenue(schedule.venue.id), `venue:${schedule.venue.id}`)
  const seatsOf = (ticketTypeId: string) => plan.data?.ticketTypes.find((t) => t.ticketTypeId === ticketTypeId)?.seats

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{formatDateTime(schedule.startAt)}</p>
          <p className="text-sm text-slate-600">
            {schedule.venue.name} · {schedule.venue.city}
          </p>
        </div>
        <StatusBadge status={schedule.status} />
      </div>
      {venue.data?.status === 'PENDING' && (
        <div className="mt-2">
          <Alert tone="warning">
            Địa điểm mới do ban tổ chức đề xuất, chưa duyệt: duyệt sự kiện sẽ duyệt luôn địa điểm này.{' '}
            <Link to={`/admin/venues/${schedule.venue.id}`} className="font-semibold underline">
              Xem khu và ghế
            </Link>
          </Alert>
        </div>
      )}
      {venue.data?.status === 'INACTIVE' && (
        <div className="mt-2">
          <Alert>Địa điểm đã bị từ chối / ngừng dùng: sự kiện không duyệt được cho tới khi ban tổ chức đổi địa điểm.</Alert>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Mở bán {formatDateTime(schedule.salesStartAt)} → đóng {formatDateTime(schedule.salesEndAt)}
        {schedule.inventoryGeneratedAt ? ' · đã tạo vé' : ''}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1 pr-4">Hạng vé</th>
              <th className="py-1 pr-4">Loại</th>
              <th className="py-1 pr-4">Giá</th>
              <th className="py-1 pr-4">Số lượng</th>
              <th className="py-1">Tối đa / đơn</th>
            </tr>
          </thead>
          <tbody>
            {ticketTypes.data?.map((tt) => (
              <tr key={tt.id} className="border-t border-slate-100">
                <td className="py-1.5 pr-4 font-medium">{tt.name}</td>
                <td className="py-1.5 pr-4 text-slate-600">{tt.inventoryMode === 'RESERVED' ? 'Ghế ngồi' : 'Vé đứng'}</td>
                <td className="py-1.5 pr-4">{formatVnd(tt.price)}</td>
                <td className="py-1.5 pr-4 text-slate-600">
                  {tt.inventoryMode === 'RESERVED' ? `${seatsOf(tt.id) ?? '…'} ghế` : `${tt.capacity} vé`}
                </td>
                <td className="py-1.5 text-slate-600">{tt.maxPerOrder}</td>
              </tr>
            ))}
            {ticketTypes.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-amber-700">
                  Chưa có hạng vé.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(ticketTypes.error || plan.error) && <p className="mt-2 text-sm text-red-600">{(ticketTypes.error ?? plan.error)?.message}</p>}
    </Card>
  )
}
