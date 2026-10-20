import { Link } from 'react-router'
import type { EventSummary } from '../api/types'
import { dateParts } from '../utils/format'
import { EventImage } from './EventImage'
import { MapPinIcon, StarIcon } from './icons'
import { Skeleton } from './ui'

/**
 * An event in a list: the picture (16:9), a calendar block with the next
 * show, title, where, who. The whole card is one link (one tab stop).
 */
export function EventCard({ event }: { event: EventSummary }) {
  const when = event.nextStartAt ? dateParts(event.nextStartAt) : null
  return (
    <Link
      to={`/events/${event.slug}`}
      className="group flex flex-col overflow-hidden rounded-card border border-line bg-white shadow-card transition duration-200 ease-standard hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-raised"
    >
      <div className="relative aspect-video overflow-hidden bg-slate-100">
        <EventImage src={event.thumbnailUrl} title={event.title} />
        {event.categories[0] && (
          <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-ink shadow-card">
            {event.categories[0].name}
          </span>
        )}
      </div>
      <div className="flex flex-1 gap-4 p-4">
        {when ? (
          <div className="flex w-12 shrink-0 flex-col items-center rounded-control border border-line py-1.5 text-center" aria-hidden="true">
            <span className="text-[11px] font-semibold uppercase text-brand-700">{when.month}</span>
            <span className="text-xl font-bold leading-tight text-ink">{when.day}</span>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {when && (
            <p className="text-xs font-medium text-slate-500">
              {when.weekday}, {when.day}/{when.month.slice(2)}/{when.year} · {when.time}
            </p>
          )}
          <h3 className="line-clamp-2 font-semibold leading-snug text-ink transition-colors group-hover:text-brand-700">{event.title}</h3>
          {event.cities.length > 0 && (
            <p className="flex items-center gap-1 text-sm text-slate-600">
              <MapPinIcon size={15} className="shrink-0 text-slate-400" />
              <span className="truncate">{event.cities.join(', ')}</span>
            </p>
          )}
          <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-xs text-slate-500">
            <span className="truncate">{event.organizer.name}</span>
            {event.rating?.average != null && (
              <span className="flex shrink-0 items-center gap-1 font-medium text-ink">
                <StarIcon size={14} className="text-amber-500" />
                {event.rating.average.toLocaleString('vi-VN')}
                <span className="font-normal text-slate-500">({event.rating.count})</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}

export function EventGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Đang tải sự kiện">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-card border border-line bg-white">
          <Skeleton className="aspect-video !rounded-none" />
          <div className="flex gap-4 p-4">
            <Skeleton className="h-14 w-12" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
