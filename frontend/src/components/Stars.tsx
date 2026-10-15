/** Phase 19: ★★★★☆, read-only, or a picker when `onChange` is given. */
export function Stars({ value, onChange, size = 'text-base' }: { value: number; onChange?: (stars: number) => void; size?: string }) {
  if (!onChange) {
    const full = Math.round(value)
    return (
      <span className={`${size} text-amber-500`} aria-label={`${value} trên 5 sao`}>
        {'★'.repeat(full)}
        <span className="text-slate-300">{'★'.repeat(5 - full)}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex gap-1" role="radiogroup" aria-label="Số sao">
      {[1, 2, 3, 4, 5].map((stars) => (
        <button
          key={stars}
          type="button"
          role="radio"
          aria-checked={value === stars}
          aria-label={`${stars} sao`}
          onClick={() => onChange(stars)}
          className={`text-2xl leading-none ${stars <= value ? 'text-amber-500' : 'text-slate-300'} hover:scale-110`}
        >
          ★
        </button>
      ))}
    </span>
  )
}
