let pendingToken: Promise<string> | null = null
function csrfToken(): Promise<string> {
  if (!pendingToken) {
    pendingToken = fetch('/api/auth/csrf', { credentials: 'include', cache: 'no-store' }).then(async response => {
      const body: unknown = await response.json()
      if (!response.ok || typeof body !== 'object' || body === null || !('csrfToken' in body) || typeof body.csrfToken !== 'string') throw new Error('Unable to secure this request. Please try again.')
      return body.csrfToken
    }).finally(() => { pendingToken = null })
  }
  return pendingToken
}
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const original = new Request(new URL(input instanceof Request ? input.url : String(input), window.location.origin), input instanceof Request ? input : undefined)
  const prepared = new Request(original, init)
  if (new URL(prepared.url).origin !== window.location.origin) throw new Error('Account requests must use the same origin.')
  if (['GET', 'HEAD', 'OPTIONS'].includes(prepared.method)) return fetch(prepared, { credentials: 'include' })
  // Retry only a rejected CSRF check: the server has not run the mutation in this case.
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = new Headers(prepared.headers)
    headers.set('X-CSRF-Token', await csrfToken())
    const response = await fetch(prepared.clone(), { headers, credentials: 'include' })
    if (response.status !== 403 || attempt === 1) return response
    const body: unknown = await response.clone().json().catch(() => null)
    if (typeof body !== 'object' || body === null || !('code' in body) || !['CSRF_MISSING', 'CSRF_INVALID'].includes(String(body.code))) return response
  }
  throw new Error('Unable to secure this request.')
}
