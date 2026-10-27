import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { EventSummary } from '../api/types'
import { dateParts, formatVnd } from '../utils/format'
import { STOCK_LABEL, stockOf } from '../utils/stock'
import { EventImage } from './EventImage'
import { ArrowRightIcon, CalendarIcon, ChevronLeftIcon, ChevronRightIcon, MapPinIcon } from './icons'

const AUTO_MS = 6000

/**
 * The home page's featured events, one at a time, full width: the picture,
 * darkened toward the text, the essentials and "Mua vé". Slides cross-fade
 * (a transition, so a quick second click retargets smoothly).
 *
 * It moves on by itself every 6 s, but never while the pointer or the
 * keyboard is in it, while the tab is hidden, after the pause button, or
 * with reduced motion (WCAG 2.2.2: moving content can be paused).
 */
export function HeroCarousel({ events }: { events: EventSummary[] }) {
  const [index, setIndex] = useState(0)
  const [held, setHeld] = useState(false) // pointer / focus inside
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const count = events.length
  const go = (to: number) => setIndex(((to % count) + count) % count)

  useEffect(() => {
    if (count < 2 || held || paused) return undefined
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((current) => (current + 1) % count)
    }, AUTO_MS)
    return () => window.clearInterval(timer)
  }, [count, held, paused])

  if (count === 0) return null
  const current = Math.min(index, count - 1)

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Sự kiện nổi bật"
      className="relative overflow-hidden bg-night text-white"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(current + 1)
        if (e.key === 'ArrowLeft') go(current - 1)
      }}
    >
      {/* Every slide in the same grid cell: the band takes the tallest slide's height (nothing cut, no jump between slides). */}
      <div className="grid min-h-[30rem] sm:min-h-[32rem] lg:min-h-[34rem]">
        {events.map((event, i) => (
          <Slide key={event.id} event={event} active={i === current} position={`${i + 1} / ${count}`} />
        ))}
      </div>

      {count > 1 && (
        <div className="absolute inset-x-0 bottom-0 z-10">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pb-16 sm:px-6">
            <div className="flex items-center gap-1.5">
              {events.map((event, i) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Sự kiện ${i + 1}: ${event.title}`}
                  aria-current={i === current ? 'true' : undefined}
                  className="flex h-6 items-center"
                >
                  <span
                    className={`block h-1.5 w-7 rounded-full transition-[scale,background-color] duration-300 ease-out ${i === current ? 'bg-white' : 'scale-x-[0.43] bg-white/40 hover:bg-white/70'}`}
                  />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold text-white/80 ring-1 ring-white/25 transition hover:bg-white/10 hover:text-white"
              >
                {paused ? 'Tự chuyển' : 'Tạm dừng'}
              </button>
              <button type="button" onClick={() => go(current - 1)} aria-label="Sự kiện trước" className={NAV}>
                <ChevronLeftIcon size={20} />
              </button>
              <button type="button" onClick={() => go(current + 1)} aria-label="Sự kiện tiếp theo" className={NAV}>
                <ChevronRightIcon size={20} />
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

const NAV = 'flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-white/20 active:scale-[0.97]'

function Slide({ event, active, position }: { event: EventSummary; active: boolean; position: string }) {
  const when = event.nextStartAt ? dateParts(event.nextStartAt) : null
  const stock = stockOf(event.places)
  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={position}
      aria-hidden={!active}
      inert={!active}
      className={`relative overflow-hidden transition-opacity duration-500 ease-out [grid-area:1/1] ${active ? 'z-[1] opacity-100' : 'opacity-0'}`}
    >
      <div className={`absolute inset-0 transition-transform duration-[6000ms] ease-linear ${active ? 'scale-105' : 'scale-100'}`}>
        <EventImage src={event.thumbnailUrl} />
      </div>
      {/* Dark toward the text: readable on any picture. */}
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-night via-night/80 to-night/10" />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-night via-transparent to-transparent" />

      <div className="relative mx-auto flex h-full max-w-6xl flex-col justify-end px-4 pb-32 pt-12 sm:px-6 sm:pb-36">
        <div className="max-w-xl space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider">
            <span className="rounded-full bg-accent-500 px-2.5 py-1 text-white">Nổi bật</span>
            {event.categories[0] && <span className="text-brand-300">{event.categories[0].name}</span>}
            {stock && <span className="rounded-full bg-white/15 px-2.5 py-1 text-white">{STOCK_LABEL[stock]}</span>}
          </p>
          {/* At most 3 lines here (the whole title is on the event page, and in `title`). */}
          <h2 title={event.title} className="line-clamp-3 text-balance text-3xl font-bold leading-tight sm:text-5xl">
            {event.title}
          </h2>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-200 sm:text-base">
            {when && (
              <span className="flex items-center gap-1.5">
                <CalendarIcon size={17} className="text-brand-300" />
                {when.weekday}, {when.day}/{when.month.slice(2)}/{when.year} · {when.time}
              </span>
            )}
            {event.cities.length > 0 && (
              <span className="flex items-center gap-1.5">
                <MapPinIcon size={17} className="text-brand-300" />
                {event.cities.join(', ')}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Link
              to={`/events/${event.slug}`}
              className="pressable inline-flex h-12 items-center gap-2 rounded-control bg-brand-700 px-6 font-semibold text-white shadow-raised transition hover:bg-brand-800"
            >
              Mua vé
              <ArrowRightIcon size={18} />
            </Link>
            {event.fromPrice != null && (
              <p className="text-sm text-slate-300">
                Giá từ <span className="text-lg font-bold text-white">{formatVnd(event.fromPrice)}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
