import { useEffect, useState } from 'react'
import { serverNow } from './serverClock'

/** Seconds left until `deadline`, on the server's clock (null without a deadline). */
export function useCountdown(deadline: string | null | undefined): number | null {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    if (!deadline) return undefined
    const timer = setInterval(() => setNow(serverNow()), 1000)
    return () => clearInterval(timer)
  }, [deadline])
  if (!deadline) return null
  return Math.max(0, Math.floor((Date.parse(deadline) - now) / 1000))
}

export const mmss = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
