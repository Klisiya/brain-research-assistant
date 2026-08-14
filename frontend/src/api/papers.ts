import type {
  Paper,
  PaperDifficulty,
  PaperPublicationType,
  PaperResourceCategory,
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

type FetchPapersOptions = {
  signal?: AbortSignal
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
