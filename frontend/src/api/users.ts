import { api, unwrap } from './client'
import type { User } from './types'

export interface ProfileChanges {
  firstName?: string
  lastName?: string
  phone?: string | null
}

export async function getMe(): Promise<User> {
  return (await unwrap<{ user: User }>(api.get('/users/me'))).user
}

export async function updateMe(changes: ProfileChanges): Promise<User> {
  return (await unwrap<{ user: User }>(api.patch('/users/me', changes))).user
}
