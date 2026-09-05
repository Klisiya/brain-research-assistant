import { Link } from 'react-router-dom'
import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import PageParticleBackground from '../components/PageParticleBackground'
import './NotFoundPage.css'

function NotFoundPage() {
  return (
    <div className="not-found-page">
      <PageParticleBackground />
      <Navbar />
      <main className="not-found-main">
        <span>404</span>
        <h1>Not Found</h1>
        <p>The page you requested could not be found.</p>
        <Link to="/">Back Home</Link>
      </main>
      <Footer />
    </div>
  )
}

export default NotFoundPage
