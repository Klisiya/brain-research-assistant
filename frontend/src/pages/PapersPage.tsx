import { Link, useParams } from 'react-router-dom'
import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import PageParticleBackground from '../components/PageParticleBackground'
import './PapersPage.css'

function PapersPage() {
  const { slug } = useParams<{ slug: string }>()
  const isReadingPlaceholder = Boolean(slug)

  return (
    <div className="papers-placeholder-page">
      <PageParticleBackground />
      <Navbar />

      <main className="papers-placeholder-main">
        <section className="papers-placeholder-card">
          <span className="papers-placeholder-eyebrow">Research Library</span>
          <h1>{isReadingPlaceholder ? 'Paper Reading Experience' : 'Paper Library'}</h1>
          <p>
            {isReadingPlaceholder
              ? 'The full paper reading experience will be available in the next development stage.'
              : 'The structured paper library is currently being prepared.'}
          </p>
          <Link className="papers-placeholder-link" to={isReadingPlaceholder ? '/papers' : '/#modules'}>
            {isReadingPlaceholder ? 'Back to Paper Library' : 'Back to Learning Center'}
          </Link>
        </section>
      </main>

      <Footer />
    </div>
  )
}

export default PapersPage
