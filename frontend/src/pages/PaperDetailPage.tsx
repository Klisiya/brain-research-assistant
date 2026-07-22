import { useEffect } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import PageParticleBackground from '../components/PageParticleBackground'
import { papers } from '../data/papers'
import './PaperDetailPage.css'

function getReturnPath(state: unknown) {
  if (
    typeof state === 'object'
    && state !== null
    && 'from' in state
    && typeof state.from === 'string'
    && state.from.startsWith('/papers')
  ) {
    return state.from
  }

  return '/papers'
}

function PaperDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const location = useLocation()
  const paper = papers.find((entry) => entry.slug === slug)
  const returnPath = getReturnPath(location.state)

  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 })
  }, [slug])

  return (
    <div className="paper-detail-page">
      <PageParticleBackground />
      <Navbar />

      <main className="paper-detail-main">
        {!paper ? (
          <section className="paper-detail-not-found">
            <span>Research Library</span>
            <h1>Paper Not Found</h1>
            <p>The requested demo resource is not available in this library.</p>
            <Link to="/papers">Back to Paper Library</Link>
          </section>
        ) : (
          <>
            <Link className="paper-detail-back" to={returnPath}>
              <span aria-hidden="true">←</span> Back to Paper Library
            </Link>

            <article>
              <header className="paper-detail-hero">
                <div className="paper-detail-badges">
                  <span>{paper.publicationType}</span>
                  <span>{paper.difficulty}</span>
                  <span>{paper.resourceCategory}</span>
                </div>
                <p className="paper-detail-eyebrow">Research Library · Demo Resource</p>
                <h1>{paper.title}</h1>
                <p className="paper-detail-authors">{paper.authors.join(', ')}</p>
                <p className="paper-detail-publication">
                  {paper.journal} · {paper.year}
                </p>

                <dl className="paper-detail-meta">
                  <div><dt>Reading time</dt><dd>{paper.estimatedReadingMinutes} min</dd></div>
                  <div><dt>Access</dt><dd>{paper.openAccess ? 'Open Access' : 'Guided Access'}</dd></div>
                  <div><dt>Reading status</dt><dd>{paper.readingStatus}</dd></div>
                </dl>
              </header>

              <div className="paper-detail-layout">
                <div className="paper-detail-content">
                  <section className="paper-detail-block">
                    <span>Overview</span>
                    <h2>Abstract</h2>
                    <p>{paper.abstract}</p>
                  </section>

                  <section className="paper-detail-block">
                    <span>Guided Study</span>
                    <h2>Learning Objectives</h2>
                    <ul>
                      {paper.learningObjectives.map((objective) => (
                        <li key={objective}>{objective}</li>
                      ))}
                    </ul>
                  </section>

                  <section className="paper-detail-block">
                    <span>Resource Tools</span>
                    <h2>Reading Workspace</h2>
                    <div className="paper-coming-soon-grid">
                      {['Guided Notes', 'Concept Highlights', 'Knowledge Check'].map((tool) => (
                        <div aria-disabled="true" className="paper-coming-soon-card" key={tool}>
                          <strong>{tool}</strong>
                          <span>Coming Soon</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <aside className="paper-detail-sidebar" aria-label="Paper metadata">
                  <section>
                    <h2>Topics</h2>
                    <div className="paper-detail-tags">
                      {paper.topics.map((topic) => <span key={topic}>{topic}</span>)}
                    </div>
                  </section>
                  <section>
                    <h2>Keywords</h2>
                    <div className="paper-detail-tags is-muted">
                      {paper.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
                    </div>
                  </section>
                  <section className="paper-detail-source">
                    <h2>Source</h2>
                    {paper.externalUrl ? (
                      <a href={paper.externalUrl} rel="noreferrer" target="_blank">
                        Open External Source <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <p>Source link unavailable in demo data.</p>
                    )}
                  </section>
                </aside>
              </div>
            </article>
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}

export default PaperDetailPage
