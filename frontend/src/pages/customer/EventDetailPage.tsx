import { Link, useParams } from 'react-router'
import { getAvailability, getEvent } from '../../api/events'
import type { Schedule } from '../../api/types'
import { EventImage } from '../../components/EventImage'
import { Alert, Card, FullPageSpinner } from '../../components/ui'
import { formatDateTime, formatVnd } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

type SaleState = 'on-sale' | 'not-yet' | 'closed' | 'over' | 'cancelled' | 'not-ready'

function saleState(schedule: Schedule, now = new Date()): SaleState {
  if (schedule.status === 'CANCELLED') return 'cancelled'
  if (schedule.status === 'FINISHED' || new Date(schedule.endAt) < now) return 'over'
  if (!schedule.inventoryGeneratedAt) return 'not-ready'
  if (now < new Date(schedule.salesStartAt)) return 'not-yet'
  if (now >= new Date(schedule.salesEndAt)) return 'closed'
  return 'on-sale'
}

const SALE_LABEL: Record<SaleState, string> = {
  'on-sale': 'Đang mở bán',
  'not-yet': 'Chưa mở bán',
  closed: 'Đã đóng bán',
  over: 'Đã diễn ra',
  cancelled: 'Đã hủy',
  'not-ready': 'Chưa mở bán',
}

/** APP-C02 event detail + APP-C03 schedule choice. Seat selection comes with step 11.2. */
export function EventDetailPage() {
  const { slug = '' } = useParams()
  const event = useAsync(() => getEvent(slug), `event:${slug}`)

  if (event.error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <Alert>{event.error.code === 'NOT_FOUND' ? 'Không tìm thấy sự kiện.' : event.error.message}</Alert>
        <Link to="/events" className="mt-4 inline-block font-semibold text-brand-700 hover:underline">
          Xem các sự kiện khác
        </Link>
      </div>
    )
  }
  if (!event.data) return <FullPageSpinner />
  const e = event.data
  const schedules = [...e.schedules].sort((a, b) => a.startAt.localeCompare(b.startAt))

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
      <div className="aspect-[21/9] overflow-hidden rounded-3xl bg-slate-200 sm:aspect-[3/1]">
        <EventImage src={e.bannerUrl ?? e.thumbnailUrl} title={e.title} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="flex flex-wrap gap-2">
            {e.categories.map((c) => (
              <Link key={c.id} to={`/events?categoryId=${c.id}`} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800">
                {c.name}
              </Link>
            ))}
            {e.ageRestriction ? <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">{e.ageRestriction}+</span> : null}
          </div>
          <h1 className="text-2xl font-bold sm:text-3xl">{e.title}</h1>
          <p className="text-sm text-slate-500">Ban tổ chức: {e.organizer.name}</p>
          <div className="whitespace-pre-line text-slate-800">{e.description || 'Ban tổ chức chưa thêm mô tả.'}</div>
        </div>
        <aside className="space-y-3">
          <h2 className="text-lg font-semibold">Lịch diễn</h2>
          {schedules.map((schedule) => (
            <ScheduleBox key={schedule.id} schedule={schedule} slug={e.slug} />
          ))}
          {schedules.length === 0 && <p className="text-sm text-slate-500">Chưa có suất diễn.</p>}
        </aside>
      </div>
    </div>
  )
}

function ScheduleBox({ schedule, slug }: { schedule: Schedule; slug: string }) {
  const state = saleState(schedule)
  const prices = useAsync(
    () => (schedule.inventoryGeneratedAt ? getAvailability(schedule.id) : Promise.resolve([])),
    `availability:${schedule.id}`,
  )
  const left = prices.data?.reduce((sum, tt) => sum + tt.available, 0)

  return (
    <Card className="space-y-2 !p-4">
      <p className="font-semibold">{formatDateTime(schedule.startAt)}</p>
      <p className="text-sm text-slate-600">
        {schedule.venue.name} · {schedule.venue.addressLine}, {schedule.venue.city}
      </p>
      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${state === 'on-sale' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
        {SALE_LABEL[state]}
        {state === 'not-yet' && ` · từ ${formatDateTime(schedule.salesStartAt)}`}
      </span>
      {prices.data && prices.data.length > 0 && (
        <ul className="space-y-1 text-sm">
          {prices.data.map((tt) => (
            <li key={tt.id} className="flex justify-between gap-2">
              <span>{tt.name}</span>
              <span className={tt.available === 0 ? 'text-slate-400 line-through' : 'font-medium'}>{formatVnd(tt.price)}</span>
            </li>
          ))}
        </ul>
      )}
      {state === 'on-sale' &&
        (left === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-center text-sm text-slate-500">Đã hết vé</p>
        ) : (
          <Link
            to={`/events/${slug}/schedules/${schedule.id}`}
            className="block rounded-lg bg-brand-700 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-800"
          >
            Chọn chỗ · còn {left ?? '…'} vé
          </Link>
        ))}
    </Card>
  )
}
