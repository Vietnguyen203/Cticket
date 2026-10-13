import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { listCategories, listEvents } from '../../api/events'
import { Pagination } from '../../admin/components'
import { EventCard, EventGridSkeleton } from '../../components/EventCard'
import { Alert, Button } from '../../components/ui'
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

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-bold">Sự kiện</h1>
      <form onSubmit={search} role="search" className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <input
          value={draft.q}
          onChange={(e) => setDraft({ ...draft, q: e.target.value })}
          placeholder="Tìm sự kiện, nghệ sĩ…"
          aria-label="Từ khóa"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2.5"
        />
        <input
          value={draft.city}
          onChange={(e) => setDraft({ ...draft, city: e.target.value })}
          placeholder="Thành phố"
          aria-label="Thành phố"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2.5"
        />
        <select
          value={categoryId}
          onChange={(e) => update({ categoryId: e.target.value })}
          aria-label="Danh mục"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2.5"
        >
          <option value="">Mọi danh mục</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button type="submit">Tìm</Button>
      </form>

      {events.error ? (
        <Alert>{events.error.message}</Alert>
      ) : !events.data ? (
        <EventGridSkeleton />
      ) : events.data.events.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">Không có sự kiện nào phù hợp.</p>
      ) : (
        <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${events.loading ? 'opacity-60' : ''}`}>
          {events.data.events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
      <Pagination meta={events.data?.meta} onPage={(p) => update({ page: String(p) })} />
    </div>
  )
}
