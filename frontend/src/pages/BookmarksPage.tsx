import { AuthLoginRedirect } from '../components/auth/AuthLoginNavigation'
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
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

const types: { value: BookmarkType; label: string; folder: string }[] = [
  { value: 'paper', label: 'Paper', folder: 'Papers' },
  { value: 'course', label: 'Course', folder: 'Course' },
  { value: 'module', label: 'Module', folder: 'Modules' },
  { value: 'research_area', label: 'Research area', folder: 'Research Areas' },
]
const labelFor = (type: BookmarkType) => types.find(item => item.value === type)!.label
const titleFor = (row: Bookmark) => !row.available ? `Unavailable ${labelFor(row.targetType).toLowerCase()}`
  : row.target.title.trim() ? row.target.title : `${labelFor(row.targetType)} title unavailable`
const countLabel = (count: number) => `${count} ${count === 1 ? 'item' : 'items'}`

function BookmarkMetadata({ row }: { row: Bookmark }) {
  if (!row.available) return <p>This saved item is no longer available.</p>
  const metadata = row.targetType === 'paper' ? [row.target.authors?.join(', '), row.target.year, row.target.journal].filter(Boolean).join(' · ')
    : row.targetType === 'module' ? [row.target.number ? `Module ${String(row.target.number).padStart(2, '0')}` : '', row.target.courseTitle?.trim()].filter(Boolean).join(' · ')
    : row.targetType === 'research_area' ? row.target.code : ''
  return <>{row.target.titleZh && <p lang="zh">{row.target.titleZh}</p>}{metadata && <p className="bw-metadata">{metadata}</p>}</>
}

/** A decorative folder object around existing bookmark links, never a local file store. */
function BookmarkFolder({ type, index, rows, open, onToggle }: {
  type: typeof types[number]; index: number; rows: Bookmark[]; open: boolean; onToggle: () => void
}) {
  const id = useId().replace(/:/g, '')
  const object = useRef<HTMLDivElement>(null)
  const bounds = useRef<DOMRect | null>(null)
  const motion = useRef(false)
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)')
    const update = () => {
      motion.current = media.matches
      if (!media.matches) {
        object.current?.style.removeProperty('--bf-px')
        object.current?.style.removeProperty('--bf-py')
      }
    }
    update(); media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  function resetPointer() {
    bounds.current = null
    object.current?.style.removeProperty('--bf-px')
    object.current?.style.removeProperty('--bf-py')
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!motion.current || event.pointerType !== 'mouse' || !bounds.current) return
    const rect = bounds.current
    object.current?.style.setProperty('--bf-px', String(Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1))))
    object.current?.style.setProperty('--bf-py', String(Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1))))
  }
  return <section className="bf-folder" data-type={type.value} data-open={open}
    style={{ '--bf-order': Math.floor(index / 2) * 10, '--bf-mobile-order': index * 10, '--bf-entrance-delay': `${index * 65}ms` } as CSSProperties}
    aria-label={`${type.folder} folder`}>
    <div className="bf-object" ref={object} onPointerEnter={event => {
      if (motion.current && event.pointerType === 'mouse') bounds.current = event.currentTarget.getBoundingClientRect()
    }} onPointerMove={move} onPointerLeave={resetPointer} onPointerCancel={resetPointer}>
      <svg className="bf-definitions" aria-hidden="true" width="0" height="0"><defs>
        <clipPath id={`${id}-back`} clipPathUnits="objectBoundingBox"><path d="M0 .206Q0 .125 .065 .125H.43C.5 .125 .506 0 .582 0H.935Q1 0 1 .081V.919Q1 1 .935 1H.065Q0 1 0 .919Z" /></clipPath>
        <clipPath id={`${id}-front`} clipPathUnits="objectBoundingBox"><path d="M0 .111Q0 0 .065 0H.347C.424 0 .43 .162 .506 .162H.935Q1 .162 1 .273V.889Q1 1 .935 1H.065Q0 1 0 .889Z" /></clipPath>
      </defs></svg>
      <div className="bf-tilt">
        <div className="bf-shadow" aria-hidden="true" />
        <div className="bf-back" style={{ clipPath: `url(#${id}-back)` }} aria-hidden="true" />
        <div className="bf-front">
          <div className="bf-glass" style={{ clipPath: `url(#${id}-front)` }} aria-hidden="true" />
          <svg className="bf-rim" viewBox="0 0 340 198" preserveAspectRatio="none" aria-hidden="true"><path d="M.6 22Q.6 .6 22 .6H118C144 .6 146 32 172 32H318Q339.4 32 339.4 54V176Q339.4 197.4 318 197.4H22Q.6 197.4 .6 176Z" /></svg>
          <button className="bf-toggle" type="button" data-folder-toggle={type.value} aria-expanded={open}
            aria-controls={`bf-contents-${type.value}`} onClick={onToggle}>
            <span className="bf-label"><span className="bf-title">{type.folder}</span><span className="bf-count">{countLabel(rows.length)}</span></span>
            <span className="bf-key" aria-hidden="true"><svg viewBox="0 0 24 24"><path d={open ? 'm6 14 6-6 6 6' : 'm9 5 7 7-7 7'} /></svg></span>
          </button>
        </div>
        <div className="bf-preview" inert={!open} aria-hidden={!open}>
          {rows.slice(0, 3).map((row, slot) => <div className="bf-preview-sheet" key={row.id}
            style={{ '--bf-slot': slot - (Math.min(3, rows.length) - 1) / 2, '--bf-depth': slot } as CSSProperties}>
            {row.available ? <Link to={bookmarkPath(row.targetType, row.target)} aria-label={`Preview: ${titleFor(row)}`}>
              <span className="bf-sheet-kind">{labelFor(row.targetType)}</span><span className="bf-sheet-title">{titleFor(row)}</span>
            </Link> : <span><span className="bf-sheet-kind">Unavailable</span><span className="bf-sheet-title">{titleFor(row)}</span></span>}
          </div>)}
        </div>
      </div>
    </div>
  </section>
}

function BookmarkDrawer({ type, index, rows, open, anotherOpen, busy, onClose, onRemove }: {
  type: typeof types[number]; index: number; rows: Bookmark[]; open: boolean; anotherOpen: boolean; busy: boolean
  onClose: () => void; onRemove: (id: number) => void
}) {
  const [present, setPresent] = useState(open)
  if (open && !present) setPresent(true)
  const drawer = useRef<HTMLElement>(null)
  const opacity = useRef(0)

  useLayoutEffect(() => {
    const element = drawer.current
    if (!element || !present) return
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    let current = true
    const animation = element.animate(open ? [
      { opacity: opacity.current, translate: '0 -6px', scale: '.99' },
      { opacity: 1, translate: '0 0', scale: '1' },
    ] : [
      { opacity: opacity.current, translate: '0 0', scale: '1' },
      { opacity: 0, translate: '0 -4px', scale: '.995' },
    ], { duration: media.matches || (!open && anotherOpen) ? 0 : open ? 200 : 130, easing: 'cubic-bezier(.22,1,.36,1)', fill: open ? 'none' : 'forwards' })
    if (!open) animation.onfinish = () => { if (current) setPresent(false) }
    const finish = () => { if (media.matches && animation.playState === 'running') animation.finish() }
    media.addEventListener('change', finish)
    return () => {
      current = false
      opacity.current = Number(getComputedStyle(element).opacity)
      media.removeEventListener('change', finish)
      animation.cancel()
    }
  }, [open, present, anotherOpen])

  return <section ref={drawer} id={`bf-contents-${type.value}`} className="bf-details" data-type={type.value}
    data-side={index % 2 ? 'right' : 'left'} data-empty={!rows.length} hidden={!present} inert={!open} aria-hidden={open ? undefined : true}
    aria-label={`Saved ${type.folder}`} style={{ '--bf-order': Math.floor(index / 2) * 10 + 1, '--bf-mobile-order': index * 10 + 1 } as CSSProperties}>
    {present && <>
      <h2 className="bf-sr-only">Saved {type.folder}</h2>
      <button className="bf-drawer-close" type="button" aria-label={`Close ${type.folder} folder`} onClick={onClose}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
      {!rows.length ? <p className="bf-folder-empty">No saved items in this folder.</p> : <ul className="bf-documents" data-many={rows.length > 4}
        aria-label={`Saved ${type.folder} documents`} tabIndex={rows.length > 4 ? 0 : undefined}>
        {rows.map(row => <li key={row.id} className={`bf-document${row.available ? '' : ' is-unavailable'}`}>
          <div className="bf-document-copy"><span className="bf-document-type">{labelFor(row.targetType)}</span>
            <h3>{titleFor(row)}</h3><BookmarkMetadata row={row} />
          </div>
          {row.available && <Link className="bf-document-open" to={bookmarkPath(row.targetType, row.target)} aria-label={`Open ${titleFor(row)}`}>
            <svg className="bf-document-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 15 15 5M5 5h10v10" /></svg>
          </Link>}
          <button className="bf-document-remove" type="button" data-remove-id={row.id} disabled={busy}
            aria-label={`Remove ${titleFor(row)} bookmark`} onClick={() => onRemove(row.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.5h13M7 5.5V3h6v2.5M5 5.5l.7 11h8.6l.7-11M8 8.5v5M12 8.5v5" /></svg><span>Remove</span>
          </button>
        </li>)}
      </ul>}
    </>}
  </section>
}

function BookmarksContent() {
  const state = usePersonalState('bookmarks-page', getBookmarks)
  const [open, setOpen] = useState<BookmarkType | null>(null)
  const [showRemovalError, setShowRemovalError] = useState(true)
  const content = useRef<HTMLDivElement>(null)
  const focusAfterRemoval = useRef<number | 'folder' | null>(null)
  const rows = state.data?.filter(row => row.targetType === open) ?? []

  useEffect(() => {
    if (!open) return
    const close = (restore: boolean) => {
      if (restore) content.current?.querySelector<HTMLButtonElement>(`[data-folder-toggle="${open}"]`)?.focus()
      setOpen(null)
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(true) } }
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && !content.current?.contains(event.target)) close(false)
      else if (event.target instanceof Element && !event.target.closest('.bf-folder, .bf-details, .bw-message')) close(false)
    }
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside) }
  }, [open])

  useEffect(() => {
    if (state.loading || state.busy || state.error || focusAfterRemoval.current === null) return
    const next = focusAfterRemoval.current
    focusAfterRemoval.current = null
    const destination = next === 'folder' ? null : content.current?.querySelector<HTMLButtonElement>(`.bf-details:not([aria-hidden="true"]) [data-remove-id="${next}"]`)
    const fallback = content.current?.querySelector<HTMLElement>(`[data-folder-toggle="${open ?? 'paper'}"]`)
    ;(destination ?? fallback)?.focus()
  }, [state.loading, state.busy, state.error, state.data, open])

  async function remove(id: number) {
    setShowRemovalError(true)
    const index = rows.findIndex(row => row.id === id)
    focusAfterRemoval.current = (rows[index + 1] ?? rows[index - 1])?.id ?? 'folder'
    const saved = await state.run(signal => removeBookmark(id, signal))
    if (!saved) focusAfterRemoval.current = null
  }

  if (state.loading) return <p role="status" className="bw-message">Loading bookmarks…</p>
  if (state.error) return <section className="bw-message"><p role="alert">Bookmarks are unavailable. Please try again.</p>
    <button type="button" onClick={state.retry}>Refresh bookmarks</button></section>

  return <div className="bw-content" ref={content}>
    {!state.data?.length && <section className="bw-empty">
      <h2>No bookmarks yet.</h2>
      <div className="bw-browse"><Link to={coursePath(PRIMARY_COURSE_SLUG)}>Browse course →</Link><Link to="/papers">Browse papers →</Link></div>
    </section>}
    <div className="bf-workspace" data-has-open={open !== null}>
      {types.map((type, index) => <Fragment key={type.value}><BookmarkFolder type={type} index={index}
        rows={state.data?.filter(row => row.targetType === type.value) ?? []} open={open === type.value}
        onToggle={() => setOpen(current => current === type.value ? null : type.value)} />
      <BookmarkDrawer type={type} index={index} rows={state.data?.filter(row => row.targetType === type.value) ?? []}
        open={open === type.value} anotherOpen={open !== null && open !== type.value} busy={state.busy}
        onRemove={id => void remove(id)} onClose={() => {
          content.current?.querySelector<HTMLButtonElement>(`[data-folder-toggle="${type.value}"]`)?.focus()
          setOpen(null)
        }} /></Fragment>)}
    </div>
    {state.errorMessage && showRemovalError && <section className="bw-message"><p role="alert">{state.errorMessage} Refresh your saved list or try removing the bookmark again.</p>
      <button type="button" onClick={() => {
        setShowRemovalError(false)
        focusAfterRemoval.current = rows[0]?.id ?? 'folder'
        state.retry()
      }}>Refresh bookmarks</button></section>}
    <p role="status" className="bw-feedback">{state.busy ? 'Removing bookmark…' : state.message ? 'Bookmark removed.' : ''}</p>
  </div>
}

export default function BookmarksPage() {
  const { state, refreshAuth } = useAuth()
  if (state.status === 'anonymous') return <AuthLoginRedirect />
  return <div className="app-shell course-page learning-page"><PageParticleBackground /><Navbar />
    <main className="course-main bookmarks-main bw-main" id="bookmarks-main" tabIndex={-1}>
      <header className="bw-header"><h1>Bookmarks</h1><p>Your saved places in research and learning.</p></header>
      {state.status === 'authenticated' ? <BookmarksContent key={state.user.id} />
        : state.status === 'loading' ? <p role="status">Checking sign-in…</p>
        : <section className="bw-message"><p role="alert">Sign-in status unavailable.</p><button type="button" onClick={() => void refreshAuth()}>Retry sign-in</button></section>}
  </main><Footer /></div>
}
