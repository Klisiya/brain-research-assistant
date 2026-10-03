import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { useCourseRead } from './useCourseRead'

export function usePersonalState<T>(scope: string, read: (signal: AbortSignal) => Promise<T>) {
  const { state: auth, refreshAuth } = useAuth()
  const account = auth.status === 'authenticated' ? auth.user.id : null
  const identity = `${account}:${scope}`
  const reader = useCallback((signal: AbortSignal) => account === null ? Promise.resolve(null) : read(signal), [account, read])
  const state = useCourseRead(identity, reader)
  const active = useRef<AbortController | null>(null)
  const [mutation, setMutation] = useState({ identity, busy: false, error: '', message: '' })
  useEffect(() => () => { active.current?.abort(); active.current = null }, [identity])
  const run = async (operation: (signal: AbortSignal) => Promise<unknown>) => {
    if (account === null || active.current) return false
    const controller = new AbortController()
    active.current = controller
    setMutation({ identity, busy: true, error: '', message: '' })
    try {
      await operation(controller.signal)
      if (!controller.signal.aborted) { state.retry(); setMutation({ identity, busy: false, error: '', message: 'Personal state saved.' }); return true }
    } catch (error) {
      if (!controller.signal.aborted) setMutation({ identity, busy: false, error: error instanceof Error ? error.message : 'Unable to save personal state.', message: '' })
    } finally { if (active.current === controller) active.current = null }
    return false
  }
  return { ...state, auth, refreshAuth, run, busy: mutation.identity === identity && mutation.busy, errorMessage: mutation.identity === identity ? mutation.error : '', message: mutation.identity === identity ? mutation.message : '' }
}
