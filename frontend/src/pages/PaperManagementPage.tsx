import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { makeManagementOrigin, readPaperListFilters, withManagementOrigin } from '../components/management/managementOrigin'
import { useManagementListPosition } from '../components/management/useManagementOrigin'
import {
  fetchManagedPapers,
  PaperApiError,
  type ManagedPaperListResponse,
  type PaperManagementSort,
} from '../api/papers'
import PaperManagementTable from '../components/papers/PaperManagementTable'
import type { AuthUser } from '../types/auth'
import './PaperManagementPage.css'

type ManagementListResult = {
  error: 'forbidden' | 'session' | 'unavailable' | null
  payload: ManagedPaperListResponse | null
  requestId: string
}

function PaperManagementLoading() {
  return (
    <section aria-busy="true" aria-label="Loading paper management" className="paper-management-loading">
      <div aria-hidden="true" className="management-table-skeleton">
        {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
      </div>
    </section>
  )
}

function PaperManagementPage({ currentUser }: { currentUser: AuthUser }) {
  const [params, setParams] = useSearchParams()
  const filters = readPaperListFilters(params, currentUser)
  const { q: query, status, sort, page } = filters
  const canonical = new URLSearchParams({ q: query, status, sort, page: String(page), account: `${currentUser.id}:${currentUser.role}` }).toString()
  const [searchDraft, setSearchDraft] = useState<{ source: string; value: string } | null>(null)
  const searchInput = searchDraft?.source === query ? searchDraft.value : query
  const changeFilters = (next: Partial<typeof filters>) => setParams(new URLSearchParams({ ...filters, ...next, page: String(next.page ?? 1), account: `${currentUser.id}:${currentUser.role}` }))
  const destination = (path: string, selectedId?: number) => withManagementOrigin(path, makeManagementOrigin(currentUser, 'papers', new URLSearchParams(canonical), selectedId))
  useEffect(() => { if (params.toString() !== canonical) setParams(canonical, { replace: true }) }, [params, canonical, setParams])
  const [requestVersion, setRequestVersion] = useState(0)
  const requestId = JSON.stringify({ page, query, requestVersion, sort, status })
  const [result, setResult] = useState<ManagementListResult | null>(null)
  const currentResult = result?.requestId === requestId ? result : null

  useEffect(() => {
    const controller = new AbortController()

    fetchManagedPapers({ page, q: query, signal: controller.signal, sort, status })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setResult({ error: null, payload, requestId })
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof DOMException && error.name === 'AbortError') return

        const errorType = error instanceof PaperApiError && error.status === 401
          ? 'session'
          : error instanceof PaperApiError && error.status === 403
            ? 'forbidden'
            : 'unavailable'
        console.error('Unable to load the paper management workspace.', error)
        setResult({ error: errorType, payload: null, requestId })
      })

    return () => controller.abort()
  }, [page, query, requestId, sort, status])

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    changeFilters({ q: searchInput.trim(), page: 1 })
  }

  const payload = currentResult?.payload
  const papers = payload?.papers ?? []
  const totalPages = payload?.pagination.totalPages ?? 0
  const filtered = Boolean(query || status !== 'all')
  useManagementListPosition(payload?.pagination)

  return (
    <>
      <header className="paper-management-header">
        <div>
          <span>Management · Research Library</span>
          <h1>Papers</h1>
          <p>Manage learning resources, drafts, and published research materials.</p>
        </div>
        <Link className="management-primary-action" to={destination('/manage/papers/new')}>
          <span aria-hidden="true">＋</span> New Paper
        </Link>
      </header>

      <section aria-label="Paper management filters" className="paper-management-filters">
        <form onSubmit={handleSearch} role="search">
          <label htmlFor="management-paper-search">Search</label>
          <div>
            <input
              id="management-paper-search"
              onChange={(event) => setSearchDraft({ source: query, value: event.target.value })}
              placeholder="Search title, author, topic..."
              type="search"
              value={searchInput}
            />
            <button type="submit">Search</button>
          </div>
        </form>
        <label>
          <span>Status</span>
          <select
            onChange={(event) => {
              changeFilters({ status: event.target.value as typeof status, page: 1 })
            }}
            value={status}
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select
            onChange={(event) => {
              changeFilters({ sort: event.target.value as PaperManagementSort, page: 1 })
            }}
            value={sort}
          >
            <option value="recommended">Recommended</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="readingTime">Reading Time</option>
            <option value="title">Title</option>
          </select>
        </label>
      </section>

      {!currentResult ? (
        <PaperManagementLoading />
      ) : currentResult.error ? (
        <section aria-live="polite" className="management-state-panel is-embedded" role="alert">
          <span>Management</span>
          <h2>
            {currentResult.error === 'forbidden'
              ? 'Access Denied'
              : currentResult.error === 'session'
                ? 'Sign In Required'
                : 'Paper Management Unavailable'}
          </h2>
          <p>
            {currentResult.error === 'forbidden'
              ? 'You do not have permission to access this workspace.'
              : currentResult.error === 'session'
                ? 'Your session has expired. Please sign in again.'
                : "We couldn't load your paper management workspace."}
          </p>
          {currentResult.error === 'session' ? (
            <Link state={{ from: '/manage/papers', managementRequired: true }} to="/login">Sign In</Link>
          ) : currentResult.error === 'unavailable' ? (
            <button onClick={() => setRequestVersion((value) => value + 1)} type="button">Try Again</button>
          ) : (
            <Link to="/papers">Back to Paper Library</Link>
          )}
        </section>
      ) : papers.length === 0 ? (
        <section className="management-state-panel is-embedded">
          <span>Research Library</span>
          <h2>{filtered ? 'No matching papers' : 'No papers yet'}</h2>
          <p>
            {filtered ? 'Try another search or change the status filter.' : 'Papers you can manage will appear here.'}
          </p>
          <Link to={destination('/manage/papers/new')}>Create Paper</Link>
        </section>
      ) : (
        <section className="paper-management-results">
          <div className="paper-management-results-heading">
            <p aria-live="polite">
              {payload?.pagination.total ?? papers.length} managed {(payload?.pagination.total ?? papers.length) === 1 ? 'paper' : 'papers'}
            </p>
            <span>{currentUser.role === 'admin' ? 'All creators' : 'Your resources'}</span>
          </div>
          <PaperManagementTable papers={papers} destination={destination} />

          {totalPages > 1 ? (
            <nav aria-label="Paper management pagination" className="paper-management-pagination">
              <button disabled={page <= 1} onClick={() => changeFilters({ page: page - 1 })} type="button">Previous</button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => changeFilters({ page: page + 1 })} type="button">Next</button>
            </nav>
          ) : null}
        </section>
      )}
    </>
  )
}

export default PaperManagementPage
