export type UserRole = 'user' | 'teacher' | 'admin'

export type AuthUser = {
  id: number
  username: string
  email: string
  role: UserRole
}

export type AuthMePayload =
  | { authenticated: false; user: null }
  | { authenticated: true; user: AuthUser }
