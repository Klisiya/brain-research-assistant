import type {
  ManagedPaper,
  Paper,
  PaperCreator,
  PaperDifficulty,
  PaperPublicationType,
  PaperResourceCategory,
  PaperStatus,
  PaperWriteInput,
} from '../types/paper'

export type PaperPagination = {
  page: number
  perPage: number
  total: number
  totalPages: number
}

export type PaperApiFilters = {
  q: string
  topic: string | null
  difficulty: PaperDifficulty | null
  publicationType: PaperPublicationType | null
  resourceCategory: PaperResourceCategory | null
  featured: boolean | null
  sort: 'recommended' | 'newest' | 'oldest' | 'readingTime' | 'title'
}

export type PaperListResponse = {
  papers: Paper[]
  pagination: PaperPagination
  filters: PaperApiFilters
}

export type PaperManagementSort = PaperApiFilters['sort']

export type ManagedPaperApiFilters = {
  q: string
  status: PaperStatus | null
  sort: PaperManagementSort
}

export type ManagedPaperListResponse = {
  papers: ManagedPaper[]
  pagination: PaperPagination
  filters: ManagedPaperApiFilters
}

type FetchPapersOptions = {
  signal?: AbortSignal
}

type FetchPaperBySlugOptions = {
  signal?: AbortSignal
}

type FetchManagedPapersOptions = {
  page?: number
  q?: string
  signal?: AbortSignal
  sort?: PaperManagementSort
  status?: PaperStatus | 'all'
}

export class PaperNotFoundError extends Error {
  constructor() {
    super('Paper not found')
    this.name = 'PaperNotFoundError'
  }
}

export class PaperApiError extends Error {
  code: string | null
  field: string | null
  status: number

  constructor(message: string, status: number, code: string | null, field: string | null) {
    super(message)
    this.name = 'PaperApiError'
    this.status = status
    this.code = code
    this.field = field
  }
}

const PUBLICATION_TYPES: readonly PaperPublicationType[] = [
  'Research Article',
  'Review',
  'Book Chapter',
  'Learning Resource',
]

const DIFFICULTIES: readonly PaperDifficulty[] = [
  'Beginner',
  'Intermediate',
  'Advanced',
]

const RESOURCE_CATEGORIES: readonly PaperResourceCategory[] = [
  'Foundational',
  'Recommended',
  'Course Resource',
  'Emerging Research',
]

const API_SORTS: readonly PaperApiFilters['sort'][] = [
  'recommended',
  'newest',
  'oldest',
  'readingTime',
  'title',
]

const PAPER_STATUSES: readonly PaperStatus[] = ['draft', 'published', 'archived']
const USER_ROLES: readonly PaperCreator['role'][] = ['user', 'teacher', 'admin']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isPaper(value: unknown): value is Paper {
  if (!isRecord(value)) return false

  return isFiniteNumber(value.id)
    && typeof value.slug === 'string'
    && typeof value.title === 'string'
    && isStringArray(value.authors)
    && (value.year === null || isFiniteNumber(value.year))
    && isNullableString(value.journal)
    && PUBLICATION_TYPES.includes(value.publicationType as PaperPublicationType)
    && isStringArray(value.topics)
    && DIFFICULTIES.includes(value.difficulty as PaperDifficulty)
    && isFiniteNumber(value.estimatedReadingMinutes)
    && typeof value.abstract === 'string'
    && isStringArray(value.learningObjectives)
    && isStringArray(value.keywords)
    && typeof value.featured === 'boolean'
    && typeof value.openAccess === 'boolean'
    && isNullableString(value.externalUrl)
    && RESOURCE_CATEGORIES.includes(value.resourceCategory as PaperResourceCategory)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && isNullableString(value.publishedAt)
}

function isPaperCreator(value: unknown): value is PaperCreator {
  return isRecord(value)
    && isFiniteNumber(value.id)
    && typeof value.username === 'string'
    && USER_ROLES.includes(value.role as PaperCreator['role'])
}

function isManagedPaper(value: unknown): value is ManagedPaper {
  if (!isPaper(value) || !isRecord(value)) return false

  const managedFields = value as Record<string, unknown>

  return PAPER_STATUSES.includes(managedFields.status as PaperStatus)
    && (managedFields.createdBy === null || isPaperCreator(managedFields.createdBy))
    && isNullableFiniteNumber(managedFields.updatedById)
}

function isPagination(value: unknown): value is PaperPagination {
  if (!isRecord(value)) return false

  return isFiniteNumber(value.page)
    && isFiniteNumber(value.perPage)
    && isFiniteNumber(value.total)
    && isFiniteNumber(value.totalPages)
}

function isApiFilters(value: unknown): value is PaperApiFilters {
  if (!isRecord(value)) return false

  return typeof value.q === 'string'
    && isNullableString(value.topic)
    && (value.difficulty === null
      || DIFFICULTIES.includes(value.difficulty as PaperDifficulty))
    && (value.publicationType === null
      || PUBLICATION_TYPES.includes(value.publicationType as PaperPublicationType))
    && (value.resourceCategory === null
      || RESOURCE_CATEGORIES.includes(value.resourceCategory as PaperResourceCategory))
    && (value.featured === null || typeof value.featured === 'boolean')
    && API_SORTS.includes(value.sort as PaperApiFilters['sort'])
}

function isManagedApiFilters(value: unknown): value is ManagedPaperApiFilters {
  if (!isRecord(value)) return false

  return typeof value.q === 'string'
    && (value.status === null || PAPER_STATUSES.includes(value.status as PaperStatus))
    && API_SORTS.includes(value.sort as PaperManagementSort)
}

function parsePaperListResponse(payload: unknown): PaperListResponse {
  if (
    !isRecord(payload)
    || !Array.isArray(payload.papers)
    || !payload.papers.every(isPaper)
    || !isPagination(payload.pagination)
    || !isApiFilters(payload.filters)
  ) {
    throw new Error('Invalid papers API response')
  }

  return payload as PaperListResponse
}

function parsePaperDetailResponse(payload: unknown): Paper {
  if (!isRecord(payload) || !isPaper(payload.paper)) {
    throw new Error('Invalid paper API response')
  }

  return payload.paper
}

function parseManagedPaperListResponse(payload: unknown): ManagedPaperListResponse {
  if (
    !isRecord(payload)
    || !Array.isArray(payload.papers)
    || !payload.papers.every(isManagedPaper)
    || !isPagination(payload.pagination)
    || !isManagedApiFilters(payload.filters)
  ) {
    throw new Error('Invalid managed papers API response')
  }

  return payload as ManagedPaperListResponse
}

function parseManagedPaperResponse(payload: unknown): ManagedPaper {
  if (!isRecord(payload) || !isManagedPaper(payload.paper)) {
    throw new Error('Invalid managed paper API response')
  }

  return payload.paper
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function getPaperApiError(response: Response, payload: unknown) {
  const record = isRecord(payload) ? payload : null
  const message = record && typeof record.error === 'string'
    ? record.error
    : 'The paper request could not be completed.'
  const code = record && typeof record.code === 'string' ? record.code : null
  const field = record && typeof record.field === 'string' ? record.field : null
  return new PaperApiError(message, response.status, code, field)
}

async function requestManagedPaper(
  url: string,
  options: RequestInit,
): Promise<ManagedPaper> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
  })
  const payload = await readJsonPayload(response)

  if (!response.ok) throw getPaperApiError(response, payload)
  return parseManagedPaperResponse(payload)
}

export async function fetchPapers({ signal }: FetchPapersOptions = {}) {
  // Stage 4 will move filtering, pagination, and URL-backed search state to the API.
  const searchParams = new URLSearchParams({ perPage: '50', sort: 'recommended' })
  const response = await fetch(`/api/papers?${searchParams}`, {
    credentials: 'include',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Papers API request failed with status ${response.status}`)
  }

  const payload: unknown = await response.json()
  return parsePaperListResponse(payload)
}

export async function fetchPaperBySlug(
  slug: string,
  { signal }: FetchPaperBySlugOptions = {},
): Promise<Paper> {
  const response = await fetch(`/api/papers/${encodeURIComponent(slug)}`, {
    credentials: 'include',
    signal,
  })

  if (response.status === 404) {
    throw new PaperNotFoundError()
  }

  if (!response.ok) {
    throw new Error(`Paper API request failed with status ${response.status}`)
  }

  const payload: unknown = await response.json()
  return parsePaperDetailResponse(payload)
}

export async function fetchManagedPapers({
  page = 1,
  q = '',
  signal,
  sort = 'recommended',
  status = 'all',
}: FetchManagedPapersOptions = {}) {
  const searchParams = new URLSearchParams({
    page: String(page),
    perPage: '50',
    q: q.trim(),
    sort,
  })

  if (status !== 'all') searchParams.set('status', status)

  const response = await fetch(`/api/papers/manage?${searchParams}`, {
    credentials: 'include',
    signal,
  })
  const payload = await readJsonPayload(response)

  if (!response.ok) throw getPaperApiError(response, payload)
  return parseManagedPaperListResponse(payload)
}

export function fetchManagedPaper(id: number, { signal }: { signal?: AbortSignal } = {}) {
  return requestManagedPaper(`/api/papers/manage/${id}`, { method: 'GET', signal })
}

export function createPaper(input: PaperWriteInput) {
  return requestManagedPaper('/api/papers', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export function updatePaper(id: number, input: PaperWriteInput) {
  return requestManagedPaper(`/api/papers/${id}`, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
  })
}

export function archivePaper(id: number) {
  return requestManagedPaper(`/api/papers/${id}/archive`, { method: 'POST' })
}

export async function deletePaper(id: number) {
  const response = await fetch(`/api/papers/${id}`, {
    credentials: 'include',
    method: 'DELETE',
  })
  const payload = await readJsonPayload(response)

  if (!response.ok) throw getPaperApiError(response, payload)

  if (
    !isRecord(payload)
    || payload.deleted !== true
    || !isFiniteNumber(payload.paperId)
  ) {
    throw new Error('Invalid delete paper API response')
  }

  return payload.paperId
}
