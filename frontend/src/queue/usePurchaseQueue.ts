import { useCallback, useEffect, useRef, useState } from 'react'
import { getQueueStatus, joinQueue, leaveQueue, tryQueueNow, type QueueView } from '../api/queue'
import { realtime } from '../realtime'

const POLL_MS = 5000

export interface PurchaseQueue {
  /** undefined: no queue to deal with (off, signed out) or still asking */
  view: QueueView | undefined
  /** My place when I joined (for the progress bar) */
  firstPlace: number | null
  /** Ask again now (e.g. the API said it is not my turn) */
  refresh: () => void
  /** "Vào ngay": in at once when there is room; else the view stays WAITING. Resolves with the people buying now. */
  tryNow: () => Promise<{ admitted: boolean; buying: number | null }>
  leave: () => Promise<void>
}

/**
 * Phase 21: join the event's purchase queue while the seat page is open,
 * then follow my place: asked every 5 seconds while waiting, and at once when
 * the server says it is my turn (WebSocket QUEUE_ADMITTED) or my turn ends.
 * Joining again never loses the place, so a reload is harmless.
 */
export function usePurchaseQueue(eventId: string | undefined, enabled: boolean): PurchaseQueue {
  const [view, setView] = useState<QueueView | undefined>(undefined)
  const [firstPlace, setFirstPlace] = useState<number | null>(null)
  const [round, setRound] = useState(0)
  const busy = useRef(false)
  const refresh = useCallback(() => setRound((n) => n + 1), [])

  // Join (or ask where I am: joining again keeps the place).
  useEffect(() => {
    if (!eventId || !enabled) return undefined
    let current = true
    busy.current = true
    joinQueue(eventId)
      .then((next) => {
        if (!current) return
        setView(next)
        if (next.state === 'WAITING') setFirstPlace((first) => first ?? next.place)
      })
      .catch(() => {
        // The seat page still works: booking answers QUEUE_TURN_REQUIRED if it must.
        if (current) setView(undefined)
      })
      .finally(() => {
        busy.current = false
      })
    return () => {
      current = false
    }
  }, [eventId, enabled, round])

  // While waiting: ask every few seconds (in case a WebSocket message is missed).
  const waiting = enabled && view?.enabled === true && view.state !== 'ACTIVE'
  useEffect(() => {
    if (!eventId || !waiting) return undefined
    const timer = setInterval(() => {
      if (busy.current) return
      getQueueStatus(eventId).then(
        (next) => (next.state === 'NONE' ? refresh() : setView(next)),
        () => undefined,
      )
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [eventId, waiting, refresh])

  // My turn: told by the server.
  useEffect(() => {
    if (!eventId || !enabled) return undefined
    return realtime.onPersonalMessage((message) => {
      if (message.type === 'QUEUE_ADMITTED' && message.eventId === eventId) refresh()
    })
  }, [eventId, enabled, refresh])

  // My turn ends: ask again (back in line, unless I hold an order meanwhile).
  const turnEndsAt = view?.state === 'ACTIVE' ? view.turnEndsAt : null
  useEffect(() => {
    if (!turnEndsAt) return undefined
    const timer = setTimeout(refresh, Math.max(0, Date.parse(turnEndsAt) - Date.now()) + 1000)
    return () => clearTimeout(timer)
  }, [turnEndsAt, refresh])

  const leave = useCallback(async () => {
    if (eventId) await leaveQueue(eventId)
  }, [eventId])

  const tryNow = useCallback(async () => {
    if (!eventId) return { admitted: false, buying: null }
    const { buying, ...next } = await tryQueueNow(eventId)
    setView(next)
    return { admitted: next.state === 'ACTIVE' || !next.enabled, buying }
  }, [eventId])

  // Switched off / signed out: nothing to wait for, whatever was last seen.
  return { view: eventId && enabled ? view : undefined, firstPlace, refresh, tryNow, leave }
}
