import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toApiError } from '../../api/errors'
import { getMyEvent, setEventStatus, updateEvent } from '../../api/organizer'
import { ConfirmDialog, PageHeader, StatusBadge, Tabs } from '../../admin/components'
import { hasAny } from '../../admin/permissions'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Button, Card, FullPageSpinner } from '../../components/ui'
import { DeleteEventDialog } from '../../organizer/DeleteEventDialog'
import { EventInfoForm } from '../../organizer/EventInfoForm'
import { ScheduleList } from '../../organizer/ScheduleList'
import { PurchaseQueueCard, QueueStatsLine } from '../../organizer/PurchaseQueueCard'
import { LineupCard } from '../../organizer/LineupCard'
import { submitChecklist } from '../../organizer/readiness'
import { ScheduleCard } from '../../organizer/ScheduleCard'
import { loadSchedules } from '../../organizer/setup'
import { StaffPanel } from '../../organizer/StaffPanel'
import { EventSalesReport } from '../../reports/EventSalesReport'
import { useAsync } from '../../utils/useAsync'

type Tab = 'info' | 'schedules' | 'staff' | 'sales'
type Action = 'submit' | 'withdraw' | 'cancel' | 'delete'

const ACTIONS: Record<Action, { label: string; title: string; danger: boolean; askReason: boolean; message: string }> = {
  submit: { label: 'Gửi duyệt', title: 'Gửi sự kiện cho quản trị viên duyệt?', danger: false, askReason: false, message: 'Trong lúc chờ duyệt bạn không sửa được; muốn sửa thì rút lại.' },
  withdraw: { label: 'Rút lại', title: 'Rút lại về nháp?', danger: false, askReason: false, message: 'Sự kiện trở về dạng nháp để bạn sửa tiếp.' },
  cancel: { label: 'Hủy sự kiện', title: 'Hủy sự kiện?', danger: true, askReason: true, message: 'Không thể hoàn tác. Đơn đang giữ chỗ bị hủy, đơn đã thanh toán được hoàn tiền.' },
  // Shown by DeleteEventDialog (what goes, title typed again), not by the generic confirm.
  delete: { label: 'Xóa', title: '', danger: true, askReason: false, message: '' },
}

/** Event editor of the organizer: info → schedules / ticket types / seat plan → submit; then run it. */
export function EventEditorPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'info'
  const [round, setRound] = useState(0)
  const { user } = useAuth()
  const anyEvent = hasAny(user, ['event:manage:any']) // an admin edits any organizer's event
  const event = useAsync(() => getMyEvent(id, { anyEvent }), `event:${id}:${round}:${anyEvent}`)
  // Reloads after every change, and when the reloaded event brings different schedules.
  const setups = useAsync(
    () => (event.data ? loadSchedules(event.data) : Promise.resolve([])),
    `setups:${round}:${event.data?.status}:${JSON.stringify(event.data?.schedules ?? null)}`,
  )
  const [action, setAction] = useState<Action | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const reload = () => setRound((r) => r + 1)

  if (event.error) return <Alert>{event.error.message}</Alert>
  if (!event.data) return <FullPageSpinner />
  const e = event.data
  const checklist = setups.data ? submitChecklist(setups.data) : null
  // Sales exist once the event went on sale (also after it ended or was cancelled: refunds).
  const hasSales = e.status === 'PUBLISHED' || e.status === 'FINISHED' || e.status === 'CANCELLED'
  const actions: Action[] =
    e.status === 'DRAFT'
      ? ['submit', 'delete']
      : e.status === 'PENDING_APPROVAL'
        ? ['withdraw', 'cancel', 'delete']
        : e.status === 'PUBLISHED'
          ? ['cancel', 'delete']
          : ['delete'] // finished / cancelled: can still be deleted for good

  return (
    <>
      <PageHeader
        title={e.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link to="/organizer" className="text-brand-700 hover:underline">
              ← Sự kiện của tôi
            </Link>
            <StatusBadge status={e.status} />
          </span>
        }
        actions={actions.map((a) => (
          <Button
            key={a}
            variant={a === 'submit' ? 'primary' : 'secondary'}
            disabled={a === 'submit' && (!checklist || checklist.problems.length > 0)}
            onClick={() => setAction(a)}
          >
            {ACTIONS[a].label}
          </Button>
        ))}
      />
      {done && (
        <div className="mb-4">
          <Alert tone="success">{done}</Alert>
        </div>
      )}
      {e.status === 'DRAFT' && checklist && (checklist.problems.length > 0 || checklist.warnings.length > 0) && (
        <Card className="mb-4 text-sm">
          <p className="font-semibold">{checklist.problems.length > 0 ? 'Còn thiếu trước khi gửi duyệt:' : 'Lưu ý trước khi gửi duyệt:'}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {checklist.problems.map((p) => (
              <li key={p} className="text-red-700">
                {p}
              </li>
            ))}
            {checklist.warnings.map((w) => (
              <li key={w} className="text-amber-700">
                {w}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Tabs
        value={tab}
        onChange={(value) => setParams({ tab: value }, { replace: true })}
        options={[
          ['info', 'Thông tin'],
          ['schedules', 'Buổi diễn & vé'],
          ['staff', 'Nhân viên soát vé'],
          ...(hasSales ? ([['sales', 'Doanh thu']] as Array<[Tab, string]>) : []),
        ]}
      />

      {tab === 'info' && (
        <div className="space-y-4">
          <Card>
            <EventInfoForm
              key={`${e.id}:${e.status}`}
              event={e}
              submitLabel="Lưu thông tin"
              onSubmit={async (input) => {
                await updateEvent(e.id, input)
                reload()
              }}
            />
          </Card>
          {/* Phase 21 */}
          <PurchaseQueueCard
            key={`queue:${e.id}:${e.status}:${JSON.stringify(e.queue ?? null)}`}
            event={e}
            onSave={async (input) => {
              await updateEvent(e.id, input)
              reload()
            }}
          />
        </div>
      )}

      {tab === 'schedules' && (
        <div className="space-y-4">
          <ScheduleList key={`schedules:${e.status}`} event={e} onChanged={reload} />
          <LineupCard
            // Not keyed on the lineup itself: after saving, the rows stay and compare equal to what was saved ("Đã lưu").
            key={`lineup:${e.id}:${e.status}`}
            event={e}
            onSave={async (input) => {
              await updateEvent(e.id, input)
              reload()
            }}
          />
          {setups.error && <Alert>{setups.error.message}</Alert>}
          {setups.data?.map((setup) => (
            <ScheduleCard key={setup.schedule.id} setup={setup} eventStatus={e.status} onChanged={reload} />
          ))}
          {!setups.data && <p className="text-sm text-slate-500">Đang tải…</p>}
        </div>
      )}

      {tab === 'staff' && <StaffPanel eventId={e.id} />}

      {tab === 'sales' && hasSales && (
        <div className="space-y-4">
          {e.queue?.enabled && e.status === 'PUBLISHED' && <QueueStatsLine eventId={e.id} />}
          <EventSalesReport eventId={e.id} />
        </div>
      )}

      {action === 'delete' && (
        <DeleteEventDialog
          eventId={e.id}
          onClose={() => setAction(null)}
          onDeleted={() => navigate(anyEvent ? '/admin/events' : '/organizer', { replace: true })}
        />
      )}

      {action && action !== 'delete' && (
        <ConfirmDialog
          open
          title={ACTIONS[action].title}
          message={ACTIONS[action].message}
          confirmLabel={ACTIONS[action].label}
          danger={ACTIONS[action].danger}
          askReason={ACTIONS[action].askReason}
          onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            try {
              const target = { submit: 'PENDING_APPROVAL', withdraw: 'DRAFT', cancel: 'CANCELLED' } as const
              await setEventStatus(e.id, target[action], reason || undefined)
            } catch (err) {
              throw toApiError(err)
            }
            setDone(action === 'submit' ? 'Đã gửi duyệt. Quản trị viên sẽ xem và duyệt sự kiện.' : `Đã ${ACTIONS[action].label.toLowerCase()}.`)
            reload()
          }}
        />
      )}
    </>
  )
}
