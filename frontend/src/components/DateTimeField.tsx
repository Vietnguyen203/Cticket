import { useState } from 'react'

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
const MINUTE_STEP = 5
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => String(i * MINUTE_STEP).padStart(2, '0'))

interface Parts {
  date: string
  hour: string
  minute: string
}

const split = (value: string): Parts => ({ date: value.slice(0, 10), hour: value.slice(11, 13), minute: value.slice(14, 16) })

/**
 * Date + time in 24-hour format, no seconds. The browser's datetime-local
 * input follows the computer's locale (AM/PM on many Windows setups), so the
 * time is two selects instead. Value: "YYYY-MM-DDTHH:mm" (Vietnam time, see
 * utils/vnTime), or '' while incomplete. Remount it (key) to clear it.
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
  const [draft, setDraft] = useState<Parts>(() => split(value))
  const parts = value ? split(value) : draft
  // A saved time that is not on the 5-minute grid stays selectable.
  const minutes = parts.minute && !MINUTES.includes(parts.minute) ? [...MINUTES, parts.minute].sort() : MINUTES

  function set(part: keyof Parts, v: string) {
    const next = { ...parts, [part]: v }
    setDraft(next)
    onChange(next.date && next.hour && next.minute ? `${next.date}T${next.hour}:${next.minute}` : '')
  }

  const box = `rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:ring-2 sm:text-sm ${
    error ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:border-brand-600 focus:ring-brand-100'
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
          onChange={(e) => set('date', e.target.value)}
          className={`min-w-0 flex-1 ${box}`}
        />
        <select aria-label={`${label}: giờ`} name={`${name}Hour`} value={parts.hour} onChange={(e) => set('hour', e.target.value)} className={box}>
          <option value="">giờ</option>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <select aria-label={`${label}: phút`} name={`${name}Minute`} value={parts.minute} onChange={(e) => set('minute', e.target.value)} className={box}>
          <option value="">phút</option>
          {minutes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </fieldset>
  )
}
