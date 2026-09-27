export const SESSION_EXPIRED_EVENT = 'brain-research:session-expired'
export async function sessionFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { ...init, credentials: 'include' })
  if (response.status === 401 && !init?.signal?.aborted) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
  return response
}
