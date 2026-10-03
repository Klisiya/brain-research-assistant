import { Link } from 'react-router-dom'
import { getPaperReadings, readingLabel } from '../../api/reading'
import { usePersonalState } from '../../hooks/usePersonalState'
import './PersonalReading.css'

export default function PaperReadingSummary() {
  const state = usePersonalState('paper-reading-summary', getPaperReadings)
  return <section className="learning-panel personal-reading-summary" aria-label="Paper Reading"><h2>Paper Reading</h2>
    {state.auth.status === 'anonymous' ? <p><Link to="/login">Sign in to view reading progress</Link></p>
      : state.auth.status === 'unavailable' ? <><p role="alert">Sign-in status unavailable.</p><button type="button" onClick={() => void state.refreshAuth()}>Retry sign-in</button></>
      : state.auth.status === 'loading' || state.loading ? <p role="status">Loading paper reading…</p>
      : state.error ? <><p role="alert">Paper reading is unavailable.</p><button type="button" onClick={state.retry}>Retry paper reading</button></>
      : !state.data?.length ? <p>No paper reading recorded yet. Open a published paper and explicitly start reading.</p>
      : <ul>{state.data.map(row => <li key={row.progressId}>{row.available ? <Link to={`/papers/${encodeURIComponent(row.paper.slug)}`}>{row.paper.title}</Link> : <span>Unavailable paper</span>}<span>{readingLabel(row.status)}</span>{row.lastActivityAt && <time dateTime={row.lastActivityAt}>Last activity: {new Date(row.lastActivityAt).toLocaleString('en-US')}</time>}</li>)}</ul>}
  </section>
}
