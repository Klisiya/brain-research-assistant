import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchManagedPapers,
  PaperApiError,
  type ManagedPaperListResponse,
  type PaperManagementSort,
} from '../api/papers'
import PaperManagementTable from '../components/papers/PaperManagementTable'
import type { AuthUser } from '../types/auth'
import type { PaperStatus } from '../types/paper'
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
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<PaperStatus | 'all'>('all')
  const [sort, setSort] = useState<PaperManagementSort>('recommended')
  const [page, setPage] = useState(1)
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
    setPage(1)
    setQuery(searchInput.trim())
  }

  const payload = currentResult?.payload
  const papers = payload?.papers ?? []
  const totalPages = payload?.pagination.totalPages ?? 0

  return (
    <>
      <header className="paper-management-header">
        <div>
          <span>Management · Research Library</span>
          <h1>Papers</h1>
          <p>Manage learning resources, drafts, and published research materials.</p>
        </div>
        <Link className="management-primary-action" to="/manage/papers/new">
          <span aria-hidden="true">＋</span> New Paper
        </Link>
      </header>

      <section aria-label="Paper management filters" className="paper-management-filters">
        <form onSubmit={handleSearch} role="search">
          <label htmlFor="management-paper-search">Search</label>
          <div>
            <input
              id="management-paper-search"
              onChange={(event) => setSearchInput(event.target.value)}
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
              setPage(1)
              setStatus(event.target.value as PaperStatus | 'all')
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
              setPage(1)
              setSort(event.target.value as PaperManagementSort)
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
                : 'Research Management Unavailable'}
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
          <h2>{currentUser.role === 'admin' ? 'No papers have been created yet.' : 'No papers yet'}</h2>
          <p>
            {currentUser.role === 'admin'
              ? 'New research resources will appear here after they are created.'
              : 'Create your first learning resource for the Brain Research library.'}
          </p>
          <Link to="/manage/papers/new">Create Paper</Link>
        </section>
      ) : (
        <section className="paper-management-results">
          <div className="paper-management-results-heading">
            <p aria-live="polite">
              {payload?.pagination.total ?? papers.length} managed {(payload?.pagination.total ?? papers.length) === 1 ? 'paper' : 'papers'}
            </p>
            <span>{currentUser.role === 'admin' ? 'All creators' : 'Your resources'}</span>
          </div>
          <PaperManagementTable papers={papers} />

          {totalPages > 1 ? (
            <nav aria-label="Paper management pagination" className="paper-management-pagination">
              <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} type="button">Previous</button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} type="button">Next</button>
            </nav>
          ) : null}
        </section>
      )}
    </>
  )
}

export default PaperManagementPage
