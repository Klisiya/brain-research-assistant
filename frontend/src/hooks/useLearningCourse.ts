import { useCallback, useEffect, useRef, useState } from 'react'
import { changeLearning, getLearningCourse } from '../api/learning'
import { useAuth } from '../auth/useAuth'
import { useCourseRead } from './useCourseRead'

export function useLearningCourse(slug: string) {
  const { state: auth, refreshAuth } = useAuth()
  const account = auth.status === 'authenticated' ? auth.user.id : null
  const identity = `${account}:${slug}`
  const reader = useCallback((signal: AbortSignal) => account === null ? Promise.resolve(null) : getLearningCourse(slug, signal), [account, slug])
  const state = useCourseRead(identity, reader)
  const controller = useRef<AbortController | null>(null)
  const [mutation, setMutation] = useState({ identity, busy: false, error: '', message: '' })
  useEffect(() => () => { controller.current?.abort(); controller.current = null }, [identity])
  const run = async (operation: Parameters<typeof changeLearning>[1]) => {
    if (account === null || controller.current) return
    const request = new AbortController()
    controller.current = request
    setMutation({ identity, busy: true, error: '', message: '' })
    try {
      await changeLearning(slug, operation, request.signal)
      if (!request.signal.aborted) {
        state.retry()
        setMutation({ identity, busy: false, error: '', message: 'Learning state saved.' })
      }
    } catch (error) {
      if (!request.signal.aborted) setMutation({ identity, busy: false, error: error instanceof Error ? error.message : 'Unable to save learning state.', message: '' })
    } finally { if (controller.current === request) controller.current = null }
  }
  return { ...state, auth, refreshAuth, run, busy: mutation.identity === identity && mutation.busy, errorMessage: mutation.identity === identity ? mutation.error : '', message: mutation.identity === identity ? mutation.message : '' }
}
export type LearningController = ReturnType<typeof useLearningCourse>
