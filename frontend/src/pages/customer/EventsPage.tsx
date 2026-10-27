import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { listCategories, listEvents } from '../../api/events'
import { Pagination } from '../../admin/components'
import { CategoryChips } from '../../components/CategoryChips'
import { EventCard, EventGridSkeleton } from '../../components/EventCard'
import { Reveal } from '../../components/Reveal'
import { stagger } from '../../utils/motion'
import { CloseIcon, MapPinIcon, SearchIcon } from '../../components/icons'
import { Button, EmptyState, ErrorState, PageHeader } from '../../components/ui'
import { useAsync } from '../../utils/useAsync'

const PAGE_SIZE = 12

/** APP-C02: search published events by keyword, category, city. Filters live in the URL (shareable). */
export function EventsPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const categoryId = params.get('categoryId') ?? ''
  const city = params.get('city') ?? ''
  const page = Number(params.get('page') ?? '1') || 1
  const [draft, setDraft] = useState({ q, city })
  const categories = useAsync(listCategories, 'categories')
  const events = useAsync(
    () => listEvents({ q: q || undefined, categoryId: categoryId || undefined, city: city || undefined, sort: 'startAt', page, pageSize: PAGE_SIZE }),
    params.toString(),
  )
  const filtered = Boolean(q || categoryId || city)
  const categoryName = categories.data?.find((c) => c.id === categoryId)?.name

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (!('page' in changes)) next.delete('page')
    setParams(next)
  }

  function search(e: FormEvent) {
    e.preventDefault()
    update({ q: draft.q.trim(), city: draft.city.trim() })
  }

  function clearFilters() {
    setDraft({ q: '', city: '' })
    setParams(new URLSearchParams())
  }

  const total = events.data?.meta.total
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader title="Sự kiện" subtitle="Tìm theo tên, nghệ sĩ, thành phố hoặc danh mục." />

      <form onSubmit={search} role="search" className="grid gap-2 rounded-card border border-line bg-surface p-2 shadow-card sm:grid-cols-[2fr_1fr_auto]">
        <label className="relative block">
          <span className="sr-only">Từ khóa</span>
          <SearchIcon size={20} className="pointer-events-none absolute inset-y-0 left-3 my-auto text-slate-400" />
          <input
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            placeholder="Tìm sự kiện, nghệ sĩ…"
            aria-label="Từ khóa"
            type="search"
            className="h-11 w-full rounded-control bg-transparent pl-10 pr-3 text-base text-ink outline-none placeholder:text-slate-400 focus:bg-slate-50 sm:text-sm"
          />
        </label>
        <label className="relative block sm:border-l sm:border-line">
          <span className="sr-only">Thành phố</span>
          <MapPinIcon size={20} className="pointer-events-none absolute inset-y-0 left-3 my-auto text-slate-400" />
          <input
            value={draft.city}
            onChange={(e) => setDraft({ ...draft, city: e.target.value })}
            placeholder="Thành phố"
            aria-label="Thành phố"
            className="h-11 w-full rounded-control bg-transparent pl-10 pr-3 text-base text-ink outline-none placeholder:text-slate-400 focus:bg-slate-50 sm:text-sm"
          />
        </label>
        <Button type="submit" className="sm:px-6">
          Tìm
        </Button>
      </form>

      {categories.data && categories.data.length > 0 && (
        <CategoryChips
          categories={categories.data}
          activeId={categoryId || undefined}
          allHref={`/events${q || city ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(city ? { city } : {}) })}` : ''}`}
          hrefOf={(c) => {
            const next = new URLSearchParams(params)
            next.set('categoryId', c.id)
            next.delete('page')
            return `/events?${next}`
          }}
        />
      )}

      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 text-sm text-slate-600" aria-live="polite">
        <p>
          {total === undefined ? 'Đang tìm…' : `${total.toLocaleString('vi-VN')} sự kiện`}
          {q && ` cho “${q}”`}
          {city && ` ở ${city}`}
          {categoryName && ` trong ${categoryName}`}
        </p>
        {filtered && (
          <button type="button" onClick={clearFilters} className="flex items-center gap-1 rounded-control px-2 py-1.5 font-medium text-brand-700 hover:bg-brand-50">
            <CloseIcon size={16} />
            Xóa bộ lọc
          </button>
        )}
      </div>

      {events.error ? (
        <ErrorState message={events.error.message} onRetry={events.reload} />
      ) : !events.data ? (
        <EventGridSkeleton />
      ) : events.data.events.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title="Không có sự kiện nào phù hợp"
          action={
            filtered ? (
              <Button variant="secondary" onClick={clearFilters}>
                Xem tất cả sự kiện
              </Button>
            ) : undefined
          }
        >
          {filtered ? 'Thử từ khóa khác, bỏ bớt bộ lọc hoặc chọn danh mục khác.' : 'Hiện chưa có sự kiện nào đang mở bán.'}
        </EmptyState>
      ) : (
        <div className={`grid gap-5 transition-opacity sm:grid-cols-2 lg:grid-cols-3 ${events.loading ? 'opacity-60' : ''}`}>
          {events.data.events.map((event, index) => (
            <Reveal key={event.id} delay={stagger(index % 3, 90)} className="h-full [&>a]:h-full">
              <EventCard event={event} />
            </Reveal>
          ))}
        </div>
      )}
      <Pagination meta={events.data?.meta} onPage={(p) => update({ page: String(p) })} />
    </div>
  )
}
