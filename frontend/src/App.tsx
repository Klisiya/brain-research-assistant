import BrainSection from './components/BrainSection'
import AITutorSection from './components/AITutorSection'
import Footer from './components/Footer'
import Hero from './components/Hero'
import ModulesSection from './components/ModulesSection'
import Navbar from './components/Navbar'
import './App.css'

function App() {
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

export default App
