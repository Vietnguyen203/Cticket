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
import { initialsOf } from '../../utils/initials'
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
      {/* Poster: the event's own picture, blurred, behind the essentials and the picture itself. */}
      <section className="relative overflow-hidden bg-night text-white">
        <div aria-hidden="true" className="absolute inset-0 scale-110 opacity-50 blur-2xl">
          <EventImage src={e.bannerUrl ?? e.thumbnailUrl} />
        </div>
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-night/70 via-night/80 to-night" />
        <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-5 sm:px-6 sm:pt-8 lg:pb-14">
          <nav aria-label="Vị trí" className="mb-5 flex items-center gap-1 text-sm text-slate-300">
            <Link to="/events" className="shrink-0 whitespace-nowrap rounded-control hover:text-white">
              Sự kiện
            </Link>
            <ChevronRightIcon size={16} className="shrink-0" />
            <span title={e.categories[0]?.name} className="min-w-0 truncate text-white">
              {e.categories[0]?.name ?? 'Chi tiết'}
            </span>
          </nav>

          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="order-2 flex animate-fade-up flex-col lg:order-1">
              <div className="flex flex-wrap gap-2">
                {e.categories.map((c) => (
                  <Link key={c.id} to={`/events?categoryId=${c.id}`} className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/15 hover:bg-white/20">
                    {c.name}
                  </Link>
                ))}
                {e.ageRestriction ? <span className="rounded-full bg-accent-500 px-3 py-1 text-xs font-bold text-white">{e.ageRestriction}+</span> : null}
              </div>
              <h1 className="mt-4 text-balance text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">{e.title}</h1>
              {e.rating?.average != null && (
                <a href="#danh-gia" className="mt-3 inline-flex w-fit items-center gap-1 rounded-control text-sm text-slate-200 hover:text-white">
                  <StarIcon size={16} className="text-amber-400" />
                  <span className="font-semibold text-white">{e.rating.average.toLocaleString('vi-VN')}</span>
                  <span>· {e.rating.count} đánh giá</span>
                </a>
              )}

              <dl className="mt-6 space-y-3 text-sm">
                {next && nextWhen && (
                  <Fact icon={<CalendarIcon size={20} />} label={schedules.length > 1 ? `Suất gần nhất (${schedules.length} suất)` : 'Thời gian'}>
                    {nextWhen.weekday}, {nextWhen.day}/{nextWhen.month.slice(2)}/{nextWhen.year} · {nextWhen.time}
                  </Fact>
                )}
                {next && (
                  <Fact icon={<MapPinIcon size={20} />} label="Địa điểm">
                    {next.venue.name}
                    <span className="block font-normal text-slate-300">
                      {next.venue.addressLine}, {next.venue.city}
                    </span>
                  </Fact>
                )}
                <Fact icon={<UserIcon size={20} />} label="Ban tổ chức">
                  {e.organizer.name}
                </Fact>
              </dl>

              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-4">
                <a
                  href="#lich-dien"
                  className="pressable inline-flex h-12 items-center gap-2 rounded-control bg-brand-700 px-6 font-semibold text-white shadow-raised transition hover:bg-brand-800"
                >
                  <TicketIcon size={20} />
                  {onSale.length > 0 ? 'Mua vé' : 'Xem lịch diễn'}
                </a>
                {onSale.length > 0 ? (
                  <p>
                    <span className="block text-sm text-slate-300">Giá vé từ</span>
                    <span className="block text-2xl font-bold text-white">{fromPrice !== null ? formatVnd(fromPrice) : availability.data ? 'Đã hết vé' : '…'}</span>
                  </p>
                ) : (
                  <p className="text-sm font-medium text-slate-300">Hiện không có suất nào đang mở bán.</p>
                )}
              </div>
            </div>

            <div className="order-1 aspect-video animate-scale-in overflow-hidden rounded-panel shadow-raised ring-1 ring-white/10 lg:order-2">
              <EventImage src={e.bannerUrl ?? e.thumbnailUrl} />
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Phones: schedules first (to buy), then the description and reviews. Wide screens: two columns. */}
        <div className="mt-10 grid gap-10 lg:grid-cols-[1.55fr_1fr] lg:gap-8">
          <aside id="lich-dien" className="scroll-mt-24 space-y-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
            <h2 className="text-xl font-bold text-ink">Lịch diễn</h2>
            {schedules.map((schedule) => (
              <ScheduleBox key={schedule.id} schedule={schedule} slug={e.slug} ticketTypes={availability.data?.[schedule.id]} />
            ))}
            {schedules.length === 0 && <p className="text-sm text-slate-500">Chưa có suất diễn.</p>}
            {/* Phase 18.3 */}
            <div className="flex gap-3 rounded-card border border-line bg-surface p-4 text-sm">
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
                <ul aria-labelledby="nghe-si" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {e.lineup.map((item, index) => (
                    <li key={`${index}:${item.artist}`} className="flex min-w-0 items-center gap-3 rounded-card border border-line bg-surface p-3 shadow-card">
                      {/* The initials are drawn by CSS (::before): not part of the text, which stays the name alone. */}
                      <span
                        aria-hidden="true"
                        data-initials={initialsOf(item.artist)}
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white before:content-[attr(data-initials)] ${AVATAR_COLORS[index % AVATAR_COLORS.length]}`}
                      />
                      <span className="min-w-0 break-words text-sm font-semibold leading-snug text-ink">{item.artist}</span>
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
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 animate-slide-up border-t border-line bg-surface/95 px-4 pt-3 shadow-raised backdrop-blur [animation-delay:400ms] lg:hidden">
          {/* An amount is never cut: when price and button do not fit side by side, the button goes under. */}
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div>
              <p className="text-xs text-slate-500">Giá vé từ</p>
              <p className="whitespace-nowrap font-bold text-ink">{fromPrice !== null ? formatVnd(fromPrice) : '…'}</p>
            </div>
            <a
              href="#lich-dien"
              className="pressable inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-control bg-brand-700 px-5 text-sm font-semibold text-white max-[359px]:grow"
            >
              Chọn suất diễn
              <ArrowRightIcon size={16} />
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

/** One line of the poster's essentials (light text on the dark poster). */
function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-brand-300">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
        <dd className="mt-0.5 font-semibold text-white">{children}</dd>
      </div>
    </div>
  )
}

const AVATAR_COLORS = ['bg-brand-700', 'bg-accent-500', 'bg-brand-900', 'bg-accent-700', 'bg-brand-500']

function ScheduleBox({ schedule, slug, ticketTypes }: { schedule: Schedule; slug: string; ticketTypes: TicketTypeAvailability[] | undefined }) {
  const state = saleState(schedule)
  const when = dateParts(schedule.startAt)
  const left = ticketTypes?.reduce((sum, tt) => sum + tt.available, 0)

  return (
    <div className={`rounded-card border bg-surface p-4 shadow-card transition duration-200 ${state === 'on-sale' ? 'border-line hover:border-slate-300 hover:shadow-raised' : 'border-line/70 opacity-90'}`}>
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
              <span className={tt.available === 0 ? 'text-slate-500' : 'text-slate-700'}>
                {tt.name}
                {tt.available === 0 && <span className="ml-2 text-xs font-medium">Hết vé</span>}
              </span>
              <span className={tt.available === 0 ? 'text-slate-500 line-through' : 'font-semibold text-ink'}>{formatVnd(tt.price)}</span>
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
            className="group mt-3 flex h-11 items-center justify-center gap-2 rounded-control bg-brand-700 px-4 text-sm font-semibold text-white transition duration-150 ease-out hover:bg-brand-800 active:scale-[0.97]"
          >
            Chọn chỗ · còn {left ?? '…'} vé
            <ArrowRightIcon size={16} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
    </div>
  )
}
