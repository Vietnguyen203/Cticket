import type { ReactNode } from 'react'
import { getEventSales, type EventSales } from '../api/reports'
import { EmptyRow, TableCard } from '../admin/components'
import { Alert, Card, FullPageSpinner } from '../components/ui'
import { formatDateTime, formatVnd } from '../utils/format'
import { useAsync } from '../utils/useAsync'
import type { Cell } from './csv'
import { percent } from './numbers'
import { FillBar, ReportSection, Stat } from './parts'
import { SalesChart } from './SalesChart'

const MODE = { RESERVED: 'Ghế ngồi', GENERAL_ADMISSION: 'Vé đứng' } as const

/**
 * REP-01, shared by the organizer (event tab) and the admin
 * (/admin/reports/events/:id, which puts the event title above it with `header`).
 */
export function EventSalesReport({ eventId, header }: { eventId: string; header?: (report: EventSales) => ReactNode }) {
  const report = useAsync(() => getEventSales(eventId), `event-sales:${eventId}`)
  if (report.error) return <Alert>{report.error.message}</Alert>
  if (!report.data) return <FullPageSpinner />
  const r = report.data
  const t = r.totals
  const file = (what: string) => `${what}_${r.event.slug}.csv`

  return (
    <div className="space-y-6">
      {header?.(r)}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Doanh thu"
          value={formatVnd(t.revenue)}
          note={t.discount > 0 ? `Gộp ${formatVnd(t.gross)} − giảm ${formatVnd(t.discount)}` : `${t.orders} đơn`}
        />
        <Stat label="Vé đã bán" value={t.tickets} note={`trên ${t.capacity - t.blocked} chỗ bán được`} />
        <Stat label="Lấp đầy" value={percent(t.fillRate)} note={t.blocked > 0 ? `${t.blocked} chỗ đang khóa` : undefined} />
        <Stat label="Đã vào cổng" value={t.checkedIn} note={t.tickets > 0 ? `${percent(t.checkedIn / t.tickets)} số vé` : undefined} />
        <Stat
          label="Hoàn tiền"
          value={formatVnd(t.refunds.amount)}
          note={`${t.refunds.orders} đơn (không tính vào doanh thu)${t.cancellationFees > 0 ? ` · phí hủy giữ lại ${formatVnd(t.cancellationFees)} (đã tính vào doanh thu)` : ''}`}
          tone={t.refunds.orders > 0 ? 'red' : undefined}
        />
      </div>

      <ReportSection
        title="Doanh thu theo ngày"
        note="Theo ngày thanh toán, giờ Việt Nam. Đơn hoàn tiền rút khỏi ngày bán và hiện ở ngày hoàn."
        csv={{ filename: file('doanh-thu-theo-ngay'), rows: () => dailyRows(r) }}
      >
        <Card>
          <SalesChart days={r.daily} />
        </Card>
      </ReportSection>

      <ReportSection
        title="Theo suất diễn và hạng vé"
        note="Doanh thu hạng vé tính trước giảm giá (mã giảm giá áp cho cả đơn)."
        csv={{ filename: file('hang-ve'), rows: () => ticketTypeRows(r) }}
      >
        {r.schedules.length === 0 && <Card className="text-sm text-slate-500">Chưa có suất diễn.</Card>}
        {r.schedules.map((s) => (
          <div key={s.id} className="space-y-2">
            <p className="text-sm">
              <b>{formatDateTime(s.startAt)}</b> · {s.venueName} · {s.totals.tickets} vé · {formatVnd(s.totals.revenue)}
              {s.totals.refunds.orders > 0 && <span className="text-red-700"> · hoàn {s.totals.refunds.orders} đơn</span>}
            </p>
            <TableCard>
              <thead>
                <tr>
                  <th>Hạng vé</th>
                  <th>Giá</th>
                  <th>Đã bán / chỗ</th>
                  <th>Lấp đầy</th>
                  <th>Doanh thu</th>
                  <th>Đã vào</th>
                </tr>
              </thead>
              <tbody>
                {s.ticketTypes.map((tt) => (
                  <tr key={tt.id}>
                    <td>
                      <p className="font-medium">{tt.name}</p>
                      <p className="text-xs text-slate-500">{MODE[tt.mode]}</p>
                    </td>
                    <td className="whitespace-nowrap">{formatVnd(tt.price)}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {tt.sold} / {tt.capacity - tt.blocked}
                      {tt.blocked > 0 && <span className="block text-xs text-slate-500">khóa {tt.blocked}</span>}
                    </td>
                    <td>
                      <FillBar rate={tt.fillRate} />
                    </td>
                    <td className="whitespace-nowrap">{formatVnd(tt.revenue)}</td>
                    <td className="tabular-nums">{tt.checkedIn}</td>
                  </tr>
                ))}
                {s.ticketTypes.length === 0 && <EmptyRow colSpan={6}>Chưa có hạng vé.</EmptyRow>}
              </tbody>
            </TableCard>
          </div>
        ))}
      </ReportSection>

      <ReportSection title="Mã giảm giá đã dùng">
        <TableCard>
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tên</th>
              <th>Số đơn</th>
              <th>Đã giảm</th>
            </tr>
          </thead>
          <tbody>
            {r.promotions.map((p) => (
              <tr key={p.code}>
                <td className="font-mono">{p.code}</td>
                <td>{p.name}</td>
                <td className="tabular-nums">{p.orders}</td>
                <td className="whitespace-nowrap">{formatVnd(p.discount)}</td>
              </tr>
            ))}
            {r.promotions.length === 0 && <EmptyRow colSpan={4}>Chưa đơn nào dùng mã giảm giá.</EmptyRow>}
          </tbody>
        </TableCard>
      </ReportSection>
    </div>
  )
}

function dailyRows(r: EventSales): Cell[][] {
  return [
    ['Ngày', 'Số đơn', 'Số vé', 'Doanh thu (VND)', 'Trong đó phí hủy (VND)', 'Đơn hoàn', 'Tiền hoàn (VND)'],
    ...r.daily.map((d) => [d.date, d.orders, d.tickets, d.revenue, d.cancellationFees, d.refunds.orders, d.refunds.amount]),
  ]
}

function ticketTypeRows(r: EventSales): Cell[][] {
  return [
    ['Suất diễn', 'Địa điểm', 'Hạng vé', 'Loại', 'Giá (VND)', 'Sức chứa', 'Đang khóa', 'Đã bán', 'Lấp đầy (%)', 'Doanh thu trước giảm giá (VND)', 'Đã vào cổng'],
    ...r.schedules.flatMap((s) =>
      s.ticketTypes.map((tt) => [
        formatDateTime(s.startAt),
        s.venueName,
        tt.name,
        MODE[tt.mode],
        tt.price,
        tt.capacity,
        tt.blocked,
        tt.sold,
        tt.fillRate === null ? null : Math.round(tt.fillRate * 1000) / 10,
        tt.revenue,
        tt.checkedIn,
      ]),
    ),
  ]
}
