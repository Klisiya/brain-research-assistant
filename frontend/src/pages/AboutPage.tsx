import { useEffect, useState, type MouseEvent } from 'react'
import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import PageParticleBackground from '../components/PageParticleBackground'
import './AboutPage.css'

const aboutSections = [
  { id: 'project-overview', label: 'Project Overview' },
  { id: 'project-purpose', label: 'Project Purpose' },
  { id: 'learning-platform', label: 'Learning Platform' },
  { id: 'ai-assisted-learning', label: 'AI-assisted Learning' },
  { id: 'educational-disclaimer', label: 'Educational Disclaimer' },
  { id: 'ai-tutor-disclaimer', label: 'AI Tutor Disclaimer' },
  { id: 'developer-contact', label: 'Developer & Contact' },
] as const

type AboutSectionId = (typeof aboutSections)[number]['id']

type AboutContentsProps = {
  activeSection: AboutSectionId
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, sectionId: AboutSectionId) => void
}

function AboutContents({ activeSection, onNavigate }: AboutContentsProps) {
  return (
    <nav aria-label="About page contents" className="about-contents-nav">
      <ol>
        {aboutSections.map((section) => (
          <li key={section.id}>
            <a
              aria-current={activeSection === section.id ? 'location' : undefined}
              className={activeSection === section.id ? 'is-active' : undefined}
              href={`#${section.id}`}
              onClick={(event) => onNavigate(event, section.id)}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function AboutPage() {
  const [activeSection, setActiveSection] = useState<AboutSectionId>('project-overview')

  useEffect(() => {
    const sections = aboutSections
      .map(({ id }) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null)

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((first, second) => first.boundingClientRect.top - second.boundingClientRect.top)[0]

        if (visibleEntry && aboutSections.some(({ id }) => id === visibleEntry.target.id)) {
          setActiveSection(visibleEntry.target.id as AboutSectionId)
        }
      },
      { rootMargin: '-20% 0px -65% 0px' },
    )

    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleHistoryNavigation = () => {
      const sectionId = window.location.hash.slice(1)
      if (aboutSections.some(({ id }) => id === sectionId)) {
        setActiveSection(sectionId as AboutSectionId)
      }
    }

    window.addEventListener('popstate', handleHistoryNavigation)
    return () => window.removeEventListener('popstate', handleHistoryNavigation)
  }, [])

  const handleNavigate = (
    event: MouseEvent<HTMLAnchorElement>,
    sectionId: AboutSectionId,
  ) => {
    const section = document.getElementById(sectionId)
    if (!section) return

    event.preventDefault()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const mobileContents = event.currentTarget.closest('details')
    if (mobileContents instanceof HTMLDetailsElement) mobileContents.open = false
    window.history.pushState(null, '', `#${sectionId}`)
    section.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'start',
    })
    setActiveSection(sectionId)
  }

  return (
    <div className="about-react-page">
      <PageParticleBackground />
      <Navbar />

      <main className="about-document-main">
        <header className="about-document-hero">
          <h1>About This Project</h1>
          <p>
            This platform supports structured learning in brain science, clinical
            neuroscience, brain-inspired intelligence, and AI-assisted education.
          </p>
        </header>

        <details className="about-mobile-contents">
          <summary>Contents</summary>
          <AboutContents activeSection={activeSection} onNavigate={handleNavigate} />
        </details>

        <div className="about-document-layout">
          <aside className="about-document-sidebar">
            <h2>Contents</h2>
            <AboutContents activeSection={activeSection} onNavigate={handleNavigate} />
          </aside>

          <article className="about-document-content">
            <section className="about-document-section" id="project-overview">
              <h2>Project Overview</h2>
              <p>
                Brain Research is an educational platform designed to support structured
                learning across brain science, clinical neuroscience, brain-inspired
                intelligence, and related interdisciplinary fields.
              </p>
              <p>
                The platform brings together course modules, research literature,
                AI-assisted learning tools, and future teaching workflows within a unified
                learning environment.
              </p>
            </section>

            <section className="about-document-section" id="project-purpose">
              <h2>Project Purpose</h2>
              <p>
                The purpose of this website is to provide an accessible learning environment
                for topics including neuroscience, cognitive science, brain-computer
                interfaces, artificial intelligence, and brain-inspired computing.
              </p>
              <p>
                The platform combines structured course content, research resources,
                interactive visualizations, and AI-assisted explanations to support
                independent study and conceptual understanding.
              </p>
            </section>

            <section className="about-document-section" id="learning-platform">
              <h2>Learning Platform</h2>
              <p>
                Brain Research is being developed as a teaching-support platform rather than
                a static information website.
              </p>
              <p>
                Its planned learning workflow connects structured course modules, research
                papers, assignments, learning progress, instructor review, and
                interdisciplinary research-to-industry activities.
              </p>
              <p>
                Features are introduced progressively as they become functional and connected
                to real platform data.
              </p>
            </section>

            <section className="about-document-section" id="ai-assisted-learning">
              <h2>AI-assisted Learning</h2>
              <p>
                The platform includes an AI Tutor designed to help learners explore concepts,
                ask questions, review scientific ideas, and connect course content with
                relevant areas of brain research.
              </p>
              <p>
                AI-supported features are intended to assist learning and teaching. They do
                not replace academic judgment, instructor review, or authoritative scientific
                sources.
              </p>
            </section>

            <section className="about-document-section" id="educational-disclaimer">
              <h2>Educational Disclaimer</h2>
              <p>
                The content provided on this website is for educational and informational
                purposes only.
              </p>
              <p>
                It should not be considered medical advice, clinical guidance, diagnosis, or
                treatment.
              </p>
              <p>
                Some topics may involve brain disorders, cognitive function, neuroscience,
                artificial intelligence, or related health concepts.
              </p>
              <p>
                Users should consult qualified professionals and authoritative academic or
                clinical sources when making medical, clinical, research-critical, or
                professional decisions.
              </p>
            </section>

            <section className="about-document-section" id="ai-tutor-disclaimer">
              <h2>AI Tutor Disclaimer</h2>
              <p>
                The AI Tutor is designed to support learning by explaining concepts,
                summarizing ideas, and answering questions related to brain science and
                brain-inspired intelligence.
              </p>
              <p>
                AI-generated responses may contain inaccuracies, incomplete explanations, or
                outdated information.
              </p>
              <p>
                Important information should be verified against textbooks, peer-reviewed
                research, official course resources, or professional guidance.
              </p>
              <p>
                AI-generated content should be clearly treated as learning assistance, not as
                authoritative medical or scientific judgment.
              </p>
            </section>

            <section className="about-document-section" id="developer-contact">
              <h2>Developer &amp; Contact</h2>
              <p>
                This website was designed and developed by Klisiya as part of the Brain
                Research educational platform project.
              </p>
              <p>
                For technical questions, feedback, or suggestions regarding the website,
                contact:{' '}
                <a href="mailto:txf5268@psu.edu">txf5268@psu.edu</a>
              </p>
            </section>
          </article>
        </div>
      </main>

      <Footer />
    </div>
  )
}

export default AboutPage
