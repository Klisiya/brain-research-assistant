import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getSearch, parseSearchUrl, SEARCH_TYPES, searchPath, searchResultPath, type SearchResult, type SearchType } from '../api/search'
import { useCourseRead } from '../hooks/useCourseRead'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import PageParticleBackground from '../components/PageParticleBackground'
import './SearchPage.css'

const labels: Record<SearchType, string> = { all: 'All', papers: 'Papers', courses: 'Courses', modules: 'Modules', research: 'Research Areas' }
const badges = { papers: 'Paper', courses: 'Course', modules: 'Module', research: 'Research Area' }
function ResultCard({ item }: { item: SearchResult }) {
  return <li className="global-search-card">
    <p className="global-search-eyebrow">{badges[item.type]}{item.type === 'modules' && ` · Module ${String(item.metadata.number).padStart(2, '0')}`}{item.type === 'research' && ` · ${item.code}`}</p>
    <h2><Link to={searchResultPath(item)}>{item.title}</Link></h2>
    {(item.type === 'courses' || item.type === 'modules') && item.titleZh && <p className="global-search-secondary" lang="zh">{item.titleZh}</p>}
    {item.type === 'papers' && <p className="global-search-secondary">{[item.metadata.authors.join(', '), item.metadata.year, item.metadata.journal].filter(v => v !== null && v !== '').join(' · ')}</p>}
    {item.type === 'modules' && <p className="global-search-secondary">{item.metadata.courseTitle} · {item.metadata.category} · {item.metadata.durationHours} Hours</p>}
    {item.summary && <p className="global-search-summary">{item.summary}</p>}
  </li>
}
export default function SearchPage() {
  const [url] = useSearchParams(), navigate = useNavigate()
  const { params, invalid } = useMemo(() => parseSearchUrl(url), [url])
  const [draft, setDraft] = useState({ source: params.q, value: params.q })
  const input = draft.source === params.q ? draft.value : params.q
  const identity = `${invalid}:${params.q}:${params.type}:${params.page}`
  const reader = useCallback((signal: AbortSignal) => params.q && !invalid ? getSearch(params, signal) : Promise.resolve(null), [params, invalid])
  const state = useCourseRead(identity, reader)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const q = input.trim()
    if (q) navigate(searchPath(q, params.type))
  }
  const data = state.data
  return <div className="app-shell global-search-page"><PageParticleBackground /><Navbar />
    <main className="global-search-main">
      <header className="global-search-header"><p className="global-search-eyebrow">Explore published knowledge</p><h1>Search Brain Research</h1><p>Find papers, courses, learning modules, and research areas.</p></header>
      <form className="global-search-form" role="search" onSubmit={submit}>
        <label htmlFor="global-search-query">Search published content</label>
        <div><input id="global-search-query" type="search" maxLength={200} placeholder="Search by title, topic, or keyword" value={input} onChange={e => setDraft({ source: params.q, value: e.target.value })} /><button type="submit">Search</button></div>
      </form>
      <nav className="global-search-filters" aria-label="Search result types">{SEARCH_TYPES.map(type => <Link key={type} to={searchPath(params.q, type)} aria-current={params.type === type ? 'page' : undefined}>{labels[type]}{data && <span> {type === 'all' ? Object.values(data.counts).reduce((a,b) => a+b,0) : data.counts[type]}</span>}</Link>)}</nav>
      <section className="global-search-results" aria-label="Search results" aria-busy={Boolean(params.q && !invalid && state.loading)}>
        {invalid ? <div className="global-search-status" role="alert"><h2>Invalid search parameters</h2><p>Use a query of up to 200 characters, a valid content type, and a positive page number.</p><Link to="/search">Reset search parameters</Link></div>
          : !params.q ? <div className="global-search-status"><h2>Search the Brain Research platform</h2><p>Enter a query to explore published content.</p></div>
          : state.loading ? <p className="global-search-status" role="status">Searching published content…</p>
          : state.error ? <div className="global-search-status" role="alert"><h2>Search unavailable</h2><p>We could not load your results. Please try again.</p><button onClick={state.retry} type="button">Retry</button></div>
          : data && <><p role="status" className="global-search-count">{data.total} {data.total === 1 ? 'result' : 'results'} for “{params.q}”</p>
            {data.items.length ? <ul className="global-search-list">{data.items.map(item => <ResultCard item={item} key={item.key} />)}</ul> : <div className="global-search-status"><h2>{data.total ? 'No results on this page' : `No results found for “${params.q}”`}</h2><p>{data.total ? 'Return to the first page to view matching content.' : 'Try another query or content type.'}</p>{data.total > 0 && <Link to={searchPath(params.q, params.type)}>First page</Link>}</div>}
            {data.totalPages > 0 && params.page <= data.totalPages && <nav className="global-search-pagination" aria-label="Search pagination">{params.page > 1 && <Link rel="prev" to={searchPath(params.q, params.type, params.page - 1)}>Previous page</Link>}<span>Page {params.page} of {data.totalPages}</span>{params.page < data.totalPages && <Link rel="next" to={searchPath(params.q, params.type, params.page + 1)}>Next page</Link>}</nav>}
          </>}
      </section>
    </main><Footer /></div>
}
