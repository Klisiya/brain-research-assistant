import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import BrainSection from './components/BrainSection'
import AITutorSection from './components/AITutorSection'
import Footer from './components/Footer'
import Hero from './components/Hero'
import HomepageIntro from './components/HomepageIntro'
import ModulesSection from './components/ModulesSection'
import Navbar from './components/Navbar'
import PapersManagementGuard from './components/auth/PapersManagementGuard'
import AboutPage from './pages/AboutPage'
import BrainRegionPage from './pages/BrainRegionPage'
import ContactPage from './pages/ContactPage'
import CoursePage from './pages/CoursePage'
import ResearchAreaPage from './pages/ResearchAreaPage'
import ResearchManagementPage from './pages/ResearchManagementPage'
import InnovationHubPage from './pages/InnovationHubPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import PaperDetailPage from './pages/PaperDetailPage'
import PaperEditorPage from './pages/PaperEditorPage'
import PaperManagementPage from './pages/PaperManagementPage'
import PapersPage from './pages/PapersPage'
import AdminAuditPage from './pages/admin/AdminAuditPage'
import AdminUsersPage from './pages/admin/AdminUsersPage'
import AccountCredentialPage from './pages/AccountCredentialPage'
import './App.css'

function HomePage() {
  const { hash } = useLocation()

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      if (!hash) {
        window.scrollTo({ left: 0, top: 0 })
        return
      }

      const target = document.getElementById(decodeURIComponent(hash.slice(1)))
      target?.scrollIntoView({ block: 'start' })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [hash])

  return (
    <div className="app-shell">
      <HomepageIntro />
      <Navbar />
      <Hero />
      <BrainSection />
      <ModulesSection />
      <AITutorSection />
      <Footer />
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route element={<HomePage />} path="/" />
      <Route element={<AboutPage />} path="/about" />
      <Route element={<ContactPage />} path="/contact" />
      <Route element={<CoursePage />} path="/course/:courseSlug" />
      <Route element={<CoursePage />} path="/course/:courseSlug/modules/:moduleSlug" />
      <Route element={<ResearchAreaPage />} path="/research" />
      <Route element={<ResearchAreaPage />} path="/research/:slug" />
      <Route element={<PapersManagementGuard>{user => <ResearchManagementPage currentUser={user} />}</PapersManagementGuard>} path="/manage/research-areas" />
      <Route element={<PapersManagementGuard>{user => <ResearchManagementPage currentUser={user} />}</PapersManagementGuard>} path="/manage/research-areas/:areaId" />
      <Route element={<LoginPage />} path="/login" />
      <Route path="/forgot-password" element={<AccountCredentialPage key="forgot" mode="forgot" />} />
      <Route path="/reset-password" element={<AccountCredentialPage key="reset" mode="reset" />} />
      <Route path="/accept-invitation" element={<AccountCredentialPage key="accept" mode="accept" />} />
      <Route path="/change-password" element={<PapersManagementGuard allowedRoles={['student', 'teacher', 'admin']}>{() => <AccountCredentialPage key="change" mode="change" />}</PapersManagementGuard>} />
      <Route element={<PapersPage />} path="/papers" />
      <Route element={<PaperDetailPage />} path="/papers/:slug" />
      <Route
        element={(
          <PapersManagementGuard>
            {(user) => <PaperManagementPage currentUser={user} />}
          </PapersManagementGuard>
        )}
        path="/manage/papers"
      />
      <Route
        element={(
          <PapersManagementGuard>
            {(user) => <PaperEditorPage currentUser={user} />}
          </PapersManagementGuard>
        )}
        path="/manage/papers/new"
      />
      <Route
        element={(
          <PapersManagementGuard>
            {(user) => <PaperEditorPage currentUser={user} />}
          </PapersManagementGuard>
        )}
        path="/manage/papers/:id/edit"
      />
      <Route
        element={(
          <PapersManagementGuard>
            {() => <PaperDetailPage preview />}
          </PapersManagementGuard>
        )}
        path="/manage/papers/:id/preview"
      />
      <Route path="/admin" element={<PapersManagementGuard adminOnly>{() => <Navigate replace to="/admin/users" />}</PapersManagementGuard>} />
      <Route path="/admin/audit-log" element={<PapersManagementGuard adminOnly>{() => <AdminAuditPage />}</PapersManagementGuard>} />
      <Route path="/admin/users" element={<PapersManagementGuard adminOnly>{() => <AdminUsersPage />}</PapersManagementGuard>} />
      <Route element={<InnovationHubPage />} path="/innovation-hub" />
      <Route element={<BrainRegionPage />} path="/brain-region/:slug" />
      <Route element={<NotFoundPage />} path="*" />
    </Routes>
  )
}

export default App
