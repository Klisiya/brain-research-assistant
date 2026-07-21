import { Link, useSearchParams } from 'react-router-dom'
import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import PageParticleBackground from '../components/PageParticleBackground'
import './InnovationHubPage.css'

type InnovationView = 'faculty' | 'industry' | 'discussions' | 'collaboration'

type InnovationViewContent = {
  description: string
  title: string
}

const innovationViews: Record<InnovationView, InnovationViewContent> = {
  faculty: {
    title: 'Faculty Resources',
    description: 'Course materials, research guidance, and recommended resources shared by instructors.',
  },
  industry: {
    title: 'Industry Updates',
    description: 'Verified technology updates and research developments from collaborating organizations.',
  },
  discussions: {
    title: 'Learner Discussions',
    description: 'A space for learners to ask questions, exchange ideas, and discuss brain science topics.',
  },
  collaboration: {
    title: 'Collaboration Board',
    description: 'Explore research challenges, student projects, and opportunities for academic-industry collaboration.',
  },
}

function isInnovationView(value: string | null): value is InnovationView {
  return value !== null && Object.prototype.hasOwnProperty.call(innovationViews, value)
}

function InnovationHubPage() {
  const [searchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const activeView: InnovationView = isInnovationView(requestedView) ? requestedView : 'faculty'
  const activeContent = innovationViews[activeView]

  return (
    <div className="innovation-hub-page">
      <PageParticleBackground />
      <Navbar />

      <main className="innovation-hub-main">
        <section className="innovation-hub-hero">
          <span className="innovation-hub-eyebrow">Industry ? Academia ? Research</span>
          <h1>Innovation Hub</h1>
          <p>
            A shared space for faculty resources, industry technology updates, learner discussions, and collaborative opportunities.
          </p>
        </section>

        <nav aria-label="Innovation Hub views" className="innovation-view-tabs">
          {(Object.entries(innovationViews) as [InnovationView, InnovationViewContent][]).map(([view, content]) => (
            <Link
              aria-current={activeView === view ? 'page' : undefined}
              className={activeView === view ? 'is-active' : undefined}
              key={view}
              to={`/innovation-hub?view=${view}`}
            >
              {content.title}
            </Link>
          ))}
        </nav>

        <section aria-live="polite" className="innovation-view-card">
          <span>Selected View</span>
          <h2>{activeContent.title}</h2>
          <p>{activeContent.description}</p>
        </section>
      </main>

      <Footer />
    </div>
  )
}

export default InnovationHubPage
