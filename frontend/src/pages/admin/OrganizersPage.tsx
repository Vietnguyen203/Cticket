import { useState } from 'react'
import { changeOrganizerStatus, listOrganizers, type OrganizerProfile, type OrganizerStatus } from '../../api/admin'
import { toApiError } from '../../api/errors'
import { ConfirmDialog, EmptyRow, PageHeader, Pagination, StatusBadge, TableCard, Tabs } from '../../admin/components'
import { Alert, Button } from '../../components/ui'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

type Action = { organizer: OrganizerProfile; to: Exclude<OrganizerStatus, 'PENDING'> }

const ACTIONS: Record<Exclude<OrganizerStatus, 'PENDING'>, { label: string; danger: boolean; askReason: boolean; message: string }> = {
  ACTIVE: { label: 'Duyệt', danger: false, askReason: false, message: 'Tài khoản sẽ có quyền tạo sự kiện (sau lần đăng nhập / làm mới phiên tiếp theo).' },
  REJECTED: { label: 'Từ chối', danger: true, askReason: true, message: 'Đơn đăng ký bị từ chối.' },
  SUSPENDED: { label: 'Tạm khóa', danger: true, askReason: true, message: 'Nhà tổ chức không quản lý được sự kiện của mình cho tới khi mở lại.' },
}

/** Which buttons each status gets (the API refuses anything else). */
const NEXT: Record<OrganizerStatus, Array<Exclude<OrganizerStatus, 'PENDING'>>> = {
  PENDING: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE'],
  REJECTED: [],
}

export function OrganizersPage() {
  const [status, setStatus] = useState<OrganizerStatus>('PENDING')
  const [page, setPage] = useState(1)
  const [action, setAction] = useState<Action | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const list = useAsync(() => listOrganizers({ status, page, pageSize: 20 }), `${status}:${page}`)

  return (
    <>
      <PageHeader title="Nhà tổ chức" subtitle="" />
      <Tabs
        value={status}
        onChange={(value) => {
          setStatus(value)
          setPage(1)
        }}
        options={[
          ['PENDING', 'Chờ duyệt'],
          ['ACTIVE', 'Hoạt động'],
          ['SUSPENDED', 'Tạm khóa'],
          ['REJECTED', 'Từ chối'],
        ]}
      />
      {done && (
        <div className="mb-4">
          <Alert tone="success">{done}</Alert>
        </div>
      )}
      {list.error && <Alert>{list.error.message}</Alert>}
      <TableCard>
        <thead>
          <tr>
            <th>Tổ chức</th>
            <th>Tài khoản</th>
            <th>Mã số thuế</th>
            <th>Ngày gửi</th>
            <th>Trạng thái</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.data?.organizers.map((organizer) => (
            <tr key={organizer.id}>
              <td>
                <p className="font-medium text-slate-900">{organizer.organizationName}</p>
                {organizer.description && <p className="mt-0.5 line-clamp-2 max-w-xs text-xs text-slate-500">{organizer.description}</p>}
              </td>
              <td className="text-slate-600">{organizer.userEmail}</td>
              <td className="text-slate-600">{organizer.taxCode ?? '—'}</td>
              <td className="whitespace-nowrap text-slate-600">{formatDateTime(organizer.createdAt)}</td>
              <td>
                <StatusBadge status={organizer.status} />
              </td>
              <td className="whitespace-nowrap text-right">
                <div className="flex justify-end gap-2">
                  {NEXT[organizer.status].map((to) => (
                    <Button key={to} variant={ACTIONS[to].danger ? 'secondary' : 'primary'} onClick={() => setAction({ organizer, to })}>
                      {organizer.status === 'SUSPENDED' && to === 'ACTIVE' ? 'Mở lại' : ACTIONS[to].label}
                    </Button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
          {list.data && list.data.organizers.length === 0 && <EmptyRow colSpan={6}>Không có nhà tổ chức nào ở trạng thái này.</EmptyRow>}
          {!list.data && list.loading && <EmptyRow colSpan={6}>Đang tải…</EmptyRow>}
        </tbody>
      </TableCard>
      <Pagination meta={list.data?.meta} onPage={setPage} />

      <ConfirmDialog
        open={action !== null}
        title={action ? `${ACTIONS[action.to].label}: ${action.organizer.organizationName}` : ''}
        message={action && ACTIONS[action.to].message}
        confirmLabel={action ? ACTIONS[action.to].label : ''}
        danger={action ? ACTIONS[action.to].danger : false}
        askReason={action ? ACTIONS[action.to].askReason : false}
        onClose={() => setAction(null)}
        onConfirm={async (reason) => {
          if (!action) return
          try {
            await changeOrganizerStatus(action.organizer.id, action.to, reason || undefined)
          } catch (err) {
            throw toApiError(err)
          }
          setDone(`Đã cập nhật ${action.organizer.organizationName}.`)
          list.reload()
        }}
      />
    </>
  )
}
