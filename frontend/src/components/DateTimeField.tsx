import { useState } from 'react'
import { formatTimeInput, parseTime24, partlyFilled, timeProblem } from '../utils/dateTimeParts'

interface Parts {
  date: string
  /** As typed: "19:30", or something on its way to it */
  time: string
}

const split = (value: string): Parts => ({ date: value.slice(0, 10), time: value.slice(11, 16) })

/**
 * Date + time, 24-hour clock, no seconds. The date comes from the calendar;
 * the time is typed as HH:mm (00:00 → 23:59) and checked as it is typed: the
 * browser's own time input follows the computer's locale (AM/PM on many
 * Windows setups). Value: "YYYY-MM-DDTHH:mm" (Vietnam time, see utils/vnTime),
 * or '' while incomplete or invalid. Remount it (key) to clear it.
 */
export function DateTimeField({
  label,
  name,
  value,
  onChange,
  error,
}: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  error?: string
}) {
  const [parts, setParts] = useState<Parts>(() => split(value))
  const [left, setLeft] = useState(false) // the time box was left: an unfinished time is now an error

  function update(next: Parts) {
    setParts(next)
    const time = parseTime24(next.time)
    onChange(next.date && time ? `${next.date}T${time}` : '')
  }

  const problem = timeProblem(parts.time, left)
  const box = (bad: boolean) =>
    `rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:ring-2 sm:text-sm ${
      bad ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:border-brand-600 focus:ring-brand-100'
    }`

  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-medium text-slate-700">{label}</legend>
      <div className="flex gap-2">
        <input
          type="date"
          name={`${name}Date`}
          aria-label={`${label}: ngày`}
          value={parts.date}
          onChange={(e) => update({ ...parts, date: e.target.value })}
          className={`min-w-0 flex-1 ${box(Boolean(error))}`}
        />
        <input
          type="text"
          name={`${name}Time`}
          aria-label={`${label}: giờ`}
          inputMode="numeric"
          autoComplete="off"
          placeholder="HH:mm"
          maxLength={5}
          value={parts.time}
          onChange={(e) => {
            setLeft(false)
            update({ ...parts, time: formatTimeInput(e.target.value) })
          }}
          onBlur={() => {
            setLeft(true)
            // "1930" or "9:30" typed: show it the way it is read.
            const time = parseTime24(parts.time)
            if (time && time !== parts.time) update({ ...parts, time })
          }}
          aria-invalid={Boolean(problem) || undefined}
          className={`w-24 shrink-0 text-center tabular-nums ${box(Boolean(error || problem))}`}
        />
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      {!error && problem && <p className="mt-1 text-sm text-red-600">{problem}</p>}
      {!error && !problem && !value && partlyFilled(parts) && (
        <p className="mt-1 text-sm text-amber-700">{parts.date ? 'Nhập giờ theo 24 giờ, ví dụ 19:30.' : 'Chọn ngày.'}</p>
      )}
    </fieldset>
  )
}
