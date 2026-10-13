/**
 * Is this page load a "fresh open" after every tab of the site was closed?
 *
 * - A reload keeps sessionStorage (per tab): the mark is there → not fresh.
 * - A new tab while another tab of the site is open: that tab answers the
 *   ping on the BroadcastChannel → not fresh.
 * - Otherwise the user closed the site and came back → fresh: without
 *   "remember me", they must log in again.
 */
const MARK = 'etp-tab-open'
const ANSWER_WAIT_MS = 300

export type PresenceMessage = { type: 'ping' } | { type: 'pong' }

function reloadedTab(): boolean {
  try {
    const seen = sessionStorage.getItem(MARK) === '1'
    sessionStorage.setItem(MARK, '1')
    return seen
  } catch {
    return true // storage blocked: never log out because of it
  }
}

export async function isFreshOpen(channel: BroadcastChannel | null): Promise<boolean> {
  if (reloadedTab() || !channel) return false
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent<PresenceMessage>) => {
      if (event.data?.type !== 'pong') return
      channel.removeEventListener('message', onMessage)
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      channel.removeEventListener('message', onMessage)
      resolve(true)
    }, ANSWER_WAIT_MS)
    channel.addEventListener('message', onMessage)
    channel.postMessage({ type: 'ping' } satisfies PresenceMessage)
  })
}
