type AuthLocation = { pathname: string; search: string; hash: string; state?: unknown }
export type AuthOrigin = { v: 1; pathname: string; search: string; hash: string; state?: { from: string } }
export type LoginNotice = 'management' | 'tutor'
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const clean = (value: string) => !value.includes('\\') && Array.from(value).every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
const routes = [
  /^\/(?:about|contact|search|bookmarks|my-learning|progress|change-password)?$/,
  /^\/(?:research|papers)(?:\/[^/?#]+)?$/,
  /^\/brain-region\/[^/?#]+$/,
  /^\/course\/[^/?#]+(?:\/modules\/[^/?#]+)?$/,
  /^\/(?:manage|admin)$/,
  /^\/admin\/(?:users|audit-log)$/,
  /^\/manage\/(?:courses|research-areas)(?:\/[1-9]\d*)?$/,
  /^\/manage\/papers(?:\/new|\/[1-9]\d*\/(?:edit|preview))?$/,
  /^\/manage\/hub(?:\/new|\/[1-9]\d*|\/industry(?:\/new|\/[1-9]\d*)?|\/discussions(?:\/reports)?)?$/,
  /^\/innovation-hub(?:\/(?:faculty|industry)\/[1-9]\d*|\/discussions\/(?:new|manage\/[1-9]\d*|[1-9]\d*))?$/,
]

// A known application route only; never API/file/credential endpoints or an absolute URL.
export function safeAuthPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8000 || !value.startsWith('/') || value.startsWith('//') || !clean(value)) return null
  try {
    const url = new URL(value, 'https://auth-context.invalid')
    const rawPath = value.split(/[?#]/, 1)[0]
    if (url.origin !== 'https://auth-context.invalid' || url.pathname !== rawPath || !routes.some(route => route.test(url.pathname))) return null
    const decoded = decodeURIComponent(url.pathname)
    if (!clean(decoded) || decoded.split('/').some(part => part === '.' || part === '..') || /%2f/i.test(url.pathname)) return null
    if ([...url.searchParams.keys()].some(key => /^(?:password|token|secret|returnTo|next|redirect)$/i.test(key))) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch { return null }
}

export function validateAuthOrigin(value: unknown): AuthOrigin | null {
  if (!record(value) || Object.keys(value).some(k => !['v', 'pathname', 'search', 'hash', 'state'].includes(k))
    || value.v !== 1 || typeof value.pathname !== 'string' || /[?#]/.test(value.pathname)
    || typeof value.search !== 'string' || (value.search !== '' && !value.search.startsWith('?')) || value.search.includes('#')
    || typeof value.hash !== 'string' || (value.hash !== '' && !value.hash.startsWith('#'))) return null
  const path = safeAuthPath(`${value.pathname}${value.search}${value.hash}`)
  if (!path) return null
  let state: { from: string } | undefined
  if (value.state !== undefined) {
    if (!record(value.state) || Object.keys(value.state).some(k => k !== 'from')) return null
    const from = safeAuthPath(value.state.from)
    if (!from) return null
    state = { from }
  }
  return { v: 1, pathname: value.pathname, search: value.search, hash: value.hash, ...(state ? { state } : {}) }
}

export function authLoginState(location: AuthLocation, notice?: LoginNotice) {
  // Paper's existing Module/Library return state is the only non-URL task context retained.
  const from = record(location.state) ? safeAuthPath(location.state.from) : null
  const authOrigin = validateAuthOrigin({ v: 1, pathname: location.pathname, search: location.search, hash: location.hash, ...(from ? { state: { from } } : {}) })
  return { ...(authOrigin ? { authOrigin } : {}), ...(notice === 'management' ? { managementRequired: true } : notice === 'tutor' ? { authRequired: true } : {}) }
}

export function loginReturn(value: unknown): { path: string; state?: { from: string } } {
  if (!record(value)) return { path: '/' }
  if ('authOrigin' in value) {
    const origin = validateAuthOrigin(value.authOrigin)
    return origin ? { path: `${origin.pathname}${origin.search}${origin.hash}`, ...(origin.state ? { state: origin.state } : {}) } : { path: '/' }
  }
  // Compatibility for existing callers; new entries all use the structured contract.
  return { path: safeAuthPath(value.from) ?? '/' }
}
