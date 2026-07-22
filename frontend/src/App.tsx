import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import BrainSection from './components/BrainSection'
import AITutorSection from './components/AITutorSection'
import Footer from './components/Footer'
import Hero from './components/Hero'
import ModulesSection from './components/ModulesSection'
import Navbar from './components/Navbar'
import AboutPage from './pages/AboutPage'
import BrainRegionPage from './pages/BrainRegionPage'
import ContactPage from './pages/ContactPage'
import InnovationHubPage from './pages/InnovationHubPage'
import LoginPage from './pages/LoginPage'
import PaperDetailPage from './pages/PaperDetailPage'
import PapersPage from './pages/PapersPage'
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
      <Route element={<LoginPage />} path="/login" />
      <Route element={<PapersPage />} path="/papers" />
      <Route element={<PaperDetailPage />} path="/papers/:slug" />
      <Route element={<InnovationHubPage />} path="/innovation-hub" />
      <Route element={<BrainRegionPage />} path="/brain-region/:slug" />
    </Routes>
  )
}

export default App
