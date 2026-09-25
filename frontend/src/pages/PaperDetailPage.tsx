import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { fetchManagedPaperPreview, fetchPaperBySlug, PaperApiError, PaperNotFoundError } from '../api/papers'
import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import PageParticleBackground from '../components/PageParticleBackground'
import type { Paper, PreviewPaper } from '../types/paper'
import './PaperDetailPage.css'

type PaperDetailError = 'not-found' | 'unavailable' | 'forbidden' | 'session'

type PaperDetailResult = {
  error: PaperDetailError | null
  paper: Paper | PreviewPaper | null
  requestId: string
}

function getReturnPath(state: unknown) {
  if (
    typeof state === 'object'
    && state !== null
    && 'from' in state
    && typeof state.from === 'string'
    && state.from.startsWith('/papers')
  ) {
    return state.from
  }

  return '/papers'
}

function getPublicationDetails(paper: Paper) {
  return [paper.journal?.trim(), paper.year?.toString()]
    .filter(Boolean)
    .join(' · ') || 'Publication details unavailable'
}

function formatPublishedDate(publishedAt: string) {
  const date = new Date(publishedAt)

  if (Number.isNaN(date.getTime())) {
    return 'Publication date unavailable'
  }

  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function getExternalSourceUrl(externalUrl: string | null) {
  if (!externalUrl) return null

  try {
    const url = new URL(externalUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function getDoiUrl(doi: string | null | undefined) {
  return doi ? `https://doi.org/${encodeURIComponent(doi)}` : null
}

function getCitation(paper: Paper) {
  const sentence = (value: string) => `${value.replace(/\.+$/, '')}.`
  const source = paper.journal?.trim() || paper.publisher?.trim()
  const volume = paper.volume?.trim()
  const issue = paper.issue?.trim()
  const pages = paper.pages?.trim()
  const publication = [source, volume ? `${volume}${issue ? `(${issue})` : ''}` : issue ? `(${issue})` : null, pages]
    .filter(Boolean).join(', ')
  const pieces = [
    paper.authors.length ? sentence(paper.authors.join(', ')) : null,
    paper.year ? `(${paper.year}).` : null,
    paper.title.trim() ? sentence(paper.title.trim()) : null,
    publication ? sentence(publication) : null,
    getDoiUrl(paper.doi)?.replace(/%2F/gi, '/'),
  ]
  return pieces.filter(Boolean).join(' ')
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isPreviewPaper(paper: Paper | PreviewPaper): paper is PreviewPaper {
  return 'preview' in paper && paper.preview === true
}

function PaperDetailLoadingState() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading paper details"
      className="paper-detail-loading"
    >
      <p className="paper-detail-loading-label">Loading research resource...</p>

      <div aria-hidden="true">
        <div className="paper-detail-hero paper-detail-skeleton-hero">
          <div className="paper-detail-skeleton-row">
            <span className="paper-detail-skeleton-line is-badge" />
            <span className="paper-detail-skeleton-line is-badge" />
            <span className="paper-detail-skeleton-line is-badge" />
          </div>
          <span className="paper-detail-skeleton-line is-eyebrow" />
          <span className="paper-detail-skeleton-line is-title" />
          <span className="paper-detail-skeleton-line is-title is-short" />
          <span className="paper-detail-skeleton-line is-author" />
          <span className="paper-detail-skeleton-line is-publication" />
          <div className="paper-detail-skeleton-meta">
            {Array.from({ length: 3 }, (_, index) => (
              <span className="paper-detail-skeleton-line" key={index} />
            ))}
          </div>
        </div>

        <div className="paper-detail-layout">
          <div className="paper-detail-content">
            <div className="paper-detail-block paper-detail-skeleton-block">
              <span className="paper-detail-skeleton-line is-eyebrow" />
              <span className="paper-detail-skeleton-line is-heading" />
              <span className="paper-detail-skeleton-line is-copy" />
              <span className="paper-detail-skeleton-line is-copy" />
              <span className="paper-detail-skeleton-line is-copy is-short" />
            </div>
            <div className="paper-detail-block paper-detail-skeleton-block">
              <span className="paper-detail-skeleton-line is-eyebrow" />
              <span className="paper-detail-skeleton-line is-heading" />
              <span className="paper-detail-skeleton-line is-copy" />
              <span className="paper-detail-skeleton-line is-copy is-short" />
            </div>
          </div>

          <aside className="paper-detail-sidebar paper-detail-skeleton-sidebar">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index}>
                <span className="paper-detail-skeleton-line is-sidebar-heading" />
                <span className="paper-detail-skeleton-line is-sidebar-item" />
                <span className="paper-detail-skeleton-line is-sidebar-item is-short" />
              </div>
            ))}
          </aside>
        </div>
      </div>
    </section>
  )
}

function PaperDetailStatus({
  error,
  onRetry,
  returnPath,
  preview,
}: {
  error: PaperDetailError
  onRetry: () => void
  returnPath: string
  preview: boolean
}) {
  const isNotFound = error === 'not-found'
  const title = isNotFound ? 'Paper Not Found' : preview
    ? error === 'forbidden' ? 'Preview Access Denied' : error === 'session' ? 'Sign In Required' : 'Preview Unavailable'
    : 'Research Library Unavailable'

  return (
    <section
      aria-live="polite"
      className="paper-detail-not-found paper-detail-status"
      role={isNotFound ? undefined : 'alert'}
    >
      <span>Research Library</span>
      <h1>{title}</h1>
      <p>
        {isNotFound
          ? 'The requested resource is not available in the research library.'
          : error === 'forbidden' ? 'You do not have permission to preview this paper.'
            : error === 'session' ? 'Your session has expired. Please sign in again.'
              : "We couldn't load this research resource right now."}
      </p>
      <div className="paper-detail-status-actions">
        {error === 'unavailable' && (
          <button className="paper-detail-retry" onClick={onRetry} type="button">
            Try Again
          </button>
        )}
        {error === 'session' ? <Link state={{ from: window.location.pathname, managementRequired: true }} to="/login">Sign In</Link> : null}
        <Link to={returnPath}>{preview ? 'Back to Papers Management' : 'Back to Paper Library'}</Link>
      </div>
    </section>
  )
}

function PaperDetailPage({ preview = false }: { preview?: boolean }) {
  const { slug, id } = useParams<{ slug: string; id: string }>()
  const location = useLocation()
  const returnPath = preview ? '/manage/papers' : getReturnPath(location.state)
  const paperId = id ? Number(id) : null
  const validId = paperId !== null && Number.isInteger(paperId) && paperId > 0
  const [result, setResult] = useState<PaperDetailResult | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)
  const [copyState, setCopyState] = useState<'copied' | 'failed' | null>(null)
  const requestId = `${preview ? `preview:${id ?? ''}` : `public:${slug ?? ''}`}:${requestVersion}`
  const currentResult = result?.requestId === requestId ? result : null
  const loading = (preview ? validId : Boolean(slug)) && currentResult === null
  const paper = currentResult?.paper ?? null
  const error = (preview ? validId : Boolean(slug)) ? (currentResult?.error ?? null) : 'not-found'

  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 })
  }, [id, slug])

  useEffect(() => {
    if (preview ? !validId || paperId === null : !slug) return undefined

    const controller = new AbortController()

    const request = preview && paperId !== null
      ? fetchManagedPaperPreview(paperId, { signal: controller.signal })
      : fetchPaperBySlug(slug!, { signal: controller.signal })
    request
      .then((loadedPaper) => {
        if (!controller.signal.aborted) {
          setResult({ error: null, paper: loadedPaper, requestId })
        }
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted || isAbortError(requestError)) return

        if (requestError instanceof PaperNotFoundError || (requestError instanceof PaperApiError && requestError.status === 404)) {
          setResult({ error: 'not-found', paper: null, requestId })
          return
        }

        if (preview && requestError instanceof PaperApiError && (requestError.status === 401 || requestError.status === 403)) {
          setResult({ error: requestError.status === 401 ? 'session' : 'forbidden', paper: null, requestId })
          return
        }

        console.error('Unable to load the research resource.', requestError)
        setResult({ error: 'unavailable', paper: null, requestId })
      })

    return () => controller.abort()
  }, [requestId, slug, preview, paperId, validId])

  const retryPaper = () => {
    setRequestVersion((version) => version + 1)
  }

  const publishedDate = paper?.publishedAt
    ? formatPublishedDate(paper.publishedAt)
    : null
  const externalSourceUrl = paper ? getExternalSourceUrl(paper.externalUrl) : null
  const citation = paper ? getCitation(paper) : ''
  const doiUrl = paper ? getDoiUrl(paper.doi) : null

  useEffect(() => {
    if (!copyState) return undefined
    const timeout = window.setTimeout(() => setCopyState(null), 2400)
    return () => window.clearTimeout(timeout)
  }, [copyState])

  const copyCitation = async () => {
    try {
      await navigator.clipboard.writeText(citation)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const content = (
      <main className={`paper-detail-main${preview ? ' is-preview' : ''}`}>
        {loading ? (
          <>
            <Link className="paper-detail-back" to={returnPath}>
              <span aria-hidden="true">←</span> {preview ? 'Back to Papers Management' : 'Back to Paper Library'}
            </Link>
            <PaperDetailLoadingState />
          </>
        ) : error ? (
          <PaperDetailStatus error={error} onRetry={retryPaper} preview={preview} returnPath={returnPath} />
        ) : paper ? (
          <>
            <Link className="paper-detail-back" to={returnPath}>
              <span aria-hidden="true">←</span> {preview ? 'Back to Papers Management' : 'Back to Paper Library'}
            </Link>

            {preview && isPreviewPaper(paper) ? (
              <div className="paper-preview-banner">
                <strong>Preview Mode · {paper.status.charAt(0).toUpperCase() + paper.status.slice(1)}</strong>
                <Link to={`/manage/papers/${paper.id}/edit`}>Back to Edit</Link>
              </div>
            ) : null}

            <article>
              <header className="paper-detail-hero">
                <div className="paper-detail-badges">
                  <span>{paper.publicationType}</span>
                  <span>{paper.difficulty}</span>
                  <span>{paper.resourceCategory}</span>
                </div>
                <p className="paper-detail-eyebrow">Research Library</p>
                <h1>{paper.title}</h1>
                <p className="paper-detail-authors">
                  {paper.authors.length > 0
                    ? paper.authors.join(', ')
                    : 'Author information unavailable'}
                </p>
                <p className="paper-detail-publication">{getPublicationDetails(paper)}</p>

                <dl className="paper-detail-meta">
                  <div>
                    <dt>Reading time</dt>
                    <dd>{paper.estimatedReadingMinutes} min</dd>
                  </div>
                  <div>
                    <dt>Access</dt>
                    <dd>{paper.openAccess ? 'Open Access' : 'Guided Access'}</dd>
                  </div>
                  {publishedDate && (
                    <div>
                      <dt>Published</dt>
                      <dd>{publishedDate}</dd>
                    </div>
                  )}
                </dl>
              </header>

              <div className="paper-detail-layout">
                <div className="paper-detail-content">
                  <section className="paper-detail-block">
                    <span>Overview</span>
                    <h2>Abstract</h2>
                    <p>{paper.abstract}</p>
                  </section>

                  <section className="paper-detail-block">
                    <span>Guided Study</span>
                    <h2>Learning Objectives</h2>
                    {paper.learningObjectives.length > 0 ? (
                      <ul>
                        {paper.learningObjectives.map((objective, index) => (
                          <li key={`${objective}-${index}`}>{objective}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No guided learning objectives are currently listed for this resource.</p>
                    )}
                  </section>

                  <section className="paper-detail-block">
                    <span>Resource Tools</span>
                    <h2>Reading Workspace</h2>
                    <div className="paper-coming-soon-grid">
                      {['Guided Notes', 'Concept Highlights', 'Knowledge Check'].map((tool) => (
                        <div aria-disabled="true" className="paper-coming-soon-card" key={tool}>
                          <strong>{tool}</strong>
                          <span>Coming Soon</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <aside className="paper-detail-sidebar" aria-label="Paper metadata">
                  <section>
                    <h2>Topics</h2>
                    {paper.topics.length > 0 ? (
                      <div className="paper-detail-tags">
                        {paper.topics.map((topic, index) => (
                          <span key={`${topic}-${index}`}>{topic}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="paper-detail-empty-meta">No topics listed.</p>
                    )}
                  </section>
                  <section>
                    <h2>Keywords</h2>
                    {paper.keywords.length > 0 ? (
                      <div className="paper-detail-tags is-muted">
                        {paper.keywords.map((keyword, index) => (
                          <span key={`${keyword}-${index}`}>{keyword}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="paper-detail-empty-meta">No keywords listed.</p>
                    )}
                  </section>
                  <section className="paper-detail-citation">
                    <h2>Citation</h2>
                    <dl>
                      {paper.authors.length > 0 && <div><dt>Authors</dt><dd>{paper.authors.join(', ')}</dd></div>}
                      {paper.year && <div><dt>Year</dt><dd>{paper.year}</dd></div>}
                      {paper.title && <div><dt>Title</dt><dd>{paper.title}</dd></div>}
                      {paper.journal && <div><dt>Journal</dt><dd>{paper.journal}</dd></div>}
                      {paper.publisher && <div><dt>Publisher</dt><dd>{paper.publisher}</dd></div>}
                      {paper.volume && <div><dt>Volume</dt><dd>{paper.volume}</dd></div>}
                      {paper.issue && <div><dt>Issue</dt><dd>{paper.issue}</dd></div>}
                      {paper.pages && <div><dt>Pages</dt><dd>{paper.pages}</dd></div>}
                      {doiUrl && <div><dt>DOI</dt><dd><a href={doiUrl} rel="noopener noreferrer" target="_blank">{paper.doi}</a></dd></div>}
                    </dl>
                    <button onClick={() => void copyCitation()} type="button">Copy Citation</button>
                    <span aria-live="polite">{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Could not copy citation.' : ''}</span>
                  </section>
                  <section className="paper-detail-source">
                    <h2>Source</h2>
                    {externalSourceUrl ? (
                      <a href={externalSourceUrl} rel="noopener noreferrer" target="_blank">
                        Open External Source <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <p>No external source is currently available for this resource.</p>
                    )}
                  </section>
                </aside>
              </div>
            </article>
          </>
        ) : null}
      </main>
  )

  if (preview) return content

  return (
    <div className="paper-detail-page">
      <PageParticleBackground />
      <Navbar />
      {content}
      <Footer />
    </div>
  )
}

export default PaperDetailPage
