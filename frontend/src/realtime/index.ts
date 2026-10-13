import { getAccessToken, onAccessTokenChange, refreshAccessToken } from '../auth/session'
import { RealtimeClient, type SocketLike } from './RealtimeClient'

/** Same origin as the page: Vite (dev) or nginx (Docker) forwards /ws to the API. */
const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

export const realtime = new RealtimeClient({
  url: wsUrl,
  createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  getToken: getAccessToken,
  refreshToken: refreshAccessToken,
  onTokenChange: onAccessTokenChange,
})

// A sleeping laptop or a phone switching networks often drops the socket
// silently: check again as soon as the page is visible / the network is back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') realtime.reconnectNow()
})
window.addEventListener('online', () => realtime.reconnectNow())

export type { ConnectionState, ServerMessage } from './RealtimeClient'
