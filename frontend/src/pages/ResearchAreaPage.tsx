import { useCallback, useEffect, useRef } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { getResearchDetail, getResearchList, researchPath, type ResearchDetail, type ResearchArea } from '../api/research'
import { modulePath } from '../api/courses'
import { useCourseRead } from '../hooks/useCourseRead'
import { usePersonalState } from '../hooks/usePersonalState'
import { getBookmarks, removeBookmark, saveBookmark } from '../api/reading'
import { useAuth } from '../auth/useAuth'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import PageParticleBackground from '../components/PageParticleBackground'
import './ResearchAreaPage.css'
import '../components/learning/PersonalReading.css'

function ResearchBookmark({ areaId }: { areaId: number }) {
  const state = usePersonalState(`bookmark:research_area:${areaId}`, getBookmarks)
  const location = useLocation()
  const button = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const saved = state.data?.find(row => row.targetType === 'research_area' && row.available && row.target.id === areaId)
  useEffect(() => {
    if (state.busy || state.loading || !restoreFocus.current) return
    restoreFocus.current = false
    if (document.activeElement === document.body) button.current?.focus()
  }, [state.busy, state.loading, state.data, state.errorMessage])
  return <div className="personal-controls bookmark-control" role="group" aria-label="Bookmark research area">
    {state.auth.status === 'anonymous' ? <Link to="/login" state={{ from: location.pathname }}>Sign in to save</Link>
      : state.auth.status === 'unavailable' ? <><p role="alert">Sign-in status unavailable.</p><button type="button" onClick={() => void state.refreshAuth()}>Retry sign-in</button></>
      : state.auth.status === 'loading' ? <p role="status">Loading bookmark…</p>
      : state.error ? <><p role="alert">Bookmark state unavailable.</p><button ref={button} type="button" onClick={() => {
          restoreFocus.current = document.activeElement === button.current
          state.retry()
        }}>Retry bookmark</button></>
      : <button ref={button} type="button" disabled={state.busy || state.loading} aria-pressed={Boolean(saved)}
        aria-label={saved ? 'Remove research area from bookmarks' : 'Save research area'} onClick={() => {
          restoreFocus.current = document.activeElement === button.current
          void state.run(signal => saved ? removeBookmark(saved.id, signal) : saveBookmark('research_area', areaId, signal))
        }}>{state.busy ? 'Saving…' : state.loading ? 'Loading bookmark…' : saved ? 'Saved · Remove Bookmark' : 'Save Bookmark'}</button>}
    {state.errorMessage && <p role="alert">{state.errorMessage}</p>}
    <span className="personal-status-message" aria-live="polite">{state.message}</span>
  </div>
}

function AreaContent({ detail, account }: { detail: ResearchDetail; account: number | null }) {
  const { area } = detail
  const papers = detail.papers.flatMap(row => row.paper ? [{ relationId: row.relationId, paper: row.paper }] : [])
  const modules = detail.modules.flatMap(row => row.course && row.module ? [{ relationId: row.relationId, course: row.course, module: row.module }] : [])
  const hasContent = papers.length > 0 || modules.length > 0 || detail.resources.length > 0 || detail.brainRegions.length > 0
  return <>
    <nav className="research-breadcrumb" aria-label="Research navigation"><Link to="/research">← Back to Research Areas</Link></nav>
    <header className={`research-header research-accent-${area.slug}`}>
      <div><p className="research-eyebrow">{area.code} · Research Area</p><h1>{area.name}</h1></div>
      <ResearchBookmark key={`${account}:${area.id}`} areaId={area.id} />
    </header>
    {area.overview && <p className="research-overview">{area.overview}</p>}
    {area.subtopics.length > 0 && <section className="research-section" aria-labelledby="research-topics-heading">
      <h2 id="research-topics-heading">Subtopics</h2><ul className="research-topics">{area.subtopics.map(topic => <li key={topic}>{topic}</li>)}</ul>
    </section>}
    {!hasContent && <p className="research-empty">No research resources are currently linked to this area.</p>}
    {papers.length > 0 && <section className="research-section" aria-labelledby="research-papers-heading">
      <h2 id="research-papers-heading">Linked Papers</h2>
      <ul className="research-linked-list">{papers.map(({ relationId, paper }) => <li key={relationId}>
        <Link className="research-content-link" to={`/papers/${encodeURIComponent(paper.slug)}`}>
          <div><h3>{paper.title}</h3>{paper.authors.length > 0 && <p>{paper.authors.join(', ')}</p>}</div>
          <span className="research-action">Read paper <span aria-hidden="true">→</span></span>
        </Link>
      </li>)}</ul>
    </section>}
    {modules.length > 0 && <section className="research-section" aria-labelledby="research-modules-heading">
      <h2 id="research-modules-heading">Linked Modules</h2>
      <ul className="research-linked-list">{modules.map(({ relationId, course, module }) => <li key={relationId}>
        <Link className="research-content-link" to={modulePath(course.slug, module.slug)}>
          <span className="research-module-number">{String(module.number).padStart(2, '0')}</span>
          <div><p className="research-eyebrow">Module · {module.durationHours} Hours</p><h3>{module.title}</h3><p lang="zh">{module.titleZh}</p>{course.title.trim() && <p className="research-course-name">{course.title}</p>}</div>
          <span className="research-action">Open module <span aria-hidden="true">→</span></span>
        </Link>
      </li>)}</ul>
    </section>}
    {detail.resources.length > 0 && <section className="research-section" aria-labelledby="research-resources-heading">
      <h2 id="research-resources-heading">Linked Resources</h2>
      <ul className="research-linked-list">{detail.resources.map(resource => <li key={resource.id} className="research-resource-row">
        <div><h3>{resource.displayName}</h3><p>{resource.attachmentType.replaceAll('_', ' ')} · Version {resource.version}</p>{resource.description && <p>{resource.description}</p>}</div>
        {resource.externalUrl ? <a href={resource.externalUrl} target="_blank" rel="noopener noreferrer">Open external resource ↗</a>
          : resource.downloadUrl ? <a href={resource.downloadUrl}>Download resource ↓</a> : <span className="research-unavailable">Resource unavailable</span>}
      </li>)}</ul>
    </section>}
    {detail.brainRegions.length > 0 && <section className="research-section" aria-labelledby="research-anatomy-heading">
      <h2 id="research-anatomy-heading">Linked Brain Anatomy</h2>
      <ul className="research-anatomy-links">{detail.brainRegions.map(region => <li key={region.slug}><Link to={`/brain-region/${encodeURIComponent(region.slug)}`}>{region.name} →</Link></li>)}</ul>
    </section>}
  </>
}

export default function ResearchAreaPage() {
  const { slug } = useParams()
  const { state: auth } = useAuth()
  const account = auth.status === 'authenticated' ? auth.user.id : null
  const reader = useCallback((signal: AbortSignal): Promise<ResearchDetail | ResearchArea[]> => slug ? getResearchDetail(slug, signal) : getResearchList(false, signal), [slug])
  const state = useCourseRead(`${slug ?? 'list'}:${auth.status}:${account ?? ''}`, reader)
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }) }, [slug])
  const detail = state.data && !Array.isArray(state.data) ? state.data : null
  const areas = Array.isArray(state.data) ? state.data : null
  return <div className="app-shell research-page"><PageParticleBackground /><Navbar />
    <main className="research-main" id="research-main" tabIndex={-1} aria-busy={state.loading}>
      {!state.data ? <section className="research-status">
        <p className="research-eyebrow">Research Areas</p>
        <h1>{state.loading ? 'Loading research…' : state.error === 'not-found' ? 'Research area not found' : 'Research unavailable'}</h1>
        <p role={state.error ? 'alert' : 'status'}>{state.loading ? 'Loading available content.' : state.error === 'not-found' ? 'This area does not exist or is unavailable.' : 'We could not load this content. Please try again.'}</p>
        {state.error === 'unavailable' && <button onClick={state.retry} type="button">Refresh research</button>}
        {!state.loading && <Link to="/research">Back to Research Areas →</Link>}
      </section> : detail ? <AreaContent detail={detail} account={account} /> : <>
        <header className="research-header research-index-header"><div><p className="research-eyebrow">Explore research</p><h1>Research Areas</h1><p>Find the content linked to each research area.</p></div></header>
        {areas?.length ? <nav aria-label="Research areas"><ul className="research-index">{areas.map(area => <li key={area.slug} className={`research-accent-${area.slug}`}>
          <Link className="research-node" to={researchPath(area.slug)}><span className="research-node-code">{area.code}</span><div><h2>{area.name}</h2><span className="research-action">Explore area →</span></div></Link>
        </li>)}</ul></nav> : <p className="research-empty">No research areas are currently available.</p>}
      </>}
    </main><Footer />
  </div>
}
