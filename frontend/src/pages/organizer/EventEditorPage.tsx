import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toApiError } from '../../api/errors'
import { deleteEvent, getMyEvent, setEventStatus, updateEvent } from '../../api/organizer'
import { ConfirmDialog, PageHeader, StatusBadge, Tabs } from '../../admin/components'
import { Alert, Button, Card, FullPageSpinner } from '../../components/ui'
import { EventInfoForm } from '../../organizer/EventInfoForm'
import { NewScheduleForm } from '../../organizer/NewScheduleForm'
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
  delete: { label: 'Xóa', title: 'Xóa sự kiện nháp?', danger: true, askReason: false, message: 'Sự kiện, suất diễn và hạng vé bị xóa hẳn.' },
}

/** Event editor of the organizer: info → schedules / ticket types / seat plan → submit; then run it. */
export function EventEditorPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'info'
  const [round, setRound] = useState(0)
  const event = useAsync(() => getMyEvent(id), `event:${id}:${round}`)
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
    e.status === 'DRAFT' ? ['submit', 'delete'] : e.status === 'PENDING_APPROVAL' ? ['withdraw', 'cancel'] : e.status === 'PUBLISHED' ? ['cancel'] : []

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
          ['schedules', `Suất diễn & vé (${e.schedules.length})`],
          ['staff', 'Nhân viên soát vé'],
          ...(hasSales ? ([['sales', 'Doanh thu']] as Array<[Tab, string]>) : []),
        ]}
      />

      {tab === 'info' && (
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
      )}

      {tab === 'schedules' && (
        <div className="space-y-4">
          {setups.error && <Alert>{setups.error.message}</Alert>}
          {setups.data?.map((setup) => (
            <ScheduleCard key={setup.schedule.id} setup={setup} eventStatus={e.status} onChanged={reload} />
          ))}
          {!setups.data && <p className="text-sm text-slate-500">Đang tải…</p>}
          {e.status === 'DRAFT' && <NewScheduleForm eventId={e.id} onCreated={reload} />}
        </div>
      )}

      {tab === 'staff' && <StaffPanel eventId={e.id} />}

      {tab === 'sales' && hasSales && <EventSalesReport eventId={e.id} />}

      {action && (
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
              if (action === 'delete') {
                await deleteEvent(e.id)
                navigate('/organizer', { replace: true })
                return
              }
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
