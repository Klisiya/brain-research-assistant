import { HubError, hubRequest, type HubState } from './hub'
export const discussionApi = '/api/hub/discussions'
export const discussionsHome = '/innovation-hub?view=discussions'
export const discussionPath = (id: number) => `/innovation-hub/discussions/${id}`
export const discussionManagePath = (id: number) => `/innovation-hub/discussions/manage/${id}`
export type DiscussionRevision = { number: number; title?: string; body: string; publishedAt: string | null; state?: 'draft' | 'pending' | 'approved' | 'rejected'; reviewNote?: string | null }
export type Discussion = { id: number; type: 'thread' | 'reply'; threadId: number | null; author: string; canManage: boolean; isAuthor?: boolean; published: DiscussionRevision | null; working?: DiscussionRevision | null; status?: HubState; version?: number }
export type Page<T> = { entries: T[]; page: number; total: number; totalPages: number }
export type DiscussionReport = { id: number; targetId: number | null; originalTargetId: number; targetType: 'thread' | 'reply'; targetState: string; threadId: number | null; reporter: string; reason: string; detail: string | null; status: 'open' | 'resolved' | 'dismissed'; version: number; createdAt: string; resolvedAt: string | null; resolvedBy: number | null }
export type DiscussionEvent = { action: string; actorId: number; createdAt: string }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
function revision(value: unknown) { return value === null || record(value) && Number.isSafeInteger(value.number) && typeof value.body === 'string' && (value.title === undefined || typeof value.title === 'string') && (value.publishedAt === null || typeof value.publishedAt === 'string') }
function entry(value: unknown): value is Discussion { return record(value) && Number.isSafeInteger(value.id) && ['thread','reply'].includes(String(value.type)) && (value.threadId === null || Number.isSafeInteger(value.threadId)) && typeof value.author === 'string' && typeof value.canManage === 'boolean' && revision(value.published) && (value.working === undefined || revision(value.working)) }
export async function discussionRead<T>(path: string, signal: AbortSignal): Promise<T> {
  const result = await hubRequest<unknown>(discussionApi+path, { signal })
  if (!record(result) || ('entry' in result && !entry(result.entry)) || ('entries' in result && (!Array.isArray(result.entries) || !Number.isSafeInteger(result.page) || !Number.isSafeInteger(result.totalPages) || result.entries.some(item => path.startsWith('/entries') && !entry(item))))) throw new HubError('Invalid discussions response.',503)
  return result as T
}
export function discussionMutation<T>(path: string, method: string, data: unknown, signal: AbortSignal) {
  return hubRequest<T>(discussionApi+path, { method, signal, headers: { 'Content-Type':'application/json' }, body: JSON.stringify(data) })
}
