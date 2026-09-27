import type { ReactNode } from 'react'
import type { AuthUser } from '../../types/auth'
import Footer from '../Footer'
import Navbar from '../Navbar'
import PageParticleBackground from '../PageParticleBackground'
import RequireRole from './RequireRole'
import '../../pages/PaperManagementPage.css'
export default function PapersManagementGuard({ children, adminOnly = false }: { children: (user: AuthUser) => ReactNode; adminOnly?: boolean }) {
  return <div className="paper-management-shell"><PageParticleBackground /><Navbar /><main className="paper-management-main"><RequireRole roles={adminOnly ? ['admin'] : ['teacher', 'admin']}>{children}</RequireRole></main><Footer /></div>
}
