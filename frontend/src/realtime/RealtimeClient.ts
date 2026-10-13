/**
 * One WebSocket per tab to the API's /ws (Phase 7 protocol), shared by every
 * page: seat maps subscribe to their schedule, other pages listen to the
 * user's personal messages (order expired, payment, ticket issued…).
 *
 * WebSocket is only a fast notification channel, never the source of truth:
 * after any reconnect the page reloads its data over REST, because messages
 * sent while the connection was down are gone.
 */

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting'

export interface ServerMessage {
  type: string
  [key: string]: unknown
}

export interface ScheduleHandlers {
  /** The server confirmed the subscription: (re)load the seat map now, so no update is missed. */
  onSubscribed?: () => void
  onMessage: (message: ServerMessage) => void
}

/** The subset of the browser WebSocket used here (a fake one in tests). */
export interface SocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
}

export interface RealtimeOptions {
  url: () => string
  createSocket: (url: string) => SocketLike
  getToken: () => string | null
  refreshToken: () => Promise<string | null>
  onTokenChange: (listener: (token: string | null) => void) => () => void
  random?: () => number
  /** How long to keep an unused connection open (page changes re-use it). */
  idleCloseMs?: number
}

const OPEN = 1
const FIRST_RETRY_MS = 1000
const MAX_RETRY_MS = 30_000
const NORMAL_CLOSURE = 1000

/** Seat map messages, routed to the subscribers of their schedule. */
const SCHEDULE_MESSAGES = new Set(['SEAT_HELD', 'SEAT_RELEASED', 'SEAT_SOLD', 'SEAT_BLOCKED', 'INVENTORY_UPDATED'])
/** Protocol replies, handled here. Anything else is a personal message for the signed-in user. */
const PROTOCOL_MESSAGES = new Set(['WELCOME', 'AUTH_OK', 'AUTH_EXPIRED', 'SUBSCRIBED', 'UNSUBSCRIBED', 'ERROR'])

/**
 * Wait before reconnect attempt n (0, 1, 2…): 1 s, 2 s, 4 s… up to 30 s, each
 * randomised to 50–100 %. Without the randomness, every browser dropped by a
 * server restart would come back in the same second and knock it over again.
 */
export function retryDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** attempt)
  return Math.round(base * (0.5 + random() / 2))
}

export class RealtimeClient {
  private readonly options: RealtimeOptions
  private socket: SocketLike | null = null
  private state: ConnectionState = 'idle'
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly schedules = new Map<string, Set<ScheduleHandlers>>()
  private readonly confirmed = new Set<string>()
  private readonly personal = new Set<(message: ServerMessage) => void>()
  private readonly stateListeners = new Set<(state: ConnectionState) => void>()
  /** The token this connection is authenticated with (null: anonymous). */
  private authToken: string | null = null
  private authRetried = false

  constructor(options: RealtimeOptions) {
    this.options = options
    options.onTokenChange((token) => this.tokenChanged(token))
  }

  getState(): ConnectionState {
    return this.state
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  /** Follow a schedule's seat map. @returns unsubscribe */
  subscribeSchedule(scheduleId: string, handlers: ScheduleHandlers): () => void {
    let handlerSet = this.schedules.get(scheduleId)
    if (!handlerSet) {
      handlerSet = new Set()
      this.schedules.set(scheduleId, handlerSet)
      this.send({ type: 'SUBSCRIBE', scheduleId })
    } else if (this.confirmed.has(scheduleId)) {
      queueMicrotask(() => handlers.onSubscribed?.())
    }
    handlerSet.add(handlers)
    this.use()

    return () => {
      handlerSet.delete(handlers)
      if (handlerSet.size === 0 && this.schedules.get(scheduleId) === handlerSet) {
        this.schedules.delete(scheduleId)
        this.confirmed.delete(scheduleId)
        this.send({ type: 'UNSUBSCRIBE', scheduleId })
      }
      this.releaseIfUnused()
    }
  }

  /** Personal messages of the signed-in user (needs a token). @returns stop listening */
  onPersonalMessage(listener: (message: ServerMessage) => void): () => void {
    this.personal.add(listener)
    this.use()
    return () => {
      this.personal.delete(listener)
      this.releaseIfUnused()
    }
  }

  /** The page became visible again / the network is back: do not wait for the back-off timer. */
  reconnectNow(): void {
    if (!this.hasConsumers() || this.state === 'open' || this.state === 'connecting') return
    this.clearRetry()
    this.connect()
  }

  // --- connection -----------------------------------------------------------

  private use(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.state === 'idle') this.connect()
  }

  private hasConsumers(): boolean {
    return this.schedules.size > 0 || this.personal.size > 0
  }

  private releaseIfUnused(): void {
    if (this.hasConsumers() || this.idleTimer) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (!this.hasConsumers()) this.shutdown()
    }, this.options.idleCloseMs ?? 5000)
  }

  private shutdown(): void {
    this.clearRetry()
    const socket = this.socket
    this.socket = null
    this.confirmed.clear()
    this.authToken = null
    socket?.close(NORMAL_CLOSURE, 'Not needed')
    this.setState('idle')
  }

  private connect(): void {
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const socket = this.options.createSocket(this.options.url())
    this.socket = socket
    socket.onopen = () => {
      if (this.socket !== socket) return
      this.authRetried = false
      this.authenticate(this.options.getToken())
      for (const scheduleId of this.schedules.keys()) this.send({ type: 'SUBSCRIBE', scheduleId })
    }
    socket.onmessage = (event) => {
      if (this.socket === socket) this.receive(event.data)
    }
    socket.onclose = () => {
      if (this.socket === socket) this.lost()
    }
    socket.onerror = () => {
      // Always followed by onclose.
    }
  }

  private lost(): void {
    this.socket = null
    this.confirmed.clear()
    this.authToken = null
    if (!this.hasConsumers()) {
      this.setState('idle')
      return
    }
    this.setState('reconnecting')
    const delay = retryDelay(this.attempt, this.options.random)
    this.attempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  // --- messages -------------------------------------------------------------

  private receive(raw: unknown): void {
    let message: ServerMessage
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (SCHEDULE_MESSAGES.has(message.type)) {
      this.schedules.get(String(message.scheduleId))?.forEach((handlers) => handlers.onMessage(message))
      return
    }
    if (!PROTOCOL_MESSAGES.has(message.type)) {
      this.personal.forEach((listener) => listener(message))
      return
    }
    switch (message.type) {
      case 'WELCOME':
        this.attempt = 0
        this.setState('open')
        break
      case 'SUBSCRIBED': {
        const scheduleId = String(message.scheduleId)
        this.confirmed.add(scheduleId)
        this.schedules.get(scheduleId)?.forEach((handlers) => handlers.onSubscribed?.())
        break
      }
      case 'AUTH_EXPIRED':
        void this.renewAuth()
        break
      case 'ERROR':
        // The AUTH we sent was refused (token expired between two checks): renew once.
        if ((message.code === 'TOKEN_EXPIRED' || message.code === 'UNAUTHENTICATED') && !this.authRetried) {
          this.authRetried = true
          void this.renewAuth()
        }
        break
      default:
        break
    }
  }

  private async renewAuth(): Promise<void> {
    this.authToken = null
    // A new token reaches tokenChanged(), which sends AUTH again.
    await this.options.refreshToken().catch(() => null)
  }

  private tokenChanged(token: string | null): void {
    if (!this.socket || this.socket.readyState !== OPEN) return
    if (token) {
      this.authenticate(token)
    } else if (this.authToken) {
      // Logged out: this connection still receives that user's messages. Start a fresh, anonymous one.
      const socket = this.socket
      this.socket = null
      socket.close(NORMAL_CLOSURE, 'Logged out')
      this.lost()
      this.reconnectNow()
    }
  }

  private authenticate(token: string | null): void {
    if (!token || token === this.authToken) return
    this.authToken = token
    this.send({ type: 'AUTH', token })
  }

  private send(message: object): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message))
  }

  private setState(state: ConnectionState): void {
    if (state === this.state) return
    this.state = state
    this.stateListeners.forEach((listener) => listener(state))
  }
}
