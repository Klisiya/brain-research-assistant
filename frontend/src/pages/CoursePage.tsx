import { useCallback, useEffect } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { courseApiPath, coursePath, getCourse, getModule, getResources, modulePath, type CourseDetail, type ModuleDetail } from '../api/courses'
import { useAuth } from '../auth/useAuth'
import { useCourseRead } from '../hooks/useCourseRead'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import PageParticleBackground from '../components/PageParticleBackground'
import '../components/modules/MorphModuleCard.css'
import './CoursePage.css'

function Resources({ url }: { url: string }) {
  const { state: auth } = useAuth()
  const reader = useCallback((signal: AbortSignal) => getResources(url, signal), [url])
  const state = useCourseRead(`${url}:${auth.status}:${auth.user?.id ?? ''}`, reader)
  return <section className="course-resources course-glass" aria-labelledby="resources-heading" aria-busy={state.loading}>
    <h2 id="resources-heading">Resources</h2>
    {state.loading ? <p role="status">Loading resources…</p> : state.error ? <><p role="alert">Resources are currently unavailable.</p><button onClick={state.retry} type="button">Try again</button></> : !state.data?.length ? <p>No resources have been published yet.</p> : <ul>
      {state.data.map(resource => <li key={resource.id}>
        {resource.externalUrl ? <a href={resource.externalUrl} target="_blank" rel="noopener noreferrer">{resource.displayName}<span> ↗</span></a> : <a href={resource.downloadUrl ?? undefined}>{resource.displayName}</a>}
        <small>{resource.attachmentType.replaceAll('_', ' ')} · Version {resource.version}</small>
        {resource.description && <p>{resource.description}</p>}
      </li>)}
    </ul>}
  </section>
}

export default function CoursePage() {
  const { courseSlug = '', moduleSlug } = useParams()
  const location = useLocation()
  const reader = useCallback((signal: AbortSignal): Promise<CourseDetail | ModuleDetail> => moduleSlug ? getModule(courseSlug, moduleSlug, signal) : getCourse(courseSlug, signal), [courseSlug, moduleSlug])
  const state = useCourseRead(courseApiPath(courseSlug, moduleSlug), reader)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (location.hash === '#modules' && state.data) {
        const target = document.getElementById('modules')
        const navbar = document.querySelector('.course-page .navbar')
        if (target) {
          target.style.scrollMarginTop = `${(navbar?.getBoundingClientRect().height ?? 96) + 28}px`
          target.scrollIntoView({ block: 'start' })
        }
      } else if (!location.hash) window.scrollTo({ top: 0, left: 0 })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [location.pathname, location.hash, state.data])
  const data = state.data
  const detail = data && 'module' in data ? data : null
  const course = detail ? detail.course : data as CourseDetail | null
  const overview = data && 'modules' in data ? data : null
  return <div className="app-shell course-page">
    <PageParticleBackground /><Navbar />
    <main className="course-main" aria-busy={state.loading}>
      {!course ? <div className="course-status course-glass">
        <p className="course-eyebrow">Learning Center</p>
        <h1>{state.loading ? 'Loading course…' : state.error === 'not-found' ? (moduleSlug ? 'Module not found' : 'Course not found') : 'Course unavailable'}</h1>
        <p role={state.error ? 'alert' : 'status'}>{state.loading ? 'Preparing the course content.' : state.error === 'not-found' ? 'This content does not exist or has not been published.' : 'We could not load this content. Please try again.'}</p>
        {state.error === 'unavailable' && <button onClick={state.retry} type="button">Try again</button>}
        {state.error && <Link to="/">Back to Home</Link>}
      </div> : <>
        <nav className="course-breadcrumb" aria-label="Breadcrumb"><Link to="/">Home</Link><span aria-hidden="true">/</span>{detail ? <><Link to={coursePath(course.slug)}>Course Overview</Link><span aria-hidden="true">/</span><span aria-current="page">Module {detail.module.number}</span></> : <span aria-current="page">Course Overview</span>}</nav>
        <header className="course-header">
          <p className="course-eyebrow">{detail ? `Module ${String(detail.module.number).padStart(2, '0')} · ${detail.module.category}` : 'Course Overview'}</p>
          <h1>{detail ? detail.module.title : course.title}</h1>
          {(detail?.module.titleZh || course.titleZh) && <p lang="zh" className="course-title-zh">{detail ? detail.module.titleZh : course.titleZh}</p>}
          <p className="course-description">{detail ? detail.module.description : course.description}</p>
          <div className="course-stats">{detail ? <span><strong>{detail.module.durationHours}</strong> Estimated hours</span> : <><span><strong>{course.moduleCount}</strong> Learning modules</span><span><strong>{course.totalHours}</strong> Estimated hours</span></>}</div>
        </header>
        {detail ? <>
          <section className="course-focus course-glass"><h2>Learning Focus</h2><p>{detail.module.learningFocus}</p></section>
          <Resources key={courseApiPath(course.slug, detail.module.slug)} url={`${courseApiPath(course.slug, detail.module.slug)}/resources`} />
          <Link className="course-back" to={`${coursePath(course.slug)}#modules`}>Explore all modules →</Link>
        </> : overview && <>
          <section className="course-focus course-glass"><h2>Fields of Study</h2><ul className="course-categories">{course.categories.map(category => <li key={category}>{category}</li>)}</ul></section>
          <section id="modules" className="course-module-section" aria-labelledby="modules-heading">
            <div className="course-section-heading"><p className="course-eyebrow">The learning journey</p><h2 id="modules-heading">Learning Modules</h2></div>
            {!overview.modules.length ? <p>No modules have been published yet.</p> : <div className="course-module-grid">{overview.modules.map(module => <Link className="course-module-card course-glass" to={modulePath(course.slug, module.slug)} key={module.slug}>
              <div className={`course-module-cover morph-module-visual ${module.coverVariant}`} aria-hidden="true" />
              <div className="course-module-copy"><span className="course-eyebrow">Module {String(module.number).padStart(2, '0')} · {module.durationHours} Hours</span><h3>{module.title}</h3><p lang="zh" className="course-title-zh">{module.titleZh}</p><span className="course-category">{module.category}</span><p>{module.description}</p><div className="course-module-focus"><strong>Learning focus</strong><p>{module.learningFocus}</p></div><span className="course-open">Explore module →</span></div>
            </Link>)}</div>}
          </section>
          <Resources key={courseApiPath(course.slug)} url={`${courseApiPath(course.slug)}/resources`} />
        </>}
      </>}
    </main><Footer />
  </div>
}
