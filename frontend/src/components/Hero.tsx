import PageParticleBackground from './PageParticleBackground'
import './Hero.css'

function Hero() {
  return (
    <>
      <PageParticleBackground />

      <header className="hero hero-intro">
        <span className="hero-kicker">Interactive Brain Research Platform</span>

        <h1>
          <span className="hero-title-line">Frontiers in Brain Science and</span>{' '}
          <span className="hero-title-line">Brain-Inspired Intelligence</span>
        </h1>

        <p>
          Explore neuroscience, cognitive science, brain-computer interfaces,
          brain-inspired Intelligence, and artificial intelligence through an immersive
          learning experience.
        </p>
      </header>
    </>
  )
}

export default Hero
