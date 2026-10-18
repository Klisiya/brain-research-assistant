import { sessionFetch } from './session'

export type HubState = 'draft' | 'pending' | 'published' | 'rejected' | 'archived'
export type HubAttachment = { id: number; displayName: string; attachmentType: string; mimeType: string | null; fileSize: number | null; externalUrl: string | null; downloadUrl: string | null }
export type HubRevision = { id: number; number: number; title: string; body: string; sourceName: string | null; sourceUrl: string | null; sourceDate?: string | null; createdAt?: string; reviewedById?: number | null; reviewedAt?: string | null; attachments: HubAttachment[]; state?: 'draft' | 'pending' | 'approved' | 'rejected'; reviewNote?: string | null }
export type HubEntry = { id: number; kind: 'faculty' | 'industry'; status: HubState; published: HubRevision | null; version?: number; ownerId?: number; working?: HubRevision | null; submittedById?: number; createdAt?: string; updatedAt?: string }
export type HubList = { entries: HubEntry[]; page: number; total: number; totalPages: number }
export type HubFields = { title: string; body: string; sourceName: string; sourceUrl: string }
export const hubPath = (id: number) => `/innovation-hub/faculty/${id}`
export const hubManagePath = (id: number) => `/manage/hub/${id}`
export const industryPath = (id: number) => `/innovation-hub/industry/${id}`
export const industryManagePath = (id: number) => `/manage/hub/industry/${id}`
export class HubError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status } }

export async function hubRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await sessionFetch(path, { ...init, cache: 'no-store' })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new HubError(typeof body?.error === 'string' ? body.error : 'Hub is unavailable. Please retry.', response.status)
  }
  if (!body || typeof body !== 'object') throw new HubError('Invalid Hub response.', 503)
  return body as T
}
export function hubMutation(path: string, method: string, data: unknown, signal: AbortSignal) {
  return hubRequest<{ entry: HubEntry }>(path, { method, signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
}
export const hubLabels: Record<HubState | 'approved', string> = { draft: 'Draft', pending: 'Pending Review', published: 'Published', rejected: 'Rejected', archived: 'Archived', approved: 'Published' }
