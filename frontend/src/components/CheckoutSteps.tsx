import { CheckIcon } from './icons'

const STEPS = ['Chọn chỗ', 'Thanh toán', 'Nhận vé'] as const

/**
 * Where the buyer is in the purchase: choose seats (seat map) → pay (the held
 * order) → tickets (the paid order). `current` is the step being done; with
 * `done`, that step is finished too (the paid order: everything ticked).
 */
export function CheckoutSteps({ current, done = false }: { current: 0 | 1 | 2; done?: boolean }) {
  return (
    <ol aria-label="Các bước mua vé" className="flex items-center gap-2 text-sm">
      {STEPS.map((label, index) => {
        const finished = index < current || (done && index === current)
        const active = index === current && !done
        return (
          <li key={label} aria-current={active ? 'step' : undefined} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-200 ${
                finished ? 'bg-brand-700 text-white' : active ? 'bg-brand-700 text-white ring-4 ring-brand-100' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {finished ? <CheckIcon size={15} /> : index + 1}
              <span className="sr-only">{finished ? ' (đã xong)' : active ? ' (đang làm)' : ''}</span>
            </span>
            <span className={`truncate font-medium ${active ? 'text-ink' : finished ? 'text-slate-700' : 'text-slate-500'} ${active ? '' : 'max-sm:sr-only'}`}>
              {label}
            </span>
            {index < STEPS.length - 1 && (
              <span aria-hidden="true" className={`h-0.5 min-w-4 flex-1 rounded-full ${index < current || done ? 'bg-brand-700' : 'bg-slate-200'}`} />
            )}
          </li>
        )
      })}
    </ol>
  )
}
