import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Rises into place the first time it comes near the view (index.css `.reveal`):
 * it starts a little below the fold, so a fast scroll never meets a blank band.
 * `delay` (ms) staggers items of a grid. Without IntersectionObserver, or with
 * reduced motion (CSS), it is simply shown.
 */
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const element = ref.current
    if (!element || shown) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true)
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px 15% 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [shown])

  return (
    <div ref={ref} data-shown={shown} className={`reveal ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  )
}
