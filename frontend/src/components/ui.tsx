import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { AlertIcon, CheckCircleIcon, ChevronDownIcon, EyeIcon, EyeOffIcon, InfoIcon, XCircleIcon } from './icons'

/**
 * Shared building blocks (docs/ui-redesign.md, section 4), styled with the
 * design tokens of index.css. Names and props of the first version are kept:
 * every page, the admin ones included, uses them.
 */

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'dark'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white shadow-card hover:bg-brand-800 active:bg-brand-900 disabled:bg-brand-700/45 disabled:shadow-none',
  secondary: 'border border-line bg-white text-ink shadow-card hover:border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white shadow-card hover:bg-red-700 disabled:bg-red-600/45',
  ghost: 'text-brand-700 hover:bg-brand-50 disabled:text-slate-400',
  dark: 'bg-ink text-white hover:bg-ink-soft disabled:bg-ink/50',
}

// Minimum heights (a long label may wrap onto two lines, never clipped).
const SIZES: Record<Size, string> = {
  sm: 'min-h-9 px-3 py-1.5 text-sm',
  md: 'min-h-11 px-4 py-2 text-sm',
  lg: 'min-h-12 px-6 py-2.5 text-base',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

/** Disabled while `loading`: a second click never sends a second request. */
export function Button({ variant = 'primary', size = 'md', loading = false, disabled, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-control text-center font-semibold leading-snug transition duration-150 ease-standard disabled:cursor-not-allowed ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

const fieldClass = (error?: string) =>
  `block w-full rounded-control border bg-white px-3.5 text-base text-ink placeholder:text-slate-400 transition duration-150 outline-none sm:text-sm disabled:bg-slate-100 disabled:text-slate-500 focus:ring-4 ${
    error ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : 'border-line hover:border-slate-300 focus:border-brand-600 focus:ring-brand-100'
  }`

function FieldFrame({ inputId, label, error, hint, className, children }: { inputId: string; label: string; error?: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 flex items-start gap-1 text-sm text-red-600">
          <AlertIcon size={16} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-slate-500">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
  /** An icon inside the field, on the left (e.g. <SearchIcon />). */
  icon?: ReactNode
}

export function TextField({ label, error, hint, icon, id, className = '', ...rest }: TextFieldProps) {
  // The label must point at the input (screen readers, getByLabel): a generated id when none is given.
  const generatedId = useId()
  const inputId = id ?? rest.name ?? generatedId
  return (
    <FieldFrame inputId={inputId} label={label} error={error} hint={hint} className={className}>
      <div className="relative">
        {icon && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">{icon}</span>}
        <input
          id={inputId}
          {...rest}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={`h-11 ${fieldClass(error)} ${icon ? 'pl-10' : ''}`}
        />
      </div>
    </FieldFrame>
  )
}

/** A password with a show / hide button (the button never submits the form). */
export function PasswordField(props: Omit<TextFieldProps, 'type' | 'icon'>) {
  const [visible, setVisible] = useState(false)
  const generatedId = useId()
  const inputId = props.id ?? props.name ?? generatedId
  const { label, error, hint, className = '', ...rest } = props
  return (
    <FieldFrame inputId={inputId} label={label} error={error} hint={hint} className={className}>
      <div className="relative">
        <input
          {...rest}
          id={inputId}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={`h-11 pr-11 ${fieldClass(error)}`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          aria-pressed={visible}
          className="absolute inset-y-0 right-1 my-1 flex w-9 items-center justify-center rounded-control text-slate-500 hover:bg-slate-100 hover:text-ink"
        >
          {visible ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
        </button>
      </div>
    </FieldFrame>
  )
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Visible label; without it, give an aria-label. */
  label?: string
}

/** A native select (keyboard and phones handle it best), styled like the inputs. */
export function SelectField({ label, id, className = '', children, ...rest }: SelectFieldProps) {
  const generatedId = useId()
  const selectId = id ?? rest.name ?? generatedId
  const select = (
    <div className="relative">
      <select id={selectId} {...rest} className={`h-11 appearance-none pr-10 ${fieldClass()}`}>
        {children}
      </select>
      <ChevronDownIcon size={18} className="pointer-events-none absolute inset-y-0 right-3 my-auto text-slate-500" />
    </div>
  )
  if (!label) return <div className={className}>{select}</div>
  return (
    <FieldFrame inputId={selectId} label={label} className={className}>
      {select}
    </FieldFrame>
  )
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

const ALERT_TONES = {
  error: { box: 'border-red-200 bg-red-50 text-red-900', icon: <XCircleIcon size={20} className="text-red-600" /> },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: <CheckCircleIcon size={20} className="text-emerald-600" /> },
  info: { box: 'border-sky-200 bg-sky-50 text-sky-900', icon: <InfoIcon size={20} className="text-sky-600" /> },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-950', icon: <AlertIcon size={20} className="text-amber-600" /> },
}

export function Alert({ tone = 'error', children }: { tone?: keyof typeof ALERT_TONES; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-card border px-4 py-3 text-sm leading-relaxed ${ALERT_TONES[tone].box}`}>
      <span className="mt-px shrink-0">{ALERT_TONES[tone].icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

const BADGE_TONES = {
  neutral: 'bg-slate-100 text-slate-700',
  brand: 'bg-brand-50 text-brand-800',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-800',
  danger: 'bg-red-50 text-red-700',
  info: 'bg-sky-50 text-sky-800',
}
export type BadgeTone = keyof typeof BADGE_TONES

/** A short status ("Đang mở bán", "Đã thanh toán"): colour plus text, never colour alone. */
export function Badge({ tone = 'neutral', children, className = '' }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE_TONES[tone]} ${className}`}>{children}</span>
}

/** Nothing to show: a calm panel with what to do next. */
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-panel border border-dashed border-line bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-slate-600">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** A failed load, with "Thử lại". */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert>
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-2 font-semibold underline underline-offset-2">
          Thử lại
        </button>
      )}
    </Alert>
  )
}

/** A grey block while something loads (keeps the layout from jumping). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-control bg-slate-200/70 ${className}`} />
}

// ---------------------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------------------

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card border border-line bg-white p-5 shadow-card sm:p-6 ${className}`}>{children}</div>
}

/** Title of a page, with an optional line under it and actions on the right. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600 sm:text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Spinner({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${small ? 'h-4 w-4' : 'h-8 w-8'}`}
    />
  )
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-brand-700" role="status" aria-label="Đang tải">
      <Spinner />
    </div>
  )
}

/** A centred, narrow page for forms (login, register…). */
export function FormPage({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
      <div className="rounded-panel border border-line bg-white p-6 shadow-card sm:p-8">
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-slate-600">{subtitle}</p>}
        <div className="mt-7">{children}</div>
      </div>
    </div>
  )
}
