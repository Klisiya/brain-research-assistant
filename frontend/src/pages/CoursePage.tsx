import { useCallback, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { courseApiPath, coursePath, getCourse, getResources, modulePath, type CourseDetail } from '../api/courses'
import { statusLabel } from '../api/learning'
import { useAuth } from '../auth/useAuth'
import { useCourseRead } from '../hooks/useCourseRead'
import { useLearningCourse, type LearningController } from '../hooks/useLearningCourse'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import './CoursePage.css'
import { ResourceLearning } from '../components/learning/LearningControls'
import BookmarkControl from '../components/learning/BookmarkControl'

function Resources({ courseSlug, learning }: { courseSlug: string; learning: LearningController }) {
  const { state: auth } = useAuth()
  const url = `${courseApiPath(courseSlug)}/resources`
  const reader = useCallback((signal: AbortSignal) => getResources(url, signal), [url])
  const state = useCourseRead(`${url}:${auth.status}:${auth.user?.id ?? ''}`, reader)
  if (state.loading) return <p className="co-resource-state" role="status">Loading course resources…</p>
  if (!state.error && !state.data?.length) return null
  return <section className="co-resources" aria-labelledby="resources-heading">
    <h2 id="resources-heading">Course resources</h2>
    {state.error ? <><p role="alert">Course resources are unavailable.</p><button onClick={state.retry} type="button">Retry resources</button></> : <ul>
      {state.data?.map(resource => <li key={resource.id}>
        {resource.externalUrl ? <a href={resource.externalUrl} target="_blank" rel="noopener noreferrer">{resource.displayName} ↗</a> : resource.downloadUrl ? <a href={resource.downloadUrl}>{resource.displayName}</a> : <span>{resource.displayName}</span>}
        <small>{resource.attachmentType.replaceAll('_', ' ')} · Version {resource.version}</small>
        {resource.description && <p>{resource.description}</p>}
        <ResourceLearning learning={learning} resourceId={resource.id} version={resource.version} />
      </li>)}
    </ul>}
  </section>
}

function CourseJourney({ course, learning, hasActivity, target }: { course: CourseDetail; learning: LearningController; hasActivity: boolean; target: CourseDetail['modules'][number] | undefined }) {
  const { auth, data, loading, error } = learning
  const navigate = useNavigate()
  const startRequested = useRef(false)
  // Only the explicit Start action creates the existing R5 record; its response determines the destination.
  useEffect(() => {
    if (error || learning.errorMessage) startRequested.current = false
    if (startRequested.current && data && !loading) {
      startRequested.current = false
      void navigate(data.continuePath)
    }
  }, [data, loading, error, learning.errorMessage, navigate])
  const available = auth.status === 'anonymous' || (auth.status === 'authenticated' && !loading && !error)
  return <section className="co-journey" aria-label="Your learning" aria-busy={auth.status === 'loading' || loading}>
    <div className="co-next">
      <p className="course-eyebrow">Your learning</p>
      <h2>{available && data?.selfCompleted ? 'All required modules completed' : available && target ? `${hasActivity ? 'Continue with' : 'Start with'} Module ${String(target.number).padStart(2, '0')}` : 'Learning progress'}</h2>
      {available && target && <p className="co-next-title">{target.title}</p>}
      {auth.status === 'anonymous' ? <Link className="co-primary" to="/login" state={{ from: coursePath(course.slug) }}>Sign in to start learning</Link>
        : auth.status === 'unavailable' ? <><p role="alert">Sign-in status unavailable.</p><button type="button" onClick={() => void learning.refreshAuth()}>Retry sign-in</button></>
        : auth.status === 'loading' || loading ? <p role="status">Loading learning progress…</p>
        : error ? <><p role="alert">Learning progress is unavailable. You can still open the modules below.</p><button type="button" onClick={learning.retry}>Retry progress</button></>
        : !data ? <><p className="co-note">No saved learning activity yet.</p><button className="co-primary" type="button" disabled={learning.busy || !course.modules.length} onClick={() => { startRequested.current = true; void learning.run({ type: 'enroll' }) }}>Start Learning</button></>
        : <div className="co-actions"><Link className="co-primary" to={data.continuePath}>{hasActivity ? 'Continue Learning' : 'Start Learning'}</Link><Link className="co-progress-link" to="/progress">View Progress →</Link></div>}
      {learning.errorMessage && <p role="alert">{learning.errorMessage} <button type="button" onClick={learning.retry}>Reload progress</button></p>}
    </div>
    {auth.status === 'authenticated' && data && <div className="co-progress">
      <p><strong>{data.studyProgressPercent}%</strong> <span>Progress</span></p>
      <div className="co-progress-track" role="progressbar" aria-label="Self-reported study progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.studyProgressPercent}><span style={{ width: `${data.studyProgressPercent}%` }} /></div>
      <p>{data.completedModuleCount} of {data.requiredModuleCount} required modules completed</p>
      <p className="co-note">Self-reported learning. Completion is recorded only when you mark it.</p>
    </div>}
  </section>
}

export default function CoursePage() {
  const { courseSlug = '' } = useParams()
  const location = useLocation()
  const learning = useLearningCourse(courseSlug)
  const reader = useCallback((signal: AbortSignal) => getCourse(courseSlug, signal), [courseSlug])
  const state = useCourseRead(courseApiPath(courseSlug), reader)
  const course = state.data
  const progress = learning.auth.status === 'authenticated' ? learning.data : null
  const hasActivity = Boolean(progress?.modules.some(module => module.status !== 'not_started')
    || progress?.resources.some(resource => resource.status !== 'not_started' || resource.history.some(version => version.status !== 'not_started')))
  const canSuggestStart = learning.auth.status === 'anonymous' || (learning.auth.status === 'authenticated' && !learning.loading && !learning.error && !progress)
  const target = progress ? course?.modules.find(module => modulePath(course.slug, module.slug) === progress.continuePath) : canSuggestStart ? course?.modules[0] : undefined
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (location.hash === '#modules' && course) {
        const target = document.getElementById('modules')
        const navbar = document.querySelector('.co-desktop-nav .navbar')
        if (target) {
          target.style.scrollMarginTop = `${(navbar?.getBoundingClientRect().height ?? 0) + 24}px`
          target.scrollIntoView({ block: 'start' })
        }
      } else if (!location.hash) window.scrollTo({ top: 0, left: 0 })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [location.pathname, location.hash, course])
  return <div className="app-shell course-page course-overview">
    <a className="co-skip" href="#course-main">Skip to course</a>
    <div className="co-desktop-nav"><Navbar /></div>
    <nav className="co-mobile-nav" aria-label="Course navigation"><Link to="/">Brain Research</Link><a href="#modules">Learning Path</a></nav>
    <main id="course-main" tabIndex={-1} className="course-main" aria-busy={state.loading}>
      {!course ? <section className="co-load-state">
        <p className="course-eyebrow">Learning Center</p><h1>{state.loading ? 'Loading course…' : state.error === 'not-found' ? 'Course not found' : 'Course unavailable'}</h1>
        <p role={state.error ? 'alert' : 'status'}>{state.loading ? 'Loading the learning path.' : state.error === 'not-found' ? 'This course does not exist or has not been published.' : 'The learning path could not be loaded. Please try again.'}</p>
        {state.error === 'unavailable' && <button onClick={state.retry} type="button">Retry course</button>}
        {state.error && <Link to="/">Back to Home</Link>}
      </section> : <>
        <nav className="course-breadcrumb" aria-label="Breadcrumb"><Link to="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">Course Overview</span></nav>
        <header className="course-header co-header">
          <div><p className="course-eyebrow">Learning Center</p><h1>Course Overview</h1><p className="co-facts"><span>{course.moduleCount} Modules</span><span>{course.totalHours} Hours</span><span>One semester</span></p></div>
          <BookmarkControl targetType="course" targetId={course.id} showSignInPrompt={false} />
        </header>
        <CourseJourney key={`${course.slug}:${learning.auth.status}:${learning.auth.user?.id ?? ''}`} course={course} learning={learning} hasActivity={hasActivity} target={target} />
        <section id="modules" className="co-curriculum" aria-labelledby="modules-heading">
          <div className="co-curriculum-heading"><h2 id="modules-heading">Learning Path</h2><span>Ordered modules</span></div>
          {!course.modules.length ? <p>Modules have not been published yet.</p> : <ol className="co-path">
            {course.modules.map(module => {
              const activity = progress?.modules.find(row => row.moduleId === module.id && row.available)
              const current = target?.id === module.id
              return <li key={module.id} data-status={activity?.status} data-current={current ? 'true' : undefined}>
                <Link className="co-module" to={modulePath(course.slug, module.slug)} aria-current={current ? 'step' : undefined}>
                  <span className="co-number"><span className="co-number-label">Module</span>{String(module.number).padStart(2, '0')}</span>
                  <div className="co-module-copy"><h3>{module.title}</h3><p lang="zh">{module.titleZh}</p><div className="co-module-meta"><span>{module.durationHours} Hours</span>{activity && <span className="co-state">{statusLabel(activity.status)}</span>}{current && <span className="co-current">{hasActivity ? 'Continue here' : 'Start here'}</span>}</div></div>
                  <span className="co-open">Open module <span aria-hidden="true">→</span></span>
                </Link>
              </li>
            })}
          </ol>}
        </section>
        <Resources key={course.slug} courseSlug={course.slug} learning={learning} />
      </>}
    </main><Footer />
  </div>
}
