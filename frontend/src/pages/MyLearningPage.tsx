import { useCallback } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { coursePath, getCourse, modulePath, PRIMARY_COURSE_SLUG } from '../api/courses'
import { getLearningCourse, statusLabel } from '../api/learning'
import { getPaperReadings, readingLabel } from '../api/reading'
import { useAuth } from '../auth/useAuth'
import { useCourseRead } from '../hooks/useCourseRead'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import PageParticleBackground from '../components/PageParticleBackground'
import './MyLearningPage.css'

function MyLearningContent({ account }: { account: number }) {
  const readCourse = useCallback((signal: AbortSignal) => getCourse(PRIMARY_COURSE_SLUG, signal), [])
  const readProgress = useCallback((signal: AbortSignal) => getLearningCourse(PRIMARY_COURSE_SLUG, signal), [])
  const course = useCourseRead('my-learning-course', readCourse)
  const progress = useCourseRead(`my-learning-progress:${account}`, readProgress)
  const papers = useCourseRead(`my-learning-papers:${account}`, getPaperReadings)
  const saved = progress.data
  // A compatibility record alone is not learning activity. Earlier resource versions still count.
  const courseActivity = Boolean(saved?.modules.some(row => row.status !== 'not_started')
    || saved?.resources.some(row => row.status !== 'not_started' || row.history.some(version => version.status !== 'not_started')))
  // This endpoint is already ordered by explicit Paper activity. It does not include attachment-only history.
  const paper = papers.data?.find(row => row.available && row.status !== 'not_started')
  const readablePaper = paper?.available ? paper : null
  const hasActivity = courseActivity || Boolean(readablePaper)
  const loading = course.loading || progress.loading || papers.loading
  const unavailable = Boolean(course.error || progress.error || papers.error)
  const module = course.data?.modules.find(row => saved && modulePath(PRIMARY_COURSE_SLUG, row.slug) === saved.continuePath)
  const firstModule = course.data?.modules[0]
  const startPath = firstModule ? modulePath(PRIMARY_COURSE_SLUG, firstModule.slug) : coursePath(PRIMARY_COURSE_SLUG)
  const paperPath = readablePaper ? `/papers/${encodeURIComponent(readablePaper.paper.slug)}` : null
  const destination = courseActivity && saved ? saved.continuePath : paperPath ?? startPath
  const target = courseActivity ? module : readablePaper ? null : firstModule
  const targetProgress = saved?.modules.find(row => row.moduleId === target?.id && row.available)
  const resource = saved?.resources.find(row => row.status !== 'not_started' || row.history.some(version => version.status !== 'not_started'))
  const resourceActivity = resource?.status !== 'not_started' ? resource : resource?.history.find(row => row.status !== 'not_started')
  const unavailablePaperHistory = papers.data?.some(row => !row.available)
  const retry = () => { course.retry(); progress.retry(); papers.retry() }
  return <>
    <header className="ml-header"><h1>My Learning</h1><p>Your place to start or continue learning.</p></header>
    <section className="ml-next" aria-labelledby="ml-next-heading" aria-busy={loading}>
      {loading ? <><h2 id="ml-next-heading">Your next step</h2><p role="status">Loading your learning…</p></>
        : unavailable ? <><h2 id="ml-next-heading">Learning state unavailable</h2><p role="alert">We could not load your learning state. Try again to find where to continue.</p><button type="button" onClick={retry}>Refresh learning</button><Link className="ml-secondary" to={coursePath(PRIMARY_COURSE_SLUG)}>Open Course Overview →</Link></>
        : <>
          <p className="ml-eyebrow">{hasActivity ? 'Continue your learning' : 'Your first step'}</p>
          <h2 id="ml-next-heading">{target ? `Module ${String(target.number).padStart(2, '0')}` : readablePaper && !courseActivity ? 'Continue reading' : 'Course Overview'}</h2>
          {target ? <div className="ml-target"><p>{target.title}</p><p lang="zh">{target.titleZh}</p><span>{target.durationHours} Hours</span>{courseActivity && targetProgress && <span>{statusLabel(targetProgress.status)}</span>}</div>
            : readablePaper && !courseActivity ? <><p className="ml-paper-title">{readablePaper.paper.title}</p><p className="ml-note">{readingLabel(readablePaper.status)}</p></> : null}
          {!hasActivity && <p className="ml-note">Start with the first module. Record your progress as you learn.</p>}
          {courseActivity && saved?.selfCompleted && <p>All required modules marked complete by you.</p>}
          <div className="ml-actions"><Link className="ml-primary" to={destination}>{hasActivity ? 'Continue Learning' : 'Start Learning'}</Link><Link className="ml-secondary" to={coursePath(PRIMARY_COURSE_SLUG)}>Course Overview →</Link></div>
          {courseActivity && saved && <p className="ml-progress">{saved.completedModuleCount} of {saved.requiredModuleCount} required modules completed <span>· Self-reported Progress</span></p>}
        </>}
    </section>
    {!loading && !unavailable && (resource || (courseActivity && readablePaper) || unavailablePaperHistory) && <section className="ml-records" aria-labelledby="ml-records-heading">
      <h2 id="ml-records-heading">Recorded learning</h2>
      {resource && resourceActivity && <div className="ml-record"><div><p className="ml-eyebrow">Course resource</p><Link to={resource.moduleSlug ? modulePath(PRIMARY_COURSE_SLUG, resource.moduleSlug) : coursePath(PRIMARY_COURSE_SLUG)}>{resource.displayName}</Link><p className="ml-note">{resource.status === 'not_started' ? 'Earlier version' : 'Version'} {resourceActivity.version} · {statusLabel(resourceActivity.status)}</p></div><span className="ml-record-hint">Open {resource.moduleSlug ? 'module' : 'course'} →</span></div>}
      {courseActivity && readablePaper && <div className="ml-record"><div><p className="ml-eyebrow">Recent Paper</p><Link to={paperPath!}>{readablePaper.paper.title}</Link><p className="ml-note">{readingLabel(readablePaper.status)}</p></div><span className="ml-record-hint">Open paper →</span></div>}
      {unavailablePaperHistory && <p className="ml-note">Some recorded papers are unavailable. Their history remains in Progress.</p>}
    </section>}
    <nav className="ml-shortcuts" aria-label="Personal learning tools">
      <Link to="/progress"><span>Progress<small>View your learning record</small></span><span aria-hidden="true">→</span></Link>
      <Link to="/bookmarks"><span>Bookmarks<small>Open your saved places</small></span><span aria-hidden="true">→</span></Link>
    </nav>
  </>
}

export default function MyLearningPage() {
  const { state, refreshAuth } = useAuth()
  const location = useLocation()
  if (state.status === 'anonymous') return <Navigate replace to="/login" state={{ from: location.pathname }} />
  return <div className="app-shell my-learning-page">
    <PageParticleBackground />
    <a className="ml-skip" href="#my-learning-main">Skip to My Learning</a>
    <div className="ml-desktop-nav"><Navbar /></div>
    <nav className="ml-mobile-nav" aria-label="Learning navigation"><Link to="/">Brain Research</Link><Link to={coursePath(PRIMARY_COURSE_SLUG)}>Course Overview →</Link></nav>
    <main id="my-learning-main" className="ml-main" tabIndex={-1}>
      {state.status === 'authenticated' ? <MyLearningContent key={state.user.id} account={state.user.id} />
        : <><h1>My Learning</h1>{state.status === 'loading' ? <p role="status">Checking sign-in…</p> : <><p role="alert">Sign-in status unavailable.</p><button type="button" onClick={() => void refreshAuth()}>Retry sign-in</button></>}</>}
    </main><Footer />
  </div>
}
