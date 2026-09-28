import type { ReactNode } from 'react'
import type { AuthUser, UserRole } from '../../types/auth'
import Footer from '../Footer'
import Navbar from '../Navbar'
import PageParticleBackground from '../PageParticleBackground'
import RequireRole from './RequireRole'
import '../../pages/PaperManagementPage.css'
export default function PapersManagementGuard({ children, adminOnly = false, allowedRoles }: { children: (user: AuthUser) => ReactNode; adminOnly?: boolean; allowedRoles?: readonly UserRole[] }) {
  return <div className="paper-management-shell"><PageParticleBackground /><Navbar /><main className="paper-management-main"><RequireRole roles={allowedRoles ?? (adminOnly ? ['admin'] : ['teacher', 'admin'])}>{children}</RequireRole></main><Footer /></div>
}
