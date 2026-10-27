import { api, unwrap } from './client'
import type { User } from './types'

export interface ProfileChanges {
  firstName?: string
  lastName?: string
  phone?: string | null
  /** Phase 18.2 */
  eventReminders?: boolean
}

export async function getMe(): Promise<User> {
  return (await unwrap<{ user: User }>(api.get('/users/me'))).user
}

export async function updateMe(changes: ProfileChanges): Promise<User> {
  return (await unwrap<{ user: User }>(api.patch('/users/me', changes))).user
}

/** Everything ETP holds about me (Luật Bảo vệ dữ liệu cá nhân), saved by the page as a JSON file. */
export async function exportMyData(): Promise<{ exportedAt: string } & Record<string, unknown>> {
  return (await unwrap<{ data: { exportedAt: string } & Record<string, unknown> }>(api.get('/users/me/data'))).data
}

/** Why my account cannot be deleted now (none: it can). */
export type DeletionBlocker = 'ADMIN' | 'ORGANIZER_EVENTS' | 'OPEN_ORDER' | 'UPCOMING_TICKETS' | 'PENDING_REFUND'

export async function getDeletionCheck(): Promise<{ allowed: boolean; reasons: DeletionBlocker[] }> {
  return (await unwrap<{ deletion: { allowed: boolean; reasons: DeletionBlocker[] } }>(api.get('/users/me/deletion'))).deletion
}

/** Not undoable: personal data removed, every session ended. */
export async function deleteMyAccount(password: string): Promise<void> {
  await api.delete('/users/me', { data: { password } })
}
