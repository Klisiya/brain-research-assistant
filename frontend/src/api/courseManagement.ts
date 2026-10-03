import { apiFetch } from './request'
import { CourseReadError, type CourseDetail } from './courses'
import type { LearningModule } from '../data/modules'

export type ManagedModule = LearningModule & { status: string; updatedAt: string }
export type ManagedCourse = Omit<CourseDetail,'modules'> & { status: string; updatedAt: string; modules: ManagedModule[] }
export type ModuleReading = { relationId: number; readingType: 'required' | 'recommended'; sortOrder: number; status?: string; paper: { slug: string; title: string; authors: string[] } | null }
export type CourseStaffMember = { id: number; userId: number; username: string; role: string; eligible: boolean }
export class CourseManagementError extends CourseReadError {
  constructor(message: string, status: number) { super(status); this.message = message }
}
export async function courseRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(url, { cache: 'no-store', ...init })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new CourseManagementError(typeof body?.error === 'string' ? body.error : 'Course workspace unavailable.', response.status)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CourseManagementError('Invalid course response.',503)
  return body as T
}
export const courseWrite = <T,>(url: string, method: string, body?: unknown) => courseRequest<T>(url, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
export async function getReadings(url: string, signal: AbortSignal) {
  const body = await courseRequest<{ readings: ModuleReading[] }>(url,{signal})
  if (!Array.isArray(body.readings) || !body.readings.every(r => Number.isInteger(r.relationId) && ['required','recommended'].includes(r.readingType) && (r.paper === null || (typeof r.paper?.title === 'string' && typeof r.paper?.slug === 'string' && Array.isArray(r.paper?.authors))))) throw new CourseManagementError('Invalid reading response.',503)
  return body.readings
}
