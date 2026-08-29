import type { AuthMePayload, AuthUser, UserRole } from '../types/auth'

const USER_ROLES: readonly UserRole[] = ['user', 'teacher', 'admin']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAuthUser(value: unknown): value is AuthUser {
  return isRecord(value)
    && typeof value.id === 'number'
    && Number.isFinite(value.id)
    && typeof value.username === 'string'
    && typeof value.email === 'string'
    && USER_ROLES.includes(value.role as UserRole)
}

function isAuthMePayload(value: unknown): value is AuthMePayload {
  return isRecord(value)
    && (
      (value.authenticated === false && value.user === null)
      || (value.authenticated === true && isAuthUser(value.user))
    )
}

export async function fetchAuthMe({ signal }: { signal?: AbortSignal } = {}) {
  const response = await fetch('/api/auth/me', {
    credentials: 'include',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Authentication request failed with status ${response.status}`)
  }

  const payload: unknown = await response.json()

  if (!isAuthMePayload(payload)) {
    throw new Error('Invalid authentication response')
  }

  return payload
}
