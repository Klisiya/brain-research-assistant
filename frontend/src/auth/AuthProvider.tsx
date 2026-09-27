import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchAuthMe, login, logout } from '../api/auth'
import { SESSION_EXPIRED_EVENT } from '../api/session'
import { AuthContext, type AuthState } from './auth-context'
export default function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null })
  const generation = useRef(0)
  const mutating = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const refreshAuth = useCallback(async () => {
    if (mutating.current) return
    const key = ++generation.current
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    try {
      const payload = await fetchAuthMe({ signal: request.signal })
      if (key !== generation.current || request.signal.aborted) return
      setState(payload.authenticated && payload.user.isActive ? { status: 'authenticated', user: payload.user } : { status: 'anonymous', user: null })
    } catch {
      if (key === generation.current && !request.signal.aborted) setState({ status: 'unavailable', user: null })
    }
  }, [])
  const signIn = useCallback(async (email: string, password: string, remember: boolean) => {
    const key = ++generation.current
    controller.current?.abort()
    mutating.current = true
    try {
      const user = await login(email, password, remember)
      if (key === generation.current) setState({ status: 'authenticated', user })
      else {
        mutating.current = false
        await refreshAuth()
      }
    } finally { mutating.current = false }
  }, [refreshAuth])
  const signOut = useCallback(async () => {
    ++generation.current
    controller.current?.abort()
    mutating.current = true
    try {
      await logout()
      ++generation.current
      controller.current?.abort()
      setState({ status: 'anonymous', user: null })
    } finally { mutating.current = false }
  }, [])
  const cancelRequests = useCallback(() => {
    ++generation.current
    controller.current?.abort()
  }, [])
  useEffect(() => {
    const expired = () => {
      ++generation.current
      controller.current?.abort()
      setState({ status: 'anonymous', user: null })
    }
    const focus = () => { void refreshAuth() }
    window.addEventListener(SESSION_EXPIRED_EVENT, expired)
    window.addEventListener('focus', focus)
    void Promise.resolve().then(refreshAuth)
    return () => {
      cancelRequests()
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired)
      window.removeEventListener('focus', focus)
    }
  }, [refreshAuth, cancelRequests])
  const value = useMemo(() => ({ state, refreshAuth, signIn, signOut }), [state, refreshAuth, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
