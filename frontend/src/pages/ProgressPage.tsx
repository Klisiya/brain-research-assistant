import { useCallback } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { coursePath, getCourse, modulePath, PRIMARY_COURSE_SLUG } from '../api/courses'
import { getEnrollments, type LearningResource, type LearningStatus } from '../api/learning'
import { getPaperReadings } from '../api/reading'
import { useAuth } from '../auth/useAuth'
import { useCourseRead } from '../hooks/useCourseRead'
import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import PageParticleBackground from '../components/PageParticleBackground'
import './CoursePage.css'
import './LearningPage.css'
import './ProgressPage.css'

const moduleLabels = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' }
const resourceLabels = { not_started: 'Not started', in_progress: 'Started', completed: 'Completed' }
const paperLabels = { not_started: 'Not started', in_progress: 'Reading', completed: 'Read' }
const symbols = { not_started: '○', in_progress: '◐', completed: '✓' }
const hasResourceActivity = (resource: LearningResource) => resource.status !== 'not_started'
  || resource.history.some(version => version.status !== 'not_started')

function Status({ status, label = moduleLabels[status] }: { status: LearningStatus; label?: string }) {
  return <span className={`pw-status is-${status}`}><span aria-hidden="true">{symbols[status]}</span>{label}</span>
}

function ProgressContent({ account }: { account: number }) {
  const readCourse = useCallback((signal: AbortSignal) => getCourse(PRIMARY_COURSE_SLUG, signal), [])
  const course = useCourseRead('progress-course', readCourse)
  const learning = useCourseRead(`progress-records:${account}`, getEnrollments)
  const papers = useCourseRead(`progress-papers:${account}`, getPaperReadings)
  const saved = learning.data?.find(row => row.available && row.course.slug === PRIMARY_COURSE_SLUG)
  const record = saved?.available ? saved : null
  const unavailableCourse = learning.data?.some(row => !row.available)
  const loading = course.loading || learning.loading || papers.loading
  const privateUnavailable = Boolean(learning.error || papers.error)
  const resources = record?.resources.filter(hasResourceActivity) ?? []
  const readings = papers.data?.filter(row => row.status !== 'not_started') ?? []
  const courseActivity = Boolean(record?.modules.some(row => row.status !== 'not_started') || resources.length)
  const empty = !courseActivity && !readings.length && !unavailableCourse
  const modules = [...(course.data?.modules ?? [])].sort((a, b) => a.number - b.number)
  const startPath = modules[0] ? modulePath(PRIMARY_COURSE_SLUG, modules[0].slug) : coursePath(PRIMARY_COURSE_SLUG)
  const unavailableModules = record?.modules.filter(row => !row.available) ?? []
  const retry = () => { course.retry(); learning.retry(); papers.retry() }

  if (loading) return <p role="status" className="pw-message">Loading your progress…</p>
  if (privateUnavailable) return <section className="pw-message" aria-label="Progress unavailable">
    <p role="alert">We could not load your progress. Your saved records have not changed.</p>
    <button type="button" onClick={retry}>Refresh progress</button>
  </section>

  return <>
    {course.error ? <section className="pw-message" aria-label="Course unavailable">
      <h2>Course details unavailable</h2><p role="alert">Module details could not be loaded. Any saved learning history is preserved.</p>
      <button type="button" onClick={course.retry}>Refresh course details</button>
    </section> : <>
      <section className="pw-summary" aria-label="Learning summary">
        {empty ? <><p className="pw-empty">No learning progress yet.</p><Link className="pw-primary" to={startPath}>Start Learning</Link></>
          : courseActivity && record ? <>
            <dl className="pw-totals">
              <div><dt>Modules completed</dt><dd>{record.completedModuleCount}<span> / {record.requiredModuleCount}</span></dd></div>
              <div><dt>Modules in progress</dt><dd>{record.modules.filter(row => row.status === 'in_progress').length}</dd></div>
            </dl>
            <Link className="pw-continue" to={record.continuePath}>Continue Learning →</Link>
          </> : <p>Your recorded learning is shown below.</p>}
      </section>

      <section className="pw-modules" aria-labelledby="pw-modules-heading">
        <div className="pw-section-heading"><h2 id="pw-modules-heading">Module progress</h2>
          <span>{course.data?.moduleCount} Modules · {course.data?.totalHours} Hours</span></div>
        <ol className="pw-module-list">
          {modules.map(module => {
            const progress = record?.modules.find(row => row.moduleId === module.id)
            // Missing records after a successful read mean no activity; unavailable identities stay redacted.
            if (progress?.available === false) return null
            const status = progress?.status ?? 'not_started'
            return <li key={module.id} className={`is-${status}`}>
              <Link className="pw-module-link" to={modulePath(PRIMARY_COURSE_SLUG, module.slug)}>
                <span className="pw-module-number"><span>Module</span>{String(module.number).padStart(2, '0')}</span>
                <div className="pw-module-copy"><h3>{module.title}</h3><p lang="zh">{module.titleZh}</p>
                  <div className="pw-module-meta"><span>{module.durationHours} Hours</span><Status status={status} /></div></div>
                <span className="pw-module-arrow" aria-hidden="true">→</span>
              </Link>
            </li>
          })}
        </ol>
        {!!unavailableModules.length && <div className="pw-unavailable-modules"><p>Some module details are unavailable. Their recorded status is preserved.</p>
          <ul>{unavailableModules.map(row => <li key={row.moduleId}>Unavailable module <Status status={row.status} /></li>)}</ul>
        </div>}
      </section>
    </>}

    {unavailableCourse && <p className="pw-message">A recorded course is unavailable. Its learning history is preserved.</p>}
    {!!resources.length && <section className="pw-records" aria-labelledby="pw-resources-heading">
      <h2 id="pw-resources-heading">Resource progress</h2>
      <p className="pw-section-note">Completion applies to the version shown.</p>
      <ul className="pw-record-list">{resources.map(resource => <li key={`${resource.kind}:${resource.resourceId}`}>
        <span className="pw-kind">{resource.kind === 'module' ? 'Module resource' : 'Course resource'}</span>
        <h3><Link to={resource.moduleSlug ? modulePath(PRIMARY_COURSE_SLUG, resource.moduleSlug) : coursePath(PRIMARY_COURSE_SLUG)}>{resource.displayName}</Link></h3>
        <p className="pw-version">Current version {resource.version}<Status status={resource.status} label={resourceLabels[resource.status]} /></p>
        {!!resource.history.filter(version => version.status !== 'not_started').length && <ul className="pw-history" aria-label={`Earlier versions of ${resource.displayName}`}>
          {resource.history.filter(version => version.status !== 'not_started').map(version => <li key={version.version}>Earlier version {version.version}<Status status={version.status} label={resourceLabels[version.status]} /></li>)}
        </ul>}
      </li>)}</ul>
    </section>}

    {!!readings.length && <section className="pw-records" aria-labelledby="pw-papers-heading">
      <h2 id="pw-papers-heading">Paper progress</h2>
      <ul className="pw-record-list">{readings.map(row => <li key={row.progressId} className="pw-paper-row">
        <h3>{row.available ? <Link to={`/papers/${encodeURIComponent(row.paper.slug)}`}>{row.paper.title}</Link> : 'Unavailable paper'}</h3>
        <Status status={row.status} label={paperLabels[row.status]} />
      </li>)}</ul>
    </section>}
  </>
}

export default function ProgressPage() {
  const { state, refreshAuth } = useAuth()
  const location = useLocation()
  if (state.status === 'anonymous') return <Navigate replace to="/login" state={{ from: location.pathname }} />
  return <div className="app-shell course-page learning-page"><PageParticleBackground /><Navbar />
    <main className="course-main pw-main" id="progress-main" tabIndex={-1}>
      <header className="pw-header"><div><h1>Progress</h1><p>Your self-reported learning record. Completion is not an assessment result.</p></div><Link to="/my-learning">My Learning →</Link></header>
      {state.status === 'authenticated' ? <ProgressContent key={state.user.id} account={state.user.id} />
        : state.status === 'loading' ? <p role="status">Checking sign-in…</p>
        : <section className="pw-message"><p role="alert">Sign-in status unavailable.</p><button type="button" onClick={() => void refreshAuth()}>Retry sign-in</button></section>}
    </main><Footer />
  </div>
}
