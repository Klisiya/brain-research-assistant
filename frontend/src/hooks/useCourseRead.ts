import { useEffect, useState } from 'react'
import { CourseReadError } from '../api/courses'

export function useCourseRead<T>(identity: string, reader: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const key = `${identity}:${attempt}`
  const [result, setResult] = useState<{ key: string; data: T | null; error: 'not-found' | 'unavailable' | null }>({ key: '', data: null, error: null })
  useEffect(() => {
    const controller = new AbortController()
    reader(controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, data, error: null })
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ key, data: null, error: error instanceof CourseReadError && error.status === 404 ? 'not-found' : 'unavailable' })
    })
    return () => controller.abort()
  }, [key, reader])
  return { data: result.key === key ? result.data : null, error: result.key === key ? result.error : null, loading: result.key !== key, retry: () => setAttempt(a => a + 1) }
}
