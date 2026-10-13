// Events without an image get a colour picked from their title (always the same one).
const PLACEHOLDERS = [
  'from-brand-700 to-brand-500',
  'from-indigo-600 to-sky-500',
  'from-rose-600 to-orange-400',
  'from-violet-700 to-fuchsia-500',
  'from-emerald-700 to-lime-500',
]

/** Tailwind gradient classes */
export function placeholderOf(title: string): string {
  let hash = 0
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PLACEHOLDERS[hash % PLACEHOLDERS.length]
}
