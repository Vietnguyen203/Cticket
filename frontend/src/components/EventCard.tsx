import { Link } from 'react-router'
import type { EventSummary } from '../api/types'
import { formatDateTime } from '../utils/format'
import { placeholderOf } from '../utils/placeholder'

export function EventCard({ event }: { event: EventSummary }) {
  return (
    <Link
      to={`/events/${event.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="aspect-[16/9] overflow-hidden bg-slate-100">
        {event.thumbnailUrl ? (
          <img src={event.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
        ) : (
          <div className={`flex h-full items-end bg-gradient-to-br p-4 ${placeholderOf(event.title)}`}>
            <span className="line-clamp-2 text-lg font-bold text-white/90">{event.title}</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {event.nextStartAt && <p className="text-sm font-semibold text-brand-700">{formatDateTime(event.nextStartAt)}</p>}
        <h3 className="line-clamp-2 font-semibold text-slate-900">{event.title}</h3>
        <p className="mt-auto text-sm text-slate-500">
          {[event.cities.join(', '), event.organizer.name].filter(Boolean).join(' · ')}
        </p>
      </div>
    </Link>
  )
}

export function EventGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-64 animate-pulse rounded-2xl bg-slate-200/70" />
      ))}
    </div>
  )
}
