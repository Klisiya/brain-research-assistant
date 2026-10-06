import { useCallback } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { getEnrollments, statusLabel } from '../api/learning'
import { coursePath, modulePath, PRIMARY_COURSE_SLUG } from '../api/courses'
import { useCourseRead } from '../hooks/useCourseRead'
import { StudyProgress } from '../components/learning/LearningControls'
import PaperReadingSummary from '../components/learning/PaperReadingSummary'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import PageParticleBackground from '../components/PageParticleBackground'
import './CoursePage.css'
import './LearningPage.css'

function LearningContent({ account, detailed }: { account: number; detailed: boolean }) {
  const reader = useCallback((signal: AbortSignal) => getEnrollments(signal), [])
  const state = useCourseRead(`enrollments:${account}`, reader)
  return <><h1>{detailed ? 'Progress' : 'My Learning'}</h1><p>Your personal, self-reported learning record.</p>
    {state.loading ? <p role="status">Loading your learning…</p> : state.error ? <section className="learning-panel"><p role="alert">Your learning is unavailable.</p><button type="button" onClick={state.retry}>Retry</button></section> : !state.data?.length ? <section className="learning-panel"><h2>No enrolled courses yet</h2><p>Choose a course and enroll to start recording your learning.</p><Link to={coursePath(PRIMARY_COURSE_SLUG)}>Explore the course</Link></section> : state.data.map(e => <article className="learning-panel" key={e.enrollmentId}>
      {!e.available ? <><h2>Course unavailable</h2><p>Your enrollment and learning history are preserved. This course is not currently published.</p></> : <>
        <h2><Link to={coursePath(e.course.slug)}>{e.course.title || 'Course Overview'}</Link></h2><StudyProgress enrollment={e} />
        <p>Last activity: <time dateTime={e.lastActivityAt}>{new Date(e.lastActivityAt).toLocaleString()}</time></p>
        <Link className="learning-continue" to={e.continuePath}>Continue Learning</Link>
        {detailed && <><h3>Required modules</h3><ol className="learning-module-list">{e.modules.map(m => <li key={m.moduleId}>{m.available && m.slug ? <Link to={modulePath(e.course.slug, m.slug)}>{m.title}</Link> : <span>Module unavailable</span>}<span>{statusLabel(m.status)}</span></li>)}</ol>
          <h3>Current learning resources</h3>{e.resources.length ? <ul>{e.resources.map(r => <li key={`${r.kind}:${r.resourceId}`}><Link to={r.moduleSlug ? modulePath(e.course.slug, r.moduleSlug) : coursePath(e.course.slug)}>{r.displayName}</Link> · Version {r.version} · {statusLabel(r.status)}{r.history.some(h => h.selfCompletedAt) && <p>Earlier completed versions: {r.history.filter(h => h.selfCompletedAt).map(h => h.version).join(', ')}</p>}</li>)}</ul> : <p>No accessible learning resources are available.</p>}</>}
      </>}
    </article>)}
    {detailed && <PaperReadingSummary />}
    <Link to={detailed ? '/my-learning' : '/progress'}>{detailed ? 'My Learning' : 'View Progress'}</Link>
  </>
}
export default function LearningPage({ detailed = false }: { detailed?: boolean }) {
  const { state, refreshAuth } = useAuth(), location = useLocation()
  if (state.status === 'anonymous') return <Navigate replace to="/login" state={{ from: location.pathname }} />
  return <div className="app-shell course-page learning-page"><PageParticleBackground /><Navbar /><main className="course-main">
    {state.status === 'authenticated' ? <LearningContent key={`${state.user.id}:${detailed}`} account={state.user.id} detailed={detailed} /> : state.status === 'loading' ? <p role="status">Checking sign-in…</p> : <section className="learning-panel"><p role="alert">Sign-in status unavailable.</p><button type="button" onClick={() => void refreshAuth()}>Retry sign-in</button></section>}
  </main><Footer /></div>
}
