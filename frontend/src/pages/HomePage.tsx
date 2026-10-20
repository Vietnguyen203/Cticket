import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { listCategories, listEvents } from '../api/events'
import type { EventSummary } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { CategoryChips } from '../components/CategoryChips'
import { EventCard, EventGridSkeleton } from '../components/EventCard'
import { EventImage } from '../components/EventImage'
import { ArrowRightIcon, CalendarIcon, MapPinIcon, QrIcon, ShieldIcon, TicketIcon } from '../components/icons'
import { SearchBar } from '../components/SearchBar'
import { EmptyState, ErrorState, Skeleton } from '../components/ui'
import { dateParts } from '../utils/format'
import { useAsync } from '../utils/useAsync'

const UPCOMING_COUNT = 9

/** APP-C02: what is on soon, by category, with a search box. */
export function HomePage() {
  const { status, user } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const upcoming = useAsync(() => listEvents({ sort: 'startAt', pageSize: UPCOMING_COUNT }), 'upcoming')
  const categories = useAsync(listCategories, 'categories')
  const events = upcoming.data?.events ?? []
  // The soonest event that has a picture leads the page (or simply the soonest).
  const featured = events.find((event) => event.thumbnailUrl) ?? events[0]

  function search() {
    navigate(q.trim() ? `/events?q=${encodeURIComponent(q.trim())}` : '/events')
  }

  return (
    <>
      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-16">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-300">
              {status === 'authenticated' && user ? `Chào ${user.firstName}` : 'Vé sự kiện trực tuyến'}
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-5xl">Hôm nay bạn muốn xem gì?</h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-300 sm:text-lg">
              Chọn ghế trên sơ đồ cập nhật trực tiếp, thanh toán an toàn và nhận vé có mã QR ngay trong email.
            </p>
            <div className="mt-8 max-w-xl text-ink">
              <SearchBar value={q} onChange={setQ} onSubmit={search} size="lg" />
            </div>
          </div>
          <div className="min-w-0">
            {upcoming.error ? null : !upcoming.data ? (
              <Skeleton className="aspect-[4/3] w-full !rounded-panel !bg-white/10" />
            ) : featured ? (
              <FeaturedEvent event={featured} />
            ) : null}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6 sm:py-14">
        {categories.data && categories.data.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-ink">Khám phá theo danh mục</h2>
            <CategoryChips categories={categories.data} hrefOf={(c) => `/events?categoryId=${c.id}`} />
          </section>
        )}

        <section className="space-y-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-ink">Sắp diễn ra</h2>
              <p className="mt-1 text-sm text-slate-600">Những sự kiện gần nhất đang mở bán.</p>
            </div>
            <Link to="/events" className="flex shrink-0 items-center gap-1 rounded-control text-sm font-semibold text-brand-700 hover:text-brand-800">
              Xem tất cả
              <ArrowRightIcon size={16} />
            </Link>
          </div>
          {upcoming.error ? (
            <ErrorState message={upcoming.error.message} onRetry={upcoming.reload} />
          ) : !upcoming.data ? (
            <EventGridSkeleton />
          ) : events.length === 0 ? (
            <EmptyState icon={<CalendarIcon />} title="Chưa có sự kiện nào sắp diễn ra">
              Hãy quay lại sau, các ban tổ chức đang chuẩn bị sự kiện mới.
            </EmptyState>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </section>

        <section aria-label="Vì sao mua vé ở đây" className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: <TicketIcon />, title: 'Chọn chỗ trực tiếp', text: 'Sơ đồ ghế cập nhật ngay khi có người giữ, không bao giờ bán trùng ghế.' },
            { icon: <ShieldIcon />, title: 'Thanh toán an toàn', text: 'Thanh toán qua VNPay; đơn chỉ thành công khi cổng thanh toán xác nhận.' },
            { icon: <QrIcon />, title: 'Vé QR tức thì', text: 'Vé có mã QR trong email và trong tài khoản, tải được bản PDF để in.' },
          ].map((item) => (
            <div key={item.title} className="flex gap-4 rounded-card border border-line bg-white p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-700">{item.icon}</span>
              <div>
                <p className="font-semibold text-ink">{item.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.text}</p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </>
  )
}

/** The lead event of the home page: big picture, the essentials on it. */
function FeaturedEvent({ event }: { event: EventSummary }) {
  const when = event.nextStartAt ? dateParts(event.nextStartAt) : null
  return (
    <Link to={`/events/${event.slug}`} className="group block overflow-hidden rounded-panel bg-ink-soft ring-1 ring-white/10">
      <div className="aspect-video overflow-hidden">
        <EventImage src={event.thumbnailUrl} title={event.title} className="transition duration-300 group-hover:opacity-90" />
      </div>
      <div className="space-y-2 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-300">Nổi bật</p>
        <h2 className="line-clamp-2 text-xl font-bold leading-snug text-white">{event.title}</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
          {when && (
            <span className="flex items-center gap-1.5">
              <CalendarIcon size={16} className="text-slate-400" />
              {when.weekday}, {when.day}/{when.month.slice(2)} · {when.time}
            </span>
          )}
          {event.cities.length > 0 && (
            <span className="flex items-center gap-1.5">
              <MapPinIcon size={16} className="text-slate-400" />
              {event.cities.join(', ')}
            </span>
          )}
        </div>
        <span className="inline-flex items-center gap-1 pt-1 text-sm font-semibold text-white">
          Xem chi tiết <ArrowRightIcon size={16} className="transition group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  )
}
