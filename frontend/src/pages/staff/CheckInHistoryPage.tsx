import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { listCheckIns } from '../../api/checkins'
import { getCheckInStats } from '../../api/organizer'
import { EmptyRow, Pagination, TableCard } from '../../admin/components'
import { Alert, Button, Card } from '../../components/ui'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

const PAGE_SIZE = 20

/** CHK-02 + CHK-03: who came in, newest first, and the totals per ticket type. */
export function CheckInHistoryPage() {
  const { scheduleId = '' } = useParams()
  const [page, setPage] = useState(1)
  const [round, setRound] = useState(0)
  const stats = useAsync(() => getCheckInStats(scheduleId), `stats:${scheduleId}:${round}`)
  const list = useAsync(() => listCheckIns(scheduleId, { page, pageSize: PAGE_SIZE }), `checkins:${scheduleId}:${page}:${round}`)

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link to={`/staff/scan/${scheduleId}`} className="text-sm text-brand-700 hover:underline">
            ← Quay lại quét vé
          </Link>
          <h1 className="text-xl font-bold">Lịch sử soát vé</h1>
        </div>
        <Button variant="secondary" onClick={() => setRound((r) => r + 1)}>
          Làm mới
        </Button>
      </div>

      {(stats.error ?? list.error) && <Alert>{(stats.error ?? list.error)?.message}</Alert>}

      {stats.data && (
        <Card className="space-y-2 !p-4">
          <p className="text-lg font-semibold">
            Đã vào {stats.data.checkedIn} / {stats.data.total} vé
          </p>
          {stats.data.byTicketType.map((type) => (
            <div key={type.ticketTypeId} className="text-sm">
              <div className="flex justify-between">
                <span>{type.ticketTypeName}</span>
                <span className="tabular-nums">
                  {type.checkedIn} / {type.total}
                </span>
              </div>
              <div className="mt-1 h-2 rounded bg-slate-100">
                <div
                  className="h-2 rounded bg-emerald-500"
                  style={{ width: `${type.total ? Math.round((type.checkedIn / type.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </Card>
      )}

      <TableCard>
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Giờ vào</th>
            <th className="px-3 py-2">Vé</th>
            <th className="px-3 py-2">Cổng</th>
            <th className="px-3 py-2">Nhân viên</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.checkIns.map((entry) => (
            <tr key={entry.id} className="border-t border-slate-100">
              <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(entry.checkedInAt)}</td>
              <td className="px-3 py-2">
                <span className="font-mono text-xs">{entry.ticket.code}</span>
                <br />
                {entry.ticket.ticketTypeName} · {entry.ticket.seatLabel ?? `#${entry.ticket.admissionNo}`}
              </td>
              <td className="px-3 py-2">{entry.deviceId ?? '—'}</td>
              <td className="px-3 py-2">{entry.staffName}</td>
            </tr>
          ))}
          {list.data?.checkIns.length === 0 && <EmptyRow colSpan={4}>Chưa có ai vào.</EmptyRow>}
        </tbody>
      </TableCard>
      <Pagination meta={list.data?.meta} onPage={setPage} />
    </div>
  )
}
