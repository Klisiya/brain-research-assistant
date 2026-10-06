import { sessionFetch } from './session'

export type LearningStatus = 'not_started' | 'in_progress' | 'completed'
export type LearningAction = 'start' | 'complete' | 'incomplete'
export type Activity = { status: LearningStatus; startedAt: string | null; lastActivityAt: string | null; selfCompletedAt: string | null }
export type LearningModule = Activity & { moduleId: number; available: boolean; slug: string | null; title: string | null }
export type LearningResource = Activity & { kind: 'course' | 'module'; resourceId: number; version: number; displayName: string; moduleSlug: string | null; history: (Activity & { version: number })[] }
export type UnavailableEnrollment = { enrollmentId: number; available: false; course: null; enrolledAt: string; lastActivityAt: string }
export type ActiveEnrollment = { enrollmentId: number; available: true; course: { slug: string; title: string }; enrolledAt: string; lastActivityAt: string; completionRuleVersion: number; requiredModuleCount: number; completedModuleCount: number; studyProgressPercent: number; selfCompleted: boolean; verifiedPassed: false; verificationStatus: 'not_available'; continuePath: string; modules: LearningModule[]; resources: LearningResource[] }
export type Enrollment = UnavailableEnrollment | ActiveEnrollment
export class LearningError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v)
const nullableString = (v: unknown) => v === null || typeof v === 'string'
function activity(v: unknown): boolean {
  return record(v) && ['not_started', 'in_progress', 'completed'].includes(String(v.status)) && ['startedAt', 'lastActivityAt', 'selfCompletedAt'].every(k => nullableString(v[k]))
}
function enrollment(v: unknown): v is Enrollment {
  if (!record(v) || !integer(v.enrollmentId) || typeof v.enrolledAt !== 'string' || typeof v.lastActivityAt !== 'string') return false
  if (v.available === false) return v.course === null
  return v.available === true && record(v.course) && typeof v.course.title === 'string' && typeof v.course.slug === 'string'
    && integer(v.completionRuleVersion) && integer(v.requiredModuleCount) && integer(v.completedModuleCount)
    && typeof v.studyProgressPercent === 'number' && v.studyProgressPercent >= 0 && v.studyProgressPercent <= 100
    && typeof v.selfCompleted === 'boolean' && v.verifiedPassed === false && v.verificationStatus === 'not_available'
    && typeof v.continuePath === 'string' && v.continuePath.startsWith('/course/')
    && Array.isArray(v.modules) && v.modules.every(m => record(m) && activity(m) && integer(m.moduleId) && typeof m.available === 'boolean' && nullableString(m.slug) && nullableString(m.title))
    && Array.isArray(v.resources) && v.resources.every(r => record(r) && activity(r) && ['course','module'].includes(String(r.kind)) && integer(r.resourceId) && integer(r.version) && typeof r.displayName === 'string' && nullableString(r.moduleSlug) && Array.isArray(r.history) && r.history.every(h => record(h) && activity(h) && integer(h.version)))
}
async function request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await sessionFetch(url, { cache: 'no-store', ...init })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = record(body) && body.code === 'ENROLLMENT_REQUIRED' ? 'Start Learning to save your learning progress.'
      : record(body) && typeof body.error === 'string' ? body.error : 'Learning state is unavailable. Please retry.'
    throw new LearningError(message, response.status)
  }
  if (!record(body)) throw new LearningError('Invalid learning response.', 503)
  return body
}
const base = (slug: string) => `/api/learning/courses/${encodeURIComponent(slug)}`
export async function getLearningCourse(slug: string, signal: AbortSignal): Promise<ActiveEnrollment | null> {
  const body = await request(base(slug), { signal })
  if (body.enrollment === null) return null
  if (!enrollment(body.enrollment) || !body.enrollment.available) throw new LearningError('Invalid learning response.', 503)
  return body.enrollment
}
export async function getEnrollments(signal: AbortSignal): Promise<Enrollment[]> {
  const body = await request('/api/learning/enrollments', { signal })
  if (!Array.isArray(body.enrollments) || !body.enrollments.every(enrollment)) throw new LearningError('Invalid learning response.', 503)
  return body.enrollments
}
export async function changeLearning(slug: string, operation: { type: 'enroll' } | { type: 'module'; moduleSlug: string; action: LearningAction } | { type: 'resource'; moduleSlug?: string; resourceId: number; version: number; action: LearningAction }, signal: AbortSignal): Promise<ActiveEnrollment> {
  const suffix = operation.type === 'enroll' ? '/enroll' : `${'moduleSlug' in operation && operation.moduleSlug ? `/modules/${encodeURIComponent(operation.moduleSlug)}` : ''}${operation.type === 'resource' ? `/resources/${operation.resourceId}` : ''}/progress`
  const payload = operation.type === 'enroll' ? {} : { action: operation.action, ...(operation.type === 'resource' ? { expectedVersion: operation.version } : {}) }
  const body = await request(base(slug) + suffix, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  if (!enrollment(body.enrollment) || !body.enrollment.available) throw new LearningError('Invalid learning response.', 503)
  return body.enrollment
}

export const statusLabel = (status: LearningStatus) => ({ not_started: 'Not started', in_progress: 'In Progress', completed: 'Completed by learner' })[status]
