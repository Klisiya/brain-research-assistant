import { Link, useLocation } from 'react-router-dom'
import { getBookmarks, removeBookmark, saveBookmark, type BookmarkType } from '../../api/reading'
import { usePersonalState } from '../../hooks/usePersonalState'
import './PersonalReading.css'

export default function BookmarkControl({ targetType, targetId }: { targetType: BookmarkType; targetId: number }) {
  const state = usePersonalState(`bookmark:${targetType}:${targetId}`, getBookmarks)
  const location = useLocation(), name = targetType.replace('_', ' ')
  const saved = state.data?.find(b => b.targetType === targetType && b.available && b.target.id === targetId)
  return <div className="personal-controls bookmark-control" role="group" aria-label={`Bookmark ${name}`}>
    {state.auth.status === 'anonymous' ? <Link to="/login" state={{ from: location.pathname }}>Sign in to save</Link>
      : state.auth.status === 'unavailable' ? <><p role="alert">Sign-in status unavailable.</p><button type="button" onClick={() => void state.refreshAuth()}>Retry sign-in</button></>
      : state.auth.status === 'loading' || state.loading ? <p role="status">Loading bookmark…</p>
      : state.error ? <><p role="alert">Bookmark state unavailable.</p><button type="button" onClick={state.retry}>Retry bookmark</button></>
      : <button type="button" disabled={state.busy} aria-pressed={Boolean(saved)} aria-label={saved ? `Remove ${name} from bookmarks` : `Save ${name}`} onClick={() => void state.run(signal => saved ? removeBookmark(saved.id, signal) : saveBookmark(targetType, targetId, signal))}>{state.busy ? 'Saving…' : saved ? 'Saved · Remove Bookmark' : 'Save Bookmark'}</button>}
    {state.errorMessage && <p role="alert">{state.errorMessage}</p>}<span className="personal-status-message" aria-live="polite">{state.message}</span>
  </div>
}
