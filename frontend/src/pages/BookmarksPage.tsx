import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { bookmarkPath, getBookmarks, removeBookmark, type Bookmark, type BookmarkType } from '../api/reading'
import { coursePath, PRIMARY_COURSE_SLUG } from '../api/courses'
import { useAuth } from '../auth/useAuth'
import { usePersonalState } from '../hooks/usePersonalState'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import PageParticleBackground from '../components/PageParticleBackground'
import './CoursePage.css'
import './LearningPage.css'
import '../components/learning/PersonalReading.css'
import './BookmarksPage.css'

const types: { value: BookmarkType; label: string; filter: string }[] = [
  { value: 'paper', label: 'Paper', filter: 'Papers' },
  { value: 'course', label: 'Course', filter: 'Course' },
  { value: 'module', label: 'Module', filter: 'Modules' },
  { value: 'research_area', label: 'Research area', filter: 'Research Areas' },
]
const labelFor = (type: BookmarkType) => types.find(item => item.value === type)!.label
const titleFor = (row: Bookmark) => row.available && row.target.title.trim()
  ? row.target.title : `${labelFor(row.targetType)} title unavailable`

function BookmarksContent() {
  const state = usePersonalState('bookmarks-page', getBookmarks)
  const [filter, setFilter] = useState<BookmarkType | 'all'>('all')
  const [showRemovalError, setShowRemovalError] = useState(true)
  const content = useRef<HTMLDivElement>(null)
  const focusAfterRemoval = useRef<number | 'empty' | null>(null)
  const rows = state.data?.filter(row => filter === 'all' || row.targetType === filter) ?? []

  useEffect(() => {
    if (state.loading || state.busy || state.error || focusAfterRemoval.current === null) return
    const next = focusAfterRemoval.current
    focusAfterRemoval.current = null
    const destination = next === 'empty' ? null : content.current?.querySelector<HTMLButtonElement>(`[data-remove-id="${next}"]`)
    const fallback = content.current?.querySelector<HTMLElement>('.bw-empty h2, .bw-filters [aria-pressed="true"]')
    ;(destination ?? fallback)?.focus()
  }, [state.loading, state.busy, state.error, state.data])

  async function remove(id: number) {
    setShowRemovalError(true)
    const index = rows.findIndex(row => row.id === id)
    focusAfterRemoval.current = (rows[index + 1] ?? rows[index - 1])?.id ?? 'empty'
    const saved = await state.run(signal => removeBookmark(id, signal))
    if (!saved) focusAfterRemoval.current = null
  }

  if (state.loading) return <p role="status" className="bw-message">Loading bookmarks…</p>
  if (state.error) return <section className="bw-message"><p role="alert">Bookmarks are unavailable. Please try again.</p>
    <button type="button" onClick={state.retry}>Refresh bookmarks</button></section>

  return <div className="bw-content" ref={content}>
    {!!state.data?.length && <div className="bw-filters" role="group" aria-label="Bookmark type">
      <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
      {types.map(type => <button key={type.value} type="button" aria-pressed={filter === type.value} onClick={() => setFilter(type.value)}>{type.filter}</button>)}
    </div>}
    {!rows.length ? <section className="bw-empty">
      <h2 tabIndex={-1}>{state.data?.length ? 'No bookmarks of this type.' : 'No bookmarks yet.'}</h2>
      {!state.data?.length && <div className="bw-browse"><Link to={coursePath(PRIMARY_COURSE_SLUG)}>Browse course →</Link><Link to="/papers">Browse papers →</Link></div>}
    </section> : <ul className="bw-list" aria-label="Saved items">
      {rows.map(row => <li key={row.id} className="bw-item">
        <div className="bw-item-copy"><span className="bw-type">{labelFor(row.targetType)}</span>
          {row.available ? <>
            <h2><Link to={bookmarkPath(row.targetType, row.target)}>{titleFor(row)}</Link></h2>
            {row.target.titleZh && <p lang="zh">{row.target.titleZh}</p>}
            {row.targetType === 'module' && <p className="bw-context">Module {String(row.target.number).padStart(2, '0')}{row.target.courseTitle?.trim() ? ` · ${row.target.courseTitle}` : ''}</p>}
            {row.targetType === 'paper' && !![row.target.authors?.join(', '), row.target.year, row.target.journal].filter(Boolean).length
              && <p className="bw-metadata">{[row.target.authors?.join(', '), row.target.year, row.target.journal].filter(Boolean).join(' · ')}</p>}
            {row.targetType === 'research_area' && row.target.code && <p className="bw-context">{row.target.code}</p>}
          </> : <><h2>Unavailable {labelFor(row.targetType).toLowerCase()}</h2><p>This saved item is no longer available.</p></>}
        </div>
        <div className="bw-item-actions">
          {row.available && <Link to={bookmarkPath(row.targetType, row.target)} aria-label={`Open ${titleFor(row)}`}>Open →</Link>}
          <button type="button" data-remove-id={row.id} disabled={state.busy}
            aria-label={`Remove ${row.available ? titleFor(row) : `unavailable ${labelFor(row.targetType).toLowerCase()}`} bookmark`}
            onClick={() => void remove(row.id)}>Remove bookmark</button>
        </div>
      </li>)}
    </ul>}
    {state.errorMessage && showRemovalError && <section className="bw-message"><p role="alert">{state.errorMessage} Refresh your saved list or try removing the bookmark again.</p>
      <button type="button" onClick={() => {
        setShowRemovalError(false)
        focusAfterRemoval.current = rows[0]?.id ?? 'empty'
        state.retry()
      }}>Refresh bookmarks</button></section>}
    <p role="status" className="bw-feedback">{state.busy ? 'Removing bookmark…' : state.message ? 'Bookmark removed.' : ''}</p>
  </div>
}

export default function BookmarksPage() {
  const { state, refreshAuth } = useAuth()
  const location = useLocation()
  if (state.status === 'anonymous') return <Navigate replace to="/login" state={{ from: location.pathname }} />
  return <div className="app-shell course-page learning-page"><PageParticleBackground /><Navbar />
    <main className="course-main bookmarks-main bw-main" id="bookmarks-main" tabIndex={-1}>
      <header className="bw-header"><h1>Bookmarks</h1><p>Your saved places in research and learning.</p></header>
      {state.status === 'authenticated' ? <BookmarksContent key={state.user.id} />
        : state.status === 'loading' ? <p role="status">Checking sign-in…</p>
        : <section className="bw-message"><p role="alert">Sign-in status unavailable.</p><button type="button" onClick={() => void refreshAuth()}>Retry sign-in</button></section>}
  </main><Footer /></div>
}
