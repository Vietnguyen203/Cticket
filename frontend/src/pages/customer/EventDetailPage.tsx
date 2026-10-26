import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { getAvailability, getEvent } from '../../api/events'
import type { EventDetail, Schedule, TicketTypeAvailability } from '../../api/types'
import { EventImage } from '../../components/EventImage'
import { ArrowRightIcon, CalendarIcon, ChevronRightIcon, MapPinIcon, ShieldIcon, StarIcon, TicketIcon, UserIcon } from '../../components/icons'
import { Alert, Badge, FullPageSpinner, type BadgeTone } from '../../components/ui'
import { dateParts, formatDateTime, formatVnd } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'
import { refundPolicyOf } from '../../payments/refundPolicy'
import { EventReviews } from './EventReviews'

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
const SALE_TONE: Record<SaleState, BadgeTone> = {
  'on-sale': 'success',
  'not-yet': 'info',
  closed: 'neutral',
  over: 'neutral',
  cancelled: 'danger',
  'not-ready': 'neutral',
}

type Availability = Record<string, TicketTypeAvailability[]>

/** Prices and places of every schedule that has tickets (one request each, as before). */
async function loadAvailability(event: EventDetail | undefined): Promise<Availability> {
  if (!event) return {}
  const withTickets = event.schedules.filter((s) => s.inventoryGeneratedAt)
  const lists = await Promise.all(withTickets.map((s) => getAvailability(s.id)))
  return Object.fromEntries(withTickets.map((s, i) => [s.id, lists[i]]))
}

/** APP-C02 event detail + APP-C03 schedule choice. */
export function EventDetailPage() {
  const { slug = '' } = useParams()
  const event = useAsync(() => getEvent(slug), `event:${slug}`)
  const availability = useAsync(() => loadAvailability(event.data), `availability:${event.data?.id ?? ''}`)

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
  const onSale = schedules.filter((s) => saleState(s) === 'on-sale')
  const next = onSale[0] ?? schedules.find((s) => !['over', 'cancelled'].includes(saleState(s))) ?? schedules[0]
  // "From" price: only what can be bought now (schedules on sale, places left).
  const prices = onSale
    .flatMap((s) => availability.data?.[s.id] ?? [])
    .filter((tt) => tt.available > 0)
    .map((tt) => tt.price)
  const fromPrice = prices.length > 0 ? Math.min(...prices) : null
  const policy = refundPolicyOf(e.refundPolicy)
  const nextWhen = next ? dateParts(next.startAt) : null

  return (
    <div className="pb-24 lg:pb-0">
      <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6 sm:pt-8">
        <nav aria-label="Vị trí" className="mb-4 flex items-center gap-1 text-sm text-slate-500">
          <Link to="/events" className="rounded-control hover:text-ink">
            Sự kiện
          </Link>
          <ChevronRightIcon size={16} />
          <span className="truncate text-slate-700">{e.categories[0]?.name ?? 'Chi tiết'}</span>
        </nav>

        {/* The picture and the essentials */}
        <section className="grid gap-6 lg:grid-cols-[1.55fr_1fr] lg:gap-8">
          <div className="aspect-video animate-scale-in overflow-hidden rounded-panel bg-slate-200 shadow-card">
            <EventImage src={e.bannerUrl ?? e.thumbnailUrl} title={e.title} />
          </div>
          <div className="flex animate-fade-up flex-col [animation-delay:120ms]">
            <div className="flex flex-wrap gap-2">
              {e.categories.map((c) => (
                <Link key={c.id} to={`/events?categoryId=${c.id}`} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100">
                  {c.name}
                </Link>
              ))}
              {e.ageRestriction ? <Badge tone="warning">{e.ageRestriction}+</Badge> : null}
            </div>
            <h1 className="mt-3 text-2xl font-bold leading-tight text-ink sm:text-3xl">{e.title}</h1>
            {e.rating?.average != null && (
              <a href="#danh-gia" className="mt-2 inline-flex w-fit items-center gap-1 rounded-control text-sm text-slate-700 hover:text-ink">
                <StarIcon size={16} className="text-amber-500" />
                <span className="font-semibold">{e.rating.average.toLocaleString('vi-VN')}</span>
                <span className="text-slate-500">· {e.rating.count} đánh giá</span>
              </a>
            )}

            <dl className="mt-5 space-y-3 border-y border-line py-5 text-sm">
              {next && nextWhen && (
                <Fact icon={<CalendarIcon size={20} />} label={schedules.length > 1 ? `Suất gần nhất (${schedules.length} suất)` : 'Thời gian'}>
                  {nextWhen.weekday}, {nextWhen.day}/{nextWhen.month.slice(2)}/{nextWhen.year} · {nextWhen.time}
                </Fact>
              )}
              {next && (
                <Fact icon={<MapPinIcon size={20} />} label="Địa điểm">
                  {next.venue.name}
                  <span className="block text-slate-500">
                    {next.venue.addressLine}, {next.venue.city}
                  </span>
                </Fact>
              )}
              <Fact icon={<UserIcon size={20} />} label="Ban tổ chức">
                {e.organizer.name}
              </Fact>
            </dl>

            <div className="mt-auto flex flex-wrap items-end justify-between gap-4 pt-5">
              {onSale.length > 0 ? (
                <div>
                  <p className="text-sm text-slate-500">Giá vé từ</p>
                  <p className="text-2xl font-bold text-ink">{fromPrice !== null ? formatVnd(fromPrice) : availability.data ? 'Đã hết vé' : '…'}</p>
                </div>
              ) : (
                <p className="text-sm font-medium text-slate-600">Hiện không có suất nào đang mở bán.</p>
              )}
              <a
                href="#lich-dien"
                className="inline-flex h-12 items-center gap-2 rounded-control bg-brand-700 px-6 font-semibold text-white shadow-card transition hover:-translate-y-px hover:bg-brand-800 hover:shadow-raised active:scale-[0.98]"
              >
                <TicketIcon size={20} />
                {onSale.length > 0 ? 'Chọn suất diễn' : 'Xem lịch diễn'}
              </a>
            </div>
          </div>
        </section>

        {/* Phones: schedules first (to buy), then the description and reviews. Wide screens: two columns. */}
        <div className="mt-10 grid gap-10 lg:grid-cols-[1.55fr_1fr] lg:gap-8">
          <aside id="lich-dien" className="scroll-mt-24 space-y-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
            <h2 className="text-xl font-bold text-ink">Lịch diễn</h2>
            {schedules.map((schedule) => (
              <ScheduleBox key={schedule.id} schedule={schedule} slug={e.slug} ticketTypes={availability.data?.[schedule.id]} />
            ))}
            {schedules.length === 0 && <p className="text-sm text-slate-500">Chưa có suất diễn.</p>}
            {/* Phase 18.3 */}
            <div className="flex gap-3 rounded-card border border-line bg-white p-4 text-sm">
              <ShieldIcon size={20} className="mt-0.5 shrink-0 text-brand-700" />
              <div>
                <p className="font-semibold text-ink">Chính sách hủy: {policy.label}</p>
                <p className="mt-1 leading-relaxed text-slate-600">{policy.summary}</p>
                <Link to="/dieu-khoan#huy-va-hoan-tien" className="mt-1 inline-block font-semibold text-brand-700 hover:underline">
                  Điều kiện hủy và hoàn tiền
                </Link>
              </div>
            </div>
          </aside>

          <section className="lg:col-start-1 lg:row-start-1" aria-labelledby="gioi-thieu">
            <h2 id="gioi-thieu" className="text-xl font-bold text-ink">
              Giới thiệu
            </h2>
            <div className="mt-3 whitespace-pre-line leading-relaxed text-slate-700">{e.description || 'Ban tổ chức chưa thêm mô tả.'}</div>
            {e.lineup && e.lineup.length > 0 && (
              <div className="mt-8">
                <h2 id="nghe-si" className="text-xl font-bold text-ink">
                  Nghệ sĩ khách mời
                </h2>
                <ul aria-labelledby="nghe-si" className="mt-3 flex flex-wrap gap-2">
                  {e.lineup.map((item, index) => (
                    <li key={`${index}:${item.artist}`} className="rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-semibold text-ink">
                      {item.artist}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <div className="lg:col-start-1 lg:row-start-2">
            {/* Phase 19 */}
            <EventReviews eventId={e.id} slug={e.slug} />
          </div>
        </div>
      </div>

      {/* Phones: the way to buy stays on screen while reading. */}
      {onSale.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 animate-slide-up border-t border-line bg-white/95 px-4 py-3 shadow-raised backdrop-blur [animation-delay:400ms] lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Giá vé từ</p>
              <p className="truncate font-bold text-ink">{fromPrice !== null ? formatVnd(fromPrice) : '…'}</p>
            </div>
            <a href="#lich-dien" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-control bg-brand-700 px-5 text-sm font-semibold text-white">
              Chọn suất diễn
              <ArrowRightIcon size={16} />
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-slate-400">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
        <dd className="mt-0.5 font-medium text-ink">{children}</dd>
      </div>
    </div>
  )
}

function ScheduleBox({ schedule, slug, ticketTypes }: { schedule: Schedule; slug: string; ticketTypes: TicketTypeAvailability[] | undefined }) {
  const state = saleState(schedule)
  const when = dateParts(schedule.startAt)
  const left = ticketTypes?.reduce((sum, tt) => sum + tt.available, 0)

  return (
    <div className={`rounded-card border bg-white p-4 shadow-card transition duration-200 ${state === 'on-sale' ? 'border-line hover:border-slate-300 hover:shadow-raised' : 'border-line/70 opacity-90'}`}>
      <div className="flex gap-4">
        <div className="flex w-14 shrink-0 flex-col items-center rounded-control bg-canvas py-2 text-center" aria-hidden="true">
          <span className="text-[11px] font-semibold uppercase text-brand-700">{when.month}</span>
          <span className="text-2xl font-bold leading-none text-ink">{when.day}</span>
          <span className="mt-0.5 text-[11px] text-slate-500">{when.time}</span>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-semibold text-ink">{formatDateTime(schedule.startAt)}</p>
          <p className="text-sm text-slate-600">
            {schedule.venue.name} · {schedule.venue.addressLine}, {schedule.venue.city}
          </p>
          <Badge tone={SALE_TONE[state]}>
            {SALE_LABEL[state]}
            {state === 'not-yet' && ` · từ ${formatDateTime(schedule.salesStartAt)}`}
          </Badge>
        </div>
      </div>
      {ticketTypes && ticketTypes.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
          {ticketTypes.map((tt) => (
            <li key={tt.id} className="flex items-center justify-between gap-2 py-2">
              <span className={tt.available === 0 ? 'text-slate-400' : 'text-slate-700'}>
                {tt.name}
                {tt.available === 0 && <span className="ml-2 text-xs font-medium">Hết vé</span>}
              </span>
              <span className={tt.available === 0 ? 'text-slate-400 line-through' : 'font-semibold text-ink'}>{formatVnd(tt.price)}</span>
            </li>
          ))}
        </ul>
      )}
      {state === 'on-sale' &&
        (left === 0 ? (
          <p className="mt-3 rounded-control bg-canvas px-3 py-2.5 text-center text-sm font-medium text-slate-500">Đã hết vé</p>
        ) : (
          <Link
            to={`/events/${slug}/schedules/${schedule.id}`}
            className="group mt-3 flex h-11 items-center justify-center gap-2 rounded-control bg-brand-700 px-4 text-sm font-semibold text-white transition hover:bg-brand-800 active:scale-[0.98]"
          >
            Chọn chỗ · còn {left ?? '…'} vé
            <ArrowRightIcon size={16} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
    </div>
  )
}
