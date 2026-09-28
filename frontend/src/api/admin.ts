import type { AuthUser, UserRole } from '../types/auth'
import { isAuthUser } from './auth'
import { sessionFetch } from './session'
export type AdminUser = AuthUser & { createdAt: string | null; lastLoginAt: string | null }
export type UserFilters = { q: string; role: UserRole | ''; status: 'active' | 'disabled' | ''; page: number }
export type Pagination = { page: number; perPage: number; total: number; totalPages: number }
export type AdminUsersResponse = { users: AdminUser[]; pagination: Pagination; filters: { q: string; role: UserRole | null; status: 'active' | 'disabled' | null; sort: string } }
export type AccountAuditEntry = { id: number; actor: { id: number; username: string } | null; target: { id: number; username: string } | null; action: string; createdAt: string; details: Partial<Record<'oldRole' | 'newRole' | 'oldStatus' | 'newStatus', string>> & { invitationId?: number } }
const messages: Record<string, string> = {
  IMPORT_INVALID: 'Use a UTF-8 CSV with email, username (or display_name), role columns and 1 to 100 rows. Password columns are not allowed.', REQUEST_TOO_LARGE: 'CSV files must be no larger than 128 KiB.',
  AUTH_REQUIRED: 'Your session has expired. Please sign in again.',
  ACCESS_DENIED: 'You do not have permission to manage accounts.',
  FORBIDDEN: 'You do not have permission to manage accounts.',
  LAST_ACTIVE_ADMIN: 'At least one active administrator must remain.',
  USER_NOT_FOUND: 'This user no longer exists. Refresh the user list.',
  VALIDATION_ERROR: 'Check the search and filter values and try again.',
  INVALID_ROLE: 'Choose a valid account role.',
  ACCOUNT_UNAVAILABLE: 'Account service is temporarily unavailable. Please try again.',
}
export class AdminApiError extends Error {
  status: number
  code: string | null
  constructor(status: number, code: string | null) {
    super(code && messages[code] || 'Unable to complete the account request. Please try again.')
    this.status = status
    this.code = code
  }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function nullableString(value: unknown) { return value === null || typeof value === 'string' }
function isUser(value: unknown): value is AdminUser { return record(value) && nullableString(value.createdAt) && nullableString(value.lastLoginAt) && isAuthUser(value) }
function isPagination(value: unknown): value is Pagination {
  return record(value) && ['page', 'perPage', 'total', 'totalPages'].every(key => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && (value[key] as number) >= (key === 'page' || key === 'perPage' ? 1 : 0))
}
async function request(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await sessionFetch(`/api/admin/${path}`, options)
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new AdminApiError(response.status, record(payload) && typeof payload.code === 'string' ? payload.code : null)
  return payload
}
export async function fetchAdminUsers(filters: UserFilters, signal?: AbortSignal): Promise<AdminUsersResponse> {
  const query = new URLSearchParams({ q: filters.q, page: String(filters.page), perPage: '20' })
  if (filters.role) query.set('role', filters.role)
  if (filters.status) query.set('status', filters.status)
  const payload = await request(`users?${query}`, { signal })
  if (!record(payload) || !Array.isArray(payload.users) || !payload.users.every(isUser) || !isPagination(payload.pagination) || !record(payload.filters)
    || typeof payload.filters.q !== 'string' || ![null, 'student', 'teacher', 'admin'].includes(payload.filters.role as string | null)
    || ![null, 'active', 'disabled'].includes(payload.filters.status as string | null) || typeof payload.filters.sort !== 'string') throw new AdminApiError(502, null)
  return payload as AdminUsersResponse
}
async function userRequest(path: string, options?: RequestInit) {
  const payload = await request(path, options)
  if (!record(payload) || !isUser(payload.user)) throw new AdminApiError(502, null)
  return payload.user
}
export const fetchAdminUser = (id: number, signal?: AbortSignal) => userRequest(`users/${id}`, { signal })
export const changeUserRole = (id: number, role: UserRole) => userRequest(`users/${id}/role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) })
export const disableUser = (id: number) => userRequest(`users/${id}/disable`, { method: 'POST' })
export const enableUser = (id: number) => userRequest(`users/${id}/enable`, { method: 'POST' })
export function adminErrorMessage(error: unknown) { return error instanceof AdminApiError ? error.message : 'Account service could not be reached. Please try again.' }

export type ImportResult = { row: number; status: 'invited' | 'failed'; invitationId?: number; code?: string; error?: string }
export async function importUsers(file: File): Promise<{ results: ImportResult[]; invited: number; failed: number }> {
  const data = new FormData(); data.append('file', file)
  const payload = await request('users/import', { method: 'POST', body: data })
  if (!record(payload) || !Array.isArray(payload.results) || !payload.results.every(row => record(row) && Number.isSafeInteger(row.row) && ['invited', 'failed'].includes(String(row.status)) && (row.error === undefined || typeof row.error === 'string')) || typeof payload.invited !== 'number' || typeof payload.failed !== 'number') throw new AdminApiError(502, null)
  return payload as { results: ImportResult[]; invited: number; failed: number }
}
function person(value: unknown) { return value === null || (record(value) && Number.isSafeInteger(value.id) && typeof value.username === 'string') }
export async function fetchAudit(params: URLSearchParams, signal?: AbortSignal): Promise<{ logs: AccountAuditEntry[]; pagination: Pagination }> {
  const payload = await request(`audit-logs?${params}`, { signal })
  if (!record(payload) || !Array.isArray(payload.logs) || !payload.logs.every(log => record(log) && Number.isSafeInteger(log.id) && person(log.actor) && person(log.target) && typeof log.action === 'string' && typeof log.createdAt === 'string' && record(log.details)) || !isPagination(payload.pagination)) throw new AdminApiError(502, null)
  return payload as { logs: AccountAuditEntry[]; pagination: Pagination }
}
