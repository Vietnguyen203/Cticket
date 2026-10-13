import { useCallback, useEffect, useReducer, useState } from 'react'
import { ApiError, toApiError } from '../api/errors'
import { getSeatMap } from '../api/events'
import { realtime, type ConnectionState } from './index'
import { initialSeatMapState, seatMapReducer, type LiveUpdate } from './seatMapReducer'

/**
 * The seat map of a schedule, live (docs/phase-11-web-design.md, section 6):
 * SUBSCRIBE first, and (re)load over REST each time the server confirms the
 * subscription, so nothing sent while (re)connecting is missed. The very
 * first load does not wait for the socket, in case WebSockets are blocked.
 */
export function useScheduleSeats(scheduleId: string) {
  const [state, dispatch] = useReducer(seatMapReducer, initialSeatMapState)
  const [error, setError] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
    try {
      dispatch({ type: 'loaded', map: await getSeatMap(scheduleId) })
      setError(null)
    } catch (err) {
      setError(toApiError(err))
    }
  }, [scheduleId])

  useEffect(() => {
    // Synchronises with the API and the socket; load() sets state only after an await.
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
    return realtime.subscribeSchedule(scheduleId, {
      onSubscribed: () => void load(),
      onMessage: (message) => dispatch({ type: 'live', message: message as unknown as LiveUpdate }),
    })
  }, [scheduleId, load])

  return { state, dispatch, error, reload: load }
}

/** "Trực tiếp" / "Đang kết nối lại…" badge. */
export function useRealtimeState(): ConnectionState {
  const [state, setState] = useState<ConnectionState>(() => realtime.getState())
  useEffect(() => realtime.onStateChange(setState), [])
  return state
}
