import { Fragment, type ReactNode } from 'react'
import type { AuthUser, UserRole } from '../../types/auth'
import Footer from '../Footer'
import Navbar from '../Navbar'
import PageParticleBackground from '../PageParticleBackground'
import RequireRole from './RequireRole'
import { useLocation } from 'react-router-dom'
import ManagementNavigation from '../management/ManagementNavigation'
import '../../pages/PaperManagementPage.css'
import '../management/ManagementWorkspace.css'
export default function PapersManagementGuard({ children, adminOnly = false, allowedRoles }: { children: (user: AuthUser) => ReactNode; adminOnly?: boolean; allowedRoles?: readonly UserRole[] }) {
  const { pathname } = useLocation()
  const workspace = (pathname.startsWith('/manage') || pathname.startsWith('/admin')) && !pathname.endsWith('/preview')
  return <div className="paper-management-shell"><PageParticleBackground /><Navbar /><main className="paper-management-main"><RequireRole roles={allowedRoles ?? (adminOnly ? ['admin'] : ['teacher', 'admin'])}>{user => <Fragment key={`${user.id}:${user.role}`}>{workspace ? <div className="management-workspace"><ManagementNavigation user={user} />{children(user)}</div> : children(user)}</Fragment>}</RequireRole></main><Footer /></div>
}
