import { Link } from 'react-router'
import type { Category } from '../api/types'

/** Categories as links (they filter the events page); the current one highlighted. */
export function CategoryChips({ categories, activeId, allHref = '/events', hrefOf }: {
  categories: Category[]
  activeId?: string
  allHref?: string
  hrefOf: (category: Category) => string
}) {
  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition duration-150 ease-out active:scale-[0.97] ${
      active ? 'border-brand-700 bg-brand-700 text-white shadow-card' : 'border-line bg-surface text-slate-700 hover:border-slate-300 hover:text-ink'
    }`
  return (
    <nav aria-label="Danh mục" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      <Link to={allHref} className={chip(!activeId)} aria-current={!activeId ? 'page' : undefined}>
        Tất cả
      </Link>
      {categories.map((category) => (
        <Link key={category.id} to={hrefOf(category)} className={chip(activeId === category.id)} aria-current={activeId === category.id ? 'page' : undefined}>
          {category.name}
        </Link>
      ))}
    </nav>
  )
}
