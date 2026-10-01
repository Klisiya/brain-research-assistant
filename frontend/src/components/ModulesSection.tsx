import { useCallback } from 'react'
import { getCourse, PRIMARY_COURSE_SLUG } from '../api/courses'
import { useCourseRead } from '../hooks/useCourseRead'
import ModulesMorphSection from './modules/ModulesMorphSection'
import './modules/ModulesMorphSection.css'

export default function ModulesSection() {
  const reader = useCallback((signal: AbortSignal) => getCourse(PRIMARY_COURSE_SLUG, signal), [])
  const state = useCourseRead(PRIMARY_COURSE_SLUG, reader)
  if (state.data?.modules.length) return <ModulesMorphSection modules={state.data.modules} courseSlug={state.data.slug} courseTitle={state.data.title} />
  return <section id="modules" className="modules-morph-section" aria-label="Learning modules" aria-busy={state.loading}>
    <div className="modules-scroll-track"><div className="modules-sticky-stage modules-read-state">
      <h2>Learning Modules</h2>
      <p role="status">{state.loading ? 'Loading course modules…' : state.error ? 'Course modules are currently unavailable.' : 'No published modules are available.'}</p>
      {state.error && <button type="button" onClick={state.retry}>Try again</button>}
      {state.loading && <div className="modules-skeleton-grid" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <div className="module-skeleton" key={i} />)}</div>}
    </div></div>
  </section>
}
