import type { ReactNode } from 'react'

/**
 * The light content frame down the middle of a page (home, /events). On wide
 * screens the sides show `picture` very blurred: an event's colours (the
 * slide on show on the home page). It stays put while the page scrolls.
 * Narrower screens: the frame is the whole width, no sides.
 */
export function BackdropFrame({ picture, className = '', children }: { picture: string | null; className?: string; children: ReactNode }) {
  return (
    // flow-root: a margin given to the frame (className) stays inside, over the coloured sides.
    <div className="relative flow-root">
      {picture && <Backdrop key={picture} src={picture} />}
      <div className={`relative mx-auto max-w-6xl bg-canvas xl:shadow-raised ${className}`}>{children}</div>
    </div>
  )
}

/** Decorative (aria-hidden); a new picture fades in. */
function Backdrop({ src }: { src: string }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-night">
      <div className="sticky top-0 h-screen">
        <img src={src} alt="" className="h-full w-full scale-125 animate-fade-in object-cover opacity-80 blur-3xl saturate-150" />
        {/* A little darker at the top, where the band or the header ends. */}
        <div className="absolute inset-0 bg-gradient-to-b from-night/70 via-night/20 to-night/30" />
      </div>
    </div>
  )
}
