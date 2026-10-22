import { useState } from 'react'
import { formatTimeInput, parseTime24, timeProblem } from '../utils/dateTimeParts'

/**
 * A time typed as HH:mm on a 24-hour clock (00:00 → 23:59): digits only, the
 * ":" is added after the hour, "1930" / "9:30" are read as 19:30 / 09:30 when
 * the box is left. A wrong time is said at once ("25"), an unfinished one when
 * the box is left. value: what is typed; the parent reads it with parseTime24.
 */
export function TimeInput({
  label,
  name,
  value,
  onChange,
  hint,
  showLabel = true,
}: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  hint?: string
  /** false: the label is for screen readers only (a time next to a date, under one legend) */
  showLabel?: boolean
}) {
  const [left, setLeft] = useState(false)
  const problem = timeProblem(value, left)
  return (
    <label className="block text-sm">
      <span className={showLabel ? 'mb-1 block font-medium text-slate-700' : 'sr-only'}>{label}</span>
      <input
        type="text"
        name={name}
        inputMode="numeric"
        autoComplete="off"
        placeholder="HH:mm"
        maxLength={5}
        value={value}
        onChange={(e) => {
          setLeft(false)
          onChange(formatTimeInput(e.target.value))
        }}
        onBlur={() => {
          setLeft(true)
          const time = parseTime24(value)
          if (time && time !== value) onChange(time)
        }}
        aria-invalid={Boolean(problem) || undefined}
        className={`w-24 rounded-lg border bg-white px-3 py-2.5 text-center text-base tabular-nums outline-none focus:ring-2 sm:text-sm ${
          problem ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:border-brand-600 focus:ring-brand-100'
        }`}
      />
      {problem && <span className="mt-1 block text-sm text-red-600">{problem}</span>}
      {!problem && hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}
