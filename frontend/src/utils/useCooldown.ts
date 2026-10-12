import { useCallback, useEffect, useState } from 'react'

/** Seconds left before an action may be repeated (e.g. "resend the code" after 60 s). */
export function useCooldown(seconds: number, startNow = false) {
  const [until, setUntil] = useState(() => (startNow ? Date.now() + seconds * 1000 : 0))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (until <= Date.now()) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [until])

  const start = useCallback(() => {
    setNow(Date.now())
    setUntil(Date.now() + seconds * 1000)
  }, [seconds])

  return { remaining: Math.max(0, Math.ceil((until - now) / 1000)), start }
}
