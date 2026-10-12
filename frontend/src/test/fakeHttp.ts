import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'

/** A response from a fake server, for axios `adapter` in tests. */
export function reply(config: InternalAxiosRequestConfig, status: number, data: unknown) {
  const response = { data, status, statusText: String(status), headers: {}, config }
  if (status < 400) return Promise.resolve(response)
  return Promise.reject(new AxiosError(`HTTP ${status}`, 'ERR_BAD_RESPONSE', config, null, response))
}

/** The API error envelope. */
export const apiError = (code: string) => ({ success: false, error: { code, message: code } })

/** A connection failure: no response at all. */
export function networkDown(config: InternalAxiosRequestConfig) {
  return Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config, null))
}

/** An adapter that records every request it receives. */
export function recordingAdapter(handle: AxiosAdapter) {
  const calls: InternalAxiosRequestConfig[] = []
  const adapter: AxiosAdapter = (config) => {
    calls.push(config)
    return handle(config)
  }
  return { adapter, calls }
}

/** An unsigned JWT that expires `inSeconds` from now (the web only reads the payload). */
export function fakeJwt(inSeconds: number, roles: string[] = ['CUSTOMER']): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${encode({ alg: 'none' })}.${encode({ sub: 'user-1', roles, exp: Math.floor(Date.now() / 1000) + inSeconds })}.sig`
}
