import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { fetchAuthMe } from '../../api/auth'
import type { AuthMePayload, AuthUser } from '../../types/auth'
import Footer from '../Footer'
import Navbar from '../Navbar'
import PageParticleBackground from '../PageParticleBackground'

type GuardResult = {
  payload: AuthMePayload | null
  requestId: number
  unavailable: boolean
}

type PapersManagementGuardProps = {
  children: (user: AuthUser) => ReactNode
}

function PapersManagementGuard({ children }: PapersManagementGuardProps) {
  const location = useLocation()
  const [requestId, setRequestId] = useState(0)
  const [result, setResult] = useState<GuardResult | null>(null)
  const currentResult = result?.requestId === requestId ? result : null
  const returnPath = `${location.pathname}${location.search}${location.hash}`

  useEffect(() => {
    const controller = new AbortController()

    fetchAuthMe({ signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setResult({ payload, requestId, unavailable: false })
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        console.error('Unable to verify management access.', error)
        setResult({ payload: null, requestId, unavailable: true })
      })

    return () => controller.abort()
  }, [requestId])

  if (currentResult?.payload?.authenticated === false) {
    return (
      <Navigate
        replace
        state={{ from: returnPath, managementRequired: true }}
        to="/login"
      />
    )
  }

  const authenticatedUser = currentResult?.payload?.authenticated
    ? currentResult.payload.user
    : null
  const hasManagementRole = authenticatedUser?.role === 'teacher'
    || authenticatedUser?.role === 'admin'

  return (
    <div className="paper-management-shell">
      <PageParticleBackground />
      <Navbar />

      <main className="paper-management-main">
        {!currentResult ? (
          <section aria-busy="true" aria-label="Checking management access" className="management-state-panel">
            <span>Management</span>
            <h1>Checking Access...</h1>
            <div aria-hidden="true" className="management-guard-skeleton" />
          </section>
        ) : currentResult.unavailable ? (
          <section aria-live="polite" className="management-state-panel" role="alert">
            <span>Management</span>
            <h1>Authentication Check Unavailable</h1>
            <p>We couldn't verify your management access right now.</p>
            <button onClick={() => setRequestId((value) => value + 1)} type="button">
              Try Again
            </button>
          </section>
        ) : authenticatedUser && !hasManagementRole ? (
          <section className="management-state-panel">
            <span>Access Denied</span>
            <h1>Management Access Required</h1>
            <p>This area is available to instructors and administrators.</p>
            <Link to="/papers">Back to Paper Library</Link>
          </section>
        ) : authenticatedUser && hasManagementRole ? (
          children(authenticatedUser)
        ) : null}
      </main>

      <Footer />
    </div>
  )
}

export default PapersManagementGuard
