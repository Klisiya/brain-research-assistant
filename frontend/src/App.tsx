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
import ModuleWorkspacePage from './pages/ModuleWorkspacePage'
import ResearchAreaPage from './pages/ResearchAreaPage'
import ResearchManagementPage from './pages/ResearchManagementPage'
import SearchPage from './pages/SearchPage'
import CourseManagementPage from './pages/CourseManagementPage'
import ProgressPage from './pages/ProgressPage'
import MyLearningPage from './pages/MyLearningPage'
import BookmarksPage from './pages/BookmarksPage'
import InnovationHubPage from './pages/InnovationHubPage'
import FacultyWorkspace from './components/hub/FacultyWorkspace'
import IndustryWorkspace from './components/hub/IndustryWorkspace'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import PaperDetailPage from './pages/PaperDetailPage'
import PaperEditorPage from './pages/PaperEditorPage'
import PaperManagementPage from './pages/PaperManagementPage'
import PapersPage from './pages/PapersPage'
import AdminAuditPage from './pages/admin/AdminAuditPage'
import AdminUsersPage from './pages/admin/AdminUsersPage'
import DiscussionWorkspace from './components/hub/DiscussionWorkspace'
import AccountCredentialPage from './pages/AccountCredentialPage'
import ManagementPage from './pages/ManagementPage'
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
      <Route element={<SearchPage />} path="/search" />
      <Route element={<MyLearningPage />} path="/my-learning" />
      <Route element={<ProgressPage />} path="/progress" />
      <Route element={<BookmarksPage />} path="/bookmarks" />
      <Route element={<PapersManagementGuard>{user => <ManagementPage currentUser={user} />}</PapersManagementGuard>} path="/manage" />
      <Route element={<PapersManagementGuard>{user => <CourseManagementPage currentUser={user} />}</PapersManagementGuard>} path="/manage/courses" />
      <Route element={<PapersManagementGuard>{user => <CourseManagementPage currentUser={user} />}</PapersManagementGuard>} path="/manage/courses/:courseId" />
      <Route element={<ContactPage />} path="/contact" />
      <Route element={<CoursePage />} path="/course/:courseSlug" />
      <Route element={<ModuleWorkspacePage />} path="/course/:courseSlug/modules/:moduleSlug" />
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
      <Route element={<InnovationHubPage detail />} path="/innovation-hub/faculty/:entryId" />
      <Route element={<InnovationHubPage detail kind="industry" />} path="/innovation-hub/industry/:entryId" />
      <Route element={<InnovationHubPage detail kind="discussions" discussionMode="create" />} path="/innovation-hub/discussions/new" />
      <Route element={<InnovationHubPage detail kind="discussions" discussionMode="manage" />} path="/innovation-hub/discussions/manage/:entryId" />
      <Route element={<InnovationHubPage detail kind="discussions" />} path="/innovation-hub/discussions/:entryId" />
      <Route element={<PapersManagementGuard adminOnly>{user=><DiscussionWorkspace user={user} mode="review"/>}</PapersManagementGuard>} path="/manage/hub/discussions" />
      <Route element={<PapersManagementGuard adminOnly>{user=><DiscussionWorkspace user={user} mode="reports"/>}</PapersManagementGuard>} path="/manage/hub/discussions/reports" />
      <Route element={<PapersManagementGuard>{user => <IndustryWorkspace user={user} managed />}</PapersManagementGuard>} path="/manage/hub/industry" />
      <Route element={<PapersManagementGuard>{user => <IndustryWorkspace user={user} managed create />}</PapersManagementGuard>} path="/manage/hub/industry/new" />
      <Route element={<PapersManagementGuard>{user => <IndustryWorkspace user={user} managed />}</PapersManagementGuard>} path="/manage/hub/industry/:entryId" />
      <Route element={<PapersManagementGuard>{user => <FacultyWorkspace user={user} managed />}</PapersManagementGuard>} path="/manage/hub" />
      <Route element={<PapersManagementGuard>{user => <FacultyWorkspace user={user} managed create />}</PapersManagementGuard>} path="/manage/hub/new" />
      <Route element={<PapersManagementGuard>{user => <FacultyWorkspace user={user} managed />}</PapersManagementGuard>} path="/manage/hub/:entryId" />
      <Route element={<BrainRegionPage />} path="/brain-region/:slug" />
      <Route element={<NotFoundPage />} path="*" />
    </Routes>
  )
}

export default App
