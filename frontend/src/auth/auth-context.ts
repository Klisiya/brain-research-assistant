import { createContext } from 'react'
import type { AuthUser } from '../types/auth'
export type AuthState =
  | { status: 'loading' | 'anonymous' | 'unavailable'; user: null }
  | { status: 'authenticated'; user: AuthUser }
export type AuthContextValue = {
  state: AuthState
  refreshAuth: () => Promise<void>
  signIn: (email: string, password: string, remember: boolean) => Promise<void>
  signOut: () => Promise<void>
}
export const AuthContext = createContext<AuthContextValue | null>(null)
