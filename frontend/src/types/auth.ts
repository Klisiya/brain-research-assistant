export type UserRole = 'student' | 'teacher' | 'admin'

export type AuthUser = {
  id: number
  username: string
  email: string
  role: UserRole
  isActive?: boolean
}

export type AuthMePayload =
  | { authenticated: false; user: null }
  | { authenticated: true; user: AuthUser }
