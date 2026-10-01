import { apiFetch } from './request'
import type { LearningModule } from '../data/modules'

export const PRIMARY_COURSE_SLUG = 'brain-science-and-brain-inspired-intelligence'
export const coursePath = (slug: string) => `/course/${encodeURIComponent(slug)}`
export const modulePath = (course: string, module: string) => `${coursePath(course)}/modules/${encodeURIComponent(module)}`
export const courseApiPath = (course: string, module?: string) => `/api/courses/${encodeURIComponent(course)}${module ? `/modules/${encodeURIComponent(module)}` : ''}`
export type Course = { id: number; slug: string; title: string; titleZh: string | null; description: string; moduleCount: number; totalHours: number; categories: string[] }
export type CourseDetail = Course & { modules: LearningModule[] }
export type ModuleDetail = { course: Course; module: LearningModule }
export type CourseResource = { id: number; displayName: string; description: string | null; attachmentType: string; mimeType: string | null; fileSize: number | null; accessLevel: string; version: number; sortOrder: number; externalUrl: string | null; downloadUrl: string | null }
export class CourseReadError extends Error {
  status: number
  constructor(status: number) { super('Course content is unavailable.'); this.status = status }
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v)
function isCourse(v: unknown): v is Course {
  return record(v) && integer(v.id) && ['slug', 'title', 'description'].every(k => typeof v[k] === 'string') && (v.titleZh === null || typeof v.titleZh === 'string') && integer(v.moduleCount) && integer(v.totalHours) && Array.isArray(v.categories) && v.categories.every(c => typeof c === 'string')
}
function isModule(v: unknown): v is LearningModule {
  return record(v) && integer(v.id) && integer(v.number) && integer(v.durationHours) && Number(v.number) > 0 && Number(v.durationHours) > 0 && ['slug', 'title', 'titleZh', 'category', 'description', 'learningFocus', 'coverVariant'].every(k => typeof v[k] === 'string')
}
async function read(url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await apiFetch(url, { signal, cache: 'no-store' })
  if (!response.ok) throw new CourseReadError(response.status)
  const body: unknown = await response.json()
  if (!record(body)) throw new CourseReadError(503)
  return body
}
export async function getCourse(slug: string, signal: AbortSignal): Promise<CourseDetail> {
  const body = await read(courseApiPath(slug), signal)
  const course = body.course
  if (!record(course) || !Array.isArray(course.modules) || !course.modules.every(isModule) || !isCourse(course)) throw new CourseReadError(503)
  return course as CourseDetail
}
export async function getModule(course: string, module: string, signal: AbortSignal): Promise<ModuleDetail> {
  const body = await read(courseApiPath(course, module), signal)
  if (!isCourse(body.course) || !isModule(body.module)) throw new CourseReadError(503)
  return { course: body.course, module: body.module }
}
export async function getResources(url: string, signal: AbortSignal): Promise<CourseResource[]> {
  const body = await read(url, signal)
  if (!Array.isArray(body.resources) || !body.resources.every(v => record(v) && integer(v.id) && typeof v.displayName === 'string' && typeof v.attachmentType === 'string' && integer(v.version) && integer(v.sortOrder) && (v.downloadUrl === null || (typeof v.downloadUrl === 'string' && v.downloadUrl.startsWith('/api/courses/'))) && (v.externalUrl === null || (typeof v.externalUrl === 'string' && /^https?:\/\//i.test(v.externalUrl))))) throw new CourseReadError(503)
  return body.resources as CourseResource[]
}
