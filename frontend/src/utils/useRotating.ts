import { useEffect, useState } from 'react'

/**
 * One item of `items` at a time, the next every `ms` (the home carousel's
 * pace): still while the tab is hidden and with reduced motion.
 */
export function useRotating<T>(items: T[], ms = 3000): T | null {
  const [index, setIndex] = useState(0)
  const count = items.length
  useEffect(() => {
    if (count < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % count)
    }, ms)
    return () => window.clearInterval(timer)
  }, [count, ms])
  return count > 0 ? items[index % count] : null
}
