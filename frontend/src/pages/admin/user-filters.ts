import type { UserFilters } from '../../api/admin'
import type { UserRole } from '../../types/auth'
export function readUserFilters(params: URLSearchParams): UserFilters {
  const role = params.get('role') || ''
  const status = params.get('status') || ''
  const rawPage = params.get('page') || '1'
  const page = /^\d+$/.test(rawPage) ? Number(rawPage) : 1
  return { q: (params.get('q') || '').trim().slice(0, 200), role: ['student', 'teacher', 'admin'].includes(role) ? role as UserRole : '', status: status === 'active' || status === 'disabled' ? status : '', page: Number.isSafeInteger(page) && page >= 1 && page <= 1000000 ? page : 1 }
}
export function userFilterParams(filters: UserFilters) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.role) params.set('role', filters.role)
  if (filters.status) params.set('status', filters.status)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}
