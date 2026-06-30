import Hero from './components/Hero'
import Navbar from './components/Navbar'
import './App.css'

function App() {
  return (
    <div className="app-shell">
      <Navbar />
      <main className="home-main">
        <Hero />
        <section className="home-dark-continuation" aria-hidden="true" />
      </main>
    </div>
  )
}

export default App
