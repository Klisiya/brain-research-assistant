import { useRef } from 'react'
import type {
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
  RefCallback,
} from 'react'
import { Link } from 'react-router-dom'
import { modulePath } from '../../api/courses'
import type { LearningModule } from '../../data/modules'
import './MorphModuleCard.css'

type MorphModuleCardProps = {
  courseSlug: string
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
  courseSlug,
  isFlipped,
  module,
  onClose,
  onToggle,
  positionerRef,
}: MorphModuleCardProps) {
  const moduleLabel = getModuleLabel(module.number)
  const touchPointer = useRef(false)
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (touchPointer.current && event.detail > 0 && !isFlipped) {
      event.preventDefault()
      onToggle(module.slug)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.currentTarget !== event.target) {
      return
    }

    if (event.key === ' ') {
      event.preventDefault()
      onToggle(module.slug)
    }

    if (event.key === 'Escape') {
      onClose(module.slug)
    }
  }

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      onClose(module.slug)
    }
  }

  return (
    <div
      className={`module-card-positioner morph-module-positioner${isFlipped ? ' is-active' : ''}`}
      ref={positionerRef}
    >
      <Link
        to={modulePath(courseSlug, module.slug)}
        aria-label={`${moduleLabel}: ${module.title}. Open module.`}
        className={`morph-module-card${isFlipped ? ' is-flipped' : ''}`}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onPointerDown={event => { touchPointer.current = event.pointerType !== 'mouse' }}
        onClick={handleClick}
      >
        <div className="module-card-flipper morph-module-flipper">
          <div aria-hidden="true" className="morph-module-face morph-module-front">
            <div
              aria-hidden="true"
              className={`morph-module-visual ${module.coverVariant}`}
            />
            <div className="morph-module-front-copy">
              <span>{moduleLabel}</span>
              <h3>{module.title}</h3>
            </div>
          </div>

          <div aria-hidden="true" className="morph-module-face morph-module-back">
            <div className="morph-module-back-heading">
              <span>{moduleLabel}</span>
              <h3>{module.title}</h3>
            </div>

            <div className="morph-module-back-meta">
              <span>{module.durationHours} Hours</span>
              {module.category && <span>{module.category}</span>}
            </div>

            {module.description && <p>{module.description}</p>}
          </div>
        </div>
      </Link>
    </div>
  )
}

export default MorphModuleCard
