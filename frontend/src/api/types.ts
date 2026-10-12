/** Shapes returned by the API, written by hand from the backend's responses. */

export type Role = 'CUSTOMER' | 'ORGANIZER' | 'STAFF' | 'ADMIN'

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string | null
  status: string
  emailVerifiedAt: string | null
  createdAt: string
  roles?: Role[]
  permissions?: string[]
}

export interface LoginResult {
  tokenType: 'Bearer'
  accessToken: string
  expiresIn: number
  user: User
}

export type OtpPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'

export interface PageMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}
