import { useEffect, useState } from 'react'

export type ManagementReadError = 'session' | 'forbidden' | 'not-found' | 'unavailable'

export function useManagementRead<T>(identity: string, reader: (signal: AbortSignal) => Promise<T>, retainWhileRefreshing = false) {
  const [attempt, setAttempt] = useState(0)
  const key = `${identity}:${attempt}`
  const [result, setResult] = useState<{ key: string; identity: string; data: T | null; error: ManagementReadError | null } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    reader(controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, identity, data, error: null })
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return
      const status = reason instanceof Error && 'status' in reason ? reason.status : null
      const error = status === 401 ? 'session' : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : 'unavailable'
      setResult(previous => ({ key, identity, data: retainWhileRefreshing && error === 'unavailable' && previous?.identity === identity ? previous.data : null, error }))
    })
    return () => controller.abort()
  }, [key, identity, reader, retainWhileRefreshing])
  const current = result?.key === key ? result : null
  const retained = retainWhileRefreshing && result?.identity === identity ? result.data : null
  return { data: current?.data ?? retained ?? null, error: current?.error ?? null, loading: !current && !retained, retry: () => setAttempt(value => value + 1), reload: () => { setResult(null); setAttempt(value => value + 1) } }
}
