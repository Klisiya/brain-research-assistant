import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import PageParticleBackground from '../components/PageParticleBackground'
import './AboutPage.css'

const aboutCards: Array<{ title: string; paragraphs: string[]; wide?: boolean }> = [
  {
    title: 'Project Purpose',
    paragraphs: [
      'The purpose of this website is to provide an accessible learning environment for topics such as neuroscience, cognitive science, brain-computer interfaces, artificial intelligence, and brain-inspired computing.',
      'The platform combines visual design, topic-based learning modules, and AI-assisted explanations to support independent study and conceptual understanding.',
    ],
  },
  {
    title: 'Developer Information',
    paragraphs: [
      'This website was designed and developed by Klisiya. Have any questions or feedback? Send an e-mail to txf5268@psu.edu',
      'The interface, layout, AI tutor interaction, and visual components were built to create a modern educational experience for users interested in brain research and intelligent systems.',
    ],
  },
  {
    title: 'Educational Disclaimer',
    wide: true,
    paragraphs: [
      'The content provided on this website is for educational and informational purposes only. It should not be considered medical advice, clinical guidance, diagnosis, or treatment.',
      'Some topics may involve brain disorders, cognitive function, or neuroscience-related health concepts. Users should consult qualified professionals or authoritative academic sources for medical, clinical, or research-critical decisions.',
    ],
  },
  {
    title: 'AI Tutor Disclaimer',
    wide: true,
    paragraphs: [
      'The AI Tutor is designed to support learning by explaining concepts, summarizing ideas, and answering questions related to brain science and brain-inspired intelligence.',
      'AI-generated responses may contain inaccuracies, incomplete explanations, or outdated information. Users should verify important information with textbooks, peer-reviewed papers, official resources, or professional guidance.',
    ],
  },
]

function AboutPage() {
  return (
    <div className="about-react-page">
      <PageParticleBackground />
      <Navbar />
      <main className="about-react-main">
        <section className="about-react-hero">
          <span className="about-react-label">About &amp; Disclaimer</span>
          <h1>About This Project</h1>
          <p>
            This platform is an educational web project focused on frontiers in brain
            science and brain-inspired intelligence. It is designed to help learners
            explore core concepts, research directions, and emerging technologies through
            structured modules and an AI tutor.
          </p>
        </section>
        <AboutCards />
      </main>
      <Footer />
    </div>
  )
}

function AboutCards() {
  return (
    <section aria-label="About this project" className="about-react-grid">
      {aboutCards.map((card, index) => (
        <article
          className={'about-react-card' + (card.wide ? ' about-react-card-wide' : '')}
          key={card.title}
        >
          <span className="about-react-card-index">
            {String(index + 1).padStart(2, '0')}
          </span>
          <h2>{card.title}</h2>
          {card.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </article>
      ))}
    </section>
  )
}

export default AboutPage
