import { useState } from 'react'
import { Link } from 'react-router'
import { listStaffEvents } from '../../api/checkins'
import { Alert, Card, FullPageSpinner, TextField } from '../../components/ui'
import { saveGate, savedGate } from '../../staff/feedback'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

/** APP-S01: the events I am on the gate team of — pick a schedule to scan for. */
export function StaffEventsPage() {
  const events = useAsync(listStaffEvents, 'staff-events')
  const [gate, setGate] = useState(savedGate)

  if (events.error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Alert>{events.error.message}</Alert>
      </div>
    )
  }
  if (!events.data) return <FullPageSpinner />

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <h1 className="text-2xl font-bold">Soát vé</h1>
      <Card>
        <TextField
          label="Tên cổng của máy này"
          hint="Ghi vào mỗi lượt quét, để biết vé đã vào ở cổng nào. Máy này sẽ nhớ."
          placeholder="Cổng A"
          maxLength={100}
          value={gate}
          onChange={(e) => {
            setGate(e.target.value)
            saveGate(e.target.value.trim())
          }}
        />
      </Card>

      {events.data.length === 0 && (
        <Card className="text-center text-slate-500">Bạn chưa được ban tổ chức nào thêm vào đội soát vé.</Card>
      )}

      {events.data.map((event) => (
        <section key={event.id} className="space-y-2">
          <h2 className="font-semibold">{event.title}</h2>
          {event.schedules.length === 0 && <p className="text-sm text-slate-500">Không còn suất diễn nào sắp tới.</p>}
          {event.schedules.map((schedule) => (
            <Card key={schedule.id} className="flex flex-wrap items-center justify-between gap-3 !p-4">
              <div>
                <p className="font-medium">{formatDateTime(schedule.startAt)}</p>
                <p className="text-sm text-slate-600">{schedule.venueName}</p>
              </div>
              <div className="flex gap-2">
                <Link
                  to={`/staff/history/${schedule.id}`}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Lịch sử
                </Link>
                <Link
                  to={`/staff/scan/${schedule.id}`}
                  className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
                >
                  Quét vé
                </Link>
              </div>
            </Card>
          ))}
        </section>
      ))}
    </div>
  )
}
