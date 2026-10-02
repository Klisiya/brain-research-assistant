import { apiFetch } from './request'
import { CourseReadError } from './courses'

export const researchPath = (slug: string) => `/research/${encodeURIComponent(slug)}`
export type ResearchArea = { id: number; code: string; slug: string; name: string; overview: string; subtopics: string[]; brainRegionSlugs: string[]; sortOrder: number; status?: string; updatedAt?: string }
export type ResearchPaper = { relationId: number; sortOrder: number; paper: { id: number; slug: string; title: string; authors: string[] }; status?: string }
export type ResearchModule = { relationId: number; sortOrder: number; course: { id: number; slug: string; title: string }; module: { id: number; slug: string; title: string; titleZh: string; number: number; durationHours: number }; status?: string; courseStatus?: string }
export type ResearchResource = { id: number; displayName: string; description: string | null; attachmentType: string; accessLevel: string; version: number; sortOrder: number; externalUrl: string | null; downloadUrl: string | null }
export type ResearchDetail = { area: ResearchArea; papers: ResearchPaper[]; modules: ResearchModule[]; resources: ResearchResource[]; brainRegions: { slug: string; name: string }[]; hubContent: unknown[] }
export type Editor = { id: number; username: string; email: string }
export type Staff = { id: number; userId: number; username: string; eligible: boolean }
export class ResearchError extends CourseReadError {
  constructor(message: string, status: number) { super(status); this.message = message }
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string')
function area(v: unknown): v is ResearchArea { return record(v) && Number.isInteger(v.id) && ['code','slug','name','overview'].every(k => typeof v[k] === 'string') && strings(v.subtopics) && strings(v.brainRegionSlugs) && Number.isInteger(v.sortOrder) }
export async function researchRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(url, { cache: 'no-store', ...init })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new ResearchError(record(body) && typeof body.error === 'string' ? body.error : 'Research content is unavailable.', response.status)
  if (!record(body)) throw new ResearchError('Invalid server response.',503)
  return body as T
}
export async function getResearchList(managed: boolean, signal: AbortSignal) {
  const body = await researchRequest<{ areas: unknown[] }>(`/api/research-areas${managed ? '/manage' : ''}`, { signal })
  if (!Array.isArray(body.areas) || !body.areas.every(area)) throw new ResearchError('Research areas are unavailable.',503)
  return body.areas
}
export async function getResearchDetail(identity: string | number, signal: AbortSignal) {
  const body = await researchRequest<ResearchDetail>(`/api/research-areas/${typeof identity === 'number' ? `${identity}/manage` : encodeURIComponent(identity)}`, { signal })
  if (!area(body.area) || !['papers','modules','resources','brainRegions','hubContent'].every(k => Array.isArray(body[k as keyof ResearchDetail]))) throw new ResearchError('Research area is unavailable.',503)
  return body
}
export const researchWrite = <T,>(url: string, method: string, body?: unknown) => researchRequest<T>(url, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
