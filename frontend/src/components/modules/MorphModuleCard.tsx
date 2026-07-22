import type {
  FocusEvent,
  KeyboardEvent,
  PointerEvent,
  RefCallback,
} from 'react'
import type { LearningModule } from '../../data/modules'
import './MorphModuleCard.css'

type MorphModuleCardProps = {
  isFlipped: boolean
  module: LearningModule
  onClose: (moduleId: string) => void
  onToggle: (moduleId: string) => void
  positionerRef: RefCallback<HTMLDivElement>
}

function getModuleLabel(number: number) {
  return `Module ${String(number).padStart(2, '0')}`
}

function MorphModuleCard({
  isFlipped,
  module,
  onClose,
  onToggle,
  positionerRef,
}: MorphModuleCardProps) {
  const moduleLabel = getModuleLabel(module.number)

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse') {
      return
    }

    event.currentTarget.focus({ preventScroll: true })
    onToggle(module.id)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.currentTarget !== event.target) {
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle(module.id)
    }

    if (event.key === 'Escape') {
      onClose(module.id)
    }
  }

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      onClose(module.id)
    }
  }

  return (
    <div
      className={`module-card-positioner morph-module-positioner${isFlipped ? ' is-active' : ''}`}
      ref={positionerRef}
    >
      <article
        aria-expanded={isFlipped}
        aria-label={`${moduleLabel}: ${module.title}. Activate to read the course description.`}
        className={`morph-module-card${isFlipped ? ' is-flipped' : ''}`}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onPointerUp={handlePointerUp}
        role="button"
        tabIndex={0}
      >
        <div className="module-card-flipper morph-module-flipper">
          <div aria-hidden={isFlipped} className="morph-module-face morph-module-front">
            <div
              aria-hidden="true"
              className={`morph-module-visual ${module.coverVariant}`}
            />
            <div className="morph-module-front-copy">
              <span>{moduleLabel}</span>
              <h3>{module.title}</h3>
            </div>
          </div>

          <div aria-hidden={!isFlipped} className="morph-module-face morph-module-back">
            <div className="morph-module-back-heading">
              <span>{moduleLabel}</span>
              <h3>{module.title}</h3>
            </div>

            <div className="morph-module-back-meta">
              <span>{module.durationHours} Hours</span>
              <span>{module.category}</span>
            </div>

            <p>{module.description}</p>
          </div>
        </div>
      </article>
    </div>
  )
}

export default MorphModuleCard
