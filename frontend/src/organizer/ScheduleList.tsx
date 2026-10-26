import { useState } from 'react'
import { listVenues } from '../api/admin'
import { ApiError, toApiError } from '../api/errors'
import { createSchedule, deleteSchedule, updateSchedule } from '../api/organizer'
import type { EventDetail, Schedule } from '../api/types'
import { ConfirmDialog, StatusBadge } from '../admin/components'
import { DateTimeField } from '../components/DateTimeField'
import { TimeInput } from '../components/TimeInput'
import { Alert, Button, Card } from '../components/ui'
import { showTimes } from '../utils/dateTimeParts'
import { formatDateTime } from '../utils/format'
import { useAsync } from '../utils/useAsync'
import { missingForSchedule } from './missing'
import { NewVenuePanel } from './NewVenuePanel'
import { conflictMessage, EMPTY_ROW, LONG_SHOW_HOURS, rowOf, scheduleBody, showHours, type ScheduleRowInput } from './scheduleTimes'

const NEW_VENUE = '__new__'

/**
 * "Buổi diễn": one event is one show (its many programmes and acts are in
 * it): the venue, the date, the start and end typed on a 24-hour clock, edited
 * in place. Older events may still have several shows: each gets its line.
 * The tiers and seats of the show are below (ScheduleCard).
 */
export function ScheduleList({ event, onChanged }: { event: EventDetail; onChanged: () => void }) {
  const draft = event.status === 'DRAFT'
  const shows = [...event.schedules].sort((a, b) => a.startAt.localeCompare(b.startAt))
  const eventVenue = shows.find((s) => s.status !== 'CANCELLED')?.venue ?? null
  const venues = useAsync(() => listVenues({ pageSize: 50 }), 'active-venues')
  const [venueId, setVenueId] = useState('')
  const [newVenue, setNewVenue] = useState(false)
  // One event, one show: the line to set it whenever the draft has no active show
  // (derived, not kept in state: deleting the only show brings the line back at once).
  const needsShow = draft && !shows.some((s) => s.status !== 'CANCELLED')
  const several = shows.length + (needsShow ? 1 : 0) > 1

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">Buổi diễn</h2>
        <p className="text-sm text-slate-600">
          Địa điểm, ngày diễn, giờ bắt đầu và kết thúc (gõ theo 24 giờ, ví dụ 19:30; để trống giờ kết thúc = 3 tiếng sau). Sửa ngay rồi bấm "Lưu".
        </p>
      </div>

      {eventVenue ? (
        <div className="text-sm">
          <span className="font-medium text-slate-700">Địa điểm: </span>
          <span className="text-slate-800">
            {eventVenue.name} — {eventVenue.city}
          </span>
        </div>
      ) : (
        draft && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Địa điểm</span>
            <select
              value={newVenue ? NEW_VENUE : venueId}
              onChange={(e) => {
                setNewVenue(e.target.value === NEW_VENUE)
                if (e.target.value !== NEW_VENUE) setVenueId(e.target.value)
              }}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
            >
              <option value="">Chọn địa điểm…</option>
              {venues.data?.venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name} — {venue.city}
                  {venue.status === 'PENDING' ? ' (chờ duyệt)' : ''}
                </option>
              ))}
              <option value={NEW_VENUE}>+ Nhập địa điểm mới…</option>
            </select>
          </label>
        )
      )}
      {newVenue && (
        <NewVenuePanel
          onCancel={() => setNewVenue(false)}
          onReady={(venue) => {
            setNewVenue(false)
            setVenueId(venue.id)
            venues.reload()
          }}
        />
      )}

      <ol className="space-y-3">
        {shows.map((schedule, index) => (
          <ScheduleLine
            key={schedule.id}
            number={several ? index + 1 : 0}
            eventId={event.id}
            eventStatus={event.status}
            schedule={schedule}
            onChanged={onChanged}
          />
        ))}
        {needsShow && (
          <ScheduleLine
            // A fresh line (empty fields) each time the event is left without a show.
            key={`new:${shows.length}`}
            number={several ? shows.length + 1 : 0}
            eventId={event.id}
            eventStatus={event.status}
            venueId={eventVenue?.id ?? (newVenue ? '' : venueId)}
            newVenueOpen={!eventVenue && newVenue}
            onChanged={onChanged}
          />
        )}
      </ol>
      {shows.length === 0 && !needsShow && <p className="text-sm text-slate-500">Chưa có buổi diễn.</p>}
      {!draft && <p className="text-xs text-slate-500">Sự kiện không còn là nháp: không đổi được ngày giờ, chỉ hủy buổi diễn.</p>}
    </Card>
  )
}

/** One show of the list: a saved one (schedule), or a new line (venueId). */
function ScheduleLine({
  number,
  eventId,
  eventStatus,
  schedule,
  venueId = '',
  newVenueOpen = false,
  onChanged,
}: {
  number: number
  eventId: string
  eventStatus: string
  schedule?: Schedule
  venueId?: string
  newVenueOpen?: boolean
  onChanged: () => void
}) {
  const draft = eventStatus === 'DRAFT'
  // Several shows (older events): ", suất N" tells their fields apart.
  const suffix = number > 0 ? `, suất ${number}` : ''
  const cancelled = schedule?.status === 'CANCELLED'
  const editable = draft && !cancelled
  const [row, setRow] = useState<ScheduleRowInput>(() => (schedule ? rowOf(schedule) : EMPTY_ROW))
  const [sales, setSales] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'delete' | 'cancel' | null>(null)

  const times = showTimes(row.date, row.start, row.end)
  const body = scheduleBody(row, schedule)
  const changed = schedule ? Boolean(body && Object.keys(body).length > 0) : true
  const missing = missingForSchedule({ venueId: schedule ? schedule.venue.id : venueId, date: row.date, start: row.start, end: row.end }, newVenueOpen)
  const hours = schedule ? showHours(schedule.startAt, schedule.endAt) : 0
  const set = (part: Partial<ScheduleRowInput>) => setRow((r) => ({ ...r, ...part }))
  // "YYYY-MM-DDTHH:mm" → "01:30 ngày 25/10/2026"
  const endLabel = times.endAt && `${times.endAt.slice(11)} ngày ${times.endAt.slice(8, 10)}/${times.endAt.slice(5, 7)}/${times.endAt.slice(0, 4)}`
  const nextDay = Boolean(times.endAt && times.endAt.slice(0, 10) !== times.startAt.slice(0, 10))

  async function save() {
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      if (schedule) await updateSchedule(schedule.id, body)
      else await createSchedule(eventId, { venueId, ...body } as Parameters<typeof createSchedule>[1])
      onChanged()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`rounded-lg border p-3 ${cancelled ? 'border-slate-200 bg-slate-50 opacity-70' : schedule ? 'border-slate-200' : 'border-dashed border-brand-300'}`}>
      <div className="flex flex-wrap items-end gap-3">
        {number > 0 && <span className="pb-2.5 text-sm font-semibold text-slate-500">Suất {number}</span>}
        {editable ? (
          <>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Ngày diễn</span>
              <input
                type="date"
                aria-label={`Ngày diễn${suffix}`}
                value={row.date}
                onChange={(e) => set({ date: e.target.value })}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100 sm:text-sm"
              />
            </label>
            <div>
              <span aria-hidden className="mb-1 block text-sm font-medium text-slate-700">
                Giờ bắt đầu
              </span>
              <TimeInput label={`Giờ bắt đầu${suffix}`} name={`start${number}`} value={row.start} onChange={(start) => set({ start })} showLabel={false} />
            </div>
            <div>
              <span aria-hidden className="mb-1 block text-sm font-medium text-slate-700">
                Giờ kết thúc
              </span>
              <TimeInput label={`Giờ kết thúc${suffix}`} name={`end${number}`} value={row.end} onChange={(end) => set({ end })} showLabel={false} />
            </div>
          </>
        ) : (
          schedule && (
            <p className="pb-2.5 text-sm text-slate-800">
              {formatDateTime(schedule.startAt)} → {formatDateTime(schedule.endAt)}
            </p>
          )
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2 pb-1">
          {schedule && <StatusBadge status={schedule.status} />}
          {editable && (
            <Button type="button" loading={busy} disabled={!changed || missing.length > 0} onClick={() => void save()}>
              {schedule ? 'Lưu' : 'Lưu buổi diễn'}
            </Button>
          )}
          {editable && schedule && (
            <Button type="button" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setConfirm('delete')}>
              Xóa
            </Button>
          )}
          {eventStatus === 'PUBLISHED' && schedule?.status === 'SCHEDULED' && (
            <Button type="button" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setConfirm('cancel')}>
              Hủy buổi diễn
            </Button>
          )}
        </div>
      </div>

      {editable && (
        <div className="mt-2 space-y-1 text-sm">
          {endLabel && (
            <p className="text-slate-600">
              {row.end.trim() ? 'Kết thúc' : 'Kết thúc dự kiến (3 tiếng sau)'}: <strong>{endLabel}</strong>
              {nextDay && ', sau nửa đêm'}.{schedule && changed && <span className="font-medium text-amber-700"> Có thay đổi chưa lưu.</span>}
            </p>
          )}
          {hours > LONG_SHOW_HOURS && (
            <p className="font-medium text-amber-700">
              Suất đang lưu kéo dài {hours} giờ (đến {formatDateTime(schedule!.endAt)}): có thể giờ kết thúc bị nhập nhầm. Dòng trên đọc là kết thúc cùng
              đêm; bấm "Lưu" để sửa.
            </p>
          )}
          {missing.length > 0 && !busy && <p className="text-amber-700">Còn thiếu: {missing.join(', ')}.</p>}
          <button type="button" onClick={() => setSales((s) => !s)} className="text-xs font-semibold text-brand-700 hover:underline" aria-expanded={sales}>
            {sales ? '− Ẩn giờ mở bán' : '+ Giờ mở bán'}
          </button>
          {!sales && <span className="ml-2 text-xs text-slate-500">mặc định: từ khi được duyệt đến lúc suất bắt đầu</span>}
          {sales && (
            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              <DateTimeField label="Mở bán (để trống: ngay bây giờ)" name={`salesStart${number}`} value={row.salesStartAt} onChange={(salesStartAt) => set({ salesStartAt })} />
              <DateTimeField label="Đóng bán (để trống: lúc bắt đầu)" name={`salesEnd${number}`} value={row.salesEndAt} onChange={(salesEndAt) => set({ salesEndAt })} />
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="mt-2">
          <Alert>{conflictMessage(error) ?? error.message}</Alert>
        </div>
      )}

      {confirm && schedule && (
        <ConfirmDialog
          open
          title={confirm === 'delete' ? 'Xóa buổi diễn này?' : 'Hủy buổi diễn này?'}
          message={
            confirm === 'cancel'
              ? 'Không thể hoàn tác. Đơn đang giữ chỗ bị hủy, đơn đã thanh toán được hoàn tiền.'
              : 'Buổi diễn cùng hạng vé và sơ đồ ghế của nó bị xóa.'
          }
          confirmLabel={confirm === 'delete' ? 'Xóa' : 'Hủy buổi diễn'}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              if (confirm === 'delete') await deleteSchedule(schedule.id)
              else await updateSchedule(schedule.id, { status: 'CANCELLED' })
            } catch (err) {
              throw toApiError(err)
            }
            onChanged()
          }}
        />
      )}
    </li>
  )
}
