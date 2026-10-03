import { Link } from 'react-router-dom'
import type { ActiveEnrollment, LearningAction, LearningStatus } from '../../api/learning'
import type { LearningController } from '../../hooks/useLearningCourse'
import '../../pages/LearningPage.css'

import { statusLabel } from '../../api/learning'
export function StudyProgress({ enrollment }: { enrollment: ActiveEnrollment }) {
  return <div className="study-progress"><p><strong>Study progress: {enrollment.studyProgressPercent}%</strong> · {enrollment.completedModuleCount}/{enrollment.requiredModuleCount} required modules</p>
    <div className="study-progress-track" role="progressbar" aria-label="Self-reported study progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={enrollment.studyProgressPercent}><span style={{ width: `${enrollment.studyProgressPercent}%` }} /></div>
    <p className="learning-note">Self-reported learning. Assessment verification is not yet available.</p></div>
}
function ActivityControls({ status, busy, action }: { status: LearningStatus; busy: boolean; action: (action: LearningAction) => void }) {
  return <div className="learning-actions"><span>{statusLabel(status)}</span>{status === 'not_started' && <button type="button" disabled={busy} onClick={() => action('start')}>Start learning</button>}<button type="button" disabled={busy} onClick={() => action(status === 'completed' ? 'incomplete' : 'complete')}>{status === 'completed' ? 'Mark as Incomplete' : 'Mark as Complete'}</button></div>
}
export function CourseLearning({ learning, moduleSlug, returnPath }: { learning: LearningController; moduleSlug?: string; returnPath: string }) {
  const { auth, data, loading, error, run, busy } = learning
  return <section className="learning-panel" aria-label="Your learning">
    <h2>Your learning</h2>
    {auth.status === 'anonymous' ? <Link to="/login" state={{ from: returnPath }}>Sign in to enroll</Link> : auth.status === 'unavailable' ? <><p role="alert">Sign-in status unavailable.</p><button type="button" onClick={() => void learning.refreshAuth()}>Retry sign-in</button></> : auth.status === 'loading' || loading ? <p role="status">Loading learning state…</p> : error ? <><p role="alert">Learning state is unavailable.</p><button onClick={learning.retry} type="button">Retry learning state</button></> : !data ? <><p>Enroll to save your learning across devices.</p><button disabled={busy} type="button" onClick={() => void run({ type: 'enroll' })}>Enroll</button></> : <>
      <StudyProgress enrollment={data} /><Link to={data.continuePath}>Continue Learning</Link> · <Link to="/progress">View Progress</Link>
      {moduleSlug && (() => { const module = data.modules.find(m => m.slug === moduleSlug); return module ? <ActivityControls status={module.status} busy={busy} action={action => void run({ type: 'module', moduleSlug, action })} /> : <p>This module is outside your enrollment completion rule.</p> })()}
    </>}
    {learning.errorMessage && <p role="alert">{learning.errorMessage} <button type="button" onClick={learning.retry}>Reload learning state</button></p>}
    <p role="status" aria-live="polite">{learning.message}</p>
  </section>
}
export function ResourceLearning({ learning, resourceId, version, moduleSlug }: { learning: LearningController; resourceId: number; version: number; moduleSlug?: string }) {
  if (learning.auth.status !== 'authenticated' || !learning.data) return null
  const resource = learning.data.resources.find(r => r.resourceId === resourceId && r.kind === (moduleSlug ? 'module' : 'course') && r.moduleSlug === (moduleSlug ?? null))
  if (!resource) return null
  if (version !== resource.version) return <div className="learning-resource"><p>Resource version changed. Reload to see the current resource.</p><button type="button" onClick={() => window.location.reload()}>Reload resources</button></div>
  return <div className="learning-resource" role="group" aria-label={`Learning status for ${resource.displayName}`}>
    <ActivityControls status={resource.status} busy={learning.busy} action={action => void learning.run({ type: 'resource', resourceId, version, moduleSlug, action })} />
    {resource.history.some(h => h.selfCompletedAt) && <p className="learning-note">Earlier versions completed: {resource.history.filter(h => h.selfCompletedAt).map(h => h.version).join(', ')}. Each version is tracked separately.</p>}
  </div>
}
