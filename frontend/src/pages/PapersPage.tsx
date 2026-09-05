import { useCallback, useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { fetchPapers, type PaperListResponse } from '../api/papers'
import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import PageParticleBackground from '../components/PageParticleBackground'
import PaperCard from '../components/papers/PaperCard'
import PaperFilters from '../components/papers/PaperFilters'
import PapersHero from '../components/papers/PapersHero'
import PapersTabs from '../components/papers/PapersTabs'
import ReadingProgressPanel from '../components/papers/ReadingProgressPanel'
import type {
  PaperDifficulty,
  PaperPublicationType,
  PaperSort,
  PaperView,
} from '../types/paper'
import './PapersPage.css'

function isPaperView(value: string | null): value is Exclude<PaperView, 'all'> {
  return value === 'recommended' || value === 'resources' || value === 'progress'
}

const PAPER_SORTS: readonly PaperSort[] = [
  'recommended',
  'newest',
  'oldest',
  'readingTime',
  'title',
]

type PaperQueryState = {
  q: string
  topic: string
  author: string
  difficulty: PaperDifficulty | 'all'
  publicationType: PaperPublicationType | 'all'
  year: number | null
  view: PaperView
  sort: PaperSort
  page: number
}

function readPaperQuery(searchParams: URLSearchParams): PaperQueryState {
  const requestedSort = searchParams.get('sort') === 'reading-time'
    ? 'readingTime'
    : searchParams.get('sort')
  const requestedPage = Number(searchParams.get('page'))
  const requestedYear = Number(searchParams.get('year'))
  const requestedDifficulty = searchParams.get('difficulty')
  const requestedPublicationType = searchParams.get('publicationType')
  const requestedView = searchParams.get('view')

  return {
    q: searchParams.get('q')?.trim() ?? '',
    topic: searchParams.get('topic')?.trim() ?? '',
    author: searchParams.get('author')?.trim() ?? '',
    difficulty: requestedDifficulty === 'Beginner'
      || requestedDifficulty === 'Intermediate'
      || requestedDifficulty === 'Advanced'
      ? requestedDifficulty
      : 'all',
    publicationType: requestedPublicationType === 'Research Article'
      || requestedPublicationType === 'Review'
      || requestedPublicationType === 'Book Chapter'
      || requestedPublicationType === 'Learning Resource'
      ? requestedPublicationType
      : 'all',
    year: Number.isInteger(requestedYear) && requestedYear >= 1800 ? requestedYear : null,
    view: isPaperView(requestedView) ? requestedView : 'all',
    sort: PAPER_SORTS.includes(requestedSort as PaperSort)
      ? requestedSort as PaperSort
      : 'recommended',
    page: Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  }
}

function buildPaperSearchParams(query: PaperQueryState) {
  const params = new URLSearchParams({ page: String(query.page), sort: query.sort })
  if (query.q) params.set('q', query.q)
  if (query.topic) params.set('topic', query.topic)
  if (query.author) params.set('author', query.author)
  if (query.difficulty !== 'all') params.set('difficulty', query.difficulty)
  if (query.publicationType !== 'all') params.set('publicationType', query.publicationType)
  if (query.year !== null) params.set('year', String(query.year))
  if (query.view !== 'all') params.set('view', query.view)
  return params
}

function getPaginationItems(page: number, totalPages: number) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
  const pages = new Set([1, totalPages, page - 1, page, page + 1])
  const sorted = [...pages].filter((value) => value > 0 && value <= totalPages).sort((a, b) => a - b)
  const items: Array<number | 'ellipsis'> = []
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) items.push('ellipsis')
    items.push(value)
  })
  return items
}

function PapersLoadingState() {
  return (
    <section aria-label="Loading research library" aria-live="polite" className="papers-loading-state">
      <p>Loading research library...</p>
      <div aria-hidden="true" className="paper-card-grid papers-skeleton-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <article className="paper-card paper-skeleton-card" key={index}>
            <div className="paper-skeleton-line is-badge" />
            <div className="paper-skeleton-line is-title" />
            <div className="paper-skeleton-line is-byline" />
            <div className="paper-skeleton-line is-copy" />
            <div className="paper-skeleton-line is-copy is-short" />
            <div className="paper-skeleton-line is-meta" />
          </article>
        ))}
      </div>
    </section>
  )
}

function PapersPage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const query = readPaperQuery(searchParams)
  const [requestVersion, setRequestVersion] = useState(0)
  const canonicalSearch = buildPaperSearchParams(query).toString()
  const requestKey = `${canonicalSearch}:${requestVersion}`
  const [requestState, setRequestState] = useState<{
    key: string
    payload: PaperListResponse | null
    error: string | null
  }>({ key: '', payload: null, error: null })
  const payload = requestState.payload
  const loading = requestState.key !== requestKey
  const error = requestState.key === requestKey ? requestState.error : null

  const activeView = query.view
  const returnPath = `${location.pathname}${location.search}`
  const papers = payload?.papers ?? []
  const availableTopics = payload?.availableFilters.topics ?? []
  const availableAuthors = payload?.availableFilters.authors ?? []
  const availableYears = payload?.availableFilters.years ?? []
  const topicCount = availableTopics.length
  const difficultyLevelCount = payload?.availableFilters.difficulties.length ?? 0
  const resourceCount = payload?.libraryTotal ?? 0
  const resultCount = payload?.pagination.total ?? 0
  const currentPage = payload?.pagination.page ?? query.page
  const totalPages = payload?.pagination.totalPages ?? 0

  const updateQuery = useCallback((
    changes: Partial<PaperQueryState>,
    { replace = false, resetPage = true } = {},
  ) => {
    const currentQuery = readPaperQuery(searchParams)
    const nextQuery = {
      ...currentQuery,
      ...changes,
      page: resetPage ? 1 : changes.page ?? currentQuery.page,
    }
    setSearchParams(buildPaperSearchParams(nextQuery), { replace })
  }, [searchParams, setSearchParams])

  const updateSearch = useCallback((q: string) => {
    updateQuery({ q }, { replace: true })
  }, [updateQuery])

  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 })
  }, [])

  useEffect(() => {
    if (canonicalSearch !== searchParams.toString()) {
      setSearchParams(canonicalSearch, { replace: true })
    }
  }, [canonicalSearch, searchParams, setSearchParams])

  useEffect(() => {
    const controller = new AbortController()

    fetchPapers({
      author: query.author || undefined,
      difficulty: query.difficulty === 'all' ? undefined : query.difficulty,
      page: query.view === 'progress' ? 1 : query.page,
      publicationType: query.publicationType === 'all' ? undefined : query.publicationType,
      q: query.q,
      signal: controller.signal,
      sort: query.sort,
      topic: query.topic || undefined,
      view: query.view === 'progress' ? 'all' : query.view,
      year: query.year ?? undefined,
    })
      .then((nextPayload) => {
        if (controller.signal.aborted) return
        setRequestState({ key: requestKey, payload: nextPayload, error: null })
        if (query.view !== 'progress' && nextPayload.pagination.page !== query.page) {
          setSearchParams(buildPaperSearchParams({
            q: query.q,
            topic: query.topic,
            author: query.author,
            difficulty: query.difficulty,
            publicationType: query.publicationType,
            year: query.year,
            view: query.view,
            sort: query.sort,
            page: nextPayload.pagination.page,
          }), { replace: true })
        }
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return
        console.error('Unable to load the research library.', requestError)
        setRequestState((current) => ({
          key: requestKey,
          payload: current.payload,
          error: "We couldn't load the paper library right now.",
        }))
      })

    return () => controller.abort()
  }, [query.author, query.difficulty, query.page, query.publicationType, query.q,
    query.sort, query.topic, query.view, query.year, requestKey, setSearchParams])

  const hasActiveFilters = Boolean(query.q)
    || Boolean(query.topic)
    || Boolean(query.author)
    || query.difficulty !== 'all'
    || query.publicationType !== 'all'
    || query.year !== null

  const clearFilters = () => {
    updateQuery({
      q: '', topic: '', author: '', difficulty: 'all', publicationType: 'all', year: null,
    })
  }

  const retryPapers = () => {
    setRequestVersion((version) => version + 1)
  }

  return (
    <div className="papers-page">
      <PageParticleBackground />
      <Navbar />

      <main className="papers-main">
        <PapersHero
          difficultyLevelCount={difficultyLevelCount}
          loading={loading && payload === null}
          papers={payload?.highlights ?? []}
          resourceCount={resourceCount}
          topicCount={topicCount}
        />

        <PapersTabs
          activeView={activeView}
          searchParams={buildPaperSearchParams(query)}
        />

        {loading && payload === null ? (
          <PapersLoadingState />
        ) : error ? (
          <section className="papers-empty-state papers-error-state" role="alert">
            <span>Research Library Unavailable</span>
            <h2>Research Library Unavailable</h2>
            <p>{error}</p>
            <button onClick={retryPapers} type="button">
              Try Again
            </button>
          </section>
        ) : activeView === 'progress' ? (
          <ReadingProgressPanel />
        ) : resourceCount === 0 ? (
          <section className="papers-empty-state">
            <span>Research Library</span>
            <h2>No published resources yet</h2>
            <p>New learning resources will appear here once they are published.</p>
          </section>
        ) : (
          <>
            <PaperFilters
              author={query.author}
              availableAuthors={availableAuthors}
              availableTopics={availableTopics}
              availableYears={availableYears}
              difficulty={query.difficulty}
              hasActiveFilters={hasActiveFilters}
              initialSearchTerm={query.q}
              key={query.q}
              onAuthorChange={(author) => updateQuery({ author })}
              onClear={clearFilters}
              onDifficultyChange={(difficulty) => updateQuery({ difficulty })}
              onPublicationTypeChange={(publicationType) => updateQuery({ publicationType })}
              onSearchChange={updateSearch}
              onSortChange={(sort) => updateQuery({ sort })}
              onTopicChange={(topic) => updateQuery({ topic: topic === 'all' ? '' : topic })}
              onYearChange={(year) => updateQuery({ year })}
              publicationType={query.publicationType}
              resultCount={resultCount}
              sort={query.sort}
              topic={query.topic || 'all'}
              year={query.year}
            />

            {loading && <p aria-live="polite" className="papers-results-loading">Updating results...</p>}

            {papers.length > 0 ? (
              <section aria-busy={loading} aria-label="Paper results" className="paper-card-grid">
                {papers.map((paper) => (
                  <PaperCard key={paper.id} paper={paper} returnPath={returnPath} />
                ))}
              </section>
            ) : (
              <section className="papers-empty-state">
                <span>No matching resources</span>
                <h2>Try a broader search</h2>
                <p>Adjust your search terms or clear one or more library filters.</p>
                <button onClick={clearFilters} type="button">Clear Filters</button>
              </section>
            )}

            {totalPages > 1 && (
              <nav aria-label="Paper results pages" className="papers-pagination">
                <button
                  disabled={currentPage <= 1 || loading}
                  onClick={() => updateQuery({ page: currentPage - 1 }, { resetPage: false })}
                  type="button"
                >
                  Previous
                </button>
                {getPaginationItems(currentPage, totalPages).map((item, index) => (
                  item === 'ellipsis' ? (
                    <span aria-hidden="true" key={`ellipsis-${index}`}>...</span>
                  ) : (
                    <button
                      aria-current={item === currentPage ? 'page' : undefined}
                      className={item === currentPage ? 'is-active' : undefined}
                      disabled={loading}
                      key={item}
                      onClick={() => updateQuery({ page: item }, { resetPage: false })}
                      type="button"
                    >
                      {item}
                    </button>
                  )
                ))}
                <button
                  disabled={currentPage >= totalPages || loading}
                  onClick={() => updateQuery({ page: currentPage + 1 }, { resetPage: false })}
                  type="button"
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}

        <p className="papers-library-boundary">
          This library is a curated learning resource. Publication management and learner
          submissions are not available in this preview.
        </p>
      </main>

      <Footer />
    </div>
  )
}

export default PapersPage
