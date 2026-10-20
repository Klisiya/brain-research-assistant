import type { AuthUser, UserRole } from '../../types/auth'

// A small, account-bound list description, never a user-provided return URL.
export const MANAGEMENT_ORIGIN = 'managementOrigin'
export type ManagementKind = 'faculty' | 'industry' | 'discussions' | 'reports' | 'papers'
export type ManagementOrigin = {
  v: 1; accountId: number; role: UserRole; kind: ManagementKind; scope: string; page: number
  selectedId?: number; status?: string; q?: string; sort?: string
}
export const paperSorts = ['recommended', 'newest', 'oldest', 'readingTime', 'title'] as const
export const paperStatuses = ['all', 'draft', 'published', 'archived'] as const
const scopes: Record<ManagementKind, readonly string[]> = {
  faculty: ['mine', 'review', 'published'], industry: ['mine', 'review', 'all', 'published'],
  discussions: ['review', 'published', 'mine', 'all'], reports: ['reports'], papers: ['managed'],
}
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
export function listPage(value: string | null) {
  return value && /^[1-9]\d{0,4}$/.test(value) && Number(value) <= 10000 ? Number(value) : 1
}
const safeQuery = (v: unknown): v is string => typeof v === 'string' && v.length <= 200 && Array.from(v).every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)

export function validateManagementOrigin(value: unknown, user: AuthUser, allowed: readonly ManagementKind[]): ManagementOrigin | null {
  if (!user.isActive || typeof value !== 'object' || !value || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (v.v !== 1 || v.accountId !== user.id || v.role !== user.role || !positive(v.accountId)
    || typeof v.kind !== 'string' || !allowed.includes(v.kind as ManagementKind)) return null
  const kind = v.kind as ManagementKind
  const keys = ['v', 'accountId', 'role', 'kind', 'scope', 'page', 'selectedId', ...(kind === 'papers' ? ['q', 'status', 'sort'] : kind === 'reports' ? ['status'] : [])]
  if (Object.keys(v).some(key => !keys.includes(key)) || typeof v.scope !== 'string' || !scopes[kind].includes(v.scope)
    || !positive(v.page) || v.page > 10000 || (v.selectedId !== undefined && !positive(v.selectedId))) return null
  if (user.role === 'student' || ((kind === 'reports' || kind === 'discussions' || ['review', 'all'].includes(v.scope)) && user.role !== 'admin')) return null
  if (kind === 'reports' && !['open', 'resolved', 'dismissed', 'all'].includes(String(v.status))) return null
  if (kind === 'papers' && (!safeQuery(v.q) || !paperStatuses.includes(v.status as typeof paperStatuses[number]) || !paperSorts.includes(v.sort as typeof paperSorts[number]))) return null
  // Rebuild rather than retaining an untrusted object's extra fields/prototype.
  return { v: 1, accountId: user.id, role: user.role, kind, scope: v.scope, page: v.page,
    ...(v.selectedId === undefined ? {} : { selectedId: v.selectedId as number }),
    ...(kind === 'reports' ? { status: v.status as string } : {}),
    ...(kind === 'papers' ? { q: v.q as string, status: v.status as string, sort: v.sort as string } : {}) }
}
export function readManagementOrigin(search: string, user: AuthUser, allowed: readonly ManagementKind[]) {
  const params = new URLSearchParams(search), values = params.getAll(MANAGEMENT_ORIGIN)
  if (values.length !== 1 || values[0].length > 1500) return null
  try { return validateManagementOrigin(JSON.parse(values[0]), user, allowed) } catch { return null }
}
export function makeManagementOrigin(user: AuthUser, kind: ManagementKind, params: URLSearchParams, selectedId?: number) {
  return validateManagementOrigin({ v: 1, accountId: user.id, role: user.role, kind,
    scope: params.get('scope') ?? (kind === 'reports' ? 'reports' : kind === 'papers' ? 'managed' : 'mine'), page: listPage(params.get('page')),
    ...(selectedId === undefined ? {} : { selectedId }),
    ...(kind === 'reports' ? { status: params.get('status') ?? 'open' } : {}),
    ...(kind === 'papers' ? { q: params.get('q') ?? '', status: params.get('status') ?? 'all', sort: params.get('sort') ?? 'recommended' } : {}),
  }, user, [kind])
}
export function withManagementOrigin(path: string, origin: ManagementOrigin | null) {
  if (!origin) return path
  const [pathname, search = ''] = path.split('?'), params = new URLSearchParams(search)
  params.set(MANAGEMENT_ORIGIN, JSON.stringify(origin))
  return `${pathname}?${params}`
}
export function managementReturn(origin: ManagementOrigin) {
  const { kind, scope, page } = origin
  const params = new URLSearchParams(), row = origin.selectedId
  let path: string, label: string
  if (kind === 'papers') {
    path = '/manage/papers'; label = 'Back to papers management'
    params.set('q', origin.q!); params.set('status', origin.status!); params.set('sort', origin.sort!)
    params.set('account', `${origin.accountId}:${origin.role}`)
  } else if (kind === 'reports') {
    path = '/manage/hub/discussions'; label = 'Back to reports'
    params.set('scope', 'reports'); params.set('status', origin.status!)
  } else if (kind === 'discussions') {
    path = '/manage/hub/discussions'; params.set('scope', scope)
    label = scope === 'review' ? 'Back to review queue' : scope === 'mine' ? 'Back to my discussions' : scope === 'all' ? 'Back to all discussions' : 'Back to published threads'
  } else {
    const faculty = kind === 'faculty'
    path = scope === 'published' ? '/innovation-hub' : faculty ? '/manage/hub' : '/manage/hub/industry'
    if (scope === 'published') params.set('view', kind)
    else params.set('scope', scope)
    label = scope === 'published' ? `Back to published ${faculty ? 'resources' : 'updates'}`
      : scope === 'review' ? faculty ? 'Back to all resources / review' : 'Back to review queue'
      : scope === 'all' ? 'Back to all updates' : faculty ? 'Back to my resources' : 'Back to my updates'
  }
  params.set('page', String(page))
  return { path: `${path}?${params}${row ? `#${kind}-${row}` : ''}`, label }
}

export function readPaperListFilters(params: URLSearchParams, user: AuthUser) {
  const defaults = { q: '', status: 'all' as typeof paperStatuses[number], sort: 'recommended' as typeof paperSorts[number], page: 1 }
  // URLs produced by this workspace discard a previous account's private filter on switch.
  if (params.has('account') && params.get('account') !== `${user.id}:${user.role}`) return defaults
  if ([...params.keys()].some(k => !['q', 'status', 'sort', 'page', 'account'].includes(k) || params.getAll(k).length !== 1)) return defaults
  return { q: safeQuery(params.get('q') ?? '') ? (params.get('q') ?? '').trim() : '',
    status: paperStatuses.includes(params.get('status') as typeof paperStatuses[number]) ? params.get('status') as typeof paperStatuses[number] : defaults.status,
    sort: paperSorts.includes(params.get('sort') as typeof paperSorts[number]) ? params.get('sort') as typeof paperSorts[number] : defaults.sort,
    page: listPage(params.get('page')) }
}
