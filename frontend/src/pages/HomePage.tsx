import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { listCategories, listEvents } from '../api/events'
import { useAuth } from '../auth/AuthContext'
import { BlurText } from '../components/BlurText'
import { CategoryChips } from '../components/CategoryChips'
import { EventCard, EventGridSkeleton } from '../components/EventCard'
import { HeroCarousel } from '../components/HeroCarousel'
import { ArrowRightIcon, CalendarIcon, MapPinIcon, QrIcon, ShieldIcon, TicketIcon } from '../components/icons'
import { Reveal } from '../components/Reveal'
import { SearchBar } from '../components/SearchBar'
import { EmptyState, ErrorState, Skeleton } from '../components/ui'
import { stagger } from '../utils/motion'
import { citiesOf, stockOf } from '../utils/stock'
import { useAsync } from '../utils/useAsync'

/** One request feeds every section of the page (the soonest events on sale). */
const LOADED = 24
const FEATURED = 5
const UPCOMING = 6

/**
 * APP-C02, a ticket marketplace's front page: featured events (carousel),
 * search and categories, what is almost sold out, what is on soon, by city.
 */
export function HomePage() {
  const { status, user } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const loaded = useAsync(() => listEvents({ sort: 'startAt', pageSize: LOADED }), 'home-events')
  const categories = useAsync(listCategories, 'categories')
  const events = loaded.data?.events ?? []

  // Featured: the soonest events with a picture (else simply the soonest).
  const withPicture = events.filter((e) => e.thumbnailUrl)
  const featured = (withPicture.length > 0 ? withPicture : events).slice(0, FEATURED)
  const almostGone = events.filter((e) => stockOf(e.places) === 'LOW').slice(0, 4)
  const cities = citiesOf(events)

  function search() {
    navigate(q.trim() ? `/events?q=${encodeURIComponent(q.trim())}` : '/events')
  }

  return (
    <>
      {loaded.error ? null : !loaded.data ? (
        <Skeleton className="h-[30rem] w-full !rounded-none sm:h-[32rem] lg:h-[34rem]" />
      ) : featured.length > 0 ? (
        <HeroCarousel events={featured} />
      ) : null}

      <div className="mx-auto max-w-6xl space-y-14 px-4 pb-14 sm:px-6">
        {/* Search, pulled up over the carousel's bottom edge. */}
        <section
          aria-labelledby="tim-su-kien"
          className={`relative z-10 rounded-panel border border-line bg-surface p-5 shadow-raised sm:p-7 ${featured.length > 0 ? '-mt-10' : 'mt-10'}`}
        >
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-700">
            {status === 'authenticated' && user ? `Chào ${user.firstName}` : 'Vé sự kiện trực tuyến'}
          </p>
          <h1 id="tim-su-kien" className="mt-1 text-balance text-2xl font-bold text-ink sm:text-3xl">
            <BlurText text="Hôm nay bạn muốn xem gì?" delayMs={80} />
          </h1>
          <div className="mt-4">
            <SearchBar value={q} onChange={setQ} onSubmit={search} size="lg" />
          </div>
          {categories.data && categories.data.length > 0 && (
            <div className="mt-4">
              <CategoryChips categories={categories.data} hrefOf={(c) => `/events?categoryId=${c.id}`} />
            </div>
          )}
        </section>

        {loaded.error ? (
          <ErrorState message={loaded.error.message} onRetry={loaded.reload} />
        ) : !loaded.data ? (
          <EventGridSkeleton />
        ) : events.length === 0 ? (
          <EmptyState icon={<CalendarIcon />} title="Chưa có sự kiện nào sắp diễn ra">
            Hãy quay lại sau, các ban tổ chức đang chuẩn bị sự kiện mới.
          </EmptyState>
        ) : (
          <>
            {almostGone.length > 0 && (
              <Rail title="Sắp hết vé" subtitle="Còn ít chỗ: đặt sớm kẻo lỡ." accent>
                <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
                  {almostGone.map((event) => (
                    <div key={event.id} className="w-[78%] shrink-0 snap-start sm:w-auto [&>a]:h-full">
                      <EventCard event={event} />
                    </div>
                  ))}
                </div>
              </Rail>
            )}

            <Rail title="Sắp diễn ra" subtitle="Những sự kiện gần nhất đang mở bán." more="/events">
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {events.slice(0, UPCOMING).map((event, index) => (
                  <Reveal key={event.id} delay={stagger(index % 3, 60)} className="h-full [&>a]:h-full">
                    <EventCard event={event} />
                  </Reveal>
                ))}
              </div>
            </Rail>

            {cities.length > 0 && (
              <Rail title="Theo thành phố" subtitle="Sự kiện gần bạn.">
                <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                  {cities.map(([city, count]) => (
                    <Link
                      key={city}
                      to={`/events?city=${encodeURIComponent(city)}`}
                      className="pressable group flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card transition hover:border-brand-300 hover:shadow-raised"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-700">
                        <MapPinIcon size={20} />
                      </span>
                      <span className="min-w-0">
                        <span title={city} className="line-clamp-2 break-words font-semibold leading-snug text-ink group-hover:text-brand-700">
                          {city}
                        </span>
                        <span className="text-sm text-slate-500">{count} sự kiện</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </Rail>
            )}
          </>
        )}

        <section aria-label="Vì sao mua vé ở đây" className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: <TicketIcon />, title: 'Chọn chỗ trực tiếp', text: 'Sơ đồ ghế cập nhật ngay khi có người giữ, không bao giờ bán trùng ghế.' },
            { icon: <ShieldIcon />, title: 'Thanh toán an toàn', text: 'Thanh toán qua VNPay; đơn chỉ thành công khi cổng thanh toán xác nhận.' },
            { icon: <QrIcon />, title: 'Vé QR tức thì', text: 'Vé có mã QR trong email và trong tài khoản, tải được bản PDF để in.' },
          ].map((item, index) => (
            <Reveal key={item.title} delay={stagger(index, 60)} className="flex gap-4 rounded-card border border-line bg-surface p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-700">{item.icon}</span>
              <div>
                <p className="font-semibold text-ink">{item.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.text}</p>
              </div>
            </Reveal>
          ))}
        </section>
      </div>
    </>
  )
}

/** A titled band of the page, with an optional "see all" link. `accent`: the pink mark for urgency. */
function Rail({ title, subtitle, more, accent = false, children }: { title: string; subtitle: string; more?: string; accent?: boolean; children: ReactNode }) {
  return (
    <section className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-ink">
            {accent && <span aria-hidden="true" className="h-6 w-1.5 rounded-full bg-accent-500" />}
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        </div>
        {more && (
          <Link to={more} className="flex shrink-0 items-center gap-1 rounded-control text-sm font-semibold text-brand-700 hover:text-brand-800">
            Xem tất cả
            <ArrowRightIcon size={16} />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}
