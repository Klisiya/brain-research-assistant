import PageParticleBackground from './PageParticleBackground'
import './Hero.css'

function Hero() {
  return (
    <>
      <PageParticleBackground />

      <header className="hero hero-intro" id="overview">
        <span className="hero-kicker">Interactive Brain Research Platform</span>

        <h1>
          <span className="hero-title-line"><span className="hero-title-surround">Frontiers in</span>{' '}<span className="hero-title-anchor"><span className="hero-title-anchor-word">Brain</span>{' '}<span className="hero-title-anchor-word">Science</span></span><span className="hero-title-surround"> and</span></span>{' '}
          <span className="hero-title-line hero-title-surround">Brain-Inspired Intelligence</span>
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
