import { Link, useLocation } from 'react-router-dom'
import type { ManagementReadError } from './useManagementRead'

export default function ManagementRequestState({ error, subject, retry }: { error: ManagementReadError; subject: string; retry: () => void }) {
  const location = useLocation()
  return <section className="management-request-state" role="alert">
    <h2>{error === 'session' ? 'Sign In Required' : error === 'forbidden' ? 'Access Denied' : error === 'not-found' ? `${subject} not found` : `${subject} unavailable`}</h2>
    <p>{error === 'session' ? 'Your session has expired. Please sign in again.' : error === 'forbidden' ? 'Your account does not have permission to manage this content.' : error === 'not-found' ? 'This content does not exist or is no longer available.' : 'The request failed. Please try again.'}</p>
    {error === 'session' ? <Link to="/login" state={{ from: location.pathname, managementRequired: true }}>Sign In</Link> : error === 'unavailable' ? <button type="button" onClick={retry}>Try Again</button> : <Link to="/manage">Back to Management</Link>}
  </section>
}
