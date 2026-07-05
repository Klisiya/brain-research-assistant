import { useEffect, useRef } from 'react'
import './ModulesStats.css'

const moduleStats = [
  {
    id: 'learning-modules',
    icon: '▥',
    value: 10,
    suffix: '',
    title: 'Learning Modules',
    description: 'Structured learning path',
  },
  {
    id: 'research-areas',
    icon: '●',
    value: 6,
    suffix: '',
    title: 'Research Areas',
    description: 'Core topics in brain science',
  },
  {
    id: 'always-learning',
    icon: '◴',
    value: 24,
    suffix: '/7',
    title: 'Learning',
    description: 'Self-paced study experience',
  },
  {
    id: 'educational',
    icon: '☆',
    value: 100,
    suffix: '%',
    title: 'Educational',
    description: 'Designed for learning support',
  },
] as const

function ModulesStats() {
  const statsRef = useRef<HTMLElement>(null)
  const numberRefs = useRef<HTMLSpanElement[]>([])

  useEffect(() => {
    const statsElement = statsRef.current

    if (!statsElement) {
      return undefined
    }

    const intervals: number[] = []
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let hasAnimated = false

    const setFinalValues = () => {
      moduleStats.forEach((stat, index) => {
        const numberElement = numberRefs.current[index]

        if (numberElement) {
          numberElement.textContent = String(stat.value)
        }
      })
    }

    const animateNumber = (index: number) => {
      const stat = moduleStats[index]
      const numberElement = numberRefs.current[index]

      if (!numberElement) {
        return
      }

      let current = 0
      const duration = 1200
      const steps = 45
      const increment = stat.value / steps
      const intervalTime = duration / steps

      const intervalId = window.setInterval(() => {
        current += increment

        if (current >= stat.value) {
          numberElement.textContent = String(stat.value)
          window.clearInterval(intervalId)
        } else {
          numberElement.textContent = String(Math.floor(current))
        }
      }, intervalTime)

      intervals.push(intervalId)
    }

    if (motionQuery.matches) {
      setFinalValues()

      return () => {
        intervals.forEach((intervalId) => window.clearInterval(intervalId))
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          statsElement.classList.toggle('is-visible', entry.isIntersecting)

          if (entry.isIntersecting && !hasAnimated) {
            hasAnimated = true
            moduleStats.forEach((_, index) => animateNumber(index))
          }
        })
      },
      {
        threshold: 0.4,
      },
    )

    observer.observe(statsElement)

    return () => {
      observer.disconnect()
      intervals.forEach((intervalId) => window.clearInterval(intervalId))
    }
  }, [])

  return (
    <section className="modules-stats" aria-label="Learning summary" ref={statsRef}>
      {moduleStats.map((stat, index) => (
        <div className="modules-stats-item" key={stat.id}>
          <div className="modules-stats-icon" aria-hidden="true">
            {stat.icon}
          </div>

          <div>
            <h3>
              <span
                className="modules-stat-number"
                ref={(element) => {
                  if (element) {
                    numberRefs.current[index] = element
                  }
                }}
              >
                0
              </span>
              {stat.suffix} {stat.title}
            </h3>
            <p>{stat.description}</p>
          </div>
        </div>
      ))}
    </section>
  )
}

export default ModulesStats
