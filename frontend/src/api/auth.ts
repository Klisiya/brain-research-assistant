import { apiFetch } from './request'
import type { AuthMePayload, AuthUser, UserRole } from '../types/auth'

const USER_ROLES: readonly UserRole[] = ['student', 'teacher', 'admin']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAuthUser(value: unknown): value is AuthUser {
  return isRecord(value)
    && typeof value.id === 'number'
    && Number.isSafeInteger(value.id)
    && value.id > 0
    && typeof value.username === 'string'
    && typeof value.email === 'string'
    && USER_ROLES.includes(value.role as UserRole)
    && typeof value.isActive === 'boolean'
}

function isAuthMePayload(value: unknown): value is AuthMePayload {
  return isRecord(value)
    && (
      (value.authenticated === false && value.user === null)
      || (value.authenticated === true && isAuthUser(value.user))
    )
}

export async function fetchAuthMe({ signal }: { signal?: AbortSignal } = {}) {
  const response = await apiFetch('/api/auth/me', {
    credentials: 'include',
    signal,
  })

  if (response.status === 401) return { authenticated: false, user: null } as const

  if (!response.ok) {
    throw new Error(`Authentication request failed with status ${response.status}`)
  }

  const payload: unknown = await response.json()

  if (!isAuthMePayload(payload)) {
    throw new Error('Invalid authentication response')
  }

  return payload
}

export class AuthLoginError extends Error {}

export async function login(email: string, password: string, remember: boolean): Promise<AuthUser> {
  try {
  const response = await apiFetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, remember }) })
  if (!response.ok) throw new AuthLoginError(response.status === 401 ? 'Invalid email or password.' : response.status === 429 ? 'Too many sign-in attempts. Please try again later.' : 'Unable to sign in right now. Please try again.')
  const payload: unknown = await response.json()
  if (!isAuthMePayload(payload) || !payload.authenticated) throw new AuthLoginError('Unable to sign in right now. Please try again.')
  return payload.user
  } catch (error) {
    if (error instanceof AuthLoginError) throw error
    throw new AuthLoginError('Unable to sign in right now. Please try again.')
  }
}
export async function logout() {
  const response = await apiFetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  if (!response.ok) throw new Error('Unable to sign out. Please try again.')
}
