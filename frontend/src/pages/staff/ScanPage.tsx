import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { checkIn, listStaffEvents } from '../../api/checkins'
import { toApiError } from '../../api/errors'
import { getCheckInStats } from '../../api/organizer'
import { Button, Card } from '../../components/ui'
import { realtime } from '../../realtime'
import { signal, savedGate } from '../../staff/feedback'
import { QrScanner } from '../../staff/QrScanner'
import { createScanGate, toScanOutcome, type ScanOutcome } from '../../staff/scanResult'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

const RESULT_MS = 2500

/** APP-S02 + S03: scan tickets for one schedule; the result fills the screen for a moment. */
export function ScanPage() {
  const { scheduleId = '' } = useParams()
  const gate = savedGate()
  const info = useAsync(async () => {
    for (const event of await listStaffEvents()) {
      const schedule = event.schedules.find((s) => s.id === scheduleId)
      if (schedule) return { title: event.title, ...schedule }
    }
    return null
  }, `staff-schedule:${scheduleId}`)
  const initialStats = useAsync(() => getCheckInStats(scheduleId), `checkin-stats:${scheduleId}`)
  const [liveStats, setLiveStats] = useState<{ checkedIn: number; total: number } | null>(null)
  const stats = liveStats ?? initialStats.data ?? null

  const [checking, setChecking] = useState(false)
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [manual, setManual] = useState('')
  const scanGate = useRef(createScanGate())
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // CHK-03: other gates' scans move the counter too.
  useEffect(
    () =>
      realtime.onPersonalMessage((message) => {
        if (message.type === 'CHECK_IN_SUCCESS' && message.scheduleId === scheduleId) {
          setLiveStats({ checkedIn: Number(message.checkedIn), total: Number(message.total) })
        }
      }),
    [scheduleId],
  )
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }, [])

  const submit = async (code: string) => {
    const qrToken = code.trim()
    // The same QR stays in front of the camera for a while: send it once.
    if (!qrToken || checking || !scanGate.current.accept(qrToken, Date.now())) return
    setChecking(true)
    let result: ScanOutcome
    try {
      const data = await checkIn(qrToken, scheduleId, gate || undefined)
      if (data.stats) setLiveStats(data.stats)
      result = toScanOutcome({ ok: true, data })
    } catch (err) {
      result = toScanOutcome({ ok: false, error: toApiError(err) })
    }
    signal(result.ok)
    setOutcome(result)
    setChecking(false)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setOutcome(null), RESULT_MS)
  }

  const onManual = (e: FormEvent) => {
    e.preventDefault()
    void submit(manual)
    setManual('')
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link to="/staff" className="text-sm text-brand-700 hover:underline">
            ← Chọn suất khác
          </Link>
          <h1 className="text-lg font-bold">{info.data?.title ?? (info.data === null ? 'Suất diễn' : '…')}</h1>
          {info.data && (
            <p className="text-sm text-slate-600">
              {formatDateTime(info.data.startAt)} · {info.data.venueName}
            </p>
          )}
          <p className="text-xs text-slate-500">{gate ? `Cổng: ${gate}` : 'Chưa đặt tên cổng'}</p>
        </div>
        <Link to={`/staff/history/${scheduleId}`} className="shrink-0 text-right">
          <p className="text-2xl font-bold tabular-nums">{stats ? `${stats.checkedIn}/${stats.total}` : '–'}</p>
          <p className="text-xs text-brand-700 hover:underline">đã vào · lịch sử</p>
        </Link>
      </div>

      <QrScanner onCode={(code) => void submit(code)} paused={checking || outcome !== null} />

      <Card className="!p-4">
        <form onSubmit={onManual} className="flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Hoặc dán mã QR"
            aria-label="Mã QR"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <Button type="submit" loading={checking} disabled={!manual.trim()}>
            Kiểm tra
          </Button>
        </form>
      </Card>

      {outcome && (
        <button
          type="button"
          onClick={() => setOutcome(null)}
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-6 text-center text-white ${
            outcome.ok ? 'bg-emerald-600' : 'bg-red-600'
          }`}
        >
          <span className="text-7xl" aria-hidden>
            {outcome.ok ? '✓' : '✕'}
          </span>
          <span className="text-3xl font-bold">{outcome.title}</span>
          {outcome.lines.map((line) => (
            <span key={line} className="text-lg">
              {line}
            </span>
          ))}
          <span className="mt-6 text-sm opacity-80">Chạm để quét tiếp</span>
        </button>
      )}
    </div>
  )
}
