import type { UserRole } from '../types/auth'
import { sessionFetch } from './session'
export type Invitation = { id: number; email: string; role: UserRole; createdAt: string; expiresAt: string; status: 'Pending' | 'Accepted' | 'Expired' | 'Revoked' }
export type InvitationList = { invitations: Invitation[]; pagination: { page: number; totalPages: number; total: number; perPage: number } }
const errors: Record<string, string> = {
  INVITATION_INVALID: 'This invitation link is invalid.', INVITATION_EXPIRED: 'This invitation has expired. Ask an administrator for a new invitation.',
  INVITATION_USED: 'This invitation has already been accepted.', INVITATION_REVOKED: 'This invitation was revoked.',
  INVITATION_PENDING: 'A pending invitation already exists for this email.', EMAIL_ALREADY_EXISTS: 'An account already uses this email.',
  RESET_TOKEN_INVALID: 'This reset link is invalid. Request a new link.', RESET_TOKEN_EXPIRED: 'This reset link has expired. Request a new link.',
  RESET_TOKEN_USED: 'This reset link has already been used.', RESET_TOKEN_REVOKED: 'This reset link was replaced or revoked. Request a new link.',
  PASSWORD_INVALID: 'Passwords must match and contain between 12 and 512 characters.', CURRENT_PASSWORD_INVALID: 'Enter the correct current password.',
  MAIL_UNAVAILABLE: 'Email delivery is unavailable. Please try again later.', VALIDATION_ERROR: 'Check the form values and try again.',
  CSRF_ORIGIN_DENIED: 'This request origin is not allowed.',
  INVALID_ROLE: 'Choose a valid role.', AUTH_REQUIRED: 'Your session has expired. Please sign in again.', FORBIDDEN: 'Administrator access is required.',
  ACCESS_DENIED: 'Administrator access is required.', USER_NOT_FOUND: 'An active account is required.', ACCOUNT_CONFLICT: 'An account or invitation already exists.',
}
export async function lifecycleRequest(path: string, data?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const init: RequestInit = { method: data === undefined ? 'GET' : 'POST', signal }
  if (data !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(data) }
  const response = path.startsWith('/api/admin/') || path === '/api/auth/change-password'
    ? await sessionFetch(path, init) : await fetch(path, { ...init, credentials: 'include' })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const code = typeof payload === 'object' && payload !== null && 'code' in payload && typeof payload.code === 'string' ? payload.code : ''
    throw new Error(errors[code] || 'The account request could not be completed. Please try again.')
  }
  return payload
}
export async function fetchInvitations(page: number, signal?: AbortSignal): Promise<InvitationList> {
  const payload = await lifecycleRequest(`/api/admin/invitations?page=${page}&perPage=20`, undefined, signal)
  if (typeof payload !== 'object' || payload === null || !('invitations' in payload) || !Array.isArray(payload.invitations)
    || !payload.invitations.every(value => typeof value === 'object' && value !== null && typeof value.id === 'number' && typeof value.email === 'string'
      && ['student', 'teacher', 'admin'].includes(value.role) && ['Pending', 'Accepted', 'Expired', 'Revoked'].includes(value.status)
      && typeof value.createdAt === 'string' && typeof value.expiresAt === 'string') || !('pagination' in payload) || typeof payload.pagination !== 'object' || payload.pagination === null) throw new Error('Invalid invitations response.')
  const pagination = payload.pagination as Record<string, unknown>
  if (!['page', 'totalPages', 'total', 'perPage'].every(key => typeof pagination[key] === 'number' && Number.isSafeInteger(pagination[key]) && (pagination[key] as number) >= 0)) throw new Error('Invalid invitations response.')
  return payload as InvitationList
}
export const inviteUser = (email: string, role: UserRole) => lifecycleRequest('/api/admin/invitations', { email, role })
export const revokeInvitation = (id: number) => lifecycleRequest(`/api/admin/invitations/${id}/revoke`, {})
export const sendPasswordReset = (id: number) => lifecycleRequest(`/api/admin/users/${id}/password-reset`, {})
