import { Link } from 'react-router'
import { listEventsByStatus, listOrganizers } from '../../api/admin'
import { PageHeader } from '../../admin/components'
import { ADMIN_MENU, hasAny } from '../../admin/permissions'
import { useAuth } from '../../auth/AuthContext'
import { Card } from '../../components/ui'
import { useAsync } from '../../utils/useAsync'

/** Things waiting for an admin. Sales figures come in step 12.4. */
export function AdminHomePage() {
  const { user } = useAuth()
  const canApprove = hasAny(user, ['event:approve'])
  const canOrganizers = hasAny(user, ['organizer:manage'])
  const pendingEvents = useAsync(
    () => (canApprove ? listEventsByStatus({ status: 'PENDING_APPROVAL', pageSize: 1 }) : Promise.resolve(null)),
    `pending-events:${canApprove}`,
  )
  const pendingOrganizers = useAsync(
    () => (canOrganizers ? listOrganizers({ status: 'PENDING', pageSize: 1 }) : Promise.resolve(null)),
    `pending-organizers:${canOrganizers}`,
  )

  return (
    <>
      <PageHeader title="Tổng quan" subtitle={`Xin chào ${user?.firstName ?? ''}.`} />
      <div className="grid gap-4 sm:grid-cols-2">
        {canApprove && (
          <Todo to="/admin/events" label="Sự kiện chờ duyệt" count={pendingEvents.data?.meta.total} />
        )}
        {canOrganizers && (
          <Todo to="/admin/organizers" label="Nhà tổ chức chờ duyệt" count={pendingOrganizers.data?.meta.total} />
        )}
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Đi tới</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ADMIN_MENU.filter((entry) => entry.to !== '/admin' && hasAny(user, entry.anyOf)).map((entry) => (
          <Link key={entry.to} to={entry.to} className="rounded-xl border border-slate-200 bg-white p-4 font-medium text-slate-800 shadow-sm hover:border-brand-600">
            {entry.label}
          </Link>
        ))}
      </div>
    </>
  )
}

function Todo({ to, label, count }: { to: string; label: string; count: number | undefined }) {
  return (
    <Link to={to}>
      <Card className="transition hover:border-brand-600">
        <p className="text-sm text-slate-600">{label}</p>
        <p className={`mt-1 text-3xl font-bold ${count ? 'text-amber-600' : 'text-slate-900'}`}>{count ?? '…'}</p>
      </Card>
    </Link>
  )
}
