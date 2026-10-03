import { sessionFetch } from './session'

export type AnnotationKind = 'notes' | 'highlights'
export type NoteType = 'general' | 'summary' | 'question' | 'connection' | 'key_idea'
export type AnnotationSource = { kind: 'paper' | 'resource'; available: boolean; state: 'current' | 'earlier' | 'unavailable'; version: number | null; currentVersion: number | null; attachmentId: number | null; displayName: string | null; attachmentType: string | null }
type PersonalRecord = { id: number; revision: number; createdAt: string; updatedAt: string; paper: { slug: string; title: string } | null; source: AnnotationSource }
export type GuidedNote = PersonalRecord & { kind: 'note'; title: string; body: string; noteType: NoteType }
export type ConceptHighlight = PersonalRecord & { kind: 'highlight'; highlightText: string; comment: string | null }
export type AnnotationItem = GuidedNote | ConceptHighlight
export type SourceResource = { id: number; displayName: string; attachmentType: 'pdf' | 'slides' | 'document' | 'external_link'; version: number }
export type AnnotationCollection = { items: AnnotationItem[]; resources: SourceResource[] }
export type NoteContent = { title: string; body: string; noteType: NoteType }
export type HighlightContent = { highlightText: string; comment?: string | null }
export type CreateNotePayload = NoteContent & { attachmentId?: number; expectedVersion?: number }
export type CreateHighlightPayload = HighlightContent & { attachmentId?: number; expectedVersion?: number }
export type UpdateNotePayload = NoteContent & { expectedRevision: number }
export type UpdateHighlightPayload = HighlightContent & { expectedRevision: number }
export class AnnotationApiError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status: number) { super(message); this.code = code; this.status = status }
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const nullableInteger = (v: unknown) => v === null || integer(v)
const nullableString = (v: unknown) => v === null || typeof v === 'string'
function source(v: unknown): boolean {
  return record(v) && ['paper','resource'].includes(String(v.kind)) && typeof v.available === 'boolean' && ['current','earlier','unavailable'].includes(String(v.state))
    && ['version','currentVersion','attachmentId'].every(k => nullableInteger(v[k])) && nullableString(v.displayName) && nullableString(v.attachmentType)
}
function item(v: unknown, kind: AnnotationKind): v is AnnotationItem {
  if (!record(v) || !integer(v.id) || !integer(v.revision) || typeof v.createdAt !== 'string' || typeof v.updatedAt !== 'string' || !source(v.source)
    || !(v.paper === null || record(v.paper) && typeof v.paper.slug === 'string' && typeof v.paper.title === 'string')) return false
  return kind === 'notes' ? v.kind === 'note' && typeof v.title === 'string' && typeof v.body === 'string' && ['general','summary','question','connection','key_idea'].includes(String(v.noteType))
    : v.kind === 'highlight' && typeof v.highlightText === 'string' && nullableString(v.comment)
}
async function request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await sessionFetch(url, { cache: 'no-store', ...init })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new AnnotationApiError(record(body) && typeof body.error === 'string' ? body.error : 'Your personal workspace is unavailable. Please retry.', record(body) && typeof body.code === 'string' ? body.code : 'ANNOTATION_UNAVAILABLE', response.status)
  if (!record(body)) throw new AnnotationApiError('Invalid workspace response.', 'ANNOTATION_UNAVAILABLE', 503)
  return body
}
const base = (slug: string, kind: AnnotationKind) => `/api/learning/papers/${encodeURIComponent(slug)}/${kind}`
export async function getAnnotations(slug: string, kind: AnnotationKind, signal: AbortSignal): Promise<AnnotationCollection> {
  const body = await request(base(slug,kind), { signal })
  if (!Array.isArray(body[kind]) || !body[kind].every(v => item(v,kind)) || !Array.isArray(body.resources) || !body.resources.every(v => record(v) && integer(v.id) && integer(v.version) && typeof v.displayName === 'string' && ['pdf','slides','document','external_link'].includes(String(v.attachmentType)))) throw new Error('Invalid workspace response.')
  return { items: body[kind], resources: body.resources as SourceResource[] }
}
export async function saveAnnotation(slug: string, kind: AnnotationKind, payload: CreateNotePayload | CreateHighlightPayload | UpdateNotePayload | UpdateHighlightPayload, signal: AbortSignal, id?: number) {
  const body = await request(id ? `/api/learning/${kind}/${id}` : base(slug,kind), { method: id ? 'PATCH' : 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  if (!item(body[kind === 'notes' ? 'note' : 'highlight'],kind)) throw new Error('Invalid workspace response.')
}
export async function deleteAnnotation(kind: AnnotationKind, id: number, revision: number, signal: AbortSignal) {
  const body = await request(`/api/learning/${kind}/${id}`, { method: 'DELETE', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: revision }) })
  if (body.deleted !== true) throw new Error('Invalid workspace response.')
}
