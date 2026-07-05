import { useEffect, useRef } from 'react'
import ModuleCard from './ModuleCard'
import ModulesStats from './ModulesStats'
import { learningModules } from '../data/modules'
import './ModulesSection.css'

function ModulesSection() {
  const itemRefs = useRef<HTMLElement[]>([])

  useEffect(() => {
    const items = itemRefs.current

    if (!items.length) {
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('is-visible', entry.isIntersecting)
        })
      },
      {
        threshold: 0.16,
        rootMargin: '0px 0px -8% 0px',
      },
    )

    items.forEach((item) => observer.observe(item))

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <section className="modules-section" id="modules" aria-label="Learning modules">
      <ModulesStats />

      <div className="modules-grid">
        {learningModules.map((module, index) => (
          <div
            className="module-reveal-item"
            key={module.id}
            ref={(element) => {
              if (element) {
                itemRefs.current[index] = element
              }
            }}
          >
            <ModuleCard module={module} />
          </div>
        ))}
      </div>
    </section>
  )
}

export default ModulesSection
