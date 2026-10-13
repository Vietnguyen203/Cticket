import { Link, useParams } from 'react-router'
import { PageHeader, StatusBadge } from '../../admin/components'
import { EventSalesReport } from '../../reports/EventSalesReport'

/** REP-01 for any event (admin). */
export function EventReportPage() {
  const { id = '' } = useParams()
  return (
    <EventSalesReport
      eventId={id}
      header={(report) => (
        <PageHeader
          title={report.event.title}
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              <Link to="/admin/reports" className="text-brand-700 hover:underline">
                ← Doanh thu
              </Link>
              <StatusBadge status={report.event.status} />
            </span>
          }
        />
      )}
    />
  )
}
