import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { LearningModule } from '../data/modules'
import './ModuleCard.css'

type ModuleCardProps = {
  module: LearningModule
}

function ModuleCard({ module }: ModuleCardProps) {
  const [isFlipped, setIsFlipped] = useState(false)

  const toggleCard = () => {
    setIsFlipped((current) => !current)
  }

  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('a')) {
      return
    }

    toggleCard()
  }

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.currentTarget !== event.target) {
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggleCard()
    }
  }

  const handleModuleLinkClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
  }

  return (
    <article
      className={`module-card${isFlipped ? ' is-flipped' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={isFlipped}
      aria-label={`${module.title}. ${module.backDescription}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <div className="module-card-inner">
        <div className="module-card-face module-card-front" aria-hidden={isFlipped}>
          <div className={`module-card-image ${module.visual}`} />
          <div className="module-card-text">
            <span className="module-label">{module.moduleLabel}</span>
            <h2>{module.title}</h2>
            <p>{module.shortDescription}</p>
            <span className="flip-hint">Hover to explore &rarr;</span>
          </div>
        </div>

        <div className="module-card-face module-card-back" aria-hidden={!isFlipped}>
          <div>
            <span className="module-label">{module.backDescription}</span>
            <h2>{module.backTitle}</h2>

            <ul>
              {module.keyConcepts.map((concept) => (
                <li key={concept}>{concept}</li>
              ))}
            </ul>
          </div>

          <div className="module-meta">
            <span>{module.estimatedTime}</span>
            <a href={module.link} tabIndex={isFlipped ? 0 : -1} onClick={handleModuleLinkClick}>
              Start Module &rarr;
            </a>
          </div>
        </div>
      </div>
    </article>
  )
}

export default ModuleCard
