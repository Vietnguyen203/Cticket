import type { FormEvent } from 'react'
import { SearchIcon } from './icons'

/**
 * The event search box (home page hero, events page). A form with role
 * "search": Enter or the button submits, nothing is sent while typing.
 */
export function SearchBar({
  value,
  onChange,
  onSubmit,
  size = 'md',
  placeholder = 'Tìm sự kiện, nghệ sĩ, địa điểm…',
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  size?: 'md' | 'lg'
  placeholder?: string
}) {
  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }
  const large = size === 'lg'
  return (
    <form onSubmit={submit} role="search" className={`flex items-center gap-2 rounded-card border border-line bg-white shadow-card ${large ? 'p-1.5 sm:p-2' : 'p-1'}`}>
      <SearchIcon size={large ? 22 : 20} className={`shrink-0 text-slate-400 ${large ? 'ml-3' : 'ml-2.5'}`} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label="Tìm sự kiện"
        type="search"
        enterKeyHint="search"
        className={`min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden ${large ? 'h-11 text-base sm:h-12' : 'h-10 text-base sm:text-sm'}`}
      />
      <button
        type="submit"
        className={`shrink-0 rounded-control bg-brand-700 font-semibold text-white transition hover:bg-brand-800 ${large ? 'h-11 px-5 text-sm sm:h-12 sm:px-7 sm:text-base' : 'h-10 px-4 text-sm'}`}
      >
        Tìm
      </button>
    </form>
  )
}
