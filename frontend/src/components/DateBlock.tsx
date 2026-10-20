import { dateParts } from '../utils/format'

/** A small calendar sheet (month / day / time) for lists of shows, tickets and orders. */
export function DateBlock({ iso, muted = false }: { iso: string; muted?: boolean }) {
  const when = dateParts(iso)
  return (
    <div
      aria-hidden="true"
      className={`flex w-14 shrink-0 flex-col items-center rounded-control py-2 text-center ${muted ? 'bg-slate-100' : 'bg-brand-50'}`}
    >
      <span className={`text-[11px] font-semibold uppercase ${muted ? 'text-slate-500' : 'text-brand-700'}`}>{when.month}</span>
      <span className={`text-2xl font-bold leading-none ${muted ? 'text-slate-500' : 'text-ink'}`}>{when.day}</span>
      <span className="mt-0.5 text-[11px] text-slate-500">{when.time}</span>
    </div>
  )
}
