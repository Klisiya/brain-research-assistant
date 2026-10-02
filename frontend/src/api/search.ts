import { apiFetch } from './request'
import { coursePath, modulePath } from './courses'
import { researchPath } from './research'

export const SEARCH_TYPES = ['all', 'papers', 'courses', 'modules', 'research'] as const
export type SearchType = typeof SEARCH_TYPES[number]
export type SearchParams = { q: string; type: SearchType; page: number }
type ResultBase = { key: string; title: string; summary: string; route: string }
export type SearchResult =
  | (ResultBase & { type: 'papers'; slug: string; metadata: { authors: string[]; year: number | null; journal: string | null } })
  | (ResultBase & { type: 'courses'; slug: string; titleZh: string | null; metadata: Record<string, never> })
  | (ResultBase & { type: 'modules'; courseSlug: string; moduleSlug: string; titleZh: string; metadata: { number: number; category: string; durationHours: number; courseTitle: string } })
  | (ResultBase & { type: 'research'; code: string; slug: string; name: string; metadata: Record<string, never> })
export type SearchResponse = SearchParams & { items: SearchResult[]; perPage: number; total: number; totalPages: number; counts: Record<Exclude<SearchType, 'all'>, number> }
export class SearchError extends Error {}

export function searchPath(q: string, type: SearchType = 'all', page = 1) {
  return `/search?${new URLSearchParams({ q: q.trim(), type, page: String(page) })}`
}
export function parseSearchUrl(url: URLSearchParams): { params: SearchParams; invalid: boolean } {
  const q = (url.get('q') ?? '').trim(), type = url.get('type') ?? 'all', page = url.get('page') ?? '1'
  const invalid = [...url.keys()].some(k => !['q', 'type', 'page'].includes(k) || url.getAll(k).length !== 1)
    || q.length > 200 || Array.from(q).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || !SEARCH_TYPES.includes(type as SearchType)
    || !/^[0-9]{1,5}$/.test(page) || Number(page) < 1 || Number(page) > 10000
  return { params: { q, type: SEARCH_TYPES.includes(type as SearchType) ? type as SearchType : 'all', page: invalid ? 1 : Number(page) }, invalid }
}
export function searchResultPath(item: SearchResult) {
  switch (item.type) {
    case 'papers': return `/papers/${encodeURIComponent(item.slug)}`
    case 'courses': return coursePath(item.slug)
    case 'modules': return modulePath(item.courseSlug, item.moduleSlug)
    case 'research': return researchPath(item.slug)
  }
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string'
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const optionalText = (v: unknown) => v === null || text(v)
function result(v: unknown): v is SearchResult {
  if (!record(v) || !['key','title','summary','route'].every(k => text(v[k])) || !record(v.metadata)) return false
  const m = v.metadata
  let valid = false
  switch (v.type) {
    case 'papers': valid = text(v.slug) && Array.isArray(m.authors) && m.authors.every(text) && (m.year === null || integer(m.year)) && optionalText(m.journal); break
    case 'courses': valid = text(v.slug) && optionalText(v.titleZh); break
    case 'modules': valid = text(v.courseSlug) && text(v.moduleSlug) && text(v.titleZh) && integer(m.number) && m.number > 0 && integer(m.durationHours) && m.durationHours > 0 && text(m.category) && text(m.courseTitle); break
    case 'research': valid = text(v.slug) && text(v.code) && text(v.name); break
  }
  return valid && v.route === searchResultPath(v as SearchResult)
}
export async function getSearch(params: SearchParams, signal: AbortSignal): Promise<SearchResponse> {
  const query = new URLSearchParams({ ...params, page: String(params.page), perPage: '12' })
  const response = await apiFetch(`/api/search?${query}`, { signal, cache: 'no-store' })
  if (!response.ok) throw new SearchError('Search is unavailable. Please retry.')
  const body: unknown = await response.json()
  if (!record(body) || !Array.isArray(body.items) || !body.items.every(result) || new Set(body.items.map(i => i.key)).size !== body.items.length
    || body.q !== params.q || body.type !== params.type || body.page !== params.page || body.perPage !== 12
    || !integer(body.total) || !integer(body.totalPages) || body.totalPages !== Math.ceil(body.total / 12) || body.items.length > 12
    || !record(body.counts) || !SEARCH_TYPES.slice(1).every(k => integer((body.counts as Record<string, unknown>)[k]))) throw new SearchError('Invalid search response.')
  return body as SearchResponse
}
