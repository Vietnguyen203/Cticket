import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { getPlatformSales, type PlatformSales } from '../../api/reports'
import { EmptyRow, PageHeader, TableCard } from '../../admin/components'
import { Alert, Button, Card, FullPageSpinner } from '../../components/ui'
import type { Cell } from '../../reports/csv'
import { presetRange, vnToday, type RangePreset } from '../../reports/dates'
import { ReportSection, Stat } from '../../reports/parts'
import { SalesChart } from '../../reports/SalesChart'
import { formatVnd } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

const PRESETS: Array<[RangePreset, string]> = [
  ['7d', '7 ngày'],
  ['30d', '30 ngày'],
  ['month', 'Tháng này'],
  ['lastMonth', 'Tháng trước'],
]

/** REP-02: the whole platform over a range of days (at most 366). */
export function ReportsPage() {
  const [today] = useState(vnToday)
  const [range, setRange] = useState(() => presetRange('30d', today))
  const [draft, setDraft] = useState(range)
  const report = useAsync(() => getPlatformSales(range.from, range.to), `sales:${range.from}:${range.to}`)

  const apply = (e: FormEvent) => {
    e.preventDefault()
    setRange(draft)
  }
  const pick = (preset: RangePreset) => {
    const next = presetRange(preset, today)
    setDraft(next)
    setRange(next)
  }

  return (
    <>
      <PageHeader title="Doanh thu" subtitle="Toàn hệ thống, theo ngày thanh toán (giờ Việt Nam). Tối đa 366 ngày." />
      <Card className="mb-5 !p-4">
        <form onSubmit={apply} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Từ ngày</span>
            <input
              type="date"
              required
              max={draft.to}
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Đến ngày</span>
            <input
              type="date"
              required
              min={draft.from}
              max={today}
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <Button type="submit">Xem</Button>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map(([preset, label]) => (
              <button
                key={preset}
                type="button"
                onClick={() => pick(preset)}
                className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {label}
              </button>
            ))}
          </div>
        </form>
      </Card>

      {report.error && <Alert>{report.error.message}</Alert>}
      {!report.data && !report.error && <FullPageSpinner />}
      {report.data && <PlatformReport report={report.data} />}
    </>
  )
}

function PlatformReport({ report: r }: { report: PlatformSales }) {
  const t = r.totals
  const suffix = `${r.range.from}_${r.range.to}`
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Doanh thu" value={formatVnd(t.revenue)} note={t.discount > 0 ? `Gộp ${formatVnd(t.gross)} − giảm ${formatVnd(t.discount)}` : undefined} />
        <Stat label="Đơn / vé" value={`${t.orders} / ${t.tickets}`} note={`${t.buyers} người mua`} />
        <Stat label="Giá trị đơn trung bình" value={t.orders > 0 ? formatVnd(Math.round(t.revenue / t.orders)) : '—'} />
        <Stat label="Hoàn tiền" value={formatVnd(t.refunds.amount)} note={`${t.refunds.orders} đơn`} tone={t.refunds.orders > 0 ? 'red' : undefined} />
      </div>

      <ReportSection
        title="Theo ngày"
        note="Đơn hoàn tiền rút khỏi ngày bán và hiện ở ngày hoàn."
        csv={{ filename: `doanh-thu_${suffix}.csv`, rows: () => dailyRows(r) }}
      >
        <Card>
          <SalesChart days={r.daily} />
        </Card>
      </ReportSection>

      <ReportSection title="Sự kiện bán chạy" csv={{ filename: `top-su-kien_${suffix}.csv`, rows: () => topRows(r) }}>
        <TableCard>
          <thead>
            <tr>
              <th>#</th>
              <th>Sự kiện</th>
              <th>Nhà tổ chức</th>
              <th>Đơn</th>
              <th>Vé</th>
              <th>Doanh thu</th>
            </tr>
          </thead>
          <tbody>
            {r.topEvents.map((e, i) => (
              <tr key={e.id}>
                <td className="text-slate-500">{i + 1}</td>
                <td>
                  <Link to={`/admin/reports/events/${e.id}`} className="font-medium text-brand-700 hover:underline">
                    {e.title}
                  </Link>
                </td>
                <td>{e.organizerName}</td>
                <td className="tabular-nums">{e.orders}</td>
                <td className="tabular-nums">{e.tickets}</td>
                <td className="whitespace-nowrap font-medium">{formatVnd(e.revenue)}</td>
              </tr>
            ))}
            {r.topEvents.length === 0 && <EmptyRow colSpan={6}>Không có đơn nào trong khoảng này.</EmptyRow>}
          </tbody>
        </TableCard>
      </ReportSection>

      <ReportSection title="Theo nhà tổ chức" csv={{ filename: `nha-to-chuc_${suffix}.csv`, rows: () => organizerRows(r) }}>
        <TableCard>
          <thead>
            <tr>
              <th>Nhà tổ chức</th>
              <th>Đơn</th>
              <th>Vé</th>
              <th>Doanh thu</th>
            </tr>
          </thead>
          <tbody>
            {r.byOrganizer.map((o) => (
              <tr key={o.id}>
                <td>{o.name}</td>
                <td className="tabular-nums">{o.orders}</td>
                <td className="tabular-nums">{o.tickets}</td>
                <td className="whitespace-nowrap font-medium">{formatVnd(o.revenue)}</td>
              </tr>
            ))}
            {r.byOrganizer.length === 0 && <EmptyRow colSpan={4}>Không có đơn nào trong khoảng này.</EmptyRow>}
          </tbody>
        </TableCard>
      </ReportSection>
    </div>
  )
}

function dailyRows(r: PlatformSales): Cell[][] {
  return [
    ['Ngày', 'Số đơn', 'Số vé', 'Doanh thu (VND)', 'Đơn hoàn', 'Tiền hoàn (VND)'],
    ...r.daily.map((d) => [d.date, d.orders, d.tickets, d.revenue, d.refunds.orders, d.refunds.amount]),
  ]
}

function topRows(r: PlatformSales): Cell[][] {
  return [
    ['Hạng', 'Sự kiện', 'Nhà tổ chức', 'Số đơn', 'Số vé', 'Doanh thu (VND)'],
    ...r.topEvents.map((e, i) => [i + 1, e.title, e.organizerName, e.orders, e.tickets, e.revenue]),
  ]
}

function organizerRows(r: PlatformSales): Cell[][] {
  return [['Nhà tổ chức', 'Số đơn', 'Số vé', 'Doanh thu (VND)'], ...r.byOrganizer.map((o) => [o.name, o.orders, o.tickets, o.revenue])]
}
