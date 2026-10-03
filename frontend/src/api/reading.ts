import { sessionFetch } from './session'
import type { Activity, LearningAction } from './learning'

export type BookmarkType = 'paper' | 'course' | 'module' | 'research_area'
export type BookmarkTarget = { id: number; slug: string; title: string; authors?: string[]; year?: number | null; journal?: string | null; titleZh?: string | null; description?: string; number?: number; courseSlug?: string; courseTitle?: string; code?: string; overview?: string }
export type Bookmark = { id: number; targetType: BookmarkType; createdAt: string } & ({ available: false; target: null } | { available: true; target: BookmarkTarget })
export type PaperReadingResource = Activity & { attachmentId: number; version: number; displayName: string; history: (Activity & { version: number })[] }
export type PaperReading = Activity & { resources: PaperReadingResource[]; unavailableHistory: (Activity & { progressId: number; version: number })[] }
export type ReadingSummary = Activity & { progressId: number } & ({ available: false; paper: null } | { available: true; paper: BookmarkTarget })
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const nullableString = (v: unknown) => v === null || typeof v === 'string'
function activity(v: unknown): boolean {
  return record(v) && ['not_started','in_progress','completed'].includes(String(v.status)) && ['startedAt','lastActivityAt','selfCompletedAt'].every(k => nullableString(v[k]))
}
function target(v: unknown, kind: BookmarkType): v is BookmarkTarget {
  if (!record(v) || !integer(v.id) || typeof v.slug !== 'string' || typeof v.title !== 'string') return false
  if (kind === 'paper') return Array.isArray(v.authors) && v.authors.every(a => typeof a === 'string') && (v.year === null || integer(v.year)) && nullableString(v.journal)
  if (kind === 'course') return nullableString(v.titleZh) && typeof v.description === 'string'
  if (kind === 'module') return typeof v.titleZh === 'string' && integer(v.number) && typeof v.courseSlug === 'string' && typeof v.courseTitle === 'string'
  return typeof v.code === 'string' && typeof v.overview === 'string'
}
function bookmark(v: unknown): v is Bookmark {
  return record(v) && integer(v.id) && ['paper','course','module','research_area'].includes(String(v.targetType)) && typeof v.createdAt === 'string' && (v.available === false ? v.target === null : v.available === true && target(v.target, v.targetType as BookmarkType))
}
function reading(v: unknown): v is PaperReading {
  return record(v) && activity(v) && Array.isArray(v.resources) && v.resources.every(r => record(r) && activity(r) && integer(r.attachmentId) && integer(r.version) && typeof r.displayName === 'string' && Array.isArray(r.history) && r.history.every(h => record(h) && activity(h) && integer(h.version)))
    && Array.isArray(v.unavailableHistory) && v.unavailableHistory.every(h => record(h) && activity(h) && integer(h.progressId) && integer(h.version))
}
async function request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await sessionFetch(url, { cache: 'no-store', ...init })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(record(body) && typeof body.error === 'string' ? body.error : 'Personal state is unavailable. Please retry.')
  if (!record(body)) throw new Error('Invalid personal state response.')
  return body
}
const json = (method: string, data: unknown, signal: AbortSignal): RequestInit => ({ method, signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export async function getBookmarks(signal: AbortSignal): Promise<Bookmark[]> {
  const body = await request('/api/learning/bookmarks', { signal })
  if (!Array.isArray(body.bookmarks) || !body.bookmarks.every(bookmark)) throw new Error('Invalid bookmark response.')
  return body.bookmarks
}
export async function saveBookmark(targetType: BookmarkType, targetId: number, signal: AbortSignal) {
  const body = await request('/api/learning/bookmarks', json('POST', { targetType, targetId }, signal))
  if (!bookmark(body.bookmark)) throw new Error('Invalid bookmark response.')
}
export async function removeBookmark(id: number, signal: AbortSignal) {
  const body = await request(`/api/learning/bookmarks/${id}`, json('DELETE', {}, signal))
  if (body.deleted !== true) throw new Error('Invalid bookmark response.')
}
const base = (slug: string) => `/api/learning/papers/${encodeURIComponent(slug)}`
export async function getPaperReading(slug: string, signal: AbortSignal): Promise<PaperReading> {
  const body = await request(base(slug), { signal })
  if (!reading(body.reading)) throw new Error('Invalid reading response.')
  return body.reading
}
export async function changePaperReading(slug: string, action: LearningAction, signal: AbortSignal, attachment?: { id: number; version: number }) {
  const body = await request(base(slug) + (attachment ? `/attachments/${attachment.id}` : '') + '/progress', json('POST', { action, ...(attachment ? { expectedVersion: attachment.version } : {}) }, signal))
  if (!reading(body.reading)) throw new Error('Invalid reading response.')
}
export async function getPaperReadings(signal: AbortSignal): Promise<ReadingSummary[]> {
  const body = await request('/api/learning/papers', { signal })
  const summary = (v: unknown): v is ReadingSummary => record(v) && activity(v) && integer(v.progressId) && (v.available === false ? v.paper === null : v.available === true && target(v.paper, 'paper'))
  if (!Array.isArray(body.papers) || !body.papers.every(summary)) throw new Error('Invalid reading response.')
  return body.papers
}
export const readingLabel = (status: Activity['status']) => ({ not_started: 'Not started', in_progress: 'Reading', completed: 'Read by learner' })[status]
export function bookmarkPath(kind: BookmarkType, target: BookmarkTarget) {
  const slug = encodeURIComponent(target.slug)
  return kind === 'paper' ? `/papers/${slug}` : kind === 'course' ? `/course/${slug}` : kind === 'module' ? `/course/${encodeURIComponent(target.courseSlug!)}/modules/${slug}` : `/research/${slug}`
}
