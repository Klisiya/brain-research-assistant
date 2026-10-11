import { useEffect, useState } from 'react'

export type ManagementReadError = 'session' | 'forbidden' | 'not-found' | 'unavailable'

export function useManagementRead<T>(identity: string, reader: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const key = `${identity}:${attempt}`
  const [result, setResult] = useState<{ key: string; data: T | null; error: ManagementReadError | null } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    reader(controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, data, error: null })
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return
      const status = reason instanceof Error && 'status' in reason ? reason.status : null
      const error = status === 401 ? 'session' : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : 'unavailable'
      setResult({ key, data: null, error })
    })
    return () => controller.abort()
  }, [key, reader])
  const current = result?.key === key ? result : null
  return { data: current?.data ?? null, error: current?.error ?? null, loading: !current, retry: () => setAttempt(value => value + 1) }
}
