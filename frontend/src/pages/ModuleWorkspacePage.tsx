import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { courseApiPath, coursePath, getCourse, getModule, getResources, modulePath } from '../api/courses'
import { getReadings } from '../api/courseManagement'
import { statusLabel } from '../api/learning'
import { useAuth } from '../auth/useAuth'
import { useCourseRead } from '../hooks/useCourseRead'
import { useLearningCourse, type LearningController } from '../hooks/useLearningCourse'
import Navbar from '../components/Navbar'
import BookmarkControl from '../components/learning/BookmarkControl'
import { ResourceLearning } from '../components/learning/LearningControls'
import ModuleResourceViewer, { ResourceFallback } from '../components/modules/ModuleResourceViewer'
import './ModuleWorkspacePage.css'

function ModuleProgress({ learning, slug, path }: { learning: LearningController; slug: string; path: string }) {
  const activity = learning.data?.modules.find(module => module.slug === slug)
  return <div className="mw-progress" aria-label="Module learning status">
    {learning.auth.status === 'anonymous' ? <Link to="/login" state={{ from: path }}>Sign in to save progress</Link>
      : learning.auth.status === 'unavailable' ? <><span role="alert">Sign-in status unavailable.</span><button onClick={() => void learning.refreshAuth()} type="button">Retry sign-in</button></>
      : learning.auth.status === 'loading' || learning.loading ? <span role="status">Loading learning state…</span>
      : learning.error ? <><span role="alert">Learning state unavailable.</span><button type="button" onClick={learning.retry}>Retry learning state</button></>
      : !learning.data ? <><span>Progress saving is optional. Keep your learning record across devices.</span><button type="button" disabled={learning.busy} onClick={() => void learning.run({ type: 'enroll' })}>Enable progress saving</button></>
      : activity ? <><strong>{statusLabel(activity.status)}</strong><span>Self-reported learning</span>{activity.status === 'not_started' && <button type="button" disabled={learning.busy} onClick={() => void learning.run({ type: 'module', moduleSlug: slug, action: 'start' })}>Start module</button>}<button type="button" disabled={learning.busy} onClick={() => void learning.run({ type: 'module', moduleSlug: slug, action: activity.status === 'completed' ? 'incomplete' : 'complete' })}>{activity.status === 'completed' ? 'Mark module as Incomplete' : 'Mark module as Complete'}</button></>
      : <span>This module is outside your saved completion rule.</span>}
    {learning.data && <span className="mw-progress-note">Completion is recorded only when you mark it. Assessment verification is not available.</span>}
    {learning.errorMessage && <span role="alert">{learning.errorMessage} <button type="button" onClick={learning.retry}>Reload learning state</button></span>}
    {learning.message && <span role="status">{learning.message}</span>}
  </div>
}

function WorkspaceDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    const width = window.innerWidth
    const resize = () => { if (window.innerWidth !== width) onClose() }
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); dialog.close(); trigger?.focus() }
  }, [onClose])
  return <dialog ref={ref} className="mw-drawer" aria-labelledby="mw-drawer-title" onCancel={event => { event.preventDefault(); onClose() }} onClick={event => {
    if (event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
  }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]')).filter(control => control.getClientRects().length > 0)
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }}>
    <div className="mw-drawer-heading"><h2 id="mw-drawer-title">{title}</h2><button type="button" onClick={onClose} autoFocus>Close</button></div>
    {children}
  </dialog>
}

export default function ModuleWorkspacePage() {
  const { courseSlug = '', moduleSlug = '' } = useParams()
  const { state: auth } = useAuth()
  const account = `${auth.status}:${auth.user?.id ?? ''}`
  const learning = useLearningCourse(courseSlug)
  const [search, setSearch] = useSearchParams()
  const [panel, setPanel] = useState<'contents' | 'tools' | null>(null)
  const closePanel = useCallback(() => setPanel(null), [])
  const base = courseApiPath(courseSlug, moduleSlug)
  const path = modulePath(courseSlug, moduleSlug)
  const reader = useCallback(async (signal: AbortSignal) => {
    const [detail, course, resources, readings] = await Promise.all([getModule(courseSlug, moduleSlug, signal), getCourse(courseSlug, signal), getResources(`${base}/resources`, signal), getReadings(`${base}/papers`, signal)])
    return { ...detail, modules: course.modules, resources, readings: readings.filter(reading => reading.paper) }
  }, [base, courseSlug, moduleSlug])
  const state = useCourseRead(`${base}:${account}`, reader)
  const data = state.data
  const requestedReading = data?.readings.find(row => String(row.relationId) === search.get('paper'))
  const resource = data?.resources.find(row => String(row.id) === search.get('resource')) ?? (!requestedReading ? data?.resources[0] : undefined)
  const reading = !resource ? requestedReading ?? data?.readings[0] : undefined
  const ready = Boolean(data && (data.resources.length || data.readings.length))
  const moduleIndex = data?.modules.findIndex(module => module.id === data.module.id) ?? -1
  const previous = moduleIndex > 0 ? data?.modules[moduleIndex - 1] : undefined
  const next = moduleIndex >= 0 ? data?.modules[moduleIndex + 1] : undefined
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }) }, [path])

  const contents = data && <nav className="mw-content-nav" aria-label="Module materials">
    <h2>Contents</h2>
    {data.resources.length > 0 && <><h3>Resources</h3><ul>{data.resources.map(row => <li key={row.id}><button type="button" aria-current={resource?.id === row.id ? 'true' : undefined} onClick={() => { setSearch({ resource: String(row.id) }, { replace: true }); closePanel() }}><span>{row.displayName}</span><small>{row.attachmentType.replaceAll('_', ' ')} · v{row.version}</small></button></li>)}</ul></>}
    {data.readings.length > 0 && <><h3>Paper readings</h3><ul>{data.readings.map(row => <li key={row.relationId}><Link to={`/papers/${encodeURIComponent(row.paper!.slug)}`} state={{ from: `${path}?paper=${row.relationId}` }}><span>{row.paper!.title} ↗</span><small>{row.readingType === 'required' ? 'Required reading' : 'Recommended reading'}</small></Link></li>)}</ul></>}
  </nav>
  const tools = data && <aside className="mw-tools" aria-label="Current resource tools"><h2>Tools</h2>
    {resource ? <><p className="mw-tool-name">{resource.displayName}</p><dl><dt>Type</dt><dd>{resource.attachmentType.replaceAll('_', ' ')}</dd><dt>Version</dt><dd>{resource.version}</dd>{resource.fileSize !== null && <><dt>File size</dt><dd>{(resource.fileSize / 1024 / 1024).toFixed(1)} MB</dd></>}</dl><ResourceFallback resource={resource} /><ResourceLearning learning={learning} resourceId={resource.id} version={resource.version} moduleSlug={moduleSlug} /></>
      : <p>Reading progress, Guided Notes and Concept Highlights are available in the Paper Reading Workspace.</p>}
    <BookmarkControl targetType="module" targetId={data.module.id} showSignInPrompt={false} />
  </aside>
  return <div className="app-shell module-workspace">
    <a className="mw-skip" href="#module-main">Skip to module</a>
    <div className="mw-global-nav"><Navbar /></div>
    <div className="mw-mobile-brand"><Link to="/">Brain Research</Link><Link to={coursePath(courseSlug)}>Course</Link></div>
    <main id="module-main" tabIndex={-1} className="mw-main" aria-busy={state.loading}>
      <Link className="mw-back" to={`${coursePath(courseSlug)}#modules`}>← Back to Course</Link>
      {!data ? <section className="mw-load-state"><h1>{state.loading ? 'Loading module…' : state.error === 'not-found' ? 'Module not found' : 'Module unavailable'}</h1><p role={state.error ? 'alert' : 'status'}>{state.loading ? 'Loading available materials.' : state.error === 'not-found' ? 'This module does not exist or has not been published.' : 'Materials could not be loaded. Please try again.'}</p>{state.error === 'unavailable' && <button type="button" onClick={state.retry}>Retry materials</button>}</section> : <>
        <header className="mw-header"><p className="mw-eyebrow">Module {String(data.module.number).padStart(2, '0')} <span>· {data.module.durationHours} Hours</span></p><h1>{data.module.title}</h1><p className="mw-title-zh" lang="zh">{data.module.titleZh}</p></header>
        <ModuleProgress learning={learning} slug={moduleSlug} path={path} />
        {ready ? <>
          <div className="mw-mobile-actions"><button className="mw-contents-trigger" aria-haspopup="dialog" aria-expanded={panel === 'contents'} type="button" onClick={() => setPanel('contents')}>Contents ({data.resources.length + data.readings.length})</button><button className="mw-tools-trigger" aria-haspopup="dialog" aria-expanded={panel === 'tools'} type="button" onClick={() => setPanel('tools')}>Tools</button></div>
          <div className="mw-grid"><div className="mw-content-rail">{contents}</div>
            {resource ? <ModuleResourceViewer key={`${account}:${path}:${resource.id}:${resource.version}`} resource={resource} downloadBase={base} account={account} /> : <section className="mw-viewer mw-paper-entry"><p className="mw-eyebrow">Paper reading</p><h2>{reading?.paper?.title}</h2><p>This paper opens in the Paper Reading Workspace, with its own progress and annotation tools.</p>{reading?.paper && <Link to={`/papers/${encodeURIComponent(reading.paper.slug)}`} state={{ from: `${path}?paper=${reading.relationId}` }}>Open Paper Reading Workspace →</Link>}</section>}
            <div className="mw-tool-rail">{tools}</div>
          </div>
        </> : <section className="mw-empty"><p>Learning materials have not been added yet.</p><BookmarkControl targetType="module" targetId={data.module.id} showSignInPrompt={false} /></section>}
        <nav className="mw-module-navigation" aria-label="Module navigation">{previous ? <Link to={modulePath(courseSlug, previous.slug)}><small>← Previous Module · {String(previous.number).padStart(2, '0')}</small><span>{previous.title}</span></Link> : <span className="mw-boundary">First module</span>}{next ? <Link to={modulePath(courseSlug, next.slug)}><small>Next Module · {String(next.number).padStart(2, '0')} →</small><span>{next.title}</span></Link> : <span className="mw-boundary">Last module</span>}</nav>
      </>}
    </main>
    {panel && ready && <WorkspaceDrawer key={`${path}:${account}`} title={panel === 'contents' ? 'Contents' : 'Tools'} onClose={closePanel}>{panel === 'contents' ? contents : tools}</WorkspaceDrawer>}
  </div>
}
