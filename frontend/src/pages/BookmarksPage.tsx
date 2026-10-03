import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { bookmarkPath, getBookmarks, removeBookmark, type BookmarkType } from '../api/reading'
import { usePersonalState } from '../hooks/usePersonalState'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import PageParticleBackground from '../components/PageParticleBackground'
import './CoursePage.css'
import './LearningPage.css'
import '../components/learning/PersonalReading.css'

const filters: { value: BookmarkType | 'all'; label: string }[] = [{value:'all',label:'All'},{value:'paper',label:'Papers'},{value:'course',label:'Courses'},{value:'module',label:'Modules'},{value:'research_area',label:'Research Areas'}]
export default function BookmarksPage() {
  const state = usePersonalState('bookmarks-page', getBookmarks), location = useLocation()
  const [filter, setFilter] = useState<BookmarkType | 'all'>('all')
  if (state.auth.status === 'anonymous') return <Navigate replace to="/login" state={{ from: location.pathname }} />
  const rows = state.data?.filter(row => filter === 'all' || row.targetType === filter) ?? []
  return <div className="app-shell course-page learning-page"><PageParticleBackground /><Navbar /><main className="course-main bookmarks-main"><h1>Bookmarks</h1><p>Your saved research and learning content.</p>
    <div className="personal-actions bookmark-filters" role="group" aria-label="Bookmark type">{filters.map(f => <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>{f.label}</button>)}</div>
    {state.auth.status === 'unavailable' ? <section className="learning-panel"><p role="alert">Sign-in status unavailable.</p><button type="button" onClick={() => void state.refreshAuth()}>Retry sign-in</button></section>
      : state.auth.status === 'loading' || state.loading ? <p role="status">Loading bookmarks…</p>
      : state.error ? <section className="learning-panel"><p role="alert">Bookmarks are unavailable.</p><button type="button" onClick={state.retry}>Retry bookmarks</button></section>
      : !rows.length ? <section className="learning-panel"><h2>No bookmarks yet</h2><p>{filter === 'all' ? 'Save a published paper, course, module, or research area to find it here.' : 'No saved items of this type.'}</p></section>
      : <div className="bookmark-grid">{rows.map(row => <article className="learning-panel bookmark-card" key={row.id}><span>{filters.find(f => f.value === row.targetType)?.label}</span>
        {row.available ? <><h2>{row.target.title}</h2>{row.targetType === 'paper' && <p>{[row.target.authors?.join(', '),row.target.year,row.target.journal].filter(Boolean).join(' · ') || 'Publication details unavailable'}</p>}
          {row.target.titleZh && <p lang="zh">{row.target.titleZh}</p>}{row.targetType === 'module' && <p>Module {row.target.number} · {row.target.courseTitle}</p>}
          {row.targetType === 'research_area' && <p>{row.target.code} · {row.target.overview}</p>}{row.target.description && <p>{row.target.description}</p>}
          <Link to={bookmarkPath(row.targetType,row.target)}>Open</Link></> : <><h2>Unavailable {row.targetType.replace('_',' ')}</h2><p>This saved item is no longer publicly available.</p></>}
        <button type="button" disabled={state.busy} aria-label={`Remove ${row.available ? row.target.title : 'unavailable item'} bookmark`} onClick={() => void state.run(signal => removeBookmark(row.id,signal))}>Remove Bookmark</button>
      </article>)}</div>}
    {state.errorMessage && <p role="alert">{state.errorMessage}</p>}<span className="personal-status-message" aria-live="polite">{state.message}</span>
  </main><Footer /></div>
}
