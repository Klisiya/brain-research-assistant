import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import type { AuthUser, UserRole } from '../../types/auth'
export default function RequireRole({ roles, children }: { roles: readonly UserRole[]; children: (user: AuthUser) => ReactNode }) {
  const { state, refreshAuth } = useAuth()
  const location = useLocation()
  if (state.status === 'anonymous') return <Navigate replace to="/login" state={{ from: `${location.pathname}${location.search}${location.hash}`, managementRequired: true }} />
  if (state.status === 'loading') return <section className="management-state-panel" aria-busy="true"><h1>Checking Access...</h1></section>
  if (state.status === 'unavailable') return <section className="management-state-panel" role="alert"><h1>Authentication Check Unavailable</h1><p>We couldn't verify your access right now.</p><button onClick={() => void refreshAuth()}>Try Again</button></section>
  if (state.status !== 'authenticated') return null
  if (!roles.includes(state.user.role)) return <section className="management-state-panel"><span>403 / Access Denied</span><h1>Access Denied</h1><p>Your account does not have permission to access this area.</p><Link to="/papers">Back to Paper Library</Link></section>
  return children(state.user)
}
