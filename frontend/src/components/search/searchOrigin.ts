import { parseSearchUrl, searchPath, type SearchParams } from '../../api/search'
import type { AuthState } from '../../auth/auth-context'

export const SEARCH_ORIGIN = 'searchOrigin'
export type SearchOrigin = SearchParams & {
  v: 1; pathname: '/search'; accountId: number | null; role: string | null
}

export function validateSearchOrigin(value: unknown, auth: AuthState): SearchOrigin | null {
  if (auth.status !== 'anonymous' && auth.status !== 'authenticated') return null
  if (typeof value !== 'object' || !value || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(k => !['v', 'pathname', 'q', 'type', 'page', 'accountId', 'role'].includes(k))
    || v.v !== 1 || v.pathname !== '/search' || typeof v.q !== 'string' || !v.q.trim()
    || typeof v.type !== 'string' || !Number.isSafeInteger(v.page) || (v.page as number) < 1) return null
  const accountId = auth.status === 'authenticated' ? auth.user.id : null
  const role = auth.status === 'authenticated' ? auth.user.role : null
  if (v.accountId !== accountId || v.role !== role || (auth.status === 'authenticated' && !auth.user.isActive)) return null
  const { params, invalid } = parseSearchUrl(new URLSearchParams({ q: v.q, type: v.type, page: String(v.page) }))
  if (invalid || (params.type === 'hub' && auth.status !== 'authenticated')) return null
  return { v: 1, pathname: '/search', ...params, accountId, role }
}

export function makeSearchOrigin(query: URLSearchParams, auth: AuthState) {
  const { params, invalid } = parseSearchUrl(query)
  if (invalid) return null
  return validateSearchOrigin({ v: 1, pathname: '/search', ...params,
    accountId: auth.status === 'authenticated' ? auth.user.id : null,
    role: auth.status === 'authenticated' ? auth.user.role : null }, auth)
}

export function readSearchOrigin(search: string, auth: AuthState) {
  const values = new URLSearchParams(search).getAll(SEARCH_ORIGIN)
  if (values.length !== 1 || values[0].length > 1500) return null
  try { return validateSearchOrigin(JSON.parse(values[0]), auth) } catch { return null }
}

// Only called with the existing, typed Search result destination. Never accept a return URL.
export function withSearchOrigin(path: string, origin: SearchOrigin | null) {
  if (!origin) return path
  const [base, hash] = path.split('#'), [pathname, search] = base.split('?')
  const params = new URLSearchParams(search)
  params.set(SEARCH_ORIGIN, JSON.stringify(origin))
  return `${pathname}?${params}${hash === undefined ? '' : `#${hash}`}`
}

export function searchReturn(origin: SearchOrigin) {
  return { path: searchPath(origin.q, origin.type, origin.page), label: 'Back to search results' }
}
