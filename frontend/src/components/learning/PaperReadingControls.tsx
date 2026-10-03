import { Link, useLocation } from 'react-router-dom'
import { changePaperReading, readingLabel } from '../../api/reading'
import type { PaperReadingController } from '../../hooks/usePaperReading'
import './PersonalReading.css'

export default function PaperReadingControls({ state, slug, attachment }: { state: PaperReadingController; slug: string; attachment?: { id: number; version: number; displayName: string } }) {
  const location = useLocation()
  const item = attachment ? state.data?.resources.find(r => r.attachmentId === attachment.id && r.version === attachment.version) : state.data
  const name = attachment ? `Reading status for ${attachment.displayName}` : 'Paper reading progress'
  const act = (action: 'start' | 'complete' | 'incomplete') => state.run(signal => changePaperReading(slug, action, signal, attachment))
  return <section className="personal-controls paper-reading-controls" aria-label={name}>
    {!attachment && <><h3>Reading Progress</h3><p>Your self-reported reading state. Resource completion is recorded separately.</p></>}
    {state.auth.status === 'anonymous' ? <Link to="/login" state={{ from: location.pathname }}>Sign in to record reading</Link>
      : state.auth.status === 'unavailable' ? <><p role="alert">Sign-in status unavailable.</p><button type="button" onClick={() => void state.refreshAuth()}>Retry sign-in</button></>
      : state.auth.status === 'loading' || state.loading ? <p role={attachment ? undefined : 'status'}>Loading reading state…</p>
      : state.error ? <><p role={attachment ? undefined : 'alert'}>Reading state unavailable.</p><button type="button" onClick={state.retry}>Retry reading state</button></>
      : !item ? <p>This resource changed or is unavailable. Refresh the paper before recording reading.</p>
      : <><p className="personal-state">{readingLabel(item.status)}{attachment && <> · Version {attachment.version}</>}</p><div className="personal-actions">
        {item.status === 'not_started' && <button type="button" disabled={state.busy} onClick={() => void act('start')}>Start Reading</button>}
        <button type="button" disabled={state.busy} onClick={() => void act(item.status === 'completed' ? 'incomplete' : 'complete')}>{item.status === 'completed' ? 'Mark as Unread' : 'Mark as Read'}</button>
      </div>{attachment && 'history' in item && item.history.some(h => h.selfCompletedAt) && <p>Earlier versions read: {item.history.filter(h => h.selfCompletedAt).map(h => h.version).join(', ')}</p>}</>}
    {!attachment && state.data?.unavailableHistory.length ? <p>{state.data.unavailableHistory.length} removed resource record(s) preserved. Files are unavailable.</p> : null}
    {!attachment && state.errorMessage && <p role="alert">{state.errorMessage}</p>}{!attachment && <span className="personal-status-message" aria-live="polite">{state.message}</span>}
  </section>
}
