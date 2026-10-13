import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, toApiError } from '../api/errors'

export interface AsyncState<T> {
  /** The latest data; while a new request runs, the previous data stays visible. */
  data: T | undefined
  error: ApiError | null
  loading: boolean
  reload: () => void
}

interface Result<T> {
  key: string | null
  round: number
  data: T | undefined
  error: ApiError | null
}

/**
 * Load data for a page. `key` names what is loaded (e.g. the search filters
 * as a string): when it changes, `load` runs again. Only the answer to the
 * LATEST request is kept: if the user types fast, an older, slower response
 * cannot overwrite a newer one.
 */
export function useAsync<T>(load: () => Promise<T>, key: string): AsyncState<T> {
  const loadRef = useRef(load)
  const [round, setRound] = useState(0)
  const [result, setResult] = useState<Result<T>>({ key: null, round: 0, data: undefined, error: null })

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    let current = true
    loadRef.current().then(
      (data) => {
        if (current) setResult({ key, round, data, error: null })
      },
      (err: unknown) => {
        if (current) setResult((previous) => ({ key, round, data: previous.data, error: toApiError(err) }))
      },
    )
    return () => {
      current = false // a newer request (or unmount) wins
    }
  }, [key, round])

  const reload = useCallback(() => setRound((n) => n + 1), [])

  return {
    data: result.data,
    error: result.key === key && result.round === round ? result.error : null,
    loading: result.key !== key || result.round !== round,
    reload,
  }
}
