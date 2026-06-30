import Navbar from './components/Navbar'
import './App.css'

function App() {
  return (
    <div className="app-shell">
      <Navbar />
      <main className="navbar-preview" aria-hidden="true" />
    </div>
  )
}

export default App
