import { Link } from 'react-router'
import { listEventsByStatus, listOrganizers } from '../../api/admin'
import { getOverview, type PeriodTotals } from '../../api/reports'
import { PageHeader } from '../../admin/components'
import { ADMIN_MENU, hasAny } from '../../admin/permissions'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Card } from '../../components/ui'
import { ReportSection, Stat } from '../../reports/parts'
import { SalesChart } from '../../reports/SalesChart'
import { formatVnd } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

/** Dashboard: sales (report:read:any) and the things waiting for an admin. */
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
      {hasAny(user, ['report:read:any']) && <SalesOverview />}
      {(canApprove || canOrganizers) && <h2 className="mb-3 mt-8 text-lg font-semibold">Chờ duyệt</h2>}
      <div className="grid gap-4 sm:grid-cols-2">
        {canApprove && (
          <Todo to="/admin/events?status=PENDING_APPROVAL" label="Sự kiện chờ duyệt" count={pendingEvents.data?.meta.total} />
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

function Period({ label, totals }: { label: string; totals: PeriodTotals | undefined }) {
  return (
    <Stat
      label={label}
      value={totals ? formatVnd(totals.revenue) : '…'}
      note={totals && `${totals.orders} đơn · ${totals.tickets} vé${totals.refunds.orders > 0 ? ` · hoàn ${totals.refunds.orders} đơn` : ''}`}
    />
  )
}

function SalesOverview() {
  const overview = useAsync(getOverview, 'overview')
  if (overview.error) return <Alert>{overview.error.message}</Alert>
  const o = overview.data
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Period label="Hôm nay" totals={o?.today} />
        <Period label="7 ngày" totals={o?.last7Days} />
        <Period label="30 ngày" totals={o?.last30Days} />
        <Stat label="Sự kiện đang bán" value={o?.publishedEvents ?? '…'} note={o && `${o.newUsers7Days} người dùng mới trong 7 ngày`} />
      </div>
      {o && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ReportSection title="Doanh thu 30 ngày">
              <Card>
                <SalesChart days={o.daily} />
              </Card>
            </ReportSection>
          </div>
          <ReportSection title="Bán chạy 30 ngày">
            <Card className="!p-0">
              {o.topEvents.length === 0 && <p className="p-4 text-sm text-slate-500">Chưa có đơn nào.</p>}
              <ol className="divide-y divide-slate-100">
                {o.topEvents.map((e, i) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <Link to={`/admin/reports/events/${e.id}`} className="min-w-0 hover:underline">
                      <span className="mr-2 text-slate-400">{i + 1}</span>
                      <span className="font-medium">{e.title}</span>
                      <span className="block truncate text-xs text-slate-500">{e.organizerName} · {e.tickets} vé</span>
                    </Link>
                    <span className="shrink-0 font-semibold">{formatVnd(e.revenue)}</span>
                  </li>
                ))}
              </ol>
              <Link to="/admin/reports" className="block border-t border-slate-100 px-4 py-2 text-sm font-semibold text-brand-700 hover:underline">
                Xem báo cáo doanh thu →
              </Link>
            </Card>
          </ReportSection>
        </div>
      )}
    </div>
  )
}
