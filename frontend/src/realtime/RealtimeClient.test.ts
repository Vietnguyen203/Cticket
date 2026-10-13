import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RealtimeClient, retryDelay, type ServerMessage, type SocketLike } from './RealtimeClient'

class FakeSocket implements SocketLike {
  readyState = 0
  sent: ServerMessage[] = []
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null

  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
  }
  // --- driven by the test ---
  open() {
    this.readyState = 1
    this.onopen?.({})
    this.receive({ type: 'WELCOME', heartbeatSeconds: 30 })
  }
  receive(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  drop() {
    this.readyState = 3
    this.onclose?.({})
  }
}

let sockets: FakeSocket[]
let token: string | null
let tokenListener: (token: string | null) => void
let refresh: ReturnType<typeof vi.fn>

function makeClient() {
  return new RealtimeClient({
    url: () => 'ws://test/ws',
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    getToken: () => token,
    refreshToken: refresh as unknown as () => Promise<string | null>,
    onTokenChange: (listener) => {
      tokenListener = listener
      return () => {}
    },
    random: () => 1, // no jitter: exact delays
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  sockets = []
  token = 'token-1'
  refresh = vi.fn(async () => {
    token = 'token-2'
    tokenListener(token)
    return token
  })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('retryDelay', () => {
  test('1 s, 2 s, 4 s… capped at 30 s, randomised to 50–100 %', () => {
    expect([0, 1, 2, 3, 10].map((attempt) => retryDelay(attempt, () => 1))).toEqual([1000, 2000, 4000, 8000, 30000])
    expect(retryDelay(0, () => 0)).toBe(500)
  })
})

describe('RealtimeClient', () => {
  test('connects on first use, authenticates, subscribes; the seat map loads once SUBSCRIBED', () => {
    const client = makeClient()
    const onSubscribed = vi.fn()
    const onMessage = vi.fn()
    client.subscribeSchedule('sch-1', { onSubscribed, onMessage })

    const socket = sockets[0]
    socket.open()
    expect(socket.sent).toEqual([
      { type: 'AUTH', token: 'token-1' },
      { type: 'SUBSCRIBE', scheduleId: 'sch-1' },
    ])
    expect(client.getState()).toBe('open')

    socket.receive({ type: 'SUBSCRIBED', scheduleId: 'sch-1' })
    expect(onSubscribed).toHaveBeenCalledTimes(1)

    const update = { type: 'SEAT_HELD', scheduleId: 'sch-1', seats: [{ seatId: 'A01', status: 'HELD', version: 2 }] }
    socket.receive(update)
    socket.receive({ ...update, scheduleId: 'other' })
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith(update)
  })

  test('after a drop: waits, reconnects, authenticates and subscribes again, then reloads', () => {
    const client = makeClient()
    const onSubscribed = vi.fn()
    client.subscribeSchedule('sch-1', { onSubscribed, onMessage: () => {} })
    sockets[0].open()
    sockets[0].receive({ type: 'SUBSCRIBED', scheduleId: 'sch-1' })

    sockets[0].drop()
    expect(client.getState()).toBe('reconnecting')
    vi.advanceTimersByTime(999)
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(2)

    sockets[1].drop() // still down: the next wait is longer
    vi.advanceTimersByTime(1999)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    sockets[2].open()
    expect(sockets[2].sent).toEqual([
      { type: 'AUTH', token: 'token-1' },
      { type: 'SUBSCRIBE', scheduleId: 'sch-1' },
    ])
    sockets[2].receive({ type: 'SUBSCRIBED', scheduleId: 'sch-1' })
    expect(onSubscribed).toHaveBeenCalledTimes(2) // → the page reloads what it missed

    sockets[2].drop() // a successful connection reset the back-off
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(4)
  })

  test('reconnectNow skips the wait (page visible again, network back)', () => {
    const client = makeClient()
    client.subscribeSchedule('sch-1', { onMessage: () => {} })
    sockets[0].open()
    sockets[0].drop()
    client.reconnectNow()
    expect(sockets).toHaveLength(2)
  })

  test('AUTH_EXPIRED: refreshes the token and authenticates again', async () => {
    const client = makeClient()
    client.onPersonalMessage(() => {})
    sockets[0].open()
    sockets[0].receive({ type: 'AUTH_EXPIRED' })
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(sockets[0].sent.at(-1)).toEqual({ type: 'AUTH', token: 'token-2' })
  })

  test('personal messages go to personal listeners, not to seat maps', () => {
    const client = makeClient()
    const personal = vi.fn()
    const onMessage = vi.fn()
    client.onPersonalMessage(personal)
    client.subscribeSchedule('sch-1', { onMessage })
    sockets[0].open()
    sockets[0].receive({ type: 'ORDER_EXPIRED', orderId: 'o-1' })
    expect(personal).toHaveBeenCalledWith({ type: 'ORDER_EXPIRED', orderId: 'o-1' })
    expect(onMessage).not.toHaveBeenCalled()
  })

  test('logout: the authenticated connection is replaced by an anonymous one', () => {
    const client = makeClient()
    client.subscribeSchedule('sch-1', { onMessage: () => {} })
    sockets[0].open()
    token = null
    tokenListener(null)
    expect(sockets[0].readyState).toBe(3)
    expect(sockets).toHaveLength(2)
    sockets[1].open()
    expect(sockets[1].sent).toEqual([{ type: 'SUBSCRIBE', scheduleId: 'sch-1' }])
  })

  test('the last unsubscribe closes the connection after a short idle time', () => {
    const client = makeClient()
    const stop = client.subscribeSchedule('sch-1', { onMessage: () => {} })
    sockets[0].open()
    stop()
    expect(sockets[0].sent.at(-1)).toEqual({ type: 'UNSUBSCRIBE', scheduleId: 'sch-1' })
    vi.advanceTimersByTime(5000)
    expect(sockets[0].readyState).toBe(3)
    expect(client.getState()).toBe('idle')
  })
})
