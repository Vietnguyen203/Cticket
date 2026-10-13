import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { listCategories, listEvents } from '../api/events'
import { useAuth } from '../auth/AuthContext'
import { EventCard, EventGridSkeleton } from '../components/EventCard'
import { Alert, Button } from '../components/ui'
import { useAsync } from '../utils/useAsync'

const UPCOMING_COUNT = 9

/** APP-C02: what is on soon, by category, with a search box. */
export function HomePage() {
  const { status, user } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const upcoming = useAsync(() => listEvents({ sort: 'startAt', pageSize: UPCOMING_COUNT }), 'upcoming')
  const categories = useAsync(listCategories, 'categories')

  function search(event: FormEvent) {
    event.preventDefault()
    navigate(q.trim() ? `/events?q=${encodeURIComponent(q.trim())}` : '/events')
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:py-10">
      <section className="rounded-3xl bg-gradient-to-br from-brand-700 to-brand-500 px-6 py-10 text-white sm:px-10 sm:py-12">
        <h1 className="text-2xl font-bold sm:text-4xl">
          {status === 'authenticated' && user ? `Chào ${user.firstName}, hôm nay xem gì?` : 'Vé sự kiện, giữ chỗ trong tích tắc'}
        </h1>
        <p className="mt-2 max-w-xl text-brand-50">Chọn ghế trên sơ đồ cập nhật trực tiếp, thanh toán và nhận vé có mã QR.</p>
        <form onSubmit={search} className="mt-6 flex max-w-xl gap-2" role="search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm sự kiện, nghệ sĩ…"
            aria-label="Tìm sự kiện"
            className="min-w-0 flex-1 rounded-lg border-0 px-4 py-3 text-base text-slate-900 outline-none ring-2 ring-transparent focus:ring-white/60"
          />
          <Button type="submit" variant="secondary" className="shrink-0 border-0">
            Tìm
          </Button>
        </form>
      </section>

      {categories.data && categories.data.length > 0 && (
        <section aria-label="Danh mục" className="flex gap-2 overflow-x-auto pb-1">
          {categories.data.map((category) => (
            <Link
              key={category.id}
              to={`/events?categoryId=${category.id}`}
              className="shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-brand-600 hover:text-brand-700"
            >
              {category.name}
            </Link>
          ))}
        </section>
      )}

      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-xl font-bold">Sắp diễn ra</h2>
          <Link to="/events" className="text-sm font-semibold text-brand-700 hover:underline">
            Xem tất cả
          </Link>
        </div>
        {upcoming.error ? (
          <Alert>
            {upcoming.error.message}{' '}
            <button type="button" onClick={upcoming.reload} className="font-semibold underline">
              Thử lại
            </button>
          </Alert>
        ) : !upcoming.data ? (
          <EventGridSkeleton />
        ) : upcoming.data.events.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">Chưa có sự kiện nào sắp diễn ra.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.data.events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
