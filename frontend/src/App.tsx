import { Route, Routes } from 'react-router-dom'
import BrainSection from './components/BrainSection'
import AITutorSection from './components/AITutorSection'
import Footer from './components/Footer'
import Hero from './components/Hero'
import ModulesSection from './components/ModulesSection'
import Navbar from './components/Navbar'
import LoginPage from './pages/LoginPage'
import './App.css'

function HomePage() {
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
      <Route element={<LoginPage />} path="/login" />
    </Routes>
  )
}

export default App
