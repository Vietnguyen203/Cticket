import { useEffect, useState, type ReactNode } from 'react'
import { PageHeader, TableCard, EmptyRow } from '../../admin/components'
import {
  diskTone,
  errorRateTone,
  formatDuration,
  formatMs,
  latencyTone,
  overall,
  QUEUE_LABEL,
  queueTone,
  type Tone,
} from '../../admin/systemHealth'
import {
  getClientErrors,
  getSystemSeries,
  getSystemStatus,
  type ClientErrorGroup,
  type SeriesPoint,
  type SystemSnapshot,
} from '../../api/system'
import { Badge, Button, Card, ErrorState, Skeleton, type BadgeTone } from '../../components/ui'
import { formatDateTime, formatTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

/**
 * Phase 23: "Tình trạng hệ thống" (system:monitor). Figures of the API, its
 * dependencies, the background jobs and the web, refreshed every 15 seconds
 * while the tab is visible. The same thresholds email the admins
 * (backend src/modules/monitoring/alerts.js).
 */
const REFRESH_MS = 15_000

const TONE_BADGE: Record<Tone, BadgeTone> = { ok: 'success', warn: 'warning', bad: 'danger', unknown: 'neutral' }
const TONE_WORD: Record<Tone, string> = { ok: 'Tốt', warn: 'Cần để ý', bad: 'Có vấn đề', unknown: 'Không đọc được' }
const TONE_BAR: Record<Tone, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', unknown: 'bg-slate-400' }
const number = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('vi-VN'))

export function SystemPage() {
  const snapshot = useAsync(getSystemStatus, 'system')
  const series = useAsync(() => getSystemSeries(60), 'system-series')
  const webErrors = useAsync(() => getClientErrors(20), 'system-client-errors')

  const { reload: reloadSnapshot } = snapshot
  const { reload: reloadSeries } = series
  const { reload: reloadWebErrors } = webErrors
  const refreshAll = () => {
    reloadSnapshot()
    reloadSeries()
    reloadWebErrors()
  }

  // Refresh while the page is looked at; at once when the tab comes back.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      reloadSnapshot()
      reloadSeries()
      reloadWebErrors()
    }
    const timer = window.setInterval(refresh, REFRESH_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [reloadSnapshot, reloadSeries, reloadWebErrors])

  const data = snapshot.data
  return (
    <>
      <PageHeader
        title="Tình trạng hệ thống"
        subtitle={data ? `Cập nhật lúc ${formatTime(data.status.generatedAt)} · tự cập nhật mỗi 15 giây` : 'Số liệu của API, cơ sở dữ liệu, job nền và web'}
        actions={
          <Button variant="secondary" loading={snapshot.loading} onClick={refreshAll}>
            Làm mới
          </Button>
        }
      />
      <div className="mt-6 space-y-8">
        {snapshot.error && !data && <ErrorState message={snapshot.error.message} onRetry={snapshot.reload} />}
        {!data && !snapshot.error && <LoadingCards />}
        {data && (
          <>
            {snapshot.error && <ErrorState message={`Không cập nhật được: ${snapshot.error.message}. Đang hiện số liệu lần trước.`} />}
            <OverallBanner snapshot={data} />
            <Figures snapshot={data} />
            <Charts points={series.data} failed={Boolean(series.error)} />
            <Dependencies snapshot={data} />
            <Queues snapshot={data} />
            <Business snapshot={data} />
            <SlowRoutes snapshot={data} />
            <AlertHistory snapshot={data} />
          </>
        )}
        <WebErrors groups={webErrors.data} failed={Boolean(webErrors.error)} />
      </div>
    </>
  )
}

function LoadingCards() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  )
}

function OverallBanner({ snapshot }: { snapshot: SystemSnapshot }) {
  const { tone, label } = overall(snapshot)
  const box = { ok: 'border-emerald-200 bg-emerald-50 text-emerald-800', warn: 'border-amber-200 bg-amber-50 text-amber-900', bad: 'border-red-200 bg-red-50 text-red-800', unknown: 'border-line bg-surface' }[tone]
  return (
    <section aria-label="Trạng thái chung" className={`rounded-card border px-4 py-3 ${box}`}>
      <p className="flex items-center gap-2 font-semibold" role="status">
        <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${TONE_BAR[tone]}`} />
        {label}
      </p>
      {snapshot.alerts.active.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {snapshot.alerts.active.map((alert) => (
            <li key={alert.key}>
              <b>{alert.title}</b>
              {alert.detail && `: ${alert.detail}`} <span className="opacity-75">(từ {formatTime(alert.since)})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Figure({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone: Tone }) {
  return (
    <Card className="!p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-slate-600">{label}</p>
        <Badge tone={TONE_BADGE[tone]} className="shrink-0 whitespace-nowrap">
          {TONE_WORD[tone]}
        </Badge>
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</p>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
    </Card>
  )
}

function Figures({ snapshot }: { snapshot: SystemSnapshot }) {
  const { api, queues, realtime, disk, failedJobsLastHour, webErrors } = snapshot.status
  const waiting = queues?.reduce((sum, q) => sum + q.waiting, 0) ?? null
  const queuesTone: Tone = !queues ? 'unknown' : queues.some((q) => queueTone(q) === 'bad') ? 'bad' : queues.some((q) => queueTone(q) === 'warn') ? 'warn' : 'ok'
  return (
    <section aria-label="Số liệu chính" className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
      <Figure
        label="Request / phút"
        value={number(api?.requestsPerMinute)}
        note={api && `${number(api.requests)} request trong ${api.windowMinutes} phút · ${number(api.rateLimited)} bị giới hạn (429)`}
        tone={api ? 'ok' : 'unknown'}
      />
      <Figure
        label="Lỗi máy chủ (5xx)"
        value={api ? `${api.errorRatePercent.toLocaleString('vi-VN')}%` : '—'}
        note={api && `${number(api.serverErrors)} lỗi 5xx · ${number(api.clientErrors4xx)} lỗi 4xx trong ${api.windowMinutes} phút`}
        tone={errorRateTone(api)}
      />
      <Figure label="Độ trễ p95" value={formatMs(api?.p95Ms ?? null)} note={api && `p50 ${formatMs(api.p50Ms)}`} tone={latencyTone(api?.p95Ms ?? null)} />
      <Figure label="Kết nối real-time" value={number(realtime.connections)} note="WebSocket đang mở, mọi tiến trình API" tone={realtime.connections === null ? 'unknown' : 'ok'} />
      <Figure
        label="Job nền đang chờ"
        value={number(waiting)}
        note={failedJobsLastHour !== null && `${number(failedJobsLastHour)} job lỗi hẳn trong 1 giờ`}
        tone={queuesTone}
      />
      <Figure
        label="Ổ đĩa còn trống"
        value={disk?.freePercent !== null && disk ? `${disk.freePercent.toLocaleString('vi-VN')}%` : '—'}
        note={disk && `${disk.freeGb.toLocaleString('vi-VN')} / ${disk.totalGb.toLocaleString('vi-VN')} GB`}
        tone={diskTone(disk)}
      />
      {webErrors && (
        <Figure
          label="Lỗi JavaScript trên web"
          value={number(webErrors.count)}
          note={`trong ${webErrors.windowMinutes} phút`}
          tone={webErrors.count > 50 ? 'bad' : webErrors.count > 0 ? 'warn' : 'ok'}
        />
      )}
    </section>
  )
}

const CHART_HEIGHT = 120

/** Bars per minute (no chart library). Hover or tap a minute to read it. */
function MinuteBars({ points, value, label, tone, format }: { points: SeriesPoint[]; value: (p: SeriesPoint) => number; label: string; tone: string; format: (p: SeriesPoint) => string }) {
  const [picked, setPicked] = useState<number | null>(null)
  const top = Math.max(1, ...points.map(value))
  const shown = points[picked ?? points.length - 1]
  return (
    <Card className="!p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <h3 className="font-semibold text-ink">{label}</h3>
        {shown && (
          <span className="tabular-nums text-slate-600">
            {formatTime(shown.at)}: <b className="text-ink">{format(shown)}</b>
          </span>
        )}
      </div>
      <div className="mt-3 flex items-end gap-px border-b border-line" style={{ height: CHART_HEIGHT }} onMouseLeave={() => setPicked(null)}>
        {points.map((point, i) => (
          <button
            key={point.at}
            type="button"
            aria-label={`${formatTime(point.at)}: ${format(point)}`}
            onMouseEnter={() => setPicked(i)}
            onFocus={() => setPicked(i)}
            onClick={() => setPicked(i)}
            className={`flex h-full min-w-0 flex-1 items-end rounded-t ${picked === i ? 'bg-slate-100' : ''}`}
          >
            <span className={`w-full rounded-t ${tone}`} style={{ height: `${(value(point) / top) * 100}%` }} />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>{points[0] && formatTime(points[0].at)}</span>
        <span>{points.at(-1) && formatTime(points.at(-1)!.at)}</span>
      </div>
    </Card>
  )
}

function Charts({ points, failed }: { points: SeriesPoint[] | undefined; failed: boolean }) {
  return (
    <section aria-labelledby="bieu-do" className="space-y-3">
      <h2 id="bieu-do" className="text-lg font-semibold text-ink">
        60 phút gần nhất
      </h2>
      {failed && !points && <ErrorState message="Không tải được biểu đồ." />}
      {!points && !failed && <Skeleton className="h-40" />}
      {points && (
        <div className="grid gap-3 lg:grid-cols-3">
          <MinuteBars points={points} label="Request" value={(p) => p.requests} tone="bg-brand-600" format={(p) => `${number(p.requests)} request`} />
          <MinuteBars points={points} label="Lỗi 5xx" value={(p) => p.serverErrors} tone="bg-red-500" format={(p) => `${number(p.serverErrors)} lỗi`} />
          <MinuteBars points={points} label="Độ trễ p95" value={(p) => p.p95Ms ?? 0} tone="bg-amber-500" format={(p) => formatMs(p.p95Ms)} />
        </div>
      )}
    </section>
  )
}

function Dependencies({ snapshot }: { snapshot: SystemSnapshot }) {
  const { database, redis, worker, process } = snapshot.status
  const rows: Array<[string, Tone, ReactNode]> = [
    [
      'Cơ sở dữ liệu (PostgreSQL)',
      database.up ? 'ok' : 'bad',
      database.up ? `Ping ${database.pingMs} ms · kết nối: ${database.pool.total} mở, ${database.pool.idle} rảnh, ${database.pool.waiting} đang chờ` : 'Không trả lời',
    ],
    ['Redis', redis.up ? 'ok' : 'warn', redis.up ? `Ping ${redis.pingMs} ms · bộ nhớ ${number(redis.usedMemoryMb)} MB` : 'Không trả lời: giới hạn tần suất, cache, hàng chờ chạy dự phòng'],
    [
      'Worker (job nền)',
      worker.mode === 'inline' ? 'ok' : worker.alive ? 'ok' : 'bad',
      worker.mode === 'inline'
        ? 'Chạy ngay trong API (không có worker riêng)'
        : worker.lastSeenAt
          ? `Nhịp tim ${formatDuration(worker.ageMs ?? 0)} trước`
          : 'Chưa thấy nhịp tim nào',
    ],
    ['Tiến trình API trả lời trang này', 'ok', `RAM ${number(process.rssMb)} MB · chạy được ${formatDuration(process.uptimeSeconds * 1000)}`],
  ]
  return (
    <section aria-labelledby="thanh-phan" className="space-y-3">
      <h2 id="thanh-phan" className="text-lg font-semibold text-ink">
        Thành phần
      </h2>
      <TableCard>
        <tbody>
          {rows.map(([name, tone, detail]) => (
            <tr key={name}>
              <td className="font-medium text-ink">{name}</td>
              <td>
                <Badge tone={TONE_BADGE[tone]} className="whitespace-nowrap">
                  {TONE_WORD[tone]}
                </Badge>
              </td>
              <td className="text-slate-600">{detail}</td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </section>
  )
}

function Queues({ snapshot }: { snapshot: SystemSnapshot }) {
  const { queues } = snapshot.status
  return (
    <section aria-labelledby="hang-doi" className="space-y-3">
      <h2 id="hang-doi" className="text-lg font-semibold text-ink">
        Job nền
      </h2>
      <TableCard>
        <thead>
          <tr>
            <th>Hàng đợi</th>
            <th className="!text-right">Chờ</th>
            <th className="!text-right">Đang chạy</th>
            <th className="!text-right">Hẹn giờ</th>
            <th className="!text-right">Lỗi (7 ngày)</th>
            <th>Chờ lâu nhất</th>
          </tr>
        </thead>
        <tbody>
          {!queues && <EmptyRow colSpan={6}>Không đọc được hàng đợi (Redis không trả lời).</EmptyRow>}
          {queues?.map((queue) => (
            <tr key={queue.name}>
              <td>
                <span className="flex items-center gap-2 whitespace-nowrap font-medium text-ink">
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${TONE_BAR[queueTone(queue)]}`} />
                  {QUEUE_LABEL[queue.name] ?? queue.name}
                </span>
              </td>
              <td className="text-right tabular-nums">{number(queue.waiting)}</td>
              <td className="text-right tabular-nums">{number(queue.active)}</td>
              <td className="text-right tabular-nums">{number(queue.delayed)}</td>
              <td className={`text-right tabular-nums ${queue.failed > 0 ? 'text-red-700' : ''}`}>{number(queue.failed)}</td>
              <td className="whitespace-nowrap text-slate-600">{queue.oldestWaitingMs === null ? '—' : formatDuration(queue.oldestWaitingMs)}</td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </section>
  )
}

function Business({ snapshot }: { snapshot: SystemSnapshot }) {
  const b = snapshot.status.business
  const items: Array<[string, number | null | undefined, boolean]> = [
    ['Thanh toán lỗi trong 1 giờ', b?.paymentsFailedLastHour, false],
    ['Hoàn tiền VNPay thất bại (cần "Hoàn tiền lại")', b?.refundsFailed, true],
    ['Hoàn tiền VNPay chờ quá 1 giờ', b?.refundsPendingTooLong, true],
    ['Đơn chờ thanh toán đã quá hạn chưa xử lý', b?.ordersStuck, true],
    ['Người đang chờ trong hàng chờ mua vé', b?.purchaseQueueWaiting, false],
  ]
  return (
    <section aria-labelledby="nghiep-vu" className="space-y-3">
      <h2 id="nghiep-vu" className="text-lg font-semibold text-ink">
        Nghiệp vụ
      </h2>
      {!b ? (
        <ErrorState message="Không đọc được số liệu nghiệp vụ." />
      ) : (
        <TableCard>
          <tbody>
            {items.map(([label, value, problem]) => (
              <tr key={label}>
                <td className="text-slate-700">{label}</td>
                <td className={`text-right font-semibold tabular-nums ${problem && value ? 'text-red-700' : 'text-ink'}`}>{number(value)}</td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
    </section>
  )
}

function SlowRoutes({ snapshot }: { snapshot: SystemSnapshot }) {
  const routes = snapshot.status.api?.slowestRoutes ?? []
  return (
    <section aria-labelledby="cham-nhat" className="space-y-3">
      <div>
        <h2 id="cham-nhat" className="text-lg font-semibold text-ink">
          Đường dẫn chậm nhất
        </h2>
        <p className="text-xs text-slate-500">Trong 1 giờ, theo p95, chỉ tính đường dẫn có từ 5 request.</p>
      </div>
      <TableCard>
        <thead>
          <tr>
            <th>Đường dẫn</th>
            <th className="!text-right">Request</th>
            <th className="!text-right">p95</th>
          </tr>
        </thead>
        <tbody>
          {routes.length === 0 && <EmptyRow colSpan={3}>Chưa đủ request để so sánh.</EmptyRow>}
          {routes.map((route) => (
            <tr key={route.route}>
              <td className="break-all font-mono text-xs text-ink">{route.route}</td>
              <td className="text-right tabular-nums">{number(route.requests)}</td>
              <td className={`whitespace-nowrap text-right tabular-nums ${latencyTone(route.p95Ms) === 'bad' ? 'text-red-700' : ''}`}>{formatMs(route.p95Ms)}</td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </section>
  )
}

function AlertHistory({ snapshot }: { snapshot: SystemSnapshot }) {
  const { history } = snapshot.alerts
  return (
    <section aria-labelledby="canh-bao" className="space-y-3">
      <div>
        <h2 id="canh-bao" className="text-lg font-semibold text-ink">
          Cảnh báo 7 ngày qua
        </h2>
        <p className="text-xs text-slate-500">Mỗi cảnh báo được gửi email cho quản trị viên khi bắt đầu, nhắc lại sau 30 phút nếu vẫn còn, và khi đã hết.</p>
      </div>
      <TableCard>
        <tbody>
          {history.length === 0 && <EmptyRow colSpan={3}>Không có cảnh báo nào.</EmptyRow>}
          {history.map((event) => (
            <tr key={`${event.key}-${event.at}-${event.status}`}>
              <td className="whitespace-nowrap text-slate-600">{formatDateTime(event.at)}</td>
              <td>
                <Badge tone={event.status === 'FIRING' ? 'danger' : 'success'} className="whitespace-nowrap">
                  {event.status === 'FIRING' ? 'Bắt đầu' : 'Đã hết'}
                </Badge>
              </td>
              <td>
                <span className="font-medium text-ink">{event.title}</span>
                {event.detail && <span className="block text-xs text-slate-500">{event.detail}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </section>
  )
}

function WebErrors({ groups, failed }: { groups: ClientErrorGroup[] | undefined; failed: boolean }) {
  return (
    <section aria-labelledby="loi-web" className="space-y-3">
      <div>
        <h2 id="loi-web" className="text-lg font-semibold text-ink">
          Lỗi JavaScript trên web
        </h2>
        <p className="text-xs text-slate-500">Gộp theo nội dung, giữ 7 ngày. Không lưu người dùng, IP hay query string của trang.</p>
      </div>
      {failed && !groups && <ErrorState message="Không tải được danh sách lỗi web." />}
      {!groups && !failed && <Skeleton className="h-24" />}
      {groups && groups.length === 0 && <p className="rounded-card border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-slate-500">Chưa có lỗi nào.</p>}
      {groups && groups.length > 0 && (
        <ul className="space-y-2">
          {groups.map((group) => (
            <li key={group.fingerprint} className="rounded-card border border-line bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words font-medium text-ink">{group.message}</p>
                <Badge tone="danger" className="shrink-0 whitespace-nowrap">
                  {number(group.count)} lần
                </Badge>
              </div>
              <p className="mt-1 break-all text-xs text-slate-500">
                {group.page} · lần cuối {formatDateTime(group.lastSeenAt)}
                {group.browser && ` · ${group.browser}`}
              </p>
              {group.stack && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-brand-700">Xem stack</summary>
                  <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-control bg-canvas p-3 text-[11px] text-slate-700">{group.stack}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
